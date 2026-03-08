import { useState, useCallback } from 'react';
import { useConnection } from '../hooks/useConnection';

export default function ReducersPage() {
    const { reducers, activeDatabase, client } = useConnection();
    const [expandedReducer, setExpandedReducer] = useState<string | null>(null);
    const [paramValues, setParamValues] = useState<Record<string, string>>({});
    const [callResult, setCallResult] = useState<{ reducer: string; success: boolean; error?: string } | null>(null);
    const [calling, setCalling] = useState(false);

    const handleCall = useCallback(async (reducerName: string) => {
        if (!client || !activeDatabase) return;
        setCalling(true);
        setCallResult(null);

        const reducer = reducers.find(r => r.name === reducerName);
        if (!reducer) return;

        // Build args JSON from param values
        let argsJson: string;
        if (reducer.params.length === 0) {
            argsJson = '{}';
        } else {
            const args: Record<string, unknown> = {};
            for (const p of reducer.params) {
                const raw = paramValues[`${reducerName}.${p.name}`] || '';
                // Auto-coerce types
                if (p.type.includes('u') || p.type.includes('i') || p.type.includes('f')) {
                    args[p.name] = Number(raw) || 0;
                } else if (p.type === 'bool') {
                    args[p.name] = raw === 'true';
                } else {
                    args[p.name] = raw;
                }
            }
            argsJson = JSON.stringify(args);
        }

        try {
            const result = await client.callReducer(activeDatabase, reducerName, argsJson);
            setCallResult({ reducer: reducerName, ...result });
        } catch (err) {
            setCallResult({ reducer: reducerName, success: false, error: String(err) });
        } finally {
            setCalling(false);
        }
    }, [client, activeDatabase, reducers, paramValues]);

    if (!activeDatabase) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state">
                        <div className="icon">ƒ</div>
                        <h3>No Database Selected</h3>
                        <p>Select a database from the Tables page first</p>
                    </div>
                </div>
            </div>
        );
    }

    const lifecycleReducers = reducers.filter(r => r.lifecycle);
    const userReducers = reducers.filter(r => !r.lifecycle);

    return (
        <div className="app-content">
            <div className="panel" style={{ flex: 1 }}>
                <div className="panel-header">
                    <div>
                        <div className="panel-title">Reducers</div>
                        <div className="panel-subtitle">
                            {reducers.length} total · {userReducers.length} user-defined · {lifecycleReducers.length} lifecycle
                        </div>
                    </div>
                </div>
                <div className="panel-body">
                    {userReducers.length === 0 && lifecycleReducers.length === 0 ? (
                        <div className="empty-state">
                            <div className="icon">ƒ</div>
                            <h3>No Reducers</h3>
                            <p>This module has no reducers defined.</p>
                        </div>
                    ) : (
                        <>
                            {userReducers.map(reducer => {
                                const isExpanded = expandedReducer === reducer.name;
                                return (
                                    <div
                                        key={reducer.name}
                                        style={{
                                            padding: '12px 0',
                                            borderBottom: '1px solid var(--border-subtle)',
                                        }}
                                    >
                                        <div
                                            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                            onClick={() => setExpandedReducer(isExpanded ? null : reducer.name)}
                                        >
                                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                                {isExpanded ? '▼' : '▶'}
                                            </span>
                                            <span style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, flex: 1 }}>
                                                {reducer.name}
                                            </span>
                                            <span className="badge badge-blue">Reducer</span>
                                        </div>

                                        {/* Signature */}
                                        {reducer.params.length > 0 ? (
                                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', marginLeft: 24, marginTop: 4 }}>
                                                ({reducer.params.map((p, i) => (
                                                    <span key={i}>
                                                        {i > 0 && ', '}
                                                        <span style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                                                        : <span style={{ color: 'var(--accent-purple)' }}>{p.type}</span>
                                                    </span>
                                                ))})
                                            </div>
                                        ) : (
                                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 24, marginTop: 4 }}>(no params)</div>
                                        )}

                                        {/* Expanded Call Form */}
                                        {isExpanded && (
                                            <div className="fade-in" style={{
                                                marginTop: 10, marginLeft: 24, padding: 12,
                                                background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)',
                                                border: '1px solid var(--border-subtle)',
                                            }}>
                                                {reducer.params.length > 0 ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                                                        {reducer.params.map(param => (
                                                            <div key={param.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                <label style={{
                                                                    fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                                                                    width: 100, flexShrink: 0,
                                                                }}>
                                                                    {param.name}
                                                                </label>
                                                                <input
                                                                    className="input input-mono"
                                                                    value={paramValues[`${reducer.name}.${param.name}`] || ''}
                                                                    onChange={e => setParamValues(prev => ({
                                                                        ...prev,
                                                                        [`${reducer.name}.${param.name}`]: e.target.value,
                                                                    }))}
                                                                    placeholder={param.type}
                                                                    style={{ fontSize: 11, padding: '4px 8px' }}
                                                                />
                                                                <span style={{ fontSize: 10, color: 'var(--accent-purple)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                                                                    {param.type}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                                                        This reducer takes no parameters.
                                                    </div>
                                                )}

                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => handleCall(reducer.name)}
                                                        disabled={calling}
                                                    >
                                                        {calling ? 'Calling...' : '▶ Call Reducer'}
                                                    </button>

                                                    {callResult && callResult.reducer === reducer.name && (
                                                        <span style={{
                                                            fontSize: 11,
                                                            color: callResult.success ? 'var(--accent-green)' : 'var(--accent-red)',
                                                            fontFamily: 'var(--font-mono)',
                                                        }}>
                                                            {callResult.success ? '✓ Success' : `✗ ${callResult.error?.slice(0, 80)}`}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {lifecycleReducers.length > 0 && (
                                <>
                                    <div style={{ padding: '16px 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Lifecycle
                                    </div>
                                    {lifecycleReducers.map(reducer => (
                                        <div
                                            key={reducer.name}
                                            style={{
                                                padding: '8px 0',
                                                borderBottom: '1px solid var(--border-subtle)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                            }}
                                        >
                                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
                                                {reducer.name}
                                            </span>
                                            <span className="badge badge-amber">{reducer.lifecycle}</span>
                                        </div>
                                    ))}
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Quick Help Panel */}
            <div className="panel" style={{ width: 280, flexShrink: 0 }}>
                <div className="panel-header">
                    <div className="panel-title">Quick Reference</div>
                </div>
                <div className="panel-body" style={{ fontSize: 12 }}>
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>How Reducers Work</div>
                        <p style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                            Reducers are server-side functions that modify database state. Click a reducer to expand its call form, fill in parameters, and invoke it.
                        </p>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>Type Coercion</div>
                        <p style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                            Numeric types (u32, i64, etc.) are auto-parsed from your input. Strings are passed as-is. Booleans accept "true" or "false".
                        </p>
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>Active Database</div>
                        <span className="badge badge-purple">{activeDatabase}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
