import { useState, useEffect, useCallback } from 'react';

const BACKEND_URL = 'http://localhost:3002';

interface Migration {
    id: string; tenantId: string; tenantName: string; version: number;
    timestamp: string; status: string; schemaSnapshot: { tables: number; reducers: number } | null;
    deployedBy: string | null; notes: string;
}

interface Diff {
    current: { version: number; tables: number; reducers: number };
    previous: { version: number; tables: number; reducers: number } | null;
    diff: { tablesAdded: number; tablesRemoved: number; reducersAdded: number; reducersRemoved: number };
}

interface Quota {
    limits: { requestsPerMinute: number; requestsPerDay: number; storageMB: number; maxConnections: number };
    usage: { requestsThisMinute: number; requestsToday: number; storageMB: number; activeConnections: number };
}

interface EnvData {
    active: string;
    environments: Record<string, { databaseName: string; status: string; deployedAt: string | null }>;
    promotionHistory: { id: string; from: string; to: string; timestamp: string }[];
}

interface Tenant {
    id: string; name: string; database: string | null; status: string;
}

export default function MigrationsPage() {
    const [migrations, setMigrations] = useState<Migration[]>([]);
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [selectedTenant, setSelectedTenant] = useState('');
    const [expandedMigration, setExpandedMigration] = useState<string | null>(null);
    const [diffs, setDiffs] = useState<Record<string, Diff>>({});
    const [quotas, setQuotas] = useState<Record<string, { name: string } & Quota>>({});
    const [envs, setEnvs] = useState<Record<string, EnvData>>({});
    const [tab, setTab] = useState<'migrations' | 'quotas' | 'environments'>('migrations');

    const load = useCallback(async () => {
        try {
            const [mRes, tRes, qRes] = await Promise.all([
                fetch(`${BACKEND_URL}/api/migrations${selectedTenant ? `?tenantId=${selectedTenant}` : ''}`),
                fetch(`${BACKEND_URL}/api/tenants`),
                fetch(`${BACKEND_URL}/api/quotas`),
            ]);
            if (mRes.ok) setMigrations(await mRes.json());
            if (tRes.ok) setTenants(await tRes.json());
            if (qRes.ok) setQuotas(await qRes.json());

            // Load environments for each tenant
            const tenantList = tRes.ok ? await tRes.clone().json() : [];
            const envMap: Record<string, EnvData> = {};
            for (const t of tenantList) {
                const eRes = await fetch(`${BACKEND_URL}/api/tenants/${t.id}/environments`);
                if (eRes.ok) envMap[t.id] = await eRes.json();
            }
            setEnvs(envMap);
        } catch { /* backend offline */ }
    }, [selectedTenant]);

    useEffect(() => { load(); }, [load]);

    const loadDiff = async (id: string) => {
        if (diffs[id]) return;
        const res = await fetch(`${BACKEND_URL}/api/migrations/${id}/diff`);
        if (res.ok) {
            const data = await res.json();
            setDiffs(prev => ({ ...prev, [id]: data }));
        }
    };

    const expand = (id: string) => {
        if (expandedMigration === id) { setExpandedMigration(null); return; }
        setExpandedMigration(id);
        loadDiff(id);
    };

    const rollback = async (id: string) => {
        if (!confirm('Rollback to this version? The latest migration will be marked as rolled back.')) return;
        await fetch(`${BACKEND_URL}/api/migrations/${id}/rollback`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        load();
    };

    const captureMigration = async (tenantId: string) => {
        await fetch(`${BACKEND_URL}/api/migrations/capture/${tenantId}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: 'Manual snapshot' }),
        });
        load();
    };

    const promote = async (tenantId: string, from: string, to: string) => {
        if (!confirm(`Promote ${from} → ${to}?`)) return;
        await fetch(`${BACKEND_URL}/api/tenants/${tenantId}/promote`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to }),
        });
        load();
    };

    const statusColor = (s: string) => {
        if (s === 'success') return 'var(--accent-green)';
        if (s === 'rolled_back') return 'var(--accent-red)';
        if (s === 'rollback') return 'var(--accent-amber)';
        return 'var(--text-tertiary)';
    };

    const envColor = (e: string) => {
        if (e === 'dev') return 'var(--accent-green)';
        if (e === 'staging') return 'var(--accent-amber)';
        if (e === 'prod') return 'var(--accent-red)';
        return 'var(--text-tertiary)';
    };

    const usagePercent = (used: number, limit: number) => Math.min(100, Math.round((used / limit) * 100));
    const usageColor = (pct: number) => pct > 90 ? 'var(--accent-red)' : pct > 70 ? 'var(--accent-amber)' : 'var(--accent-green)';

    return (
        <div className="app-content" style={{ flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {/* Header */}
            <div className="page-header stagger">
                <div>
                    <h2>🔄 Operations</h2>
                    <div className="page-subtitle">Migrations, quotas, and environments</div>
                </div>
                <div className="tab-nav">
                    {(['migrations', 'quotas', 'environments'] as const).map(t => (
                        <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`}
                            onClick={() => setTab(t)}>
                            {t === 'migrations' ? '📋 Migrations' : t === 'quotas' ? '🛡️ Quotas' : '🌍 Environments'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Migrations Tab */}
            {tab === 'migrations' && (
                <>
                    <div className="panel" style={{ padding: 10, flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select className="input" value={selectedTenant} onChange={e => setSelectedTenant(e.target.value)}
                            style={{ width: 'auto', fontSize: 12 }}>
                            <option value="">All tenants</option>
                            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        {tenants.map(t => (
                            <button key={t.id} className="btn btn-sm" onClick={() => captureMigration(t.id)}>📸 Snapshot: {t.name}</button>
                        ))}
                    </div>

                    <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div className="panel-header">
                            <span className="panel-title" style={{ fontSize: 12 }}>Deploy History</span>
                            <span className="badge badge-blue" style={{ fontSize: 10 }}>{migrations.length}</span>
                        </div>
                        <div className="panel-body" style={{ flex: 1, overflowY: 'auto' }}>
                            {migrations.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-tertiary)', fontSize: 11 }}>
                                    No migrations yet — deploy a tenant or capture a snapshot
                                </div>
                            ) : migrations.map(m => (
                                <div key={m.id} onClick={() => expand(m.id)} style={{
                                    padding: '12px 14px', borderBottom: '1px solid var(--border-primary)', cursor: 'pointer',
                                    background: expandedMigration === m.id ? 'var(--bg-primary)' : 'transparent',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-blue)' }}>v{m.version}</span>
                                            <span style={{ fontSize: 12, fontWeight: 600 }}>{m.tenantName}</span>
                                            <span style={{
                                                fontSize: 9, padding: '2px 6px', borderRadius: 8,
                                                background: `${statusColor(m.status)}15`, color: statusColor(m.status), fontWeight: 600,
                                            }}>{m.status}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {m.schemaSnapshot && (
                                                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                                    {m.schemaSnapshot.tables} tables · {m.schemaSnapshot.reducers} reducers
                                                </span>
                                            )}
                                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                                {new Date(m.timestamp).toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>{m.notes}</div>

                                    {expandedMigration === m.id && (
                                        <div className="fade-in" style={{ marginTop: 10, borderTop: '1px solid var(--border-primary)', paddingTop: 10 }}>
                                            {diffs[m.id] && (
                                                <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
                                                    <div style={{ flex: 1, padding: 10, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                                                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 6 }}>Schema Diff</div>
                                                        {diffs[m.id].previous ? (
                                                            <div style={{ display: 'flex', gap: 12 }}>
                                                                {diffs[m.id].diff.tablesAdded > 0 && <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>+{diffs[m.id].diff.tablesAdded} tables</span>}
                                                                {diffs[m.id].diff.tablesRemoved > 0 && <span style={{ fontSize: 11, color: 'var(--accent-red)' }}>-{diffs[m.id].diff.tablesRemoved} tables</span>}
                                                                {diffs[m.id].diff.reducersAdded > 0 && <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>+{diffs[m.id].diff.reducersAdded} reducers</span>}
                                                                {diffs[m.id].diff.reducersRemoved > 0 && <span style={{ fontSize: 11, color: 'var(--accent-red)' }}>-{diffs[m.id].diff.reducersRemoved} reducers</span>}
                                                                {diffs[m.id].diff.tablesAdded === 0 && diffs[m.id].diff.tablesRemoved === 0 && diffs[m.id].diff.reducersAdded === 0 && diffs[m.id].diff.reducersRemoved === 0 && (
                                                                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>No structural changes</span>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Initial deployment</span>
                                                        )}
                                                    </div>
                                                    <div>
                                                        {m.status === 'success' && (
                                                            <button onClick={e => { e.stopPropagation(); rollback(m.id); }} style={{
                                                                background: 'var(--accent-amber)', color: '#000', border: 'none', borderRadius: 'var(--radius-sm)',
                                                                padding: '6px 12px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                                            }}>⏪ Rollback to v{m.version}</button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* Quotas Tab */}
            {tab === 'quotas' && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {tenants.map(t => {
                        const q = quotas[t.id];
                        if (!q) return null;
                        const rpmPct = usagePercent(q.usage.requestsThisMinute, q.limits.requestsPerMinute);
                        const rdPct = usagePercent(q.usage.requestsToday, q.limits.requestsPerDay);
                        const sPct = usagePercent(q.usage.storageMB, q.limits.storageMB);
                        return (
                            <div key={t.id} className="panel fade-in" style={{ flex: 1, minWidth: 300 }}>
                                <div className="panel-header">
                                    <span className="panel-title" style={{ fontSize: 12 }}>{t.name}</span>
                                    <span className="badge" style={{
                                        background: t.status === 'deployed' ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)',
                                        color: t.status === 'deployed' ? 'var(--accent-green)' : 'var(--text-tertiary)', fontSize: 9,
                                    }}>{t.status}</span>
                                </div>
                                <div className="panel-body">
                                    {[
                                        { label: 'Req/min', used: q.usage.requestsThisMinute, limit: q.limits.requestsPerMinute, pct: rpmPct },
                                        { label: 'Req/day', used: q.usage.requestsToday, limit: q.limits.requestsPerDay, pct: rdPct },
                                        { label: 'Storage', used: q.usage.storageMB, limit: q.limits.storageMB, pct: sPct, unit: 'MB' },
                                    ].map(bar => (
                                        <div key={bar.label} style={{ padding: '8px 0' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                                <span style={{ color: 'var(--text-secondary)' }}>{bar.label}</span>
                                                <span style={{ color: usageColor(bar.pct), fontWeight: 600 }}>
                                                    {bar.used}{bar.unit ? bar.unit : ''} / {bar.limit}{bar.unit ? bar.unit : ''} ({bar.pct}%)
                                                </span>
                                            </div>
                                            <div className="progress-track">
                                                <div className={`progress-fill ${bar.pct > 90 ? 'progress-fill--red' : bar.pct > 70 ? 'progress-fill--amber' : 'progress-fill--green'}`}
                                                    style={{ width: `${bar.pct}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                        Connections: {q.usage.activeConnections} / {q.limits.maxConnections}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {tenants.length === 0 && (
                        <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-tertiary)', fontSize: 11, width: '100%' }}>
                            No tenants registered
                        </div>
                    )}
                </div>
            )}

            {/* Environments Tab */}
            {tab === 'environments' && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {tenants.map(t => {
                        const env = envs[t.id];
                        if (!env) return null;
                        return (
                            <div key={t.id} className="panel fade-in" style={{ flex: 1, minWidth: 360 }}>
                                <div className="panel-header">
                                    <span className="panel-title" style={{ fontSize: 12 }}>{t.name}</span>
                                    <span className="badge" style={{
                                        background: `${envColor(env.active)}15`, color: envColor(env.active), fontSize: 9, fontWeight: 700,
                                    }}>{env.active.toUpperCase()}</span>
                                </div>
                                <div className="panel-body">
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                        {(['dev', 'staging', 'prod'] as const).map(e => (
                                            <div key={e} style={{
                                                flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                                                background: env.active === e ? `${envColor(e)}10` : 'var(--bg-primary)',
                                                border: env.active === e ? `1px solid ${envColor(e)}` : '1px solid var(--border-primary)',
                                            }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: envColor(e), textTransform: 'uppercase' }}>{e}</div>
                                                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                                    {env.environments[e].status}
                                                </div>
                                                {env.environments[e].deployedAt && (
                                                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2 }}>
                                                        {new Date(env.environments[e].deployedAt!).toLocaleDateString()}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                        <button onClick={() => promote(t.id, 'dev', 'staging')} style={{
                                            background: 'var(--accent-amber)', color: '#000', border: 'none', borderRadius: 'var(--radius-sm)',
                                            padding: '5px 12px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                        }}>Dev → Staging</button>
                                        <button onClick={() => promote(t.id, 'staging', 'prod')} style={{
                                            background: 'var(--accent-red)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
                                            padding: '5px 12px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                        }}>Staging → Prod</button>
                                    </div>
                                    {env.promotionHistory.length > 0 && (
                                        <div style={{ marginTop: 10, borderTop: '1px solid var(--border-primary)', paddingTop: 8 }}>
                                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Promotion History</div>
                                            {env.promotionHistory.slice(-5).reverse().map(p => (
                                                <div key={p.id} style={{ fontSize: 10, color: 'var(--text-secondary)', padding: '2px 0' }}>
                                                    {p.from} → {p.to} · {new Date(p.timestamp).toLocaleString()}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
