import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../hooks/useConnection';
import { SpacetimeClient, type TableSchema, type ReducerSchema } from '../lib/spacetime-client';

interface DbNode {
    name: string;
    tables: TableSchema[];
    reducers: ReducerSchema[];
    rowCounts: Record<string, number>;
    status: 'loaded' | 'error';
    x: number;
    y: number;
}

export default function SettingsPage() {
    const { client, knownDatabases, activeDatabase, setActiveDatabase, addDatabase } = useConnection();
    const [nodes, setNodes] = useState<DbNode[]>([]);
    const [newDb, setNewDb] = useState('');
    const [loading, setLoading] = useState(false);
    const [view, setView] = useState<'topology' | 'cards'>('topology');
    const svgRef = useRef<SVGSVGElement>(null);
    const [dragging, setDragging] = useState<string | null>(null);

    const loadNodes = useCallback(async () => {
        if (!client || knownDatabases.length === 0) return;
        setLoading(true);

        const results = await Promise.all(
            knownDatabases.map(async (db, i): Promise<DbNode> => {
                const aiClient = new SpacetimeClient(client.url);
                // Arrange in a circle
                const angle = (i / knownDatabases.length) * Math.PI * 2 - Math.PI / 2;
                const radius = Math.min(200, 100 + knownDatabases.length * 30);
                const cx = 400, cy = 280;

                try {
                    const schema = await aiClient.getSchema(db);
                    const rowCounts: Record<string, number> = {};
                    for (const table of schema.tables) {
                        try {
                            const res = await aiClient.sql(db, `SELECT COUNT(*) FROM ${table.name}`);
                            const val = Object.values(res.rows[0] || {})[0];
                            rowCounts[table.name] = Number(val) || 0;
                        } catch {
                            rowCounts[table.name] = -1;
                        }
                    }
                    return {
                        name: db, tables: schema.tables, reducers: schema.reducers,
                        rowCounts, status: 'loaded',
                        x: cx + Math.cos(angle) * radius,
                        y: cy + Math.sin(angle) * radius,
                    };
                } catch {
                    return {
                        name: db, tables: [], reducers: [], rowCounts: {},
                        status: 'error',
                        x: cx + Math.cos(angle) * radius,
                        y: cy + Math.sin(angle) * radius,
                    };
                }
            })
        );

        setNodes(results);
        setLoading(false);
    }, [client, knownDatabases]);

    useEffect(() => { loadNodes(); }, [loadNodes]);

    // Drag support
    const handleMouseDown = (name: string) => setDragging(name);
    const handleMouseUp = () => setDragging(null);
    const handleMouseMove = (e: React.MouseEvent) => {
        if (!dragging || !svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setNodes(prev => prev.map(n =>
            n.name === dragging ? { ...n, x, y } : n
        ));
    };

    const handleAddDb = () => {
        if (newDb.trim()) {
            addDatabase(newDb.trim());
            setNewDb('');
        }
    };

    const totalTables = nodes.reduce((s, n) => s + n.tables.length, 0);
    const totalReducers = nodes.reduce((s, n) => s + n.reducers.length, 0);
    const totalRows = nodes.reduce(
        (s, n) => s + Object.values(n.rowCounts).filter(c => c >= 0).reduce((a, b) => a + b, 0), 0
    );

    // Central hub position
    const hub = { x: 400, y: 280 };

    return (
        <div className="app-content" style={{ flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {/* Stats Bar */}
            <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                {[
                    { label: 'Databases', value: knownDatabases.length, color: 'var(--accent-primary)' },
                    { label: 'Tables', value: totalTables, color: 'var(--accent-green)' },
                    { label: 'Reducers', value: totalReducers, color: 'var(--accent-purple)' },
                    { label: 'Rows', value: totalRows, color: 'var(--accent-amber)' },
                ].map(stat => (
                    <div key={stat.label} className="panel" style={{ flex: 1, textAlign: 'center', padding: '14px 10px' }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: stat.color, fontFamily: 'var(--font-mono)' }}>
                            {stat.value}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>
                            {stat.label}
                        </div>
                    </div>
                ))}
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                <input
                    className="input input-mono"
                    value={newDb}
                    onChange={e => setNewDb(e.target.value)}
                    placeholder="Add database name..."
                    onKeyDown={e => e.key === 'Enter' && handleAddDb()}
                    style={{ flex: 1 }}
                />
                <button className="btn btn-primary" onClick={handleAddDb} disabled={!newDb.trim()}>Add</button>
                <button className="btn" onClick={loadNodes} disabled={loading}>{loading ? '...' : '↻'}</button>
                <div style={{ borderLeft: '1px solid var(--border-subtle)', height: 24, margin: '0 4px' }} />
                <button className={`btn btn-sm ${view === 'topology' ? 'btn-primary' : ''}`} onClick={() => setView('topology')}>Topology</button>
                <button className={`btn btn-sm ${view === 'cards' ? 'btn-primary' : ''}`} onClick={() => setView('cards')}>Cards</button>
            </div>

            {/* Topology View */}
            {view === 'topology' ? (
                <div className="panel" style={{ flex: 1, minHeight: 400 }}>
                    <svg
                        ref={svgRef}
                        width="100%" height="100%"
                        viewBox="0 0 800 560"
                        style={{ cursor: dragging ? 'grabbing' : 'default' }}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    >
                        {/* Background grid */}
                        <defs>
                            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(55,70,90,0.15)" strokeWidth="0.5" />
                            </pattern>
                            <filter id="glow">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                        </defs>
                        <rect width="800" height="560" fill="url(#grid)" />

                        {/* Connection lines to hub */}
                        {nodes.map(node => (
                            <line
                                key={`line-${node.name}`}
                                x1={hub.x} y1={hub.y}
                                x2={node.x} y2={node.y}
                                stroke={activeDatabase === node.name ? 'rgba(76,154,255,0.4)' : 'rgba(55,70,90,0.3)'}
                                strokeWidth={activeDatabase === node.name ? 2 : 1}
                                strokeDasharray={activeDatabase === node.name ? 'none' : '4,4'}
                            />
                        ))}

                        {/* Central hub node */}
                        <g transform={`translate(${hub.x}, ${hub.y})`}>
                            <circle r="28" fill="rgba(76,154,255,0.1)" stroke="rgba(76,154,255,0.4)" strokeWidth="1.5" filter="url(#glow)" />
                            <text textAnchor="middle" dy="0.35em" fill="#4c9aff" fontSize="14" fontWeight="700" fontFamily="Inter">S</text>
                            <text textAnchor="middle" dy="3.2em" fill="rgba(139,148,158,0.8)" fontSize="9" fontFamily="Inter">
                                SpacetimeDB
                            </text>
                        </g>

                        {/* Database nodes */}
                        {nodes.map(node => {
                            const isActive = activeDatabase === node.name;
                            const totalNodeRows = Object.values(node.rowCounts).filter(c => c >= 0).reduce((s, c) => s + c, 0);
                            const accentColor = isActive ? '#4c9aff' : node.status === 'error' ? '#ff5c5c' : '#3dd68c';

                            return (
                                <g
                                    key={node.name}
                                    transform={`translate(${node.x}, ${node.y})`}
                                    style={{ cursor: 'pointer' }}
                                    onMouseDown={() => handleMouseDown(node.name)}
                                    onClick={() => !dragging && setActiveDatabase(node.name)}
                                >
                                    {/* Node background */}
                                    <rect
                                        x="-80" y="-36"
                                        width="160" height="72"
                                        rx="10"
                                        fill={isActive ? 'rgba(76,154,255,0.08)' : 'rgba(16,24,36,0.85)'}
                                        stroke={isActive ? 'rgba(76,154,255,0.5)' : 'rgba(60,90,130,0.25)'}
                                        strokeWidth={isActive ? 1.5 : 1}
                                    />

                                    {/* Status indicator */}
                                    <circle cx="-66" cy="-22" r="4" fill={accentColor} />

                                    {/* Database name */}
                                    <text x="-56" y="-18" fill="#e6edf3" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                                        {node.name.length > 18 ? node.name.slice(0, 18) + '…' : node.name}
                                    </text>

                                    {/* Stats */}
                                    <text x="-68" y="2" fill="#8b949e" fontSize="9" fontFamily="JetBrains Mono, monospace">
                                        {node.tables.length} tables · {node.reducers.length} reducers
                                    </text>
                                    <text x="-68" y="16" fill="#6e7681" fontSize="9" fontFamily="JetBrains Mono, monospace">
                                        {totalNodeRows} rows
                                    </text>

                                    {/* Table pills */}
                                    {node.tables.slice(0, 3).map((t, i) => (
                                        <g key={t.name} transform={`translate(${-68 + i * 50}, 26)`}>
                                            <rect width={Math.min(46, t.name.length * 6 + 8)} height="14" rx="3"
                                                fill="rgba(61,214,140,0.1)" stroke="rgba(61,214,140,0.2)" strokeWidth="0.5" />
                                            <text x="4" y="10" fill="#3dd68c" fontSize="7" fontFamily="JetBrains Mono">
                                                {t.name.length > 7 ? t.name.slice(0, 7) + '…' : t.name}
                                            </text>
                                        </g>
                                    ))}
                                </g>
                            );
                        })}
                    </svg>
                </div>
            ) : (
                /* Cards View */
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320, 1fr))',
                    gap: 12, flex: 1,
                }}>
                    {nodes.map(db => (
                        <div
                            key={db.name}
                            className="panel"
                            style={{
                                cursor: 'pointer',
                                border: activeDatabase === db.name ? '1px solid var(--accent-primary)' : undefined,
                            }}
                            onClick={() => setActiveDatabase(db.name)}
                        >
                            <div className="panel-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                                    <span style={{ fontSize: 16 }}>{db.status === 'loaded' ? '🟢' : '🔴'}</span>
                                    <div className="panel-title" style={{ fontSize: 13 }}>{db.name}</div>
                                </div>
                                {activeDatabase === db.name && <span className="badge badge-blue" style={{ fontSize: 9 }}>Active</span>}
                            </div>
                            <div className="panel-body">
                                <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                                    <span style={{ fontSize: 11 }}><strong style={{ color: 'var(--accent-green)' }}>{db.tables.length}</strong> tables</span>
                                    <span style={{ fontSize: 11 }}><strong style={{ color: 'var(--accent-purple)' }}>{db.reducers.length}</strong> reducers</span>
                                    <span style={{ fontSize: 11 }}><strong style={{ color: 'var(--accent-amber)' }}>{Object.values(db.rowCounts).filter(c => c >= 0).reduce((s, c) => s + c, 0)}</strong> rows</span>
                                </div>
                                {db.tables.map(table => (
                                    <div key={table.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                                        <span style={{ fontFamily: 'var(--font-mono)' }}>{table.isPublic ? '📖' : '🔒'} {table.name}</span>
                                        <span className="badge badge-green" style={{ fontSize: 9 }}>{db.rowCounts[table.name] >= 0 ? db.rowCounts[table.name] : '?'}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
