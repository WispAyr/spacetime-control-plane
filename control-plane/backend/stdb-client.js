/**
 * SpacetimeDB HTTP Client — dogfooding wrapper.
 *
 * The control plane uses SpacetimeDB as its own database.
 * This module provides a thin HTTP API client for:
 *   - SQL queries (SELECT from tables)
 *   - Reducer calls (INSERT/UPDATE/DELETE via reducers)
 *   - Schema introspection
 */

const SPACETIME_URL = process.env.SPACETIME_URL || 'http://localhost:3001';
const CP_DATABASE = process.env.CP_DATABASE || 'control-plane-module-8zn73';

/**
 * Execute a SQL query against the control plane database.
 * @param {string} sql - SQL query string
 * @param {string} [database] - Override database name
 * @returns {Promise<object[]>} Array of row objects
 */
export async function query(sql, database = CP_DATABASE) {
    const res = await fetch(`${SPACETIME_URL}/v1/database/${database}/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: sql,
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`SpacetimeDB query failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    // SpacetimeDB returns an array of result sets; each has schema + rows
    if (!Array.isArray(data) || data.length === 0) return [];
    const resultSet = data[0];
    if (!resultSet.schema || !resultSet.rows) return [];

    const columns = resultSet.schema.elements.map(e => e.name?.some || e.name || `col_${e}`);
    return resultSet.rows.map(row => {
        const obj = {};
        columns.forEach((col, i) => {
            obj[col] = row[i];
        });
        return obj;
    });
}

/**
 * Call a reducer on the control plane database.
 * @param {string} reducer - Reducer name
 * @param {object} args - Reducer arguments
 * @param {string} [database] - Override database name
 * @returns {Promise<void>}
 */
// BigInt-safe JSON serializer — SpacetimeDB expects numbers for U64/I32/etc.
function bigintSafeStringify(obj) {
    return JSON.stringify(obj, (_, value) =>
        typeof value === 'bigint' ? Number(value) : value
    );
}

export async function callReducer(reducer, args, database = CP_DATABASE) {
    // SpacetimeDB converts TS camelCase exports to snake_case reducer names
    const snakeReducer = reducer.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`);
    const res = await fetch(`${SPACETIME_URL}/v1/database/${database}/call/${snakeReducer}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bigintSafeStringify(args),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`SpacetimeDB reducer '${reducer}' failed (${res.status}): ${text}`);
    }
}

/**
 * Query a single row by primary key.
 * @param {string} table - Table name
 * @param {string} pkColumn - Primary key column name
 * @param {string|number} pkValue - Primary key value
 * @returns {Promise<object|null>}
 */
export async function findById(table, pkColumn, pkValue) {
    const val = typeof pkValue === 'string' ? `'${pkValue.replace(/'/g, "''")}'` : pkValue;
    const rows = await query(`SELECT * FROM ${table} WHERE ${pkColumn} = ${val}`);
    return rows.length > 0 ? rows[0] : null;
}

/**
 * Query all rows from a table with optional WHERE clause.
 * @param {string} table - Table name
 * @param {string} [where] - Optional WHERE clause (without the WHERE keyword)
 * @returns {Promise<object[]>}
 */
export async function findAll(table, where = '') {
    const sql = where ? `SELECT * FROM ${table} WHERE ${where}` : `SELECT * FROM ${table}`;
    return query(sql);
}

/**
 * Get the schema for a specific database (for tenant introspection, NOT for self).
 * @param {string} database - Database name
 * @returns {Promise<object>}
 */
export async function getSchema(database) {
    const res = await fetch(`${SPACETIME_URL}/v1/database/${database}/schema?expand=true`, {
        signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Schema fetch failed: ${res.status}`);
    return res.json();
}

/**
 * Execute a SQL query against a TENANT database (not the control plane).
 * Used for table data browsing, SQL console, etc.
 */
export async function queryTenant(database, sql) {
    return query(sql, database);
}

export const STDB_URL = SPACETIME_URL;
export const STDB_CP_DB = CP_DATABASE;
