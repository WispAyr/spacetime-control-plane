import { useState, type FormEvent } from 'react';
import { useConnection } from '../hooks/useConnection';

interface ConnectDialogProps {
    onClose: () => void;
}

export default function ConnectDialog({ onClose }: ConnectDialogProps) {
    const { connect } = useConnection();
    const [url, setUrl] = useState('http://localhost:3001');
    const [name, setName] = useState('local');
    const [database, setDatabase] = useState('test-module-7970f');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await connect(url, name || undefined, database || undefined);
            onClose();
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="connect-modal-overlay" onClick={onClose}>
            <div className="connect-modal fade-in" onClick={e => e.stopPropagation()}>
                <h2>Connect to SpacetimeDB</h2>
                <p className="subtitle">Enter the URL of a running SpacetimeDB instance</p>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Instance URL</label>
                        <input
                            className="input input-mono"
                            type="url"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            placeholder="http://localhost:3001"
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label>Database Name</label>
                        <input
                            className="input input-mono"
                            type="text"
                            value={database}
                            onChange={e => setDatabase(e.target.value)}
                            placeholder="my-database"
                        />
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, display: 'block' }}>
                            The name used with <code>spacetime publish</code>
                        </span>
                    </div>

                    <div className="form-group">
                        <label>Display Name (optional)</label>
                        <input
                            className="input"
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="my-instance"
                        />
                    </div>

                    {error && (
                        <div style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 12 }}>
                            {error}
                        </div>
                    )}

                    <div className="form-actions">
                        <button type="button" className="btn" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading || !url}>
                            {loading ? 'Connecting...' : 'Connect'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
