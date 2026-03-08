/**
 * SpacetimeDB HTTP API client for schema discovery and SQL queries.
 * Targets SpacetimeDB v2.0.3 standalone API.
 */

export interface SpacetimeInstance {
  id: string;
  name: string;
  url: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  error?: string;
  databases?: DatabaseInfo[];
}

export interface DatabaseInfo {
  identity: string;
  name?: string;
  hostType: string;
  numReplicas: number;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primaryKey?: string[];
  indexes: IndexSchema[];
  isPublic: boolean;
  rowCount?: number;
}

export interface ColumnSchema {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isAutoInc: boolean;
  isUnique: boolean;
  isNullable: boolean;
}

export interface IndexSchema {
  name: string;
  columns: string[];
  isUnique: boolean;
}

export interface ReducerSchema {
  name: string;
  params: ReducerParam[];
  lifecycle?: string;
}

export interface ReducerParam {
  name: string;
  type: string;
}

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration?: number;
}

export class SpacetimeClient {
  private baseUrl: string;

  constructor(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  get url() {
    return this.baseUrl;
  }

  /** Check if the SpacetimeDB instance is reachable */
  async ping(): Promise<boolean> {
    try {
      // Try to hit the identity endpoint — it exists on all instances
      const res = await fetch(`${this.baseUrl}/v1/identity`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
      return res.ok || res.status === 401 || res.status === 405;
    } catch {
      // Fall back to just checking TCP connection
      try {
        const res = await fetch(`${this.baseUrl}/`, {
          signal: AbortSignal.timeout(5000),
        });
        // Even a 404 means the server is up
        return res.status > 0;
      } catch {
        return false;
      }
    }
  }

  /** Get the module schema for a database (v2.0.3 API) */
  async getSchema(nameOrIdentity: string): Promise<{
    tables: TableSchema[];
    reducers: ReducerSchema[];
  }> {
    const res = await fetch(
      `${this.baseUrl}/v1/database/${encodeURIComponent(nameOrIdentity)}/schema?version=9`
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch schema: ${res.status} ${res.statusText}`);
    }
    const raw = await res.json();
    return parseSchemaV9(raw);
  }

  /** Run a SQL query against a database */
  async sql(nameOrIdentity: string, query: string): Promise<SqlResult> {
    const startTime = performance.now();
    const res = await fetch(
      `${this.baseUrl}/v1/database/${encodeURIComponent(nameOrIdentity)}/sql`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: query,
      }
    );
    const duration = performance.now() - startTime;

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText);
    }

    const data = await res.json();
    return {
      ...parseSqlResult(data),
      duration,
    };
  }

  /** List databases — not directly supported in standalone, so we return empty */
  async listDatabases(): Promise<DatabaseInfo[]> {
    // Standalone doesn't have a /database list endpoint
    // We return empty; user will enter the database name manually
    return [];
  }

  /** Call a reducer on a database */
  async callReducer(
    nameOrIdentity: string,
    reducer: string,
    args: string
  ): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(
      `${this.baseUrl}/v1/database/${encodeURIComponent(nameOrIdentity)}/call/${reducer}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: args,
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: errText };
    }

    return { success: true };
  }
}

/**
 * Parse SpacetimeDB v9 schema format.
 * Schema has: typespace.types[], tables[], reducers[]
 * Types use: Product { elements: [{ name: {some: "x"}, algebraic_type: {String: []} }] }
 */
export function parseSchemaV9(raw: RawSchema): { tables: TableSchema[]; reducers: ReducerSchema[] } {
  const typespace = raw.typespace?.types || [];
  const tables: TableSchema[] = [];
  const reducers: ReducerSchema[] = [];

  // Parse tables
  for (const t of raw.tables || []) {
    const typeRef = t.product_type_ref;
    const productType = typespace[typeRef];
    const elements = productType?.Product?.elements || [];

    const columns: ColumnSchema[] = elements.map((el: RawElement) => ({
      name: extractOptionalName(el.name),
      type: resolveAlgebraicType(el.algebraic_type),
      isPrimaryKey: (t.primary_key || []).includes(elements.indexOf(el)),
      isAutoInc: (t.sequences || []).some((s: RawSequence) => s.col_pos === elements.indexOf(el)),
      isUnique: (t.constraints || []).some((c: RawConstraint) =>
        c.data?.Unique?.columns?.includes(elements.indexOf(el))
      ),
      isNullable: false,
    }));

    tables.push({
      name: t.name,
      columns,
      primaryKey: (t.primary_key || []).map((idx: number) => columns[idx]?.name).filter(Boolean),
      indexes: (t.indexes || []).map((idx: RawIndex) => ({
        name: idx.name || '',
        columns: (idx.columns || []).map((c: number) => columns[c]?.name).filter(Boolean),
        isUnique: idx.is_unique || false,
      })),
      isPublic: 'Public' in (t.table_access || {}),
    });
  }

  // Parse reducers
  for (const r of raw.reducers || []) {
    const paramTypeRef = r.params;
    let params: ReducerParam[] = [];

    // params can be a type ref or inline Product
    if (typeof paramTypeRef === 'number') {
      const productType = typespace[paramTypeRef];
      const elements = productType?.Product?.elements || [];
      params = elements.map((el: RawElement) => ({
        name: extractOptionalName(el.name),
        type: resolveAlgebraicType(el.algebraic_type),
      }));
    } else if (paramTypeRef?.elements) {
      params = paramTypeRef.elements.map((el: RawElement) => ({
        name: extractOptionalName(el.name),
        type: resolveAlgebraicType(el.algebraic_type),
      }));
    }

    // Detect lifecycle reducers
    let lifecycle: string | undefined;
    const lc = r.lifecycle;
    if (lc && typeof lc === 'object') {
      if ('Init' in lc) lifecycle = 'init';
      else if ('OnConnect' in lc) lifecycle = 'client_connected';
      else if ('OnDisconnect' in lc) lifecycle = 'client_disconnected';
    }

    reducers.push({
      name: r.name,
      params,
      lifecycle,
    });
  }

  return { tables, reducers };
}

/** Extract name from SpacetimeDB's optional format: {some: "name"} or {none: []} */
export function extractOptionalName(opt: unknown): string {
  if (!opt) return '';
  if (typeof opt === 'string') return opt;
  if (typeof opt === 'object') {
    const o = opt as Record<string, unknown>;
    if ('some' in o) return String(o.some);
  }
  return '';
}

/** Resolve SpacetimeDB algebraic type to a human-readable string */
export function resolveAlgebraicType(at: unknown): string {
  if (!at || typeof at !== 'object') return 'unknown';
  const t = at as Record<string, unknown>;

  // Builtin types: {String: []}, {U32: []}, {Bool: []}, etc.
  for (const key of ['String', 'U8', 'U16', 'U32', 'U64', 'U128', 'U256',
    'I8', 'I16', 'I32', 'I64', 'I128', 'I256',
    'Bool', 'F32', 'F64', 'Bytes', 'Identity', 'ConnectionId', 'Timestamp']) {
    if (key in t) return key.toLowerCase();
  }

  if ('Product' in t) return 'struct';
  if ('Sum' in t) return 'enum';
  if ('Array' in t) {
    const inner = (t.Array as Record<string, unknown>)?.ty;
    return `array<${resolveAlgebraicType(inner)}>`;
  }
  if ('Map' in t) return 'map';
  if ('Ref' in t) return `ref(${t.Ref})`;

  return 'unknown';
}

export function parseSqlResult(data: unknown): Omit<SqlResult, 'duration'> {
  if (!data) return { columns: [], rows: [], rowCount: 0 };

  const results = Array.isArray(data) ? data : [data];
  if (results.length === 0) return { columns: [], rows: [], rowCount: 0 };

  const first = results[0] as RawSqlResult;
  const rawRows = first.rows || [];

  // Extract column names from schema
  const columns: string[] = [];
  if (first.schema?.elements) {
    for (const el of first.schema.elements) {
      columns.push(extractOptionalName(el.name) || `col_${columns.length}`);
    }
  }

  const rows = rawRows.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {};
    if (Array.isArray(row)) {
      row.forEach((val, i) => {
        obj[columns[i] || `col_${i}`] = val;
      });
    }
    return obj;
  });

  return { columns, rows, rowCount: rows.length };
}

// Raw type definitions for the SpacetimeDB v9 schema format
interface RawSchema {
  typespace?: { types: RawType[] };
  tables?: RawTable[];
  reducers?: RawReducer[];
}

interface RawType {
  Product?: { elements: RawElement[] };
  Sum?: unknown;
}

interface RawElement {
  name: unknown; // {some: "name"} | {none: []}
  algebraic_type: unknown;
}

interface RawTable {
  name: string;
  product_type_ref: number;
  primary_key: number[];
  indexes: RawIndex[];
  constraints: RawConstraint[];
  sequences: RawSequence[];
  table_access: Record<string, unknown>;
  schedule?: unknown;
  table_type?: unknown;
}

interface RawIndex {
  name?: string;
  columns?: number[];
  is_unique?: boolean;
}

interface RawConstraint {
  data?: { Unique?: { columns?: number[] } };
}

interface RawSequence {
  col_pos?: number;
}

interface RawReducer {
  name: string;
  params: number | { elements: RawElement[] };
  lifecycle?: Record<string, unknown>;
}

interface RawSqlResult {
  schema?: { elements: RawElement[] };
  rows?: unknown[][];
  total_duration_micros?: number;
}
