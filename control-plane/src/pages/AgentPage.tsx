import { useState, useEffect, useCallback } from 'react';
import { useConnection } from '../hooks/useConnection';
import { SpacetimeClient } from '../lib/spacetime-client';

interface AgentAction {
    id: number;
    agent_id: string;
    action_type: string;
    target_db: string;
    description: string;
    details: string;
    status: string;
    requires_approval: boolean;
    created_at: number;
    executed_at: number;
}

interface AgentRule {
    id: number;
    name: string;
    description: string;
    condition: string;
    action: string;
    enabled: boolean;
    priority: number;
}

const AI_DB = 'control-plane-module-8zn73';

export default function AgentPage() {
    const { client } = useConnection();
    const [actions, setActions] = useState<AgentAction[]>([]);
    const [rules, setRules] = useState<AgentRule[]>([]);
    const [expandedAction, setExpandedAction] = useState<number | null>(null);
    const [filter, setFilter] = useState<string>('all');
    const [loading, setLoading] = useState(true);

    const aiClient = client ? new SpacetimeClient(client.url) : null;

    const loadData = useCallback(async () => {
        if (!aiClient) return;
        try {
            const [actRes, ruleRes] = await Promise.all([
                aiClient.sql(AI_DB, 'SELECT * FROM agent_action ORDER BY created_at DESC'),
                aiClient.sql(AI_DB, 'SELECT * FROM agent_rule ORDER BY priority ASC'),
            ]);
            setActions(actRes.rows as unknown as AgentAction[]);
            setRules(ruleRes.rows as unknown as AgentRule[]);
        } catch (err) {
            console.error('Failed to load AI data:', err);
        } finally {
            setLoading(false);
        }
    }, [aiClient]);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 3000);
        return () => clearInterval(interval);
    }, [loadData]);

    const handleApprove = async (actionId: number) => {
        if (!aiClient) return;
        await aiClient.callReducer(AI_DB, 'approveAction', JSON.stringify({ action_id: actionId }));
        loadData();
    };

    const handleReject = async (actionId: number) => {
        if (!aiClient) return;
        await aiClient.callReducer(AI_DB, 'rejectAction', JSON.stringify({ action_id: actionId }));
        loadData();
    };

    const handleToggleRule = async (ruleId: number) => {
        if (!aiClient) return;
        await aiClient.callReducer(AI_DB, 'toggleRule', JSON.stringify({ rule_id: ruleId }));
        loadData();
    };

    const filteredActions = filter === 'all'
        ? actions
        : actions.filter(a => a.status === filter);

    const statusIcon = (status: string) => {
        switch (status) {
            case 'pending': return '🟡';
            case 'approved': case 'executed': return '🟢';
            case 'rejected': return '🔴';
            case 'undone': return '⚪';
            default: return '⚫';
        }
    };

    const typeIcon = (type: string) => {
        switch (type) {
            case 'query': return '🔍';
            case 'reducer_call': return '⚡';
            case 'rule_trigger': return '📋';
            case 'suggestion': return '💡';
            default: return '◉';
        }
    };

    if (!client) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state">
                        <div className="icon">◉</div>
                        <h3>Not Connected</h3>
                        <p>Connect to a SpacetimeDB instance to view AI agent activity</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="app-content">
            {/* Activity Feed */}
            <div className="panel" style={{ flex: 1 }}>
                <div className="panel-header">
                    <div>
                        <div className="panel-title">AI Activity Feed</div>
                        <div className="panel-subtitle">
                            {actions.length} actions · {actions.filter(a => a.status === 'pending').length} pending approval
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                        {['all', 'pending', 'executed', 'rejected'].map(f => (
                            <button
                                key={f}
                                className={`btn btn-sm ${filter === f ? 'btn-primary' : ''}`}
                                onClick={() => setFilter(f)}
                                style={{ textTransform: 'capitalize', fontSize: 11 }}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="panel-body">
                    {loading ? (
                        <div className="empty-state"><p>Loading...</p></div>
                    ) : filteredActions.length === 0 ? (
                        <div className="empty-state">
                            <div className="icon">◉</div>
                            <h3>No Activity</h3>
                            <p>No AI agent actions recorded yet</p>
                        </div>
                    ) : (
                        filteredActions.map(action => (
                            <div
                                key={action.id}
                                className="fade-in"
                                style={{
                                    padding: '12px 0',
                                    borderBottom: '1px solid var(--border-subtle)',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                    <span style={{ fontSize: 16, marginTop: 2 }}>{typeIcon(action.action_type)}</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                            <span style={{ fontWeight: 500, fontSize: 13 }}>{action.description}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            <span className={`badge badge-${action.status === 'pending' ? 'amber' : action.status === 'rejected' ? 'red' : 'green'}`}>
                                                {statusIcon(action.status)} {action.status}
                                            </span>
                                            <span className="badge badge-blue">{action.action_type}</span>
                                            <span className="badge badge-purple">{action.target_db}</span>
                                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                                                {action.agent_id}
                                            </span>
                                        </div>

                                        {/* Expandable details */}
                                        {expandedAction === action.id && (
                                            <pre className="code-block" style={{ marginTop: 8, maxHeight: 200 }}>
                                                {JSON.stringify(JSON.parse(action.details || '{}'), null, 2)}
                                            </pre>
                                        )}
                                    </div>

                                    {/* Action buttons */}
                                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                        <button
                                            className="btn btn-sm"
                                            onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}
                                            style={{ fontSize: 10 }}
                                        >
                                            {expandedAction === action.id ? '▲' : '▼'}
                                        </button>
                                        {action.status === 'pending' && (
                                            <>
                                                <button className="btn btn-sm" onClick={() => handleApprove(action.id)} style={{ color: 'var(--accent-green)' }}>
                                                    ✓
                                                </button>
                                                <button className="btn btn-sm" onClick={() => handleReject(action.id)} style={{ color: 'var(--accent-red)' }}>
                                                    ✗
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Rules Panel */}
            <div className="panel" style={{ width: 320, flexShrink: 0 }}>
                <div className="panel-header">
                    <div>
                        <div className="panel-title">AI Rules</div>
                        <div className="panel-subtitle">{rules.length} rules · {rules.filter(r => r.enabled).length} active</div>
                    </div>
                </div>
                <div className="panel-body">
                    {rules.length === 0 ? (
                        <div className="empty-state">
                            <div className="icon">📋</div>
                            <h3>No Rules</h3>
                            <p>Define rules to govern AI behavior</p>
                        </div>
                    ) : (
                        rules.map(rule => (
                            <div
                                key={rule.id}
                                style={{
                                    padding: '10px 0',
                                    borderBottom: '1px solid var(--border-subtle)',
                                    opacity: rule.enabled ? 1 : 0.5,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <button
                                        className="btn btn-sm btn-icon"
                                        onClick={() => handleToggleRule(rule.id)}
                                        style={{
                                            background: rule.enabled ? 'var(--accent-green-dim)' : 'var(--bg-elevated)',
                                            color: rule.enabled ? 'var(--accent-green)' : 'var(--text-tertiary)',
                                            width: 24, height: 24, fontSize: 10,
                                        }}
                                    >
                                        {rule.enabled ? '●' : '○'}
                                    </button>
                                    <span style={{ fontWeight: 500, fontSize: 12, flex: 1 }}>{rule.name}</span>
                                    <span className="badge badge-blue" style={{ fontSize: 9 }}>P{rule.priority}</span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-secondary)', paddingLeft: 32 }}>
                                    {rule.description}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', paddingLeft: 32, marginTop: 4 }}>
                                    if: {rule.condition} → {rule.action}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
