import { useState, useEffect } from 'react';
import { useConnection } from '../hooks/useConnection';
import type { TableSchema } from '../lib/spacetime-client';

export default function TablesPage() {
    const { client, tables, activeDatabase, activeInstanceId, instances, setActiveDatabase } = useConnection();
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [tableData, setTableData] = useState<Record<string, unknown>[]>([]);
    const [loading, setLoading] = useState(false);

    const activeInstance = instances.find(i => i.id === activeInstanceId);

    // Load table data when a table is selected
    useEffect(() => {
        if (!selectedTable || !client || !activeDatabase) {
            setTableData([]);
            return;
        }

        const loadData = async () => {
            setLoading(true);
            try {
                const result = await client.sql(activeDatabase, `SELECT * FROM ${selectedTable} LIMIT 200`);
                setTableData(result.rows);
            } catch (err) {
                console.error('Failed to load table data:', err);
                setTableData([]);
            } finally {
                setLoading(false);
            }
        };

        loadData();
        // Refresh every 3 seconds for live data
        const interval = setInterval(loadData, 3000);
        return () => clearInterval(interval);
    }, [selectedTable, client, activeDatabase]);

    // If no database is selected, show database picker
    if (!activeDatabase) {
        const databases = activeInstance?.databases || [];
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="panel-header">
                        <div>
                            <div className="panel-title">Select a Database</div>
                            <div className="panel-subtitle">
                                {databases.length > 0
                                    ? `${databases.length} database${databases.length > 1 ? 's' : ''} found`
                                    : 'No databases found on this instance'}
                            </div>
                        </div>
                    </div>
                    <div className="panel-body">
                        {databases.length === 0 ? (
                            <div className="empty-state">
                                <div className="icon">📦</div>
                                <h3>No Databases</h3>
                                <p>Publish a module to this SpacetimeDB instance to see it here.</p>
                                <code className="badge badge-blue" style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                                    spacetime publish my-app
                                </code>
                            </div>
                        ) : (
                            databases.map(db => (
                                <div
                                    key={db.identity}
                                    className="tree-item"
                                    onClick={() => setActiveDatabase(db.name || db.identity)}
                                >
                                    <span className="icon">🗄️</span>
                                    <span>{db.name || db.identity.slice(0, 16) + '…'}</span>
                                    <span className="count">{db.hostType}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        );
    }

    const selectedTableSchema = tables.find(t => t.name === selectedTable);

    return (
        <div className="app-content">
            {/* Table List Panel */}
            <div className="panel" style={{ width: 260, flexShrink: 0 }}>
                <div className="panel-header">
                    <div>
                        <div className="panel-title">Tables</div>
                        <div className="panel-subtitle">{tables.length} tables found</div>
                    </div>
                </div>
                <div className="panel-body">
                    {tables.length === 0 ? (
                        <div className="empty-state">
                            <div className="icon">📋</div>
                            <h3>No Tables</h3>
                            <p>This module has no tables defined yet.</p>
                        </div>
                    ) : (
                        tables.map(table => (
                            <div
                                key={table.name}
                                className={`tree-item ${selectedTable === table.name ? 'active' : ''}`}
                                onClick={() => setSelectedTable(table.name)}
                            >
                                <span className="icon">{table.isPublic ? '📖' : '🔒'}</span>
                                <span>{table.name}</span>
                                <span className="count">{table.columns.length} cols</span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Data Grid Panel */}
            <div className="panel" style={{ flex: 1 }}>
                <div className="panel-header">
                    <div>
                        <div className="panel-title">
                            {selectedTable || 'Select a table'}
                        </div>
                        {selectedTableSchema && (
                            <div className="panel-subtitle">
                                {selectedTableSchema.isPublic ? 'Public' : 'Private'} ·{' '}
                                {tableData.length} rows loaded
                                {selectedTableSchema.columns.find(c => c.isPrimaryKey) &&
                                    ` · PK: ${selectedTableSchema.columns.filter(c => c.isPrimaryKey).map(c => c.name).join(', ')}`
                                }
                            </div>
                        )}
                    </div>
                    {selectedTable && (
                        <div style={{ display: 'flex', gap: 8 }}>
                            <span className={`badge ${loading ? 'badge-amber' : 'badge-green'}`}>
                                {loading ? 'Loading' : 'Live'}
                            </span>
                        </div>
                    )}
                </div>
                <div className="panel-body" style={{ padding: 0 }}>
                    {!selectedTable ? (
                        <div className="empty-state">
                            <div className="icon">← </div>
                            <h3>Select a Table</h3>
                            <p>Choose a table from the sidebar to browse its data</p>
                        </div>
                    ) : (
                        <DataGrid table={selectedTableSchema!} rows={tableData} />
                    )}
                </div>
            </div>

            {/* Schema Panel */}
            {selectedTableSchema && (
                <div className="panel" style={{ width: 280, flexShrink: 0 }}>
                    <div className="panel-header">
                        <div className="panel-title">Schema</div>
                    </div>
                    <div className="panel-body">
                        {selectedTableSchema.columns.map(col => (
                            <div
                                key={col.name}
                                style={{
                                    padding: '8px 0',
                                    borderBottom: '1px solid var(--border-subtle)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500 }}>
                                        {col.name}
                                    </span>
                                    {col.isPrimaryKey && <span className="badge badge-blue">PK</span>}
                                    {col.isAutoInc && <span className="badge badge-purple">Auto</span>}
                                    {col.isUnique && <span className="badge badge-amber">Unique</span>}
                                </div>
                                <span className="col-type">{col.type}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function DataGrid({ table, rows }: { table: TableSchema; rows: Record<string, unknown>[] }) {
    if (rows.length === 0) {
        return (
            <div className="empty-state">
                <div className="icon">📭</div>
                <h3>No Data</h3>
                <p>This table is empty</p>
            </div>
        );
    }

    // Use column names from the schema, falling back to keys from data
    const columns = table.columns.length > 0
        ? table.columns.map(c => c.name)
        : Object.keys(rows[0] || {});

    return (
        <div style={{ overflow: 'auto', width: '100%', height: '100%' }}>
            <table className="data-table">
                <thead>
                    <tr>
                        {columns.map(col => {
                            const schema = table.columns.find(c => c.name === col);
                            return (
                                <th key={col}>
                                    <div>{col}</div>
                                    {schema && (
                                        <span className="col-type">{schema.type}</span>
                                    )}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i}>
                            {columns.map(col => (
                                <td key={col}>
                                    {formatCellValue(row[col])}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function formatCellValue(value: unknown): string {
    if (value === null || value === undefined) return '∅';
    if (typeof value === 'boolean') return value ? '✓' : '✗';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
