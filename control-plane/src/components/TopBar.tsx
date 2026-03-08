import { useState } from 'react';
import { useConnection } from '../hooks/useConnection';

export default function TopBar() {
    const { activeInstanceId, instances, activeDatabase, knownDatabases, setActiveDatabase, addDatabase } = useConnection();
    const [showDbDropdown, setShowDbDropdown] = useState(false);
    const [newDbName, setNewDbName] = useState('');
    const [showAddDb, setShowAddDb] = useState(false);

    const activeInstance = instances.find(i => i.id === activeInstanceId);
    const statusClass = activeInstance?.status || 'disconnected';

    const handleAddDb = () => {
        if (newDbName.trim()) {
            addDatabase(newDbName.trim());
            setActiveDatabase(newDbName.trim());
            setNewDbName('');
            setShowAddDb(false);
            setShowDbDropdown(false);
        }
    };

    return (
        <header className="topbar">
            <div className="topbar-left">
                <span className="topbar-title">Spacetime Control Plane</span>
            </div>
            <div className="topbar-right">
                {/* Database Switcher */}
                {activeInstance && (
                    <div style={{ position: 'relative' }}>
                        <button
                            className="btn btn-sm"
                            onClick={() => setShowDbDropdown(!showDbDropdown)}
                            style={{
                                fontFamily: 'var(--font-mono)',
                                background: activeDatabase ? 'var(--accent-purple-dim)' : 'var(--bg-elevated)',
                                color: activeDatabase ? 'var(--accent-purple)' : 'var(--text-secondary)',
                                borderColor: activeDatabase ? 'rgba(167, 139, 250, 0.3)' : undefined,
                            }}
                        >
                            🗄️ {activeDatabase || 'Select database'} ▾
                        </button>

                        {showDbDropdown && (
                            <div
                                className="panel fade-in"
                                style={{
                                    position: 'absolute',
                                    top: '100%',
                                    right: 0,
                                    marginTop: 6,
                                    width: 280,
                                    zIndex: 100,
                                }}
                            >
                                <div className="panel-header">
                                    <span className="panel-title">Databases</span>
                                    <button className="btn btn-sm btn-primary" onClick={() => setShowAddDb(!showAddDb)}>
                                        + Add
                                    </button>
                                </div>
                                <div className="panel-body" style={{ maxHeight: 250 }}>
                                    {showAddDb && (
                                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                                            <input
                                                className="input input-mono"
                                                value={newDbName}
                                                onChange={e => setNewDbName(e.target.value)}
                                                placeholder="database-name"
                                                onKeyDown={e => e.key === 'Enter' && handleAddDb()}
                                                autoFocus
                                                style={{ fontSize: 11, padding: '4px 8px' }}
                                            />
                                            <button className="btn btn-sm btn-primary" onClick={handleAddDb}>→</button>
                                        </div>
                                    )}
                                    {knownDatabases.length === 0 && !showAddDb ? (
                                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: 12 }}>
                                            No databases added yet
                                        </div>
                                    ) : (
                                        knownDatabases.map(db => (
                                            <div
                                                key={db}
                                                className={`tree-item ${activeDatabase === db ? 'active' : ''}`}
                                                onClick={() => {
                                                    setActiveDatabase(db);
                                                    setShowDbDropdown(false);
                                                }}
                                                style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}
                                            >
                                                <span>{activeDatabase === db ? '◉' : '○'}</span>
                                                <span style={{ flex: 1 }}>{db}</span>
                                                {activeDatabase === db && (
                                                    <span className="badge badge-green" style={{ fontSize: 9 }}>Active</span>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Click-away overlay */}
                        {showDbDropdown && (
                            <div
                                style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                                onClick={() => setShowDbDropdown(false)}
                            />
                        )}
                    </div>
                )}

                <div className={`connection-badge ${statusClass}`}>
                    <span className="connection-dot" />
                    {activeInstance
                        ? `${activeInstance.name}`
                        : 'Not connected'}
                </div>
            </div>
        </header>
    );
}
