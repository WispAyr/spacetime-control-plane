import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpacetimeClient } from './spacetime-client';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
    mockFetch.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data)),
    };
}

function textResponse(text: string, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        text: () => Promise.resolve(text),
    };
}

describe('SpacetimeClient', () => {
    let client: SpacetimeClient;

    beforeEach(() => {
        client = new SpacetimeClient('http://localhost:3001');
    });

    describe('constructor', () => {
        it('strips trailing slashes from URL', () => {
            const c = new SpacetimeClient('http://localhost:3001///');
            expect(c.url).toBe('http://localhost:3001');
        });

        it('stores the base URL', () => {
            expect(client.url).toBe('http://localhost:3001');
        });
    });

    describe('ping', () => {
        it('returns true when identity endpoint responds 200', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
            expect(await client.ping()).toBe(true);
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:3001/v1/identity',
                expect.objectContaining({ method: 'POST' }),
            );
        });

        it('returns true for 401 on identity endpoint (auth required but alive)', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
            expect(await client.ping()).toBe(true);
        });

        it('returns true for 405 on identity endpoint (method not allowed but alive)', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 405 });
            expect(await client.ping()).toBe(true);
        });

        it('falls back to / when identity fails', async () => {
            mockFetch.mockRejectedValueOnce(new Error('connection refused'));
            mockFetch.mockResolvedValueOnce({ status: 404 });
            expect(await client.ping()).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('returns false when fully unreachable', async () => {
            mockFetch.mockRejectedValueOnce(new Error('connection refused'));
            mockFetch.mockRejectedValueOnce(new Error('connection refused'));
            expect(await client.ping()).toBe(false);
        });
    });

    describe('getSchema', () => {
        it('calls the correct URL with version 9', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                typespace: { types: [] },
                tables: [],
                reducers: [],
            }));

            await client.getSchema('my-database');
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:3001/v1/database/my-database/schema?version=9',
            );
        });

        it('encodes database names with special characters', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                typespace: { types: [] },
                tables: [],
                reducers: [],
            }));

            await client.getSchema('my database/name');
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:3001/v1/database/my%20database%2Fname/schema?version=9',
            );
        });

        it('throws on non-OK response', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));
            await expect(client.getSchema('bad')).rejects.toThrow('Failed to fetch schema: 404');
        });

        it('returns parsed tables and reducers', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                typespace: {
                    types: [
                        { Product: { elements: [{ name: { some: 'id' }, algebraic_type: { U64: [] } }] } },
                    ],
                },
                tables: [{
                    name: 'items',
                    product_type_ref: 0,
                    primary_key: [0],
                    indexes: [],
                    constraints: [],
                    sequences: [],
                    table_access: { Public: [] },
                }],
                reducers: [],
            }));

            const schema = await client.getSchema('test');
            expect(schema.tables).toHaveLength(1);
            expect(schema.tables[0].name).toBe('items');
        });
    });

    describe('sql', () => {
        it('sends POST with text/plain content type', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse([{
                schema: { elements: [] },
                rows: [],
            }]));

            await client.sql('mydb', 'SELECT * FROM test');
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:3001/v1/database/mydb/sql',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: 'SELECT * FROM test',
                },
            );
        });

        it('parses result rows and columns', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse([{
                schema: {
                    elements: [
                        { name: { some: 'name' }, algebraic_type: { String: [] } },
                    ],
                },
                rows: [['Alice'], ['Bob']],
            }]));

            const result = await client.sql('mydb', 'SELECT name FROM person');
            expect(result.columns).toEqual(['name']);
            expect(result.rows).toHaveLength(2);
            expect(result.rows[0]).toEqual({ name: 'Alice' });
            expect(result.duration).toBeGreaterThan(0);
        });

        it('throws on error response', async () => {
            mockFetch.mockResolvedValueOnce(textResponse('Table not found', 400));
            await expect(client.sql('mydb', 'SELECT * FROM nonexistent')).rejects.toThrow('Table not found');
        });
    });

    describe('listDatabases', () => {
        it('returns empty array (standalone mode)', async () => {
            const result = await client.listDatabases();
            expect(result).toEqual([]);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('callReducer', () => {
        it('sends POST with JSON body', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse(null));

            await client.callReducer('mydb', 'add', '{"name":"Alice"}');
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:3001/v1/database/mydb/call/add',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{"name":"Alice"}',
                },
            );
        });

        it('returns success on OK response', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse(null));
            const result = await client.callReducer('mydb', 'add', '{}');
            expect(result).toEqual({ success: true });
        });

        it('returns error on failure response', async () => {
            mockFetch.mockResolvedValueOnce(textResponse('Reducer not found', 404));
            const result = await client.callReducer('mydb', 'bad', '{}');
            expect(result).toEqual({ success: false, error: 'Reducer not found' });
        });
    });
});
