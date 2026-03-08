import { useState, useEffect, useCallback } from 'react';

const BACKEND_URL = 'http://localhost:3002';

interface DashboardData {
    system: { backend: string; spacetimedb: string; uptime: number };
    tenants: { total: number; deployed: number; errors: number };
    deploys: { total: number; successRate: string; recent: { tenant: string; success: boolean; timestamp: string }[] };
    security: { activeApiKeys: number; rlsPolicies: number; enforcedPolicies: number };
    webhooks: { active: number; total: number };
    tenantStats: { name: string; database: string; tables: number; reducers: number; status: string }[];
}

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/dashboard`);
            if (res.ok) {
                setData(await res.json());
                setError('');
            } else {
                setError('Backend returned error');
            }
        } catch {
            setError('Backend unreachable');
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const i = setInterval(load, 15000);
        return () => clearInterval(i);
    }, [load]);

    if (loading) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state" style={{ padding: 60 }}>
                        <div className="icon">⏳</div>
                        <h3>Loading dashboard…</h3>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state" style={{ padding: 60 }}>
                        <div className="icon">⚠️</div>
                        <h3>Backend Not Running</h3>
                        <p>Start the backend: <code>cd backend && npm start</code></p>
                    </div>
                </div>
            </div>
        );
    }

    const statCards: { label: string; value: string | number; sub: string; color: string; icon: string }[] = [
        { label: 'System Health', value: data.system.spacetimedb === 'healthy' ? 'Healthy' : 'Degraded', sub: `Uptime: ${formatUptime(data.system.uptime)}`, color: data.system.spacetimedb === 'healthy' ? 'var(--accent-green)' : 'var(--accent-red)', icon: '💚' },
        { label: 'Tenants', value: data.tenants.total, sub: `${data.tenants.deployed} deployed · ${data.tenants.errors} errors`, color: 'var(--accent-blue)', icon: '◎' },
        { label: 'Total Deploys', value: data.deploys.total, sub: `Success rate: ${data.deploys.successRate}`, color: 'var(--accent-purple)', icon: '🚀' },
        { label: 'Security', value: `${data.security.activeApiKeys} keys`, sub: `${data.security.enforcedPolicies}/${data.security.rlsPolicies} RLS enforced`, color: 'var(--accent-cyan)', icon: '🔐' },
    ];

    return (
        <div className="app-content" style={{ flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {/* Header */}
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px' }}>Dashboard</h2>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        System overview — auto-refreshes every 15s
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
                        padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                        background: data.system.spacetimedb === 'healthy' ? 'rgba(0,200,100,0.15)' : 'rgba(255,80,80,0.15)',
                        color: data.system.spacetimedb === 'healthy' ? 'var(--accent-green)' : 'var(--accent-red)',
                        fontWeight: 600,
                    }}>
                        {data.system.spacetimedb === 'healthy' ? '● SpacetimeDB Online' : '● SpacetimeDB Offline'}
                    </span>
                </div>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, flexShrink: 0 }}>
                {statCards.map(card => (
                    <div key={card.label} className="panel fade-in" style={{ padding: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500, marginBottom: 4 }}>{card.label}</div>
                                <div style={{ fontSize: 22, fontWeight: 700, color: card.color, letterSpacing: '-1px' }}>{card.value}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>{card.sub}</div>
                            </div>
                            <span style={{ fontSize: 22, opacity: 0.6 }}>{card.icon}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Two-column: Tenants + Recent Activity */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: 1, minHeight: 0 }}>
                {/* Tenant Health */}
                <div className="panel fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="panel-header">
                        <span className="panel-title">Tenant Status</span>
                        <span className="badge badge-blue">{data.tenantStats.length} online</span>
                    </div>
                    <div className="panel-body" style={{ flex: 1, overflowY: 'auto' }}>
                        {data.tenantStats.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-tertiary)', fontSize: 12 }}>
                                No deployed tenants
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {data.tenantStats.map(t => (
                                    <div key={t.name} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '8px 10px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ color: t.status === 'online' ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 10 }}>●</span>
                                            <div>
                                                <div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div>
                                                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{t.database}</div>
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-tertiary)' }}>
                                            <div>{t.tables} tables · {t.reducers} reducers</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Recent Deploys */}
                <div className="panel fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="panel-header">
                        <span className="panel-title">Recent Activity</span>
                        <span className="badge badge-purple">{data.deploys.total} deploys</span>
                    </div>
                    <div className="panel-body" style={{ flex: 1, overflowY: 'auto' }}>
                        {data.deploys.recent.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-tertiary)', fontSize: 12 }}>
                                No deploy history yet
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {data.deploys.recent.map((d, i) => (
                                    <div key={i} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                                        background: 'var(--bg-primary)',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 12 }}>{d.success ? '✓' : '✗'}</span>
                                            <span style={{
                                                fontSize: 11, fontWeight: 600,
                                                color: d.success ? 'var(--accent-green)' : 'var(--accent-red)',
                                            }}>
                                                {d.tenant}
                                            </span>
                                        </div>
                                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                                            {new Date(d.timestamp).toLocaleString()}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Quick Links */}
            <div className="panel fade-in" style={{ flexShrink: 0, padding: 14 }}>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {[
                        { label: '📊 Monitoring', desc: 'Real-time health grid' },
                        { label: '🛡️ RLS Policies', desc: 'Guard code gen' },
                        { label: '🔐 Security', desc: 'JWT & API keys' },
                        { label: '🔔 Webhooks', desc: `${data.webhooks.active} active` },
                    ].map(link => (
                        <div key={link.label} style={{
                            padding: '10px 16px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)',
                            textAlign: 'center', minWidth: 120,
                        }}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{link.label}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{link.desc}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
