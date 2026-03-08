import { useState, useEffect, useCallback } from 'react';

const BACKEND_URL = 'http://localhost:3002';

interface Policy {
    id: string;
    tenantId: string;
    tenantName: string;
    table: string;
    operation: string;
    condition: string;
    description: string;
    enforcement: string;
    createdAt: string;
}

interface Tenant {
    id: string;
    name: string;
    database: string | null;
}

export default function PoliciesPage() {
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [selectedTenant, setSelectedTenant] = useState<string>('');
    const [policies, setPolicies] = useState<Policy[]>([]);
    const [generatedCode, setGeneratedCode] = useState('');
    const [backendOk, setBackendOk] = useState(false);

    // New policy form
    const [newTable, setNewTable] = useState('');
    const [newOp, setNewOp] = useState('all');
    const [newCondition, setNewCondition] = useState('owner_id == ctx.sender');
    const [newDesc, setNewDesc] = useState('');

    const loadTenants = useCallback(async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/tenants`);
            if (res.ok) { setTenants(await res.json()); setBackendOk(true); }
        } catch { setBackendOk(false); }
    }, []);

    const loadPolicies = useCallback(async (tenantId: string) => {
        if (!tenantId) { setPolicies([]); return; }
        const res = await fetch(`${BACKEND_URL}/api/tenants/${tenantId}/policies`);
        if (res.ok) setPolicies(await res.json());
    }, []);

    const loadCodegen = useCallback(async (tenantId: string) => {
        if (!tenantId) { setGeneratedCode(''); return; }
        const res = await fetch(`${BACKEND_URL}/api/tenants/${tenantId}/policies/codegen`);
        if (res.ok) {
            const data = await res.json();
            setGeneratedCode(data.code);
        }
    }, []);

    useEffect(() => { loadTenants(); }, [loadTenants]);

    useEffect(() => {
        if (selectedTenant) {
            loadPolicies(selectedTenant);
            loadCodegen(selectedTenant);
        }
    }, [selectedTenant, loadPolicies, loadCodegen]);

    const handleCreate = async () => {
        if (!selectedTenant || !newTable.trim()) return;
        await fetch(`${BACKEND_URL}/api/tenants/${selectedTenant}/policies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                table: newTable.trim(),
                operation: newOp,
                condition: newCondition,
                description: newDesc,
            }),
        });
        setNewTable('');
        setNewDesc('');
        loadPolicies(selectedTenant);
        loadCodegen(selectedTenant);
    };

    const handleToggle = async (policy: Policy) => {
        const next = policy.enforcement === 'enforced' ? 'disabled' : 'enforced';
        await fetch(`${BACKEND_URL}/api/tenants/${selectedTenant}/policies/${policy.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enforcement: next }),
        });
        loadPolicies(selectedTenant);
        loadCodegen(selectedTenant);
    };

    const handleDelete = async (policyId: string) => {
        await fetch(`${BACKEND_URL}/api/tenants/${selectedTenant}/policies/${policyId}`, { method: 'DELETE' });
        loadPolicies(selectedTenant);
        loadCodegen(selectedTenant);
    };

    if (!backendOk) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state" style={{ padding: 60 }}>
                        <div className="icon">🛡️</div>
                        <h3>Backend Not Running</h3>
                        <p>Start the backend to manage RLS policies</p>
                    </div>
                </div>
            </div>
        );
    }

    const enforcedCount = policies.filter(p => p.enforcement === 'enforced').length;
    const selectedName = tenants.find(t => t.id === selectedTenant)?.name || '';

    return (
        <div className="app-content" style={{ flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {/* Header */}
            <div className="page-header stagger">
                <div>
                    <h2>Row-Level Security</h2>
                    <div className="page-subtitle">Define access policies per table — generates SpacetimeDB guard code</div>
                </div>
                <select
                    className="input"
                    style={{ width: 200, fontSize: 12 }}
                    value={selectedTenant}
                    onChange={e => setSelectedTenant(e.target.value)}
                >
                    <option value="">Select tenant…</option>
                    {tenants.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
            </div>

            {!selectedTenant ? (
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state" style={{ padding: 60 }}>
                        <div className="icon">🛡️</div>
                        <h3>Select a Tenant</h3>
                        <p>Choose a tenant from the dropdown to manage its RLS policies</p>
                    </div>
                </div>
            ) : (
                <>
                    {/* Create Policy */}
                    <div className="panel" style={{ flexShrink: 0 }}>
                        <div className="panel-header">
                            <span className="panel-title">Add Policy for {selectedName}</span>
                            <span className="badge badge-green">{enforcedCount} enforced</span>
                        </div>
                        <div className="panel-body">
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 2fr 1fr auto', gap: 8, alignItems: 'flex-end' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Table</label>
                                    <input
                                        className="input input-mono"
                                        value={newTable}
                                        onChange={e => setNewTable(e.target.value)}
                                        placeholder="table_name"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Op</label>
                                    <select className="input" value={newOp} onChange={e => setNewOp(e.target.value)} style={{ fontSize: 11 }}>
                                        <option value="all">ALL</option>
                                        <option value="read">READ</option>
                                        <option value="insert">INSERT</option>
                                        <option value="update">UPDATE</option>
                                        <option value="delete">DELETE</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Condition</label>
                                    <input
                                        className="input input-mono"
                                        value={newCondition}
                                        onChange={e => setNewCondition(e.target.value)}
                                        placeholder="owner_id == ctx.sender"
                                        style={{ fontSize: 11 }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Description</label>
                                    <input
                                        className="input"
                                        value={newDesc}
                                        onChange={e => setNewDesc(e.target.value)}
                                        placeholder="Optional"
                                        style={{ fontSize: 11 }}
                                    />
                                </div>
                                <button className="btn btn-primary" onClick={handleCreate} disabled={!newTable.trim()}>
                                    + Add
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Policy Table */}
                    <div className="panel" style={{ flexShrink: 0 }}>
                        <div className="panel-header">
                            <span className="panel-title">Active Policies</span>
                            <span className="badge badge-blue">{policies.length} total</span>
                        </div>
                        <div className="panel-body">
                            {policies.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-tertiary)', fontSize: 12 }}>
                                    No policies defined — add one above to start securing this tenant's tables
                                </div>
                            ) : (
                                <table className="table-premium">
                                    <thead>
                                        <tr>
                                            <th>Table</th>
                                            <th>Operation</th>
                                            <th>Condition</th>
                                            <th>Status</th>
                                            <th className="text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {policies.map(p => (
                                            <tr key={p.id} style={{
                                                opacity: p.enforcement === 'disabled' ? 0.5 : 1,
                                            }}>
                                                <td className="text-mono" style={{ fontWeight: 600 }}>{p.table}</td>
                                                <td>
                                                    <span className={`badge badge-${p.operation === 'all' ? 'purple' : 'blue'}`} style={{ fontSize: 9 }}>
                                                        {p.operation.toUpperCase()}
                                                    </span>
                                                </td>
                                                <td className="text-mono" style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>
                                                    {p.condition}
                                                </td>
                                                <td>
                                                    <span
                                                        onClick={() => handleToggle(p)}
                                                        className={`enforcement-toggle enforcement-toggle--${p.enforcement}`}
                                                    >
                                                        {p.enforcement === 'enforced' ? '● ENFORCED' : '○ DISABLED'}
                                                    </span>
                                                </td>
                                                <td className="text-right">
                                                    <button
                                                        className="btn btn-sm"
                                                        style={{ color: 'var(--accent-red)', fontSize: 11 }}
                                                        onClick={() => handleDelete(p.id)}
                                                    >
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    {/* Generated Code */}
                    {generatedCode && (
                        <div className="panel fade-in" style={{ flexShrink: 0 }}>
                            <div className="panel-header">
                                <span className="panel-title">Generated Guard Code</span>
                                <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(generatedCode)}>
                                    📋 Copy
                                </button>
                            </div>
                            <div className="panel-body">
                                <pre className="code-block code-block--green">
                                    {generatedCode}
                                </pre>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
