import { type ReactNode } from 'react';

type Page = 'dashboard' | 'tables' | 'reducers' | 'sql' | 'agent' | 'events' | 'tasks' | 'workers' | 'operations' | 'instances' | 'monitoring' | 'policies' | 'security' | 'settings';

interface SidebarProps {
    activePage: Page;
    onNavigate: (page: Page) => void;
    aiActive?: boolean;
}

const navItems: { page: Page; icon: string; label: string }[] = [
    { page: 'tables', icon: '⊞', label: 'Tables' },
    { page: 'reducers', icon: 'ƒ', label: 'Reducers' },
    { page: 'sql', icon: '>', label: 'SQL' },
];

const aiItems: { page: Page; icon: string; label: string }[] = [
    { page: 'agent', icon: '◉', label: 'AI Agent' },
    { page: 'events', icon: '⚡', label: 'Events' },
];

const workItems: { page: Page; icon: string; label: string }[] = [
    { page: 'tasks', icon: '📋', label: 'Tasks' },
    { page: 'workers', icon: '👤', label: 'Workers' },
    { page: 'operations', icon: '🔄', label: 'Ops' },
];

const metaItems: { page: Page; icon: string; label: string }[] = [
    { page: 'dashboard', icon: '🏠', label: 'Home' },
    { page: 'instances', icon: '◎', label: 'Tenants' },
    { page: 'monitoring', icon: '📊', label: 'Monitor' },
    { page: 'policies', icon: '🛡️', label: 'Policies' },
    { page: 'security', icon: '🔐', label: 'Security' },
    { page: 'settings', icon: '⚙', label: 'Settings' },
];

function NavGroup({ items, activePage, onNavigate, aiActive }: {
    items: typeof navItems;
    activePage: Page;
    onNavigate: (page: Page) => void;
    aiActive?: boolean;
}) {
    return (
        <>
            {items.map(item => (
                <div className="sidebar-group" key={item.page}>
                    <div
                        className={`sidebar-item ${activePage === item.page ? 'active' : ''}`}
                        onClick={() => onNavigate(item.page)}
                        data-tooltip={item.label}
                    >
                        <span style={{ fontSize: 18 }}>{item.icon}</span>
                        {item.page === 'agent' && aiActive && <span className="indicator" />}
                    </div>
                    <span className="sidebar-label">{item.label}</span>
                </div>
            ))}
        </>
    );
}

export default function Sidebar({ activePage, onNavigate, aiActive }: SidebarProps): ReactNode {
    return (
        <nav className="sidebar">
            <div className="sidebar-logo">S</div>
            <div className="sidebar-nav">
                <NavGroup items={navItems} activePage={activePage} onNavigate={onNavigate} />
                <div className="sidebar-divider" />
                <NavGroup items={aiItems} activePage={activePage} onNavigate={onNavigate} aiActive={aiActive} />
                <div className="sidebar-divider" />
                <NavGroup items={workItems} activePage={activePage} onNavigate={onNavigate} />
                <div style={{ flex: 1 }} />
                <div className="sidebar-divider" />
                <NavGroup items={metaItems} activePage={activePage} onNavigate={onNavigate} />
            </div>
        </nav>
    );
}

export type { Page };
