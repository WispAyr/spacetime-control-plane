import { useState } from 'react';
import { useConnection } from '../hooks/useConnection';

export default function SqlConsolePage() {
    const { client, activeDatabase } = useConnection();
    const [query, setQuery] = useState('SELECT * FROM ');
    const [results, setResults] = useState<{ columns: string[]; rows: Record<string, unknown>[]; duration?: number } | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState<string[]>([]);

    const executeQuery = async () => {
        if (!client || !activeDatabase || !query.trim()) return;

        setLoading(true);
        setError('');
        setResults(null);

        try {
            const result = await client.sql(activeDatabase, query);
            setResults(result);
            setHistory(prev => [query, ...prev.filter(q => q !== query)].slice(0, 20));
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            executeQuery();
        }
    };

    if (!activeDatabase) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state">
                        <div className="icon">⚡</div>
                        <h3>No Database Selected</h3>
                        <p>Select a database from the Tables page first</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="app-content" style={{ flexDirection: 'column' }}>
            {/* Query Editor */}
            <div className="panel" style={{ flexShrink: 0 }}>
                <div className="panel-header">
                    <div className="panel-title">SQL Console</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <span className="badge badge-purple">{activeDatabase}</span>
                        <button className="btn btn-primary btn-sm" onClick={executeQuery} disabled={loading}>
                            {loading ? 'Running...' : 'Run ⌘↵'}
                        </button>
                    </div>
                </div>
                <div style={{ padding: 0 }}>
                    <textarea
                        className="input input-mono"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="SELECT * FROM my_table"
                        style={{
                            minHeight: 100,
                            resize: 'vertical',
                            border: 'none',
                            borderRadius: 0,
                            borderTop: '1px solid var(--border-subtle)',
                            background: 'var(--bg-primary)',
                        }}
                    />
                </div>
            </div>

            {/* Results */}
            <div className="panel" style={{ flex: 1 }}>
                <div className="panel-header">
                    <div className="panel-title">Results</div>
                    {results && (
                        <span className="panel-subtitle">
                            {results.rows.length} rows · {results.duration?.toFixed(0)}ms
                        </span>
                    )}
                </div>
                <div className="panel-body" style={{ padding: 0 }}>
                    {error && (
                        <div style={{ padding: 16, color: 'var(--accent-red)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                            {error}
                        </div>
                    )}
                    {results && results.rows.length > 0 ? (
                        <div style={{ overflow: 'auto', width: '100%', height: '100%' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        {results.columns.map(col => (
                                            <th key={col}>{col}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.rows.map((row, i) => (
                                        <tr key={i}>
                                            {results.columns.map(col => (
                                                <td key={col}>
                                                    {row[col] === null || row[col] === undefined
                                                        ? '∅'
                                                        : typeof row[col] === 'object'
                                                            ? JSON.stringify(row[col])
                                                            : String(row[col])}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : results && results.rows.length === 0 ? (
                        <div className="empty-state">
                            <h3>Query returned no rows</h3>
                        </div>
                    ) : !error ? (
                        <div className="empty-state">
                            <div className="icon">&gt;_</div>
                            <h3>Run a Query</h3>
                            <p>Type a SQL query above and press ⌘↵ to execute</p>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* History Sidebar */}
            {history.length > 0 && (
                <div className="panel" style={{ position: 'absolute', right: 20, top: 80, width: 260, maxHeight: 300, zIndex: 5, display: 'none' }}>
                    <div className="panel-header">
                        <div className="panel-title">History</div>
                    </div>
                    <div className="panel-body">
                        {history.map((q, i) => (
                            <div
                                key={i}
                                className="tree-item"
                                onClick={() => setQuery(q)}
                                style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
                            >
                                {q.slice(0, 40)}{q.length > 40 ? '…' : ''}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
