import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from './Sidebar';

describe('Sidebar', () => {
    const defaultProps = {
        activePage: 'tables' as const,
        onNavigate: vi.fn(),
    };

    it('renders all navigation labels', () => {
        render(<Sidebar {...defaultProps} />);
        expect(screen.getByText('Tables')).toBeInTheDocument();
        expect(screen.getByText('Reducers')).toBeInTheDocument();
        expect(screen.getByText('SQL')).toBeInTheDocument();
        expect(screen.getByText('AI Agent')).toBeInTheDocument();
        expect(screen.getByText('Events')).toBeInTheDocument();
        expect(screen.getByText('Instances')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('highlights the active page', () => {
        const { container } = render(<Sidebar {...defaultProps} activePage="sql" />);
        const activeItems = container.querySelectorAll('.sidebar-item.active');
        expect(activeItems).toHaveLength(1);
    });

    it('calls onNavigate when clicking a nav item', async () => {
        const user = userEvent.setup();
        const onNavigate = vi.fn();
        render(<Sidebar activePage="tables" onNavigate={onNavigate} />);

        const sqlLabel = screen.getByText('SQL');
        const sidebarGroup = sqlLabel.closest('.sidebar-group');
        const sidebarItem = sidebarGroup?.querySelector('.sidebar-item');
        expect(sidebarItem).toBeTruthy();
        await user.click(sidebarItem!);
        expect(onNavigate).toHaveBeenCalledWith('sql');
    });

    it('renders the logo with S', () => {
        const { container } = render(<Sidebar {...defaultProps} />);
        const logo = container.querySelector('.sidebar-logo');
        expect(logo).toBeInTheDocument();
        expect(logo?.textContent).toBe('S');
    });

    it('renders exactly one active item for any page', () => {
        const pages = ['tables', 'reducers', 'sql', 'agent', 'events', 'instances', 'settings'] as const;
        for (const page of pages) {
            const { container, unmount } = render(<Sidebar activePage={page} onNavigate={vi.fn()} />);
            const activeItems = container.querySelectorAll('.sidebar-item.active');
            expect(activeItems).toHaveLength(1);
            unmount();
        }
    });

    it('shows AI indicator when aiActive is true', () => {
        const { container } = render(
            <Sidebar activePage="tables" onNavigate={vi.fn()} aiActive={true} />
        );
        const indicator = container.querySelector('.indicator');
        expect(indicator).toBeInTheDocument();
    });

    it('does not show AI indicator when aiActive is false', () => {
        const { container } = render(
            <Sidebar activePage="tables" onNavigate={vi.fn()} aiActive={false} />
        );
        const indicator = container.querySelector('.indicator');
        expect(indicator).not.toBeInTheDocument();
    });
});
