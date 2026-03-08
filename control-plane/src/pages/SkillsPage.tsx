import { useState, useEffect, useCallback } from 'react';

interface Skill {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    content?: string;
}

interface Execution {
    id: string;
    tenantId: string;
    tenantName: string;
    operation: string;
    skillId: string | null;
    workerId: string | null;
    status: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    error: string | null;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
}

interface MemoryNote {
    id: string;
    content: string;
    tags: string[];
    createdAt: string;
}

interface MemoryPattern {
    key: string;
    value: string;
    count: number;
    lastUsed: string;
}

interface WorkerMemory {
    workerId: string;
    workerName: string;
    preferences: Record<string, unknown>;
    patterns: MemoryPattern[];
    notes: MemoryNote[];
}

const BACKEND = 'http://localhost:3002';

export default function SkillsPage() {
    const [skills, setSkills] = useState<Skill[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
    const [executions, setExecutions] = useState<Execution[]>([]);
    const [memory, setMemory] = useState<WorkerMemory | null>(null);
    const [workerId, setWorkerId] = useState('');
    const [newNote, setNewNote] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Array<{ type: string; content?: string; key?: string; value?: string; workerName: string }>>([]);
    const [loading, setLoading] = useState(true);

    // Load skills
    const loadSkills = useCallback(async () => {
        try {
            const res = await fetch(`${BACKEND}/api/skills`);
            if (res.ok) setSkills(await res.json());
        } catch { /* ignore */ }
    }, []);

    // Load executions
    const loadExecutions = useCallback(async () => {
        try {
            const res = await fetch(`${BACKEND}/api/executions?limit=20`);
            if (res.ok) {
                const data = await res.json();
                setExecutions(data.executions || []);
            }
        } catch { /* ignore */ }
    }, []);

    // Load worker memory
    const loadMemory = useCallback(async (wid: string) => {
        if (!wid) { setMemory(null); return; }
        try {
            const res = await fetch(`${BACKEND}/api/workers/${wid}/memory`);
            if (res.ok) setMemory(await res.json());
        } catch { /* ignore */ }
    }, []);

    // Detect active worker
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${BACKEND}/api/workers`);
                if (res.ok) {
                    const ws = await res.json();
                    if (ws.length > 0) {
                        setWorkerId(ws[0].id);
                        loadMemory(ws[0].id);
                    }
                }
            } catch { /* ignore */ }
        })();
    }, [loadMemory]);

    useEffect(() => {
        Promise.all([loadSkills(), loadExecutions()]).finally(() => setLoading(false));
        const interval = setInterval(loadExecutions, 5000);
        return () => clearInterval(interval);
    }, [loadSkills, loadExecutions]);

    // Select full skill
    const selectSkill = async (skillId: string) => {
        try {
            const res = await fetch(`${BACKEND}/api/skills/${skillId}`);
            if (res.ok) setSelectedSkill(await res.json());
        } catch { /* ignore */ }
    };

    // Add a note
    const addNote = async () => {
        if (!workerId || !newNote.trim()) return;
        try {
            await fetch(`${BACKEND}/api/workers/${workerId}/memory/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: newNote.trim(), tags: [] }),
            });
            setNewNote('');
            loadMemory(workerId);
        } catch { /* ignore */ }
    };

    // Delete a note
    const deleteNote = async (noteId: string) => {
        if (!workerId) return;
        try {
            await fetch(`${BACKEND}/api/workers/${workerId}/memory/notes/${noteId}`, { method: 'DELETE' });
            loadMemory(workerId);
        } catch { /* ignore */ }
    };

    // Search memory
    const searchMemory = async () => {
        if (!searchQuery.trim()) { setSearchResults([]); return; }
        try {
            const res = await fetch(`${BACKEND}/api/memory/search?q=${encodeURIComponent(searchQuery)}`);
            if (res.ok) {
                const data = await res.json();
                setSearchResults(data.results || []);
            }
        } catch { /* ignore */ }
    };

    const statusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'badge-green';
            case 'running': return 'badge-amber';
            case 'failed': return 'badge-red';
            default: return 'badge-blue';
        }
    };

    const categoryColor = (cat: string) => {
        switch (cat) {
            case 'operations': return 'badge-blue';
            case 'security': return 'badge-red';
            case 'observability': return 'badge-purple';
            default: return 'badge-amber';
        }
    };

    if (loading) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state"><p>Loading skills...</p></div>
                </div>
            </div>
        );
    }

    return (
        <div className="app-content" style={{ flexDirection: 'column' }}>
            {/* Header */}
            <div className="page-header stagger-1">
                <div>
                    <h1 className="page-title">Skills & Memory</h1>
                    <p className="page-subtitle">
                        {skills.length} skills · {executions.length} recent executions · {memory?.notes.length || 0} notes
                    </p>
                </div>
                <div className="page-actions">
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                            className="input"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && searchMemory()}
                            placeholder="Search memory..."
                            style={{ width: 200, fontSize: 12 }}
                        />
                        <button className="btn btn-primary btn-sm" onClick={searchMemory}>🔍</button>
                    </div>
                </div>
            </div>

            {/* Search Results (if any) */}
            {searchResults.length > 0 && (
                <div className="panel stagger-2" style={{ flexShrink: 0, maxHeight: 200 }}>
                    <div className="panel-header">
                        <div className="panel-title">Search Results</div>
                        <button className="btn btn-sm" onClick={() => setSearchResults([])}>✕</button>
                    </div>
                    <div className="panel-body" style={{ overflowY: 'auto' }}>
                        {searchResults.map((r, i) => (
                            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span className={`badge ${r.type === 'note' ? 'badge-blue' : 'badge-amber'}`}>{r.type}</span>
                                <span style={{ fontSize: 12, flex: 1 }}>{r.content || `${r.key}: ${r.value}`}</span>
                                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{r.workerName}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
                {/* Skills Catalog */}
                <div className="panel stagger-2" style={{ width: 280, flexShrink: 0 }}>
                    <div className="panel-header">
                        <div className="panel-title">Skill Catalog</div>
                        <span className="badge badge-purple">{skills.length}</span>
                    </div>
                    <div className="panel-body">
                        {skills.map(skill => (
                            <div
                                key={skill.id}
                                className={`tree-item ${selectedSkill?.id === skill.id ? 'active' : ''}`}
                                onClick={() => selectSkill(skill.id)}
                            >
                                <span className="icon">{skill.icon}</span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 500, fontSize: 12 }}>{skill.name}</div>
                                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{skill.description.slice(0, 60)}</div>
                                </div>
                                <span className={`badge ${categoryColor(skill.category)}`} style={{ fontSize: 9 }}>
                                    {skill.category}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Skill Detail */}
                <div className="panel stagger-3" style={{ flex: 1 }}>
                    <div className="panel-header">
                        <div>
                            <div className="panel-title">
                                {selectedSkill ? `${selectedSkill.icon} ${selectedSkill.name}` : 'Select a Skill'}
                            </div>
                            {selectedSkill && (
                                <div className="panel-subtitle">{selectedSkill.description}</div>
                            )}
                        </div>
                        {selectedSkill && (
                            <span className={`badge ${categoryColor(selectedSkill.category)}`}>{selectedSkill.category}</span>
                        )}
                    </div>
                    <div className="panel-body" style={{ overflowY: 'auto' }}>
                        {selectedSkill?.content ? (
                            <div className="skill-content">
                                {selectedSkill.content.split('\n').map((line, i) => {
                                    // Simple markdown rendering
                                    if (line.startsWith('## ')) return <h3 key={i} style={{ color: 'var(--accent-primary)', fontSize: 14, marginTop: 16, marginBottom: 8 }}>{line.slice(3)}</h3>;
                                    if (line.startsWith('### ')) return <h4 key={i} style={{ color: 'var(--text-primary)', fontSize: 13, marginTop: 12, marginBottom: 4, fontWeight: 600 }}>{line.slice(4)}</h4>;
                                    if (line.startsWith('```')) return <div key={i} style={{ borderBottom: '1px solid var(--border-subtle)', margin: '4px 0' }} />;
                                    if (line.startsWith('- ')) return <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 12, marginBottom: 2 }}>• {line.slice(2)}</div>;
                                    if (line.startsWith('| ')) {
                                        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
                                        return (
                                            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-subtle)', padding: '3px 0' }}>
                                                {cells.map((cell, j) => <span key={j} style={{ flex: 1 }}>{cell}</span>)}
                                            </div>
                                        );
                                    }
                                    if (line.trim() === '') return <div key={i} style={{ height: 8 }} />;
                                    return <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>{line}</div>;
                                })}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <div className="icon">📋</div>
                                <h3>Select a Skill</h3>
                                <p>Choose a skill from the catalog to view its workflow and instructions</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Memory Panel */}
                <div className="panel stagger-4" style={{ width: 300, flexShrink: 0 }}>
                    <div className="panel-header">
                        <div>
                            <div className="panel-title">🧠 Memory</div>
                            <div className="panel-subtitle">{memory?.workerName || 'No worker'}</div>
                        </div>
                    </div>
                    <div className="panel-body" style={{ overflowY: 'auto' }}>
                        {/* Patterns */}
                        {memory && memory.patterns.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>
                                    Patterns
                                </div>
                                {memory.patterns.map((p, i) => (
                                    <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, flex: 1, color: 'var(--text-secondary)' }}>
                                            {p.key}
                                        </span>
                                        <span className="badge badge-blue" style={{ fontSize: 9 }}>×{p.count}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Notes */}
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>
                                Knowledge Notes
                            </div>
                            {memory?.notes.map(note => (
                                <div key={note.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{note.content}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                                            {new Date(note.createdAt).toLocaleDateString()}
                                        </span>
                                        <button className="btn btn-sm" onClick={() => deleteNote(note.id)} style={{ fontSize: 9, marginLeft: 'auto' }}>✕</button>
                                    </div>
                                </div>
                            ))}

                            {(!memory || memory.notes.length === 0) && (
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '8px 0' }}>
                                    No notes yet. Add operational knowledge below.
                                </div>
                            )}
                        </div>

                        {/* Add Note */}
                        <div style={{ display: 'flex', gap: 6 }}>
                            <input
                                className="input"
                                value={newNote}
                                onChange={e => setNewNote(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addNote()}
                                placeholder="Add a note..."
                                style={{ fontSize: 11, flex: 1 }}
                            />
                            <button className="btn btn-primary btn-sm" onClick={addNote} disabled={!newNote.trim()}>+</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Execution History */}
            <div className="panel stagger-5" style={{ flexShrink: 0, maxHeight: 220 }}>
                <div className="panel-header">
                    <div className="panel-title">Execution History</div>
                    <span className="badge badge-blue">{executions.length} recent</span>
                </div>
                <div className="panel-body" style={{ padding: 0, overflowY: 'auto' }}>
                    {executions.length === 0 ? (
                        <div className="empty-state" style={{ padding: 20 }}>
                            <p style={{ fontSize: 12 }}>No executions recorded yet. Deploy a module to see execution audit trails.</p>
                        </div>
                    ) : (
                        <table className="table-premium">
                            <thead>
                                <tr>
                                    <th>Operation</th>
                                    <th>Tenant</th>
                                    <th>Status</th>
                                    <th>Duration</th>
                                    <th>Started</th>
                                    <th>Exec ID</th>
                                </tr>
                            </thead>
                            <tbody>
                                {executions.map(exec => (
                                    <tr key={exec.id}>
                                        <td style={{ fontWeight: 500 }}>{exec.operation}</td>
                                        <td>{exec.tenantName}</td>
                                        <td><span className={`badge ${statusColor(exec.status)}`}>{exec.status}</span></td>
                                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                                            {exec.durationMs != null ? `${(exec.durationMs / 1000).toFixed(1)}s` : '—'}
                                        </td>
                                        <td style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                            {exec.startedAt ? new Date(exec.startedAt).toLocaleTimeString() : '—'}
                                        </td>
                                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)' }}>
                                            {exec.id.slice(0, 8)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
