import { useState, useEffect, useRef, useCallback } from 'react';
import { useConnection } from '../hooks/useConnection';
import { SpacetimeClient } from '../lib/spacetime-client';

interface ChatMsg {
    id: number;
    sender_name: string;
    sender_type: string;
    text: string;
    timestamp: number;
}

const AI_DB = 'control-plane-module-8zn73';

export default function EventsPage() {
    const { client } = useConnection();
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const aiClient = client ? new SpacetimeClient(client.url) : null;

    const loadMessages = useCallback(async () => {
        if (!aiClient) return;
        try {
            const res = await aiClient.sql(AI_DB, 'SELECT * FROM chat_message ORDER BY timestamp ASC');
            setMessages(res.rows as unknown as ChatMsg[]);
        } catch (err) {
            console.error('Failed to load chat:', err);
        } finally {
            setLoading(false);
        }
    }, [aiClient]);

    useEffect(() => {
        loadMessages();
        const interval = setInterval(loadMessages, 2000);
        return () => clearInterval(interval);
    }, [loadMessages]);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages.length]);

    const handleSend = async () => {
        if (!aiClient || !input.trim()) return;
        setSending(true);
        try {
            await aiClient.callReducer(AI_DB, 'sendMessage', JSON.stringify({
                sender_name: 'You',
                sender_type: 'human',
                text: input.trim(),
            }));
            setInput('');
            await loadMessages();
        } catch (err) {
            console.error('Failed to send:', err);
        } finally {
            setSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const formatTime = (ts: number) => {
        if (!ts) return '';
        const d = new Date(Number(ts));
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    if (!client) {
        return (
            <div className="app-content">
                <div className="panel" style={{ flex: 1 }}>
                    <div className="empty-state">
                        <div className="icon">⚡</div>
                        <h3>Not Connected</h3>
                        <p>Connect to a SpacetimeDB instance first</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="app-content" style={{ flexDirection: 'column' }}>
            {/* Chat Messages */}
            <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div className="panel-header">
                    <div>
                        <div className="panel-title">AI Chat & Event Log</div>
                        <div className="panel-subtitle">{messages.length} messages</div>
                    </div>
                    <span className="badge badge-purple">{AI_DB.split('-').slice(0, 3).join('-')}</span>
                </div>

                <div ref={scrollRef} className="panel-body" style={{ flex: 1, overflowY: 'auto' }}>
                    {loading ? (
                        <div className="empty-state"><p>Loading chat...</p></div>
                    ) : messages.length === 0 ? (
                        <div className="empty-state">
                            <div className="icon">💬</div>
                            <h3>No Messages</h3>
                            <p>Start a conversation with the AI agent</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
                            {messages.map(msg => {
                                const isAgent = msg.sender_type === 'agent';
                                return (
                                    <div
                                        key={msg.id}
                                        className="fade-in"
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: isAgent ? 'flex-start' : 'flex-end',
                                            maxWidth: '85%',
                                            alignSelf: isAgent ? 'flex-start' : 'flex-end',
                                        }}
                                    >
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            marginBottom: 3,
                                            flexDirection: isAgent ? 'row' : 'row-reverse',
                                        }}>
                                            <span style={{
                                                fontSize: 11, fontWeight: 600,
                                                color: isAgent ? 'var(--accent-purple)' : 'var(--accent-primary)',
                                            }}>
                                                {msg.sender_name}
                                            </span>
                                            <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>
                                                {formatTime(msg.timestamp)}
                                            </span>
                                        </div>
                                        <div style={{
                                            padding: '10px 14px',
                                            borderRadius: isAgent ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                                            background: isAgent
                                                ? 'rgba(167, 139, 250, 0.08)'
                                                : 'rgba(76, 154, 255, 0.12)',
                                            border: `1px solid ${isAgent ? 'rgba(167, 139, 250, 0.15)' : 'rgba(76, 154, 255, 0.2)'}`,
                                            fontSize: 13,
                                            lineHeight: 1.5,
                                            whiteSpace: 'pre-wrap',
                                            color: 'var(--text-primary)',
                                        }}>
                                            {msg.text}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Input */}
                <div style={{
                    padding: '12px 16px',
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex', gap: 8, alignItems: 'flex-end',
                }}>
                    <textarea
                        className="input"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask the AI agent something..."
                        rows={1}
                        style={{
                            flex: 1, resize: 'none', minHeight: 38, maxHeight: 120,
                            fontFamily: 'var(--font-body)', fontSize: 13,
                        }}
                    />
                    <button
                        className="btn btn-primary"
                        onClick={handleSend}
                        disabled={sending || !input.trim()}
                        style={{ height: 38, paddingInline: 16 }}
                    >
                        {sending ? '...' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    );
}
