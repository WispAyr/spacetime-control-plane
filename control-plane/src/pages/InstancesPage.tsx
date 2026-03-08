import { useState } from 'react';
import { useConnection } from '../hooks/useConnection';

export default function InstancesPage() {
    const { instances, activeInstanceId, setActiveInstance, disconnect } = useConnection();
    const [showDetails, setShowDetails] = useState<string | null>(null);

    return (
        <div className="app-content">
            <div className="panel" style={{ flex: 1 }}>
                <div className="panel-header">
                    <div>
                        <div className="panel-title">Instances</div>
                        <div className="panel-subtitle">{instances.length} connected instance{instances.length !== 1 ? 's' : ''}</div>
                    </div>
                </div>
                <div className="panel-body">
                    {instances.length === 0 ? (
                        <div className="empty-state">
                            <div className="icon">◎</div>
                            <h3>No Instances</h3>
                            <p>Connect to a SpacetimeDB instance to get started</p>
                        </div>
                    ) : (
                        instances.map(instance => (
                            <div key={instance.id} style={{ marginBottom: 12 }}>
                                <div
                                    className={`tree-item ${activeInstanceId === instance.id ? 'active' : ''}`}
                                    onClick={() => setActiveInstance(instance.id)}
                                    style={{ padding: '10px 12px' }}
                                >
                                    <span style={{ fontSize: 18 }}>
                                        {instance.status === 'connected' ? '🟢' : instance.status === 'connecting' ? '🟡' : '🔴'}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 500 }}>{instance.name}</div>
                                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                                            {instance.url}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <button
                                            className="btn btn-sm"
                                            onClick={e => { e.stopPropagation(); setShowDetails(showDetails === instance.id ? null : instance.id); }}
                                        >
                                            Info
                                        </button>
                                        <button
                                            className="btn btn-sm"
                                            onClick={e => { e.stopPropagation(); disconnect(instance.id); }}
                                            style={{ color: 'var(--accent-red)' }}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>

                                {showDetails === instance.id && (
                                    <div className="fade-in" style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-secondary)' }}>
                                        <div>Status: <span className={`badge badge-${instance.status === 'connected' ? 'green' : 'red'}`}>{instance.status}</span></div>
                                        {instance.databases && (
                                            <div style={{ marginTop: 8 }}>
                                                <div style={{ fontWeight: 500, marginBottom: 4 }}>Databases ({instance.databases.length}):</div>
                                                {instance.databases.map(db => (
                                                    <div key={db.identity} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '2px 0' }}>
                                                        {db.name || db.identity.slice(0, 20) + '…'}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {instance.error && (
                                            <div style={{ marginTop: 8, color: 'var(--accent-red)' }}>Error: {instance.error}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
