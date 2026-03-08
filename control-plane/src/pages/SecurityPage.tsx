import { useState, useEffect, useCallback } from 'react';

const BACKEND_URL = 'http://localhost:3002';

interface ApiKey {
    id: string;
    name: string;
    key: string;
    scopes: string[];
    createdAt: string;
    lastUsedAt: string | null;
    active: boolean;
}

export default function SecurityPage() {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [newKeyName, setNewKeyName] = useState('');
    const [newKeyResult, setNewKeyResult] = useState<ApiKey | null>(null);
    const [token, setToken] = useState<string | null>(localStorage.getItem('stcp_token'));
    const [password, setPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [backendOk, setBackendOk] = useState(false);

    const loadKeys = useCallback(async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/auth/keys`);
            if (res.ok) { setKeys(await res.json()); setBackendOk(true); }
        } catch { setBackendOk(false); }
    }, []);

    useEffect(() => { loadKeys(); }, [loadKeys]);

    const handleLogin = async () => {
        setLoginError('');
        try {
            const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            if (res.ok) {
                const data = await res.json();
                setToken(data.token);
                localStorage.setItem('stcp_token', data.token);
                setPassword('');
            } else {
                setLoginError('Invalid password');
            }
        } catch {
            setLoginError('Backend unreachable');
        }
    };

    const handleLogout = () => {
        setToken(null);
        localStorage.removeItem('stcp_token');
    };

    const handleCreateKey = async () => {
        if (!newKeyName.trim()) return;
        const res = await fetch(`${BACKEND_URL}/api/auth/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newKeyName.trim() }),
        });
        if (res.ok) {
            const key = await res.json();
            setNewKeyResult(key);
            setNewKeyName('');
            loadKeys();
        }
    };

    const handleRevokeKey = async (id: string) => {
        await fetch(`${BACKEND_URL}/api/auth/keys/${id}`, { method: 'DELETE' });
        loadKeys();
    };

    const activeKeys = keys.filter(k => k.active);
    const revokedKeys = keys.filter(k => !k.active);

    if (!backendOk) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state" style={{ padding: 60 }}>
                        <div className="icon">🔐</div>
                        <h3>Backend Not Running</h3>
                        <p>Start the backend to manage security settings</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="app-content" style={{ flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {/* Header */}
            <div style={{ flexShrink: 0 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px' }}>Security & Auth</h2>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    Manage access tokens, API keys, and authentication
                </span>
            </div>

            {/* Session */}
            <div className="panel" style={{ flexShrink: 0 }}>
                <div className="panel-header">
                    <span className="panel-title">Session</span>
                    <span className={`badge ${token ? 'badge-green' : 'badge-amber'}`}>
                        {token ? 'authenticated' : 'not logged in'}
                    </span>
                </div>
                <div className="panel-body">
                    {token ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                ✓ Active session (JWT token stored)
                            </span>
                            <button className="btn btn-sm" onClick={handleLogout} style={{ color: 'var(--accent-red)' }}>
                                Logout
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                                    Admin Password
                                </label>
                                <input
                                    type="password"
                                    className="input"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Enter admin password"
                                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                                />
                            </div>
                            <button className="btn btn-primary" onClick={handleLogin} disabled={!password}>
                                Login
                            </button>
                        </div>
                    )}
                    {loginError && (
                        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent-red)' }}>⚠ {loginError}</div>
                    )}
                    <div style={{
                        marginTop: 12, padding: 10, background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)',
                        fontSize: 11, color: 'var(--text-tertiary)',
                    }}>
                        Default password: <code style={{ color: 'var(--accent-cyan)' }}>spacetime</code> · Set via{' '}
                        <code style={{ color: 'var(--accent-cyan)' }}>ADMIN_PASSWORD</code> env var
                    </div>
                </div>
            </div>

            {/* API Keys */}
            <div className="panel" style={{ flexShrink: 0 }}>
                <div className="panel-header">
                    <span className="panel-title">API Keys</span>
                    <span className="badge badge-blue">{activeKeys.length} active</span>
                </div>
                <div className="panel-body">
                    {/* Create */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                        <input
                            className="input input-mono"
                            value={newKeyName}
                            onChange={e => setNewKeyName(e.target.value)}
                            placeholder="Key name (e.g. ci-pipeline, staging-deploy)"
                            style={{ flex: 1 }}
                            onKeyDown={e => e.key === 'Enter' && handleCreateKey()}
                        />
                        <button className="btn btn-primary" onClick={handleCreateKey} disabled={!newKeyName.trim()}>
                            + Generate Key
                        </button>
                    </div>

                    {/* Show new key */}
                    {newKeyResult && (
                        <div className="fade-in" style={{
                            padding: 12, marginBottom: 16,
                            background: 'linear-gradient(135deg, rgba(0,200,100,0.1), rgba(0,150,255,0.05))',
                            borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-green)',
                        }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-green)', marginBottom: 6 }}>
                                ✓ API Key Created — Copy this now, it won't be shown again!
                            </div>
                            <div style={{
                                padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)',
                                fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)',
                                wordBreak: 'break-all', userSelect: 'all',
                            }}>
                                {newKeyResult.key}
                            </div>
                            <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-tertiary)' }}>
                                <span>Name: <strong>{newKeyResult.name}</strong></span>
                                <span>Scopes: {newKeyResult.scopes.join(', ')}</span>
                            </div>
                            <button
                                className="btn btn-sm"
                                style={{ marginTop: 8 }}
                                onClick={() => setNewKeyResult(null)}
                            >
                                Dismiss
                            </button>
                        </div>
                    )}

                    {/* Active keys */}
                    {activeKeys.length > 0 ? (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Name</th>
                                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Key</th>
                                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Scopes</th>
                                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Created</th>
                                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Last Used</th>
                                    <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeKeys.map(k => (
                                    <tr key={k.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                        <td style={{ padding: '8px', fontWeight: 600 }}>{k.name}</td>
                                        <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', fontSize: 11 }}>{k.key}</td>
                                        <td style={{ padding: '8px' }}>
                                            {k.scopes.map(s => (
                                                <span key={s} className="badge badge-blue" style={{ fontSize: 9, marginRight: 4 }}>{s}</span>
                                            ))}
                                        </td>
                                        <td style={{ padding: '8px', color: 'var(--text-tertiary)', fontSize: 11 }}>{new Date(k.createdAt).toLocaleDateString()}</td>
                                        <td style={{ padding: '8px', color: 'var(--text-tertiary)', fontSize: 11 }}>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}</td>
                                        <td style={{ padding: '8px', textAlign: 'right' }}>
                                            <button className="btn btn-sm" style={{ color: 'var(--accent-red)' }} onClick={() => handleRevokeKey(k.id)}>
                                                Revoke
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 12 }}>
                            No API keys yet — generate one for CI/CD pipelines or external integrations
                        </div>
                    )}

                    {/* Revoked keys */}
                    {revokedKeys.length > 0 && (
                        <div style={{ marginTop: 16 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6, letterSpacing: '0.5px' }}>
                                REVOKED KEYS
                            </div>
                            {revokedKeys.map(k => (
                                <div key={k.id} style={{
                                    display: 'flex', gap: 12, padding: '4px 8px', fontSize: 11,
                                    color: 'var(--text-tertiary)', opacity: 0.6, textDecoration: 'line-through',
                                }}>
                                    <span>{k.name}</span>
                                    <span style={{ fontFamily: 'var(--font-mono)' }}>{k.key}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Usage Info */}
            <div className="panel" style={{ flexShrink: 0 }}>
                <div className="panel-header">
                    <span className="panel-title">Integration Guide</span>
                </div>
                <div className="panel-body" style={{ fontSize: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div>
                            <h4 style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--accent-cyan)' }}>JWT Auth</h4>
                            <pre style={{
                                padding: 10, background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)',
                                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)',
                                whiteSpace: 'pre-wrap', lineHeight: 1.6,
                            }}>{`// Login
POST /api/auth/login
{ "password": "spacetime" }

// Use token
GET /api/auth/verify
Authorization: Bearer <token>`}</pre>
                        </div>
                        <div>
                            <h4 style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--accent-purple)' }}>API Key Auth</h4>
                            <pre style={{
                                padding: 10, background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)',
                                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)',
                                whiteSpace: 'pre-wrap', lineHeight: 1.6,
                            }}>{`// Validate key
POST /api/auth/validate-key
{ "apiKey": "stcp_..." }

// Use in headers
X-API-Key: stcp_...`}</pre>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
