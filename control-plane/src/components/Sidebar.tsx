import { type ReactNode } from 'react';

type Page = 'tables' | 'reducers' | 'sql' | 'agent' | 'events' | 'instances' | 'monitoring' | 'security' | 'settings';

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

const metaItems: { page: Page; icon: string; label: string }[] = [
    { page: 'instances', icon: '◎', label: 'Tenants' },
    { page: 'monitoring', icon: '📊', label: 'Monitor' },
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
                        title={item.label}
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
                <div style={{ flex: 1 }} />
                <div className="sidebar-divider" />
                <NavGroup items={metaItems} activePage={activePage} onNavigate={onNavigate} />
            </div>
        </nav>
    );
}

export type { Page };
