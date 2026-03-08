import { describe, it, expect } from 'vitest';
import {
    extractOptionalName,
    resolveAlgebraicType,
    parseSchemaV9,
    parseSqlResult,
} from './spacetime-client';

// ─────────────────────────────────────────────────────────────
// extractOptionalName
// ─────────────────────────────────────────────────────────────
describe('extractOptionalName', () => {
    it('extracts name from {some: "x"} format', () => {
        expect(extractOptionalName({ some: 'id' })).toBe('id');
        expect(extractOptionalName({ some: 'name' })).toBe('name');
    });

    it('returns string directly if already a string', () => {
        expect(extractOptionalName('my_column')).toBe('my_column');
    });

    it('returns empty string for {none: []}', () => {
        expect(extractOptionalName({ none: [] })).toBe('');
    });

    it('returns empty string for null/undefined', () => {
        expect(extractOptionalName(null)).toBe('');
        expect(extractOptionalName(undefined)).toBe('');
    });

    it('returns empty string for non-object/non-string values', () => {
        expect(extractOptionalName(42)).toBe('');
        expect(extractOptionalName(true)).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────
// resolveAlgebraicType
// ─────────────────────────────────────────────────────────────
describe('resolveAlgebraicType', () => {
    it('resolves builtin types to lowercase', () => {
        expect(resolveAlgebraicType({ String: [] })).toBe('string');
        expect(resolveAlgebraicType({ U32: [] })).toBe('u32');
        expect(resolveAlgebraicType({ U64: [] })).toBe('u64');
        expect(resolveAlgebraicType({ I32: [] })).toBe('i32');
        expect(resolveAlgebraicType({ Bool: [] })).toBe('bool');
        expect(resolveAlgebraicType({ F64: [] })).toBe('f64');
        expect(resolveAlgebraicType({ Identity: [] })).toBe('identity');
        expect(resolveAlgebraicType({ Timestamp: [] })).toBe('timestamp');
        expect(resolveAlgebraicType({ Bytes: [] })).toBe('bytes');
        expect(resolveAlgebraicType({ ConnectionId: [] })).toBe('connectionid');
    });

    it('resolves complex types', () => {
        expect(resolveAlgebraicType({ Product: {} })).toBe('struct');
        expect(resolveAlgebraicType({ Sum: {} })).toBe('enum');
        expect(resolveAlgebraicType({ Map: {} })).toBe('map');
        expect(resolveAlgebraicType({ Ref: 3 })).toBe('ref(3)');
    });

    it('resolves array types recursively', () => {
        expect(resolveAlgebraicType({ Array: { ty: { U8: [] } } })).toBe('array<u8>');
        expect(resolveAlgebraicType({ Array: { ty: { String: [] } } })).toBe('array<string>');
    });

    it('returns unknown for null, undefined, or unexpected shapes', () => {
        expect(resolveAlgebraicType(null)).toBe('unknown');
        expect(resolveAlgebraicType(undefined)).toBe('unknown');
        expect(resolveAlgebraicType({})).toBe('unknown');
        expect(resolveAlgebraicType('string')).toBe('unknown');
    });
});

// ─────────────────────────────────────────────────────────────
// parseSchemaV9
// ─────────────────────────────────────────────────────────────
describe('parseSchemaV9', () => {
    // Realistic SpacetimeDB v9 schema for a "person" table
    const personSchema = {
        typespace: {
            types: [
                // type 0: Person product type
                {
                    Product: {
                        elements: [
                            { name: { some: 'id' }, algebraic_type: { U64: [] } },
                            { name: { some: 'name' }, algebraic_type: { String: [] } },
                        ],
                    },
                },
                // type 1: add reducer params
                {
                    Product: {
                        elements: [
                            { name: { some: 'name' }, algebraic_type: { String: [] } },
                        ],
                    },
                },
            ],
        },
        tables: [
            {
                name: 'person',
                product_type_ref: 0,
                primary_key: [0],
                indexes: [{ name: 'pk_person_id', columns: [0], is_unique: true }],
                constraints: [{ data: { Unique: { columns: [0] } } }],
                sequences: [{ col_pos: 0 }],
                table_access: { Public: [] },
            },
        ],
        reducers: [
            { name: 'add', params: 1, lifecycle: {} },
            { name: '__init__', params: { elements: [] }, lifecycle: { Init: [] } },
        ],
    };

    it('parses tables correctly', () => {
        const { tables } = parseSchemaV9(personSchema);
        expect(tables).toHaveLength(1);
        expect(tables[0].name).toBe('person');
        expect(tables[0].isPublic).toBe(true);
    });

    it('parses columns from typespace reference', () => {
        const { tables } = parseSchemaV9(personSchema);
        const cols = tables[0].columns;
        expect(cols).toHaveLength(2);

        expect(cols[0].name).toBe('id');
        expect(cols[0].type).toBe('u64');
        expect(cols[0].isPrimaryKey).toBe(true);
        expect(cols[0].isAutoInc).toBe(true);
        expect(cols[0].isUnique).toBe(true);

        expect(cols[1].name).toBe('name');
        expect(cols[1].type).toBe('string');
        expect(cols[1].isPrimaryKey).toBe(false);
        expect(cols[1].isAutoInc).toBe(false);
    });

    it('parses primary key column names', () => {
        const { tables } = parseSchemaV9(personSchema);
        expect(tables[0].primaryKey).toEqual(['id']);
    });

    it('parses indexes', () => {
        const { tables } = parseSchemaV9(personSchema);
        expect(tables[0].indexes).toHaveLength(1);
        expect(tables[0].indexes[0].name).toBe('pk_person_id');
        expect(tables[0].indexes[0].isUnique).toBe(true);
    });

    it('parses reducers with type ref params', () => {
        const { reducers } = parseSchemaV9(personSchema);
        const addReducer = reducers.find(r => r.name === 'add');
        expect(addReducer).toBeDefined();
        expect(addReducer!.params).toHaveLength(1);
        expect(addReducer!.params[0].name).toBe('name');
        expect(addReducer!.params[0].type).toBe('string');
        expect(addReducer!.lifecycle).toBeUndefined(); // empty {} not a lifecycle
    });

    it('detects lifecycle reducers', () => {
        const { reducers } = parseSchemaV9(personSchema);
        const initReducer = reducers.find(r => r.name === '__init__');
        expect(initReducer).toBeDefined();
        expect(initReducer!.lifecycle).toBe('init');
        expect(initReducer!.params).toHaveLength(0);
    });

    it('detects private tables', () => {
        const schema = {
            typespace: { types: [{ Product: { elements: [] } }] },
            tables: [{
                name: 'private_data',
                product_type_ref: 0,
                primary_key: [],
                indexes: [],
                constraints: [],
                sequences: [],
                table_access: { Private: [] },
            }],
            reducers: [],
        };
        const { tables } = parseSchemaV9(schema);
        expect(tables[0].isPublic).toBe(false);
    });

    it('handles empty schema', () => {
        const { tables, reducers } = parseSchemaV9({});
        expect(tables).toEqual([]);
        expect(reducers).toEqual([]);
    });

    it('handles schema with multiple tables', () => {
        const multiSchema = {
            typespace: {
                types: [
                    { Product: { elements: [{ name: { some: 'id' }, algebraic_type: { U64: [] } }] } },
                    { Product: { elements: [{ name: { some: 'key' }, algebraic_type: { String: [] } }] } },
                ],
            },
            tables: [
                { name: 'users', product_type_ref: 0, primary_key: [0], indexes: [], constraints: [], sequences: [], table_access: { Public: [] } },
                { name: 'settings', product_type_ref: 1, primary_key: [0], indexes: [], constraints: [], sequences: [], table_access: { Public: [] } },
            ],
            reducers: [],
        };
        const { tables } = parseSchemaV9(multiSchema);
        expect(tables).toHaveLength(2);
        expect(tables[0].name).toBe('users');
        expect(tables[1].name).toBe('settings');
    });
});

// ─────────────────────────────────────────────────────────────
// parseSqlResult
// ─────────────────────────────────────────────────────────────
describe('parseSqlResult', () => {
    it('parses standard SQL response with named columns', () => {
        const raw = [{
            schema: {
                elements: [
                    { name: { some: 'id' }, algebraic_type: { U64: [] } },
                    { name: { some: 'name' }, algebraic_type: { String: [] } },
                ],
            },
            rows: [
                [1, 'Alice'],
                [2, 'Bob'],
                [3, 'Charlie'],
            ],
        }];

        const result = parseSqlResult(raw);
        expect(result.columns).toEqual(['id', 'name']);
        expect(result.rowCount).toBe(3);
        expect(result.rows[0]).toEqual({ id: 1, name: 'Alice' });
        expect(result.rows[1]).toEqual({ id: 2, name: 'Bob' });
        expect(result.rows[2]).toEqual({ id: 3, name: 'Charlie' });
    });

    it('handles COUNT(*) result', () => {
        const raw = [{
            schema: {
                elements: [
                    { name: { none: [] }, algebraic_type: { U64: [] } },
                ],
            },
            rows: [[5]],
        }];

        const result = parseSqlResult(raw);
        expect(result.columns).toEqual(['col_0']);
        expect(result.rowCount).toBe(1);
        expect(result.rows[0]).toEqual({ col_0: 5 });
    });

    it('handles empty result set', () => {
        const raw = [{
            schema: {
                elements: [
                    { name: { some: 'id' }, algebraic_type: { U64: [] } },
                ],
            },
            rows: [],
        }];

        const result = parseSqlResult(raw);
        expect(result.columns).toEqual(['id']);
        expect(result.rowCount).toBe(0);
        expect(result.rows).toEqual([]);
    });

    it('handles null/undefined data', () => {
        expect(parseSqlResult(null)).toEqual({ columns: [], rows: [], rowCount: 0 });
        expect(parseSqlResult(undefined)).toEqual({ columns: [], rows: [], rowCount: 0 });
    });

    it('handles non-array data by wrapping it', () => {
        const raw = {
            schema: {
                elements: [
                    { name: { some: 'value' }, algebraic_type: { String: [] } },
                ],
            },
            rows: [['test']],
        };

        const result = parseSqlResult(raw);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toEqual({ value: 'test' });
    });

    it('handles rows with more columns than schema', () => {
        const raw = [{
            schema: {
                elements: [
                    { name: { some: 'a' }, algebraic_type: { U32: [] } },
                ],
            },
            rows: [[1, 2, 3]],
        }];

        const result = parseSqlResult(raw);
        expect(result.rows[0]).toEqual({ a: 1, col_1: 2, col_2: 3 });
    });
});
