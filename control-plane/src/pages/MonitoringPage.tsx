import { useState, useEffect, useCallback } from 'react';

const BACKEND_URL = 'http://localhost:3002';

interface TenantSummary {
    name: string;
    database: string;
    tables: number;
    reducers: number;
    status: string;
    lastDeployed: string | null;
}

interface DeployEntry {
    timestamp: string;
    success: boolean;
    tenant: string;
    output?: string;
    error?: string;
}

interface TenantStats {
    database: string;
    tables: number;
    reducers: number;
    totalRows: number;
    tableDetails: { name: string; rows: number | string; columns: number }[];
    deployCount: number;
    successfulDeploys: number;
    failedDeploys: number;
    lastDeployedAt: string | null;
}

interface Overview {
    totalTenants: number;
    deployedTenants: number;
    errorTenants: number;
    totalDeploys: number;
    recentDeploys: DeployEntry[];
    tenantSummaries: TenantSummary[];
}

export default function MonitoringPage() {
    const [overview, setOverview] = useState<Overview | null>(null);
    const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
    const [tenantStats, setTenantStats] = useState<TenantStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(true);

    const loadOverview = useCallback(async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/monitoring/overview`);
            if (res.ok) {
                setOverview(await res.json());
                setError('');
            } else {
                setError('Backend unreachable');
            }
        } catch {
            setError('Backend not running');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadTenantStats = useCallback(async (tenantId: string) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/tenants/${tenantId}/stats`);
            if (res.ok) setTenantStats(await res.json());
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        loadOverview();
        if (!autoRefresh) return;
        const interval = setInterval(loadOverview, 10000);
        return () => clearInterval(interval);
    }, [loadOverview, autoRefresh]);

    const handleTenantClick = async (name: string) => {
        setSelectedTenant(name === selectedTenant ? null : name);
        setTenantStats(null);
        if (name !== selectedTenant) {
            // Need tenant ID — fetch from tenants list
            const res = await fetch(`${BACKEND_URL}/api/tenants`);
            if (res.ok) {
                const tenants = await res.json();
                const t = tenants.find((tt: { name: string }) => tt.name === name);
                if (t) loadTenantStats(t.id);
            }
        }
    };

    if (loading) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state" style={{ padding: 60 }}>
                        <div className="icon" style={{ animation: 'pulse 1s infinite' }}>📊</div>
                        <h3>Loading Monitoring Data...</h3>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state" style={{ padding: 60 }}>
                        <div className="icon">⚠️</div>
                        <h3>{error}</h3>
                        <p>Start the backend: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-green)' }}>cd control-plane/backend && npm start</code></p>
                    </div>
                </div>
            </div>
        );
    }

    if (!overview) return null;

    return (
        <div className="app-content" style={{ flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px' }}>Monitoring</h2>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        Real-time SpacetimeDB cluster status
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={autoRefresh} onChange={() => setAutoRefresh(!autoRefresh)} />
                        Auto-refresh (10s)
                    </label>
                    <button className="btn" onClick={loadOverview}>↻ Refresh</button>
                </div>
            </div>

            {/* Stats Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, flexShrink: 0 }}>
                <StatCard label="TENANTS" value={overview.totalTenants} color="var(--accent-blue)" />
                <StatCard label="DEPLOYED" value={overview.deployedTenants} color="var(--accent-green)" />
                <StatCard label="ERRORS" value={overview.errorTenants} color="var(--accent-red)" />
                <StatCard label="TOTAL DEPLOYS" value={overview.totalDeploys} color="var(--accent-purple)" />
            </div>

            {/* Tenant Health Grid */}
            <div className="panel" style={{ flexShrink: 0 }}>
                <div className="panel-header">
                    <span className="panel-title">Tenant Health</span>
                </div>
                <div className="panel-body">
                    {overview.tenantSummaries.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: 20, textAlign: 'center' }}>
                            No deployed tenants to monitor
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
                            {overview.tenantSummaries.map(t => (
                                <TenantHealthCard
                                    key={t.name}
                                    tenant={t}
                                    selected={selectedTenant === t.name}
                                    onClick={() => handleTenantClick(t.name)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Selected Tenant Detail */}
            {selectedTenant && tenantStats && (
                <div className="panel fade-in" style={{ flexShrink: 0 }}>
                    <div className="panel-header">
                        <span className="panel-title" style={{ fontFamily: 'var(--font-mono)' }}>{selectedTenant}</span>
                        <span className="badge badge-blue">{tenantStats.database}</span>
                    </div>
                    <div className="panel-body">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
                            <MiniStat label="Tables" value={tenantStats.tables} />
                            <MiniStat label="Reducers" value={tenantStats.reducers} />
                            <MiniStat label="Total Rows" value={tenantStats.totalRows} />
                            <MiniStat label="Deploys ✓" value={tenantStats.successfulDeploys} />
                            <MiniStat label="Deploys ✗" value={tenantStats.failedDeploys} />
                        </div>

                        {tenantStats.tableDetails.length > 0 && (
                            <div>
                                <h4 style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Table Breakdown</h4>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Table</th>
                                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Columns</th>
                                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Rows</th>
                                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>% of Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tenantStats.tableDetails.map(td => (
                                            <tr key={td.name} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{td.name}</td>
                                                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{td.columns}</td>
                                                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--accent-cyan)' }}>{td.rows}</td>
                                                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                                    {typeof td.rows === 'number' && tenantStats.totalRows > 0
                                                        ? `${((td.rows / tenantStats.totalRows) * 100).toFixed(1)}%`
                                                        : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Recent Deploys */}
            <div className="panel" style={{ flexShrink: 0 }}>
                <div className="panel-header">
                    <span className="panel-title">Recent Deploys</span>
                    <span className="badge badge-purple">{overview.recentDeploys.length}</span>
                </div>
                <div className="panel-body">
                    {overview.recentDeploys.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: 16, textAlign: 'center' }}>
                            No deploy history yet
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {overview.recentDeploys.map((d, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                                    background: i % 2 === 0 ? 'transparent' : 'var(--bg-primary)',
                                    fontSize: 12,
                                }}>
                                    <span style={{
                                        width: 8, height: 8, borderRadius: '50%',
                                        background: d.success ? 'var(--accent-green)' : 'var(--accent-red)',
                                        flexShrink: 0,
                                    }} />
                                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, minWidth: 120 }}>{d.tenant}</span>
                                    <span style={{ color: 'var(--text-tertiary)' }}>
                                        {new Date(d.timestamp).toLocaleString()}
                                    </span>
                                    <span style={{ marginLeft: 'auto', fontSize: 11, color: d.success ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                        {d.success ? 'success' : 'failed'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="panel" style={{ textAlign: 'center', padding: '16px 12px' }}>
            <div style={{
                fontSize: 28, fontWeight: 800, color,
                fontFamily: 'var(--font-mono)',
                lineHeight: 1,
                textShadow: `0 0 20px ${color}33`,
            }}>
                {value}
            </div>
            <div style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
                letterSpacing: '1.5px', marginTop: 6,
            }}>
                {label}
            </div>
        </div>
    );
}

function MiniStat({ label, value }: { label: string; value: number }) {
    return (
        <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {value}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</div>
        </div>
    );
}

function TenantHealthCard({ tenant, selected, onClick }: {
    tenant: TenantSummary;
    selected: boolean;
    onClick: () => void;
}) {
    const isOnline = tenant.status === 'online';
    return (
        <div
            onClick={onClick}
            style={{
                padding: '12px 14px',
                background: selected ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${selected ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{tenant.name}</span>
                <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: isOnline ? 'var(--accent-green)' : 'var(--accent-red)',
                    boxShadow: isOnline ? '0 0 6px var(--accent-green)' : 'none',
                }} />
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-tertiary)' }}>
                <span>{tenant.tables} tables</span>
                <span>{tenant.reducers} reducers</span>
            </div>
            {tenant.lastDeployed && (
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6 }}>
                    Deployed: {new Date(tenant.lastDeployed).toLocaleDateString()}
                </div>
            )}
        </div>
    );
}
