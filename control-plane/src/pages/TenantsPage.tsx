import { useState, useEffect, useCallback } from 'react';

const BACKEND_URL = 'http://localhost:3002';

interface Tenant {
    id: string;
    name: string;
    description: string;
    moduleDir: string | null;
    database: string | null;
    status: string;
    createdAt: string;
    lastDeployedAt: string | null;
    deployHistory: { timestamp: string; success: boolean; output?: string; error?: string }[];
}

interface DiscoveredModule {
    name: string;
    moduleDir: string;
    registered: boolean;
}

export default function TenantsPage() {
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [discovered, setDiscovered] = useState<DiscoveredModule[]>([]);
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [showCreate, setShowCreate] = useState(false);
    const [deploying, setDeploying] = useState<string | null>(null);
    const [deployLog, setDeployLog] = useState<{ tenantId: string; text: string } | null>(null);
    const [logsOpen, setLogsOpen] = useState<string | null>(null);
    const [logsText, setLogsText] = useState('');
    const [backupLog, setBackupLog] = useState<{ tenantId: string; text: string } | null>(null);
    const [backendOk, setBackendOk] = useState(false);

    const loadAll = useCallback(async () => {
        try {
            const [tRes, dRes, hRes] = await Promise.all([
                fetch(`${BACKEND_URL}/api/tenants`),
                fetch(`${BACKEND_URL}/api/discover`),
                fetch(`${BACKEND_URL}/api/health`),
            ]);
            if (tRes.ok) setTenants(await tRes.json());
            if (dRes.ok) setDiscovered(await dRes.json());
            if (hRes.ok) setBackendOk(true);
        } catch {
            setBackendOk(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        const res = await fetch(`${BACKEND_URL}/api/tenants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName.trim(), description: newDesc }),
        });
        if (res.ok) {
            setNewName('');
            setNewDesc('');
            setShowCreate(false);
            loadAll();
        }
    };

    const [registerDbName, setRegisterDbName] = useState<Record<string, string>>({});

    const handleRegister = async (mod: DiscoveredModule) => {
        await fetch(`${BACKEND_URL}/api/tenants/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: mod.name,
                moduleDir: mod.moduleDir,
                database: registerDbName[mod.name] || null,
            }),
        });
        loadAll();
    };

    const handleDeploy = async (tenant: Tenant) => {
        setDeploying(tenant.id);
        setDeployLog(null);
        try {
            const res = await fetch(`${BACKEND_URL}/api/tenants/${tenant.id}/deploy`, {
                method: 'POST',
            });
            const data = await res.json();
            setDeployLog({
                tenantId: tenant.id,
                text: data.success ? `✓ Deployed!\n\n${data.output}` : `✗ Failed:\n${data.error}`,
            });
        } catch (err) {
            setDeployLog({ tenantId: tenant.id, text: `Error: ${err}` });
        } finally {
            setDeploying(null);
            loadAll();
        }
    };

    const handleLogs = async (tenant: Tenant) => {
        if (logsOpen === tenant.id) {
            setLogsOpen(null);
            return;
        }
        setLogsOpen(tenant.id);
        setLogsText('Loading...');
        try {
            const res = await fetch(`${BACKEND_URL}/api/tenants/${tenant.id}/logs?lines=50`);
            const data = await res.json();
            setLogsText(data.logs || 'No logs available');
        } catch (err) {
            setLogsText(`Failed to fetch logs: ${err}`);
        }
    };

    const handleDelete = async (tenant: Tenant) => {
        await fetch(`${BACKEND_URL}/api/tenants/${tenant.id}`, { method: 'DELETE' });
        loadAll();
    };

    const handleBackup = async (tenant: Tenant) => {
        setBackupLog({ tenantId: tenant.id, text: 'Creating backup...' });
        try {
            const res = await fetch(`${BACKEND_URL}/api/tenants/${tenant.id}/backup`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setBackupLog({
                    tenantId: tenant.id,
                    text: `✓ Backup created: ${data.filename}\n  Tables: ${data.tables}\n  Size: ${(data.sizeBytes / 1024).toFixed(1)}KB`,
                });
            } else {
                setBackupLog({ tenantId: tenant.id, text: `✗ Backup failed: ${data.error}` });
            }
        } catch (err) {
            setBackupLog({ tenantId: tenant.id, text: `Error: ${err}` });
        }
    };

    const statusColor = (s: string) => {
        if (s === 'deployed') return 'var(--accent-green)';
        if (s === 'deploying') return 'var(--accent-amber)';
        if (s === 'error') return 'var(--accent-red)';
        return 'var(--text-tertiary)';
    };

    if (!backendOk) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state" style={{ padding: 60 }}>
                        <div className="icon">🔌</div>
                        <h3>Backend Not Running</h3>
                        <p>Start the backend service to manage tenants:</p>
                        <code style={{
                            display: 'block', marginTop: 12, padding: '12px 20px',
                            background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)',
                            fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-green)',
                        }}>
                            cd control-plane/backend && npm start
                        </code>
                    </div>
                </div>
            </div>
        );
    }

    const unregistered = discovered.filter(d => !d.registered);

    return (
        <div className="app-content" style={{ flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px' }}>Tenant Management</h2>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {tenants.length} tenants · {tenants.filter(t => t.status === 'deployed').length} deployed
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={loadAll}>↻ Refresh</button>
                    <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>+ New Tenant</button>
                </div>
            </div>

            {/* Create Form */}
            {showCreate && (
                <div className="panel fade-in" style={{ flexShrink: 0 }}>
                    <div className="panel-header">
                        <span className="panel-title">Create New Tenant</span>
                    </div>
                    <div className="panel-body" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Name</label>
                            <input
                                className="input input-mono"
                                value={newName} onChange={e => setNewName(e.target.value)}
                                placeholder="my-app (lowercase, hyphens only)"
                                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Description</label>
                            <input
                                className="input"
                                value={newDesc} onChange={e => setNewDesc(e.target.value)}
                                placeholder="Optional description"
                            />
                        </div>
                        <button className="btn btn-primary" onClick={handleCreate} disabled={!newName.trim()}>
                            Create & Scaffold
                        </button>
                    </div>
                </div>
            )}

            {/* Discover existing modules */}
            {unregistered.length > 0 && (
                <div className="panel" style={{ flexShrink: 0 }}>
                    <div className="panel-header">
                        <span className="panel-title">Discovered Modules</span>
                        <span className="badge badge-amber">{unregistered.length} unregistered</span>
                    </div>
                    <div className="panel-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {unregistered.map(mod => (
                            <div key={mod.name} style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '6px 12px', background: 'var(--bg-primary)',
                                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)',
                            }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{mod.name}</span>
                                <input
                                    className="input input-mono"
                                    style={{ width: 140, fontSize: 10, padding: '4px 8px' }}
                                    placeholder="database name"
                                    value={registerDbName[mod.name] || ''}
                                    onChange={e => setRegisterDbName(prev => ({ ...prev, [mod.name]: e.target.value }))}
                                />
                                <button className="btn btn-sm btn-primary" onClick={() => handleRegister(mod)}>
                                    Register
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Tenant Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                {tenants.map(tenant => (
                    <div key={tenant.id} className="panel">
                        <div className="panel-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                                <div style={{
                                    width: 10, height: 10, borderRadius: '50%',
                                    background: statusColor(tenant.status),
                                    boxShadow: tenant.status === 'deployed' ? '0 0 6px var(--accent-green)' : 'none',
                                }} />
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                                        {tenant.name}
                                    </div>
                                    {tenant.description && (
                                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{tenant.description}</div>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <span className={`badge badge-${tenant.status === 'deployed' ? 'green' : tenant.status === 'error' ? 'red' : 'amber'}`}>
                                    {tenant.status}
                                </span>
                                {tenant.database && (
                                    <span className="badge badge-purple" style={{ fontSize: 9 }}>
                                        {tenant.database.length > 20 ? tenant.database.slice(0, 20) + '…' : tenant.database}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="panel-body" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
                                <span>Created: {new Date(tenant.createdAt).toLocaleDateString()}</span>
                                {tenant.lastDeployedAt && (
                                    <span>Last deploy: {new Date(tenant.lastDeployedAt).toLocaleString()}</span>
                                )}
                                <span>Deploys: {tenant.deployHistory.length}</span>
                            </div>

                            <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                    className="btn btn-sm btn-primary"
                                    onClick={() => handleDeploy(tenant)}
                                    disabled={deploying === tenant.id || !tenant.moduleDir}
                                >
                                    {deploying === tenant.id ? '⏳ Deploying...' : '🚀 Deploy'}
                                </button>
                                {tenant.database && (
                                    <button className="btn btn-sm" onClick={() => handleLogs(tenant)}>
                                        {logsOpen === tenant.id ? '▲ Hide Logs' : '📋 Logs'}
                                    </button>
                                )}
                                {tenant.database && (
                                    <button className="btn btn-sm" onClick={() => handleBackup(tenant)}>
                                        💾 Backup
                                    </button>
                                )}
                                <button
                                    className="btn btn-sm"
                                    style={{ marginLeft: 'auto', color: 'var(--accent-red)' }}
                                    onClick={() => handleDelete(tenant)}
                                >
                                    Remove
                                </button>
                            </div>

                            {/* Deploy log */}
                            {deployLog && deployLog.tenantId === tenant.id && (
                                <pre style={{
                                    marginTop: 10, padding: 10, background: 'var(--bg-primary)',
                                    borderRadius: 'var(--radius-sm)', fontSize: 11,
                                    fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                                    maxHeight: 150, overflowY: 'auto', whiteSpace: 'pre-wrap',
                                }}>
                                    {deployLog.text}
                                </pre>
                            )}

                            {/* Backup log */}
                            {backupLog && backupLog.tenantId === tenant.id && (
                                <pre style={{
                                    marginTop: 10, padding: 10, background: 'var(--bg-primary)',
                                    borderRadius: 'var(--radius-sm)', fontSize: 11,
                                    fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)',
                                    maxHeight: 100, overflowY: 'auto', whiteSpace: 'pre-wrap',
                                }}>
                                    {backupLog.text}
                                </pre>
                            )}

                            {/* Logs */}
                            {logsOpen === tenant.id && (
                                <pre style={{
                                    marginTop: 10, padding: 10, background: 'var(--bg-primary)',
                                    borderRadius: 'var(--radius-sm)', fontSize: 11,
                                    fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)',
                                    maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap',
                                }}>
                                    {logsText}
                                </pre>
                            )}
                        </div>
                    </div>
                ))}

                {tenants.length === 0 && (
                    <div className="panel">
                        <div className="empty-state" style={{ padding: 40 }}>
                            <div className="icon">🏢</div>
                            <h3>No Tenants</h3>
                            <p>Create a new tenant or register an existing SpacetimeDB module</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
