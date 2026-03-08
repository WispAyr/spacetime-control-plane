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

interface Props {
    onNavigate?: (page: string) => void;
}

export default function DashboardPage({ onNavigate }: Props) {
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
            <div className="app-content flex-col items-center justify-center">
                <div className="empty-state scale-in">
                    <div className="icon">⏳</div>
                    <h3>Loading dashboard…</h3>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="app-content flex-col items-center justify-center">
                <div className="empty-state scale-in">
                    <div className="icon">⚠️</div>
                    <h3>Backend Not Running</h3>
                    <p>Start the backend: <code>cd backend && npm start</code></p>
                </div>
            </div>
        );
    }

    const isHealthy = data.system.spacetimedb === 'healthy';

    const statCards: { label: string; value: string | number; sub: string; variant: string; icon: string }[] = [
        { label: 'System Health', value: isHealthy ? 'Healthy' : 'Degraded', sub: `Uptime: ${formatUptime(data.system.uptime)}`, variant: isHealthy ? 'green' : 'red', icon: '💚' },
        { label: 'Tenants', value: data.tenants.total, sub: `${data.tenants.deployed} deployed · ${data.tenants.errors} errors`, variant: 'blue', icon: '◎' },
        { label: 'Total Deploys', value: data.deploys.total, sub: `Success rate: ${data.deploys.successRate}`, variant: 'purple', icon: '🚀' },
        { label: 'Security', value: `${data.security.activeApiKeys} keys`, sub: `${data.security.enforcedPolicies}/${data.security.rlsPolicies} RLS enforced`, variant: 'amber', icon: '🔐' },
    ];

    const shortcuts: { label: string; desc: string; page: string }[] = [
        { label: '📊 Monitoring', desc: 'Real-time health grid', page: 'monitoring' },
        { label: '🛡️ RLS Policies', desc: 'Guard code gen', page: 'policies' },
        { label: '🔐 Security', desc: 'JWT & API keys', page: 'security' },
        { label: '🔔 Webhooks', desc: `${data.webhooks.active} active`, page: 'webhooks' },
    ];

    return (
        <div className="app-content" style={{ flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {/* Header */}
            <div className="page-header stagger">
                <div>
                    <h2>Dashboard</h2>
                    <div className="page-subtitle">System overview — auto-refreshes every 15s</div>
                </div>
                <div className="page-actions">
                    <span className={`badge ${isHealthy ? 'badge-green' : 'badge-red'}`}
                        style={{ padding: '5px 12px', fontSize: 11 }}>
                        ● {isHealthy ? 'SpacetimeDB Online' : 'SpacetimeDB Offline'}
                    </span>
                </div>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, flexShrink: 0 }}>
                {statCards.map((card, i) => (
                    <div key={card.label} className={`stat-card stat-card--${card.variant} stagger-${i + 1}`}>
                        <div className="stat-label">{card.label}</div>
                        <div className={`stat-value text-${card.variant}`}>{card.value}</div>
                        <div className="stat-detail">{card.sub}</div>
                        <span className="stat-icon">{card.icon}</span>
                    </div>
                ))}
            </div>

            {/* Two-column: Tenants + Recent Activity */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: 1, minHeight: 0 }}>
                {/* Tenant Health */}
                <div className="panel card-hover stagger-5" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="panel-header">
                        <span className="panel-title">Tenant Status</span>
                        <span className="badge badge-blue">{data.tenantStats.length} online</span>
                    </div>
                    <div className="panel-body" style={{ flex: 1, overflowY: 'auto' }}>
                        {data.tenantStats.length === 0 ? (
                            <div className="empty-state" style={{ padding: 30 }}>
                                <p>No deployed tenants</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-sm">
                                {data.tenantStats.map(t => (
                                    <div key={t.name} className="card-interactive"
                                        style={{ padding: '8px 10px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div className="flex items-center gap-sm">
                                            <span style={{ color: t.status === 'online' ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 10 }}>●</span>
                                            <div>
                                                <div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div>
                                                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{t.database}</div>
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-tertiary)' }}>
                                            {t.tables} tables · {t.reducers} reducers
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Recent Deploys */}
                <div className="panel card-hover stagger-6" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="panel-header">
                        <span className="panel-title">Recent Activity</span>
                        <span className="badge badge-purple">{data.deploys.total} deploys</span>
                    </div>
                    <div className="panel-body" style={{ flex: 1, overflowY: 'auto' }}>
                        {data.deploys.recent.length === 0 ? (
                            <div className="empty-state" style={{ padding: 30 }}>
                                <p>No deploy history yet</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-xs">
                                {data.deploys.recent.map((d, i) => (
                                    <div key={i} className="card-interactive"
                                        style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div className="flex items-center gap-sm">
                                            <span style={{ fontSize: 12 }}>{d.success ? '✓' : '✗'}</span>
                                            <span style={{ fontSize: 11, fontWeight: 600, color: d.success ? 'var(--accent-green)' : 'var(--accent-red)' }}>
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

            {/* Quick Links — now clickable! */}
            <div className="panel stagger-7" style={{ flexShrink: 0 }}>
                <div className="shortcut-bar">
                    {shortcuts.map((link, i) => (
                        <div key={link.label}
                            className={`shortcut-card stagger-${i + 4}`}
                            onClick={() => onNavigate?.(link.page)}>
                            <span className="shortcut-label">{link.label}</span>
                            <span className="shortcut-detail">{link.desc}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
