import { useState, useEffect, useCallback } from 'react';

const BACKEND_URL = 'http://localhost:3002';

interface Worker {
    id: string; name: string; type: 'human' | 'ai'; status: string;
    lastSeen: string; tasksCompleted: number; currentTaskId: string | null;
    currentTask: string | null; createdAt: string;
}
interface Task {
    id: string; title: string; description: string; status: string;
    priority: string; claimedBy: string | null; claimedByName: string | null;
    claimedAt: string | null; completedAt: string | null; output: string | null;
    goalId: string | null; tenantId: string | null; createdBy: string;
    createdByName: string; createdAt: string; updatedAt: string;
}
interface Goal {
    id: string; title: string; parentId: string | null; status: string;
    progress: number; taskCount: number; tasksDone: number;
}
interface ActivityEntry {
    id: string; timestamp: string; workerName: string; workerType: string;
    action: string; details: string;
}

const COLUMNS: { key: string; label: string; color: string }[] = [
    { key: 'backlog', label: 'Backlog', color: 'var(--text-tertiary)' },
    { key: 'claimed', label: 'Claimed', color: 'var(--accent-amber)' },
    { key: 'in_progress', label: 'In Progress', color: 'var(--accent-blue)' },
    { key: 'review', label: 'Review', color: 'var(--accent-purple)' },
    { key: 'done', label: 'Done', color: 'var(--accent-green)' },
];

const PRIORITIES: Record<string, { color: string; label: string }> = {
    critical: { color: 'var(--accent-red)', label: '🔴' },
    high: { color: 'var(--accent-amber)', label: '🟡' },
    medium: { color: 'var(--accent-blue)', label: '🔵' },
    low: { color: 'var(--text-tertiary)', label: '⚪' },
};

export default function TaskBoardPage() {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]);
    const [activity, setActivity] = useState<ActivityEntry[]>([]);
    const [selectedWorker, setSelectedWorker] = useState('');
    const [showCreate, setShowCreate] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newPriority, setNewPriority] = useState('medium');
    const [newGoal, setNewGoal] = useState('');
    const [expandedTask, setExpandedTask] = useState<string | null>(null);
    const [showActivity, setShowActivity] = useState(true);

    const load = useCallback(async () => {
        try {
            const [tRes, wRes, gRes, aRes] = await Promise.all([
                fetch(`${BACKEND_URL}/api/tasks`),
                fetch(`${BACKEND_URL}/api/workers`),
                fetch(`${BACKEND_URL}/api/goals`),
                fetch(`${BACKEND_URL}/api/activity?limit=30`),
            ]);
            if (tRes.ok) setTasks(await tRes.json());
            if (wRes.ok) setWorkers(await wRes.json());
            if (gRes.ok) setGoals(await gRes.json());
            if (aRes.ok) { const d = await aRes.json(); setActivity(d.items || []); }
        } catch { /* backend offline */ }
    }, []);

    useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, [load]);

    const createTask = async () => {
        if (!newTitle || !selectedWorker) return;
        await fetch(`${BACKEND_URL}/api/tasks`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle, description: newDesc, priority: newPriority, goalId: newGoal || null, createdBy: selectedWorker }),
        });
        setNewTitle(''); setNewDesc(''); setShowCreate(false); load();
    };

    const claimTask = async (taskId: string) => {
        if (!selectedWorker) return;
        const res = await fetch(`${BACKEND_URL}/api/tasks/${taskId}/claim`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workerId: selectedWorker }),
        });
        if (!res.ok) { const err = await res.json(); alert(err.error + (err.claimedBy ? ` by ${err.claimedBy.name}` : '')); }
        load();
    };

    const releaseTask = async (taskId: string) => {
        if (!selectedWorker) return;
        await fetch(`${BACKEND_URL}/api/tasks/${taskId}/release`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workerId: selectedWorker }),
        });
        load();
    };

    const startTask = async (taskId: string) => {
        if (!selectedWorker) return;
        await fetch(`${BACKEND_URL}/api/tasks/${taskId}/start`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workerId: selectedWorker }),
        });
        load();
    };

    const completeTask = async (taskId: string) => {
        if (!selectedWorker) return;
        const output = prompt('Output/notes (optional):');
        await fetch(`${BACKEND_URL}/api/tasks/${taskId}/complete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workerId: selectedWorker, output }),
        });
        load();
    };

    const activeWorker = workers.find(w => w.id === selectedWorker);

    return (
        <div className="app-content" style={{ flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            {/* Header */}
            <div className="page-header stagger">
                <div>
                    <h2>📋 Task Board</h2>
                    <div className="page-subtitle">Atomic task claims — no overlaps, human + AI equal</div>
                </div>
                <div className="page-actions">
                    <select
                        value={selectedWorker}
                        onChange={e => setSelectedWorker(e.target.value)}
                        className="input"
                        style={{ width: 'auto', fontSize: 12, padding: '6px 10px' }}
                    >
                        <option value="">Act as…</option>
                        {workers.map(w => (
                            <option key={w.id} value={w.id}>{w.type === 'ai' ? '🤖' : '👤'} {w.name}</option>
                        ))}
                    </select>
                    {activeWorker && (
                        <span className={`badge ${activeWorker.type === 'ai' ? 'badge-purple' : 'badge-blue'}`}
                            style={{ padding: '4px 8px', fontSize: 11 }}>
                            {activeWorker.currentTask ? `Working: ${activeWorker.currentTask}` : 'Idle'}
                        </span>
                    )}
                    <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>+ Task</button>
                    <button className="btn" onClick={() => setShowActivity(!showActivity)}>
                        {showActivity ? 'Hide Feed' : 'Show Feed'}
                    </button>
                </div>
            </div>

            {/* Create form */}
            {showCreate && (
                <div className="panel scale-in" style={{ padding: 14, flexShrink: 0 }}>
                    <div className="flex gap-sm items-center" style={{ flexWrap: 'wrap' }}>
                        <div style={{ flex: 2 }}>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Title</div>
                            <input className="input" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Task title…" style={{ fontSize: 12 }} />
                        </div>
                        <div style={{ flex: 3 }}>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Description</div>
                            <input className="input" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Details…" style={{ fontSize: 12 }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Priority</div>
                            <select className="input" value={newPriority} onChange={e => setNewPriority(e.target.value)} style={{ width: 'auto', fontSize: 12 }}>
                                <option value="critical">🔴 Critical</option>
                                <option value="high">🟡 High</option>
                                <option value="medium">🔵 Medium</option>
                                <option value="low">⚪ Low</option>
                            </select>
                        </div>
                        {goals.length > 0 && (
                            <div>
                                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Goal</div>
                                <select className="input" value={newGoal} onChange={e => setNewGoal(e.target.value)} style={{ width: 'auto', fontSize: 12 }}>
                                    <option value="">None</option>
                                    {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                                </select>
                            </div>
                        )}
                        <button className={`btn ${!newTitle || !selectedWorker ? '' : 'btn-success'}`}
                            onClick={createTask} disabled={!newTitle || !selectedWorker}>
                            Create
                        </button>
                    </div>
                    {!selectedWorker && <div style={{ fontSize: 10, color: 'var(--accent-amber)', marginTop: 6 }}>⚠ Select a worker from "Act as…" first</div>}
                </div>
            )}

            {/* Kanban + Activity */}
            <div className="flex gap-sm flex-1" style={{ minHeight: 0 }}>
                {/* Kanban columns */}
                <div className="kanban-board">
                    {COLUMNS.map((col, ci) => {
                        const colTasks = tasks.filter(t => t.status === col.key);
                        return (
                            <div key={col.key} className={`kanban-col stagger-${ci + 1}`}>
                                <div className="kanban-col-header" style={{ borderColor: col.color }}>
                                    <span>{col.label}</span>
                                    <span className="kanban-count">{colTasks.length}</span>
                                </div>
                                <div className="kanban-col-body">
                                    {colTasks.length === 0 && (
                                        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 10 }}>Empty</div>
                                    )}
                                    {colTasks.map(task => (
                                        <div key={task.id}
                                            className={`task-card ${expandedTask === task.id ? 'pulse-new' : ''}`}
                                            onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                                            style={expandedTask === task.id ? { borderColor: 'var(--glass-border-active)' } : {}}>
                                            <div className="flex justify-between" style={{ alignItems: 'flex-start' }}>
                                                <div className="task-title">{task.title}</div>
                                                <span style={{ fontSize: 10, flexShrink: 0 }}>{PRIORITIES[task.priority]?.label || '🔵'}</span>
                                            </div>
                                            {task.claimedByName && (
                                                <div className="task-claimer">⚡ {task.claimedByName}</div>
                                            )}
                                            {expandedTask === task.id && (
                                                <div className="slide-in" style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                                                    {task.description && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 6 }}>{task.description}</div>}
                                                    {task.output && <div style={{ fontSize: 10, color: 'var(--accent-green)', marginBottom: 6 }}>Output: {task.output}</div>}
                                                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                                                        by {task.createdByName} · {new Date(task.createdAt).toLocaleDateString()}
                                                    </div>
                                                    <div className="flex gap-xs" style={{ flexWrap: 'wrap' }}>
                                                        {task.status === 'backlog' && selectedWorker && (
                                                            <button className="btn btn-sm btn-warning" onClick={e => { e.stopPropagation(); claimTask(task.id); }}>Claim</button>
                                                        )}
                                                        {task.claimedBy === selectedWorker && task.status === 'claimed' && (
                                                            <>
                                                                <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); startTask(task.id); }}>Start</button>
                                                                <button className="btn btn-sm" onClick={e => { e.stopPropagation(); releaseTask(task.id); }}>Release</button>
                                                            </>
                                                        )}
                                                        {task.claimedBy === selectedWorker && task.status === 'in_progress' && (
                                                            <button className="btn btn-sm btn-success" onClick={e => { e.stopPropagation(); completeTask(task.id); }}>Complete</button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Activity feed */}
                {showActivity && (
                    <div className="panel slide-in" style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                        <div className="panel-header">
                            <span className="panel-title" style={{ fontSize: 11 }}>Activity Feed</span>
                            <span className="badge badge-blue" style={{ fontSize: 9 }}>{activity.length}</span>
                        </div>
                        <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
                            {activity.length === 0 ? (
                                <div className="empty-state" style={{ padding: 20 }}><p style={{ fontSize: 10 }}>No activity yet</p></div>
                            ) : activity.map(a => (
                                <div key={a.id} className="activity-entry">
                                    <div className={`activity-avatar ${a.workerType === 'ai' ? 'activity-avatar--ai' : ''}`}>
                                        {a.workerType === 'ai' ? '🤖' : '👤'}
                                    </div>
                                    <div className="activity-body">
                                        <div className="activity-name">{a.workerName}</div>
                                        <div className="activity-detail">{a.details}</div>
                                        <div className="activity-time">{new Date(a.timestamp).toLocaleTimeString()}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Goals bar */}
            {goals.length > 0 && (
                <div className="panel stagger-7" style={{ flexShrink: 0, padding: 10 }}>
                    <div className="flex gap-sm" style={{ overflowX: 'auto' }}>
                        {goals.filter(g => !g.parentId).map(g => (
                            <div key={g.id} className="card-interactive" style={{ padding: '8px 14px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', minWidth: 150 }}>
                                <div style={{ fontSize: 11, fontWeight: 600 }}>🎯 {g.title}</div>
                                <div className="flex items-center gap-sm" style={{ marginTop: 4 }}>
                                    <div className="progress-track" style={{ flex: 1 }}>
                                        <div className={`progress-fill ${g.progress === 100 ? 'progress-fill--green' : 'progress-fill--blue'}`}
                                            style={{ width: `${g.progress}%` }} />
                                    </div>
                                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{g.tasksDone}/{g.taskCount}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
