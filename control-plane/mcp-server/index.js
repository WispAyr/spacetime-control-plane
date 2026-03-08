#!/usr/bin/env node
/**
 * SpacetimeDB MCP Server
 *
 * Exposes a running SpacetimeDB instance as an MCP server, allowing AI agents
 * to discover schemas, query tables, call reducers, and manage AI observability.
 *
 * Transport: stdio (for local Claude Desktop / OpenClaw / MCP client integration)
 *
 * Tools:
 *   - spacetime_ping          Check if SpacetimeDB is reachable
 *   - spacetime_list_tables   List all tables in a database with column info
 *   - spacetime_get_schema    Get full schema (tables + reducers) for a database
 *   - spacetime_query         Run a SQL query against a database
 *   - spacetime_call_reducer  Call a reducer on a database
 *   - spacetime_add_database  Register a new database name for browsing
 *
 * Resources:
 *   - spacetime://schema/{database}  Full schema as JSON
 *   - spacetime://tables/{database}  Table listing
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// SpacetimeDB HTTP client (inline — no TS compilation needed)
// ─────────────────────────────────────────────────────────────

class SpacetimeClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }

    async ping() {
        try {
            const res = await fetch(`${this.baseUrl}/v1/identity`, {
                method: 'POST',
                signal: AbortSignal.timeout(5000),
            });
            return res.ok || res.status === 401 || res.status === 405;
        } catch {
            try {
                const res = await fetch(`${this.baseUrl}/`, {
                    signal: AbortSignal.timeout(5000),
                });
                return res.status > 0;
            } catch {
                return false;
            }
        }
    }

    async getSchema(db) {
        const res = await fetch(
            `${this.baseUrl}/v1/database/${encodeURIComponent(db)}/schema?version=9`
        );
        if (!res.ok) throw new Error(`Schema fetch failed: ${res.status}`);
        const raw = await res.json();
        return this.parseSchema(raw);
    }

    async sql(db, query) {
        const res = await fetch(
            `${this.baseUrl}/v1/database/${encodeURIComponent(db)}/sql`,
            { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: query }
        );
        if (!res.ok) {
            const err = await res.text();
            throw new Error(err);
        }
        const data = await res.json();
        return this.parseSqlResult(data);
    }

    async callReducer(db, reducer, args) {
        const res = await fetch(
            `${this.baseUrl}/v1/database/${encodeURIComponent(db)}/call/${reducer}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: args }
        );
        if (!res.ok) {
            const err = await res.text();
            return { success: false, error: err };
        }
        return { success: true };
    }

    parseSchema(raw) {
        const typespace = raw.typespace?.types || [];
        const tables = [];
        const reducers = [];

        for (const t of raw.tables || []) {
            const product = typespace[t.product_type_ref];
            const elements = product?.Product?.elements || [];
            const columns = elements.map((el, i) => ({
                name: this.optName(el.name),
                type: this.resolveType(el.algebraic_type),
                isPrimaryKey: (t.primary_key || []).includes(i),
                isAutoInc: (t.sequences || []).some(s => s.col_pos === i),
            }));
            tables.push({
                name: t.name,
                columns,
                isPublic: 'Public' in (t.table_access || {}),
                primaryKey: (t.primary_key || []).map(i => columns[i]?.name).filter(Boolean),
            });
        }

        for (const r of raw.reducers || []) {
            let params = [];
            if (typeof r.params === 'number') {
                const product = typespace[r.params];
                params = (product?.Product?.elements || []).map(el => ({
                    name: this.optName(el.name),
                    type: this.resolveType(el.algebraic_type),
                }));
            } else if (r.params?.elements) {
                params = r.params.elements.map(el => ({
                    name: this.optName(el.name),
                    type: this.resolveType(el.algebraic_type),
                }));
            }
            let lifecycle;
            if (r.lifecycle && typeof r.lifecycle === 'object') {
                if ('Init' in r.lifecycle) lifecycle = 'init';
                else if ('OnConnect' in r.lifecycle) lifecycle = 'client_connected';
                else if ('OnDisconnect' in r.lifecycle) lifecycle = 'client_disconnected';
            }
            reducers.push({ name: r.name, params, lifecycle });
        }

        return { tables, reducers };
    }

    parseSqlResult(data) {
        if (!data) return { columns: [], rows: [], rowCount: 0 };
        const results = Array.isArray(data) ? data : [data];
        if (results.length === 0) return { columns: [], rows: [], rowCount: 0 };
        const first = results[0];
        const columns = (first.schema?.elements || []).map(
            (el, i) => this.optName(el.name) || `col_${i}`
        );
        const rows = (first.rows || []).map(row => {
            const obj = {};
            if (Array.isArray(row)) {
                row.forEach((val, i) => { obj[columns[i] || `col_${i}`] = val; });
            }
            return obj;
        });
        return { columns, rows, rowCount: rows.length };
    }

    optName(opt) {
        if (!opt) return '';
        if (typeof opt === 'string') return opt;
        if (typeof opt === 'object' && 'some' in opt) return String(opt.some);
        return '';
    }

    resolveType(at) {
        if (!at || typeof at !== 'object') return 'unknown';
        for (const key of ['String', 'U8', 'U16', 'U32', 'U64', 'U128', 'I8', 'I16', 'I32', 'I64', 'I128',
            'Bool', 'F32', 'F64', 'Bytes', 'Identity', 'ConnectionId', 'Timestamp']) {
            if (key in at) return key.toLowerCase();
        }
        if ('Product' in at) return 'struct';
        if ('Sum' in at) return 'enum';
        if ('Array' in at) return `array<${this.resolveType(at.Array?.ty)}>`;
        if ('Map' in at) return 'map';
        if ('Ref' in at) return `ref(${at.Ref})`;
        return 'unknown';
    }
}

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

const SPACETIME_URL = process.env.SPACETIME_URL || 'http://localhost:3001';
const client = new SpacetimeClient(SPACETIME_URL);
const knownDatabases = new Set(
    (process.env.SPACETIME_DATABASES || '').split(',').filter(Boolean)
);

// ─────────────────────────────────────────────────────────────
// MCP Server
// ─────────────────────────────────────────────────────────────

const server = new McpServer({
    name: 'spacetime-control-plane',
    version: '1.0.0',
});

// ── Tools ────────────────────────────────────────────────────

server.tool(
    'spacetime_ping',
    'Check if the SpacetimeDB instance is reachable',
    {},
    async () => {
        const alive = await client.ping();
        return {
            content: [{
                type: 'text',
                text: alive
                    ? `✓ SpacetimeDB at ${SPACETIME_URL} is reachable`
                    : `✗ SpacetimeDB at ${SPACETIME_URL} is not reachable`,
            }],
        };
    }
);

server.tool(
    'spacetime_get_schema',
    'Get the full schema (tables, columns, reducers) for a SpacetimeDB database',
    { database: z.string().describe('Database name (e.g. "test-module-7970f")') },
    async ({ database }) => {
        try {
            const schema = await client.getSchema(database);
            knownDatabases.add(database);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(schema, null, 2),
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    'spacetime_list_tables',
    'List all tables in a database with their columns, types, and primary keys',
    { database: z.string().describe('Database name') },
    async ({ database }) => {
        try {
            const schema = await client.getSchema(database);
            knownDatabases.add(database);

            const lines = schema.tables.map(t => {
                const cols = t.columns.map(c => {
                    const flags = [
                        c.isPrimaryKey ? 'PK' : '',
                        c.isAutoInc ? 'auto' : '',
                    ].filter(Boolean).join(',');
                    return `  ${c.name}: ${c.type}${flags ? ` [${flags}]` : ''}`;
                }).join('\n');

                return `📖 ${t.name} (${t.isPublic ? 'public' : 'private'})\n${cols}`;
            });

            return {
                content: [{
                    type: 'text',
                    text: lines.length > 0
                        ? `${schema.tables.length} tables in ${database}:\n\n${lines.join('\n\n')}`
                        : `No tables found in ${database}`,
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    'spacetime_query',
    'Run a SQL query against a SpacetimeDB database and return the results',
    {
        database: z.string().describe('Database name'),
        query: z.string().describe('SQL query (e.g. "SELECT * FROM person")'),
    },
    async ({ database, query }) => {
        try {
            const result = await client.sql(database, query);
            knownDatabases.add(database);

            if (result.rowCount === 0) {
                return {
                    content: [{ type: 'text', text: `Query returned 0 rows.\nColumns: ${result.columns.join(', ')}` }],
                };
            }

            // Format as markdown table
            const header = `| ${result.columns.join(' | ')} |`;
            const divider = `| ${result.columns.map(() => '---').join(' | ')} |`;
            const rows = result.rows.map(row =>
                `| ${result.columns.map(c => String(row[c] ?? '')).join(' | ')} |`
            ).join('\n');

            return {
                content: [{
                    type: 'text',
                    text: `${result.rowCount} rows returned:\n\n${header}\n${divider}\n${rows}`,
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `SQL Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    'spacetime_call_reducer',
    'Call a reducer (server-side function) on a SpacetimeDB database',
    {
        database: z.string().describe('Database name'),
        reducer: z.string().describe('Reducer name (e.g. "add")'),
        args: z.string().describe('JSON arguments (e.g. \'{"name": "Alice"}\')'),
    },
    async ({ database, reducer, args }) => {
        try {
            const result = await client.callReducer(database, reducer, args);
            knownDatabases.add(database);
            return {
                content: [{
                    type: 'text',
                    text: result.success
                        ? `✓ Reducer "${reducer}" called successfully on ${database}`
                        : `✗ Reducer "${reducer}" failed: ${result.error}`,
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    'spacetime_add_database',
    'Register a database name for browsing (SpacetimeDB standalone doesn\'t list databases)',
    { database: z.string().describe('Database name to register') },
    async ({ database }) => {
        knownDatabases.add(database);
        return {
            content: [{
                type: 'text',
                text: `Registered database "${database}". Known databases: ${[...knownDatabases].join(', ')}`,
            }],
        };
    }
);

server.tool(
    'spacetime_list_databases',
    'List all known/registered databases on this SpacetimeDB instance',
    {},
    async () => {
        const dbs = [...knownDatabases];
        if (dbs.length === 0) {
            return {
                content: [{
                    type: 'text',
                    text: 'No databases registered. Use spacetime_add_database or spacetime_get_schema to register one.',
                }],
            };
        }

        // Get stats for each
        const lines = await Promise.all(dbs.map(async (db) => {
            try {
                const schema = await client.getSchema(db);
                const totalRows = await Promise.all(schema.tables.map(async (t) => {
                    try {
                        const res = await client.sql(db, `SELECT COUNT(*) FROM ${t.name}`);
                        return Number(Object.values(res.rows[0] || {})[0]) || 0;
                    } catch { return 0; }
                }));
                const rows = totalRows.reduce((a, b) => a + b, 0);
                return `🟢 ${db}: ${schema.tables.length} tables, ${schema.reducers.length} reducers, ${rows} rows`;
            } catch {
                return `🔴 ${db}: unreachable or invalid`;
            }
        }));

        return {
            content: [{
                type: 'text',
                text: `${dbs.length} known databases:\n\n${lines.join('\n')}`,
            }],
        };
    }
);

server.tool(
    'spacetime_describe_table',
    'Get detailed information about a specific table including columns, types, and sample data',
    {
        database: z.string().describe('Database name'),
        table: z.string().describe('Table name'),
    },
    async ({ database, table }) => {
        try {
            const schema = await client.getSchema(database);
            const tableSchema = schema.tables.find(t => t.name === table);
            if (!tableSchema) {
                return {
                    content: [{ type: 'text', text: `Table "${table}" not found in ${database}. Available: ${schema.tables.map(t => t.name).join(', ')}` }],
                    isError: true,
                };
            }

            // Get row count and sample
            const countRes = await client.sql(database, `SELECT COUNT(*) FROM ${table}`);
            const rowCount = Number(Object.values(countRes.rows[0] || {})[0]) || 0;

            let sampleText = '';
            if (rowCount > 0) {
                const sampleRes = await client.sql(database, `SELECT * FROM ${table} LIMIT 5`);
                const header = `| ${sampleRes.columns.join(' | ')} |`;
                const divider = `| ${sampleRes.columns.map(() => '---').join(' | ')} |`;
                const rows = sampleRes.rows.map(row =>
                    `| ${sampleRes.columns.map(c => String(row[c] ?? '')).join(' | ')} |`
                ).join('\n');
                sampleText = `\n\nSample data (first 5 rows):\n${header}\n${divider}\n${rows}`;
            }

            const colList = tableSchema.columns.map(c => {
                const flags = [];
                if (c.isPrimaryKey) flags.push('PK');
                if (c.isAutoInc) flags.push('auto_inc');
                return `  ${c.name}: ${c.type}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
            }).join('\n');

            return {
                content: [{
                    type: 'text',
                    text: `Table: ${table} (${tableSchema.isPublic ? 'public' : 'private'})\nRows: ${rowCount}\nPrimary Key: ${tableSchema.primaryKey?.join(', ') || 'none'}\n\nColumns:\n${colList}${sampleText}`,
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    'spacetime_list_reducers',
    'List all reducers (server-side functions) available in a database with their parameter signatures',
    { database: z.string().describe('Database name') },
    async ({ database }) => {
        try {
            const schema = await client.getSchema(database);
            knownDatabases.add(database);

            const userReducers = schema.reducers.filter(r => !r.lifecycle);
            const lifecycleReducers = schema.reducers.filter(r => r.lifecycle);

            const lines = userReducers.map(r => {
                const params = r.params.length > 0
                    ? `(${r.params.map(p => `${p.name}: ${p.type}`).join(', ')})`
                    : '()';
                return `  ƒ ${r.name}${params}`;
            });

            let text = `${userReducers.length} user reducers in ${database}:\n\n${lines.join('\n')}`;
            if (lifecycleReducers.length > 0) {
                text += `\n\n${lifecycleReducers.length} lifecycle reducers: ${lifecycleReducers.map(r => `${r.name} [${r.lifecycle}]`).join(', ')}`;
            }

            return {
                content: [{ type: 'text', text }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);


// ── Control Plane Tools (via backend service) ────────────────

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

server.tool(
    'cp_list_tenants',
    'List all registered tenants in the control plane with their status and database info',
    {},
    async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/tenants`);
            if (!res.ok) throw new Error('Backend unreachable');
            const tenants = await res.json();
            const lines = tenants.map(t =>
                `${t.status === 'deployed' ? '🟢' : '🔴'} ${t.name} (db: ${t.database || 'none'}) — ${t.status}, ${t.deployHistory.length} deploys`
            );
            return {
                content: [{ type: 'text', text: tenants.length > 0 ? lines.join('\n') : 'No tenants registered' }],
            };
        } catch (err) {
            return { content: [{ type: 'text', text: `Backend error: ${err.message}. Is the backend running on ${BACKEND_URL}?` }], isError: true };
        }
    }
);

server.tool(
    'cp_deploy_tenant',
    'Deploy a registered tenant module to SpacetimeDB',
    { tenantId: z.string().describe('Tenant UUID') },
    async ({ tenantId }) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/tenants/${tenantId}/deploy`, { method: 'POST' });
            const data = await res.json();
            return {
                content: [{ type: 'text', text: data.success ? `✓ Deployed: ${data.output}` : `✗ Failed: ${data.error}` }],
            };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.tool(
    'cp_monitoring_overview',
    'Get aggregate monitoring stats for all tenants — counts, deploy history, health',
    {},
    async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/monitoring/overview`);
            if (!res.ok) throw new Error('Backend unreachable');
            const data = await res.json();
            const summary = [
                `Total tenants: ${data.totalTenants}`,
                `Deployed: ${data.deployedTenants}`,
                `Errors: ${data.errorTenants}`,
                `Total deploys: ${data.totalDeploys}`,
                `\nTenant summaries:`,
                ...data.tenantSummaries.map(t =>
                    `  ${t.status === 'online' ? '🟢' : '🔴'} ${t.name}: ${t.tables} tables, ${t.reducers} reducers`
                ),
            ];
            return { content: [{ type: 'text', text: summary.join('\n') }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.tool(
    'cp_backup_tenant',
    'Create a full backup of a tenant\'s data (exports all tables via SQL)',
    { tenantId: z.string().describe('Tenant UUID') },
    async ({ tenantId }) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/tenants/${tenantId}/backup`, { method: 'POST' });
            const data = await res.json();
            return {
                content: [{
                    type: 'text', text: data.success
                        ? `✓ Backup: ${data.filename} (${data.tables} tables, ${(data.sizeBytes / 1024).toFixed(1)}KB)`
                        : `✗ Backup failed: ${data.error}`
                }],
            };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.tool(
    'cp_create_api_key',
    'Generate a new API key for programmatic access to the control plane',
    { name: z.string().describe('Key name (e.g. "ci-pipeline")') },
    async ({ name }) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/auth/keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const key = await res.json();
            return {
                content: [{ type: 'text', text: `✓ API Key created:\n  Name: ${key.name}\n  Key: ${key.key}\n  Scopes: ${key.scopes.join(', ')}` }],
            };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.tool(
    'cp_add_rls_policy',
    'Add a row-level security policy to a tenant\'s table',
    {
        tenantId: z.string().describe('Tenant UUID'),
        table: z.string().describe('Table name'),
        operation: z.enum(['all', 'read', 'insert', 'update', 'delete']).describe('Operation to guard'),
        condition: z.string().describe('Guard condition (e.g. "owner_id == ctx.sender")'),
    },
    async ({ tenantId, table, operation, condition }) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/tenants/${tenantId}/policies`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table, operation, condition }),
            });
            const policy = await res.json();
            return {
                content: [{ type: 'text', text: `✓ RLS policy created: ${operation.toUpperCase()} on ${table} where ${condition}` }],
            };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

// ── Work Orchestration MCP Tools ─────────────────────────────

server.tool(
    'cp_list_workers',
    'List registered workers (human + AI)',
    {},
    async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/workers`);
            const data = await res.json();
            const table = data.map(w =>
                `| ${w.type === 'ai' ? '🤖' : '👤'} ${w.name} | ${w.status} | ${w.currentTask || 'idle'} | ${w.tasksCompleted} done |`
            ).join('\n');
            return { content: [{ type: 'text', text: `Workers (${data.length}):\n| Worker | Status | Task | Completed |\n|--------|--------|------|----------|\n${table}` }] };
        } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
);

server.tool(
    'cp_register_worker',
    'Register yourself as a worker (human or AI)',
    { name: z.string().describe('Worker name'), type: z.enum(['human', 'ai']).describe('Worker type') },
    async ({ name, type }) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/workers`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, type }),
            });
            const data = await res.json();
            if (!res.ok) return { content: [{ type: 'text', text: `Error: ${data.error}` }], isError: true };
            return { content: [{ type: 'text', text: `✓ Registered worker: ${name} (${type}) — ID: ${data.id}` }] };
        } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
);

server.tool(
    'cp_list_tasks',
    'List tasks with optional status filter',
    { status: z.enum(['backlog', 'claimed', 'in_progress', 'review', 'done']).optional().describe('Filter by status') },
    async ({ status }) => {
        try {
            const url = status ? `${BACKEND_URL}/api/tasks?status=${status}` : `${BACKEND_URL}/api/tasks`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.length === 0) return { content: [{ type: 'text', text: 'No tasks found' }] };
            const table = data.map(t =>
                `| ${t.title} | ${t.status} | ${t.priority} | ${t.claimedByName || '-'} |`
            ).join('\n');
            return { content: [{ type: 'text', text: `Tasks (${data.length}):\n| Title | Status | Priority | Claimed By |\n|-------|--------|----------|------------|\n${table}` }] };
        } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
);

server.tool(
    'cp_claim_task',
    'Claim a task (atomic — fails if already claimed)',
    { taskId: z.string().describe('Task ID to claim'), workerId: z.string().describe('Your worker ID') },
    async ({ taskId, workerId }) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/tasks/${taskId}/claim`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workerId }),
            });
            const data = await res.json();
            if (!res.ok) return { content: [{ type: 'text', text: `❌ ${data.error}${data.claimedBy ? ` by ${data.claimedBy.name}` : ''}` }], isError: true };
            return { content: [{ type: 'text', text: `✓ Claimed: ${data.title}` }] };
        } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
);

server.tool(
    'cp_complete_task',
    'Complete a claimed task with optional output',
    { taskId: z.string().describe('Task ID'), workerId: z.string().describe('Your worker ID'), output: z.string().optional().describe('Result/notes') },
    async ({ taskId, workerId, output }) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/tasks/${taskId}/complete`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workerId, output }),
            });
            const data = await res.json();
            if (!res.ok) return { content: [{ type: 'text', text: `Error: ${data.error}` }], isError: true };
            return { content: [{ type: 'text', text: `✓ Completed: ${data.title}` }] };
        } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
);

// ── Operations MCP Tools ─────────────────────────────────────

server.tool(
    'cp_list_migrations',
    'List schema migration history for a tenant',
    { tenantId: z.string().optional().describe('Tenant ID to filter (optional)') },
    async ({ tenantId }) => {
        try {
            const url = tenantId ? `${BACKEND_URL}/api/migrations?tenantId=${tenantId}` : `${BACKEND_URL}/api/migrations`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.length === 0) return { content: [{ type: 'text', text: 'No migrations found' }] };
            const table = data.map(m =>
                `| v${m.version} | ${m.tenantName} | ${m.status} | ${m.schemaSnapshot?.tables || '?'} tables | ${new Date(m.timestamp).toLocaleString()} |`
            ).join('\n');
            return { content: [{ type: 'text', text: `Migrations (${data.length}):\n| Version | Tenant | Status | Schema | Date |\n|---------|--------|--------|--------|------|\n${table}` }] };
        } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
);

server.tool(
    'cp_rollback',
    'Rollback a tenant to a specific migration version',
    { migrationId: z.string().describe('Migration ID to rollback to') },
    async ({ migrationId }) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/migrations/${migrationId}/rollback`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!res.ok) return { content: [{ type: 'text', text: `Error: ${data.error}` }], isError: true };
            return { content: [{ type: 'text', text: `✓ Rolled back: ${data.notes} (now at v${data.version})` }] };
        } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
);

server.tool(
    'cp_promote_env',
    'Promote tenant environment (dev→staging or staging→prod)',
    { tenantId: z.string().describe('Tenant ID'), from: z.enum(['dev', 'staging']).describe('Source environment'), to: z.enum(['staging', 'prod']).describe('Target environment') },
    async ({ tenantId, from, to }) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/tenants/${tenantId}/promote`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from, to }),
            });
            const data = await res.json();
            if (!res.ok) return { content: [{ type: 'text', text: `Error: ${data.error}` }], isError: true };
            return { content: [{ type: 'text', text: `✓ Promoted ${from} → ${to}. Active environment: ${data.active}` }] };
        } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
);

// ── Resources ────────────────────────────────────────────────

server.resource(
    'spacetime-instance',
    'spacetime://instance',
    async (uri) => ({
        contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
                url: SPACETIME_URL,
                knownDatabases: [...knownDatabases],
            }, null, 2),
        }],
    })
);

// ── Start ────────────────────────────────────────────────────

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`SpacetimeDB MCP server running (${SPACETIME_URL})`);
    if (knownDatabases.size > 0) {
        console.error(`Pre-registered databases: ${[...knownDatabases].join(', ')}`);
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
