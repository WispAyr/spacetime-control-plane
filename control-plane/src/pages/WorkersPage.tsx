import { useState, useEffect, useCallback } from 'react';

const BACKEND_URL = 'http://localhost:3002';

interface Worker {
    id: string; name: string; type: 'human' | 'ai'; status: string;
    lastSeen: string; tasksCompleted: number; currentTaskId: string | null;
    currentTask: string | null; createdAt: string;
}
interface Goal {
    id: string; title: string; parentId: string | null; status: string;
    progress: number; taskCount: number; tasksDone: number;
}
interface ActivityEntry {
    id: string; timestamp: string; workerName: string; workerType: string;
    action: string; details: string;
}

export default function WorkersPage() {
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]);
    const [activity, setActivity] = useState<ActivityEntry[]>([]);
    const [showRegister, setShowRegister] = useState(false);
    const [showGoalForm, setShowGoalForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newType, setNewType] = useState<'human' | 'ai'>('human');
    const [newGoalTitle, setNewGoalTitle] = useState('');

    const load = useCallback(async () => {
        try {
            const [wRes, gRes, aRes] = await Promise.all([
                fetch(`${BACKEND_URL}/api/workers`),
                fetch(`${BACKEND_URL}/api/goals`),
                fetch(`${BACKEND_URL}/api/activity?limit=20`),
            ]);
            if (wRes.ok) setWorkers(await wRes.json());
            if (gRes.ok) setGoals(await gRes.json());
            if (aRes.ok) { const d = await aRes.json(); setActivity(d.items || []); }
        } catch { /* backend offline */ }
    }, []);

    useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, [load]);

    const registerWorker = async () => {
        if (!newName) return;
        await fetch(`${BACKEND_URL}/api/workers`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName, type: newType }),
        });
        setNewName(''); setShowRegister(false); load();
    };

    const removeWorker = async (id: string) => {
        if (!confirm('Remove this worker? Their claimed tasks will be released.')) return;
        await fetch(`${BACKEND_URL}/api/workers/${id}`, { method: 'DELETE' });
        load();
    };

    const createGoal = async () => {
        if (!newGoalTitle) return;
        const firstWorker = workers[0];
        await fetch(`${BACKEND_URL}/api/goals`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newGoalTitle, createdBy: firstWorker?.id || null }),
        });
        setNewGoalTitle(''); setShowGoalForm(false); load();
    };

    const deleteGoal = async (id: string) => {
        if (!confirm('Delete this goal? Tasks will be unlinked.')) return;
        await fetch(`${BACKEND_URL}/api/goals/${id}`, { method: 'DELETE' });
        load();
    };

    const timeSince = (dateStr: string) => {
        const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
        if (secs < 60) return `${secs}s ago`;
        if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
        if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
        return `${Math.floor(secs / 86400)}d ago`;
    };

    const humans = workers.filter(w => w.type === 'human');
    const ais = workers.filter(w => w.type === 'ai');

    const renderWorker = (w: Worker) => (
        <div key={w.id} className="worker-card">
            <div className={`worker-avatar worker-avatar--${w.type === 'ai' ? 'ai' : 'human'}`}>
                {w.type === 'ai' ? '🤖' : '👤'}
                <span className={`worker-status-dot worker-status-dot--${w.status === 'active' ? 'active' : 'idle'}`} />
            </div>
            <div className="worker-info">
                <div className="worker-name">{w.name}</div>
                <div className="worker-detail">
                    {w.currentTask ? `Working on: ${w.currentTask}` : 'Available'} · {w.tasksCompleted} completed
                </div>
            </div>
            <span className={`badge ${w.status === 'active' ? 'badge-green' : ''}`} style={{ fontSize: 10 }}>{w.status}</span>
            <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{timeSince(w.lastSeen)}</span>
            <button className="btn btn-sm" onClick={() => removeWorker(w.id)}
                style={{ background: 'none', border: 'none', color: 'var(--accent-red)', opacity: 0.6 }}>✕</button>
        </div>
    );

    return (
        <div className="app-content" style={{ flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {/* Header */}
            <div className="page-header stagger">
                <div>
                    <h2>👤 Workers & Goals</h2>
                    <div className="page-subtitle">Human and AI workers — equal participants, no overlap</div>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={() => setShowRegister(!showRegister)}>+ Worker</button>
                    <button className="btn" onClick={() => setShowGoalForm(!showGoalForm)}
                        style={{ background: 'var(--accent-purple)', color: '#fff', borderColor: 'transparent' }}>+ Goal</button>
                </div>
            </div>

            {/* Register form */}
            {showRegister && (
                <div className="panel scale-in" style={{ padding: 14, flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Register Worker</div>
                    <div className="flex gap-sm items-center">
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Name</div>
                            <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Worker name…" style={{ fontSize: 12 }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Type</div>
                            <select className="input" value={newType} onChange={e => setNewType(e.target.value as 'human' | 'ai')} style={{ width: 'auto', fontSize: 12 }}>
                                <option value="human">👤 Human</option>
                                <option value="ai">🤖 AI Agent</option>
                            </select>
                        </div>
                        <button className={`btn ${newName ? 'btn-success' : ''}`} onClick={registerWorker} disabled={!newName}>Register</button>
                    </div>
                </div>
            )}

            {/* Goal form */}
            {showGoalForm && (
                <div className="panel scale-in" style={{ padding: 14, flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Create Goal</div>
                    <div className="flex gap-sm items-center">
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Goal Title</div>
                            <input className="input" value={newGoalTitle} onChange={e => setNewGoalTitle(e.target.value)} placeholder="e.g. Launch v2.0…" style={{ fontSize: 12 }} />
                        </div>
                        <button className={`btn ${newGoalTitle ? 'btn-success' : ''}`} onClick={createGoal} disabled={!newGoalTitle}
                            style={newGoalTitle ? { background: 'var(--accent-purple)', borderColor: 'transparent' } : {}}>Create Goal</button>
                    </div>
                </div>
            )}

            <div className="flex gap-md flex-1" style={{ minHeight: 0 }}>
                {/* Workers section */}
                <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
                    {/* Humans */}
                    <div className="panel card-hover stagger-1" style={{ flexShrink: 0 }}>
                        <div className="panel-header">
                            <span className="panel-title" style={{ fontSize: 12 }}>👤 Human Workers</span>
                            <span className="badge badge-blue" style={{ fontSize: 10 }}>{humans.length}</span>
                        </div>
                        <div className="panel-body" style={{ padding: 0 }}>
                            {humans.length === 0 ? (
                                <div className="empty-state" style={{ padding: 20 }}><p style={{ fontSize: 11 }}>No human workers registered</p></div>
                            ) : humans.map(renderWorker)}
                        </div>
                    </div>

                    {/* AI Workers */}
                    <div className="panel card-hover stagger-2" style={{ flexShrink: 0 }}>
                        <div className="panel-header">
                            <span className="panel-title" style={{ fontSize: 12 }}>🤖 AI Workers</span>
                            <span className="badge badge-purple" style={{ fontSize: 10 }}>{ais.length}</span>
                        </div>
                        <div className="panel-body" style={{ padding: 0 }}>
                            {ais.length === 0 ? (
                                <div className="empty-state" style={{ padding: 20 }}><p style={{ fontSize: 11 }}>No AI workers registered</p></div>
                            ) : ais.map(renderWorker)}
                        </div>
                    </div>

                    {/* Goals */}
                    <div className="panel card-hover stagger-3" style={{ flexShrink: 0 }}>
                        <div className="panel-header">
                            <span className="panel-title" style={{ fontSize: 12 }}>🎯 Goals</span>
                            <span className="badge badge-purple" style={{ fontSize: 10 }}>{goals.length}</span>
                        </div>
                        <div className="panel-body" style={{ padding: 0 }}>
                            {goals.length === 0 ? (
                                <div className="empty-state" style={{ padding: 20 }}><p style={{ fontSize: 11 }}>No goals yet — create one above</p></div>
                            ) : goals.filter(g => !g.parentId).map(g => (
                                <div key={g.id} className="card-interactive" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                                    <div className="flex justify-between items-center">
                                        <div style={{ fontSize: 13, fontWeight: 600 }}>🎯 {g.title}</div>
                                        <div className="flex items-center gap-sm">
                                            <span className={`badge ${g.status === 'completed' ? 'badge-green' : 'badge-blue'}`} style={{ fontSize: 10 }}>{g.status}</span>
                                            <button onClick={() => deleteGoal(g.id)} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 11, opacity: 0.5 }}>✕</button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-sm" style={{ marginTop: 6 }}>
                                        <div className="progress-track" style={{ flex: 1 }}>
                                            <div className={`progress-fill ${g.progress === 100 ? 'progress-fill--green' : 'progress-fill--blue'}`}
                                                style={{ width: `${g.progress}%` }} />
                                        </div>
                                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{g.progress}%</span>
                                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{g.tasksDone}/{g.taskCount} tasks</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Activity sidebar */}
                <div className="panel slide-in" style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    <div className="panel-header">
                        <span className="panel-title" style={{ fontSize: 12 }}>📢 Activity Feed</span>
                        <span className="badge badge-blue" style={{ fontSize: 9 }}>Live</span>
                    </div>
                    <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
                        {activity.length === 0 ? (
                            <div className="empty-state" style={{ padding: 30 }}>
                                <p style={{ fontSize: 11 }}>No activity yet — register workers and create tasks</p>
                            </div>
                        ) : activity.map(a => (
                            <div key={a.id} className="activity-entry">
                                <div className={`activity-avatar ${a.workerType === 'ai' ? 'activity-avatar--ai' : ''}`}>
                                    {a.workerType === 'ai' ? '🤖' : '👤'}
                                </div>
                                <div className="activity-body">
                                    <div className="activity-name">{a.workerName}</div>
                                    <div className="activity-detail">{a.details}</div>
                                    <div className="activity-time">{timeSince(a.timestamp)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
