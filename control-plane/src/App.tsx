import { useState } from 'react';
import { ConnectionProvider, useConnection } from './hooks/useConnection';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ConnectDialog from './components/ConnectDialog';
import DashboardPage from './pages/DashboardPage';
import TablesPage from './pages/TablesPage';
import ReducersPage from './pages/ReducersPage';
import SqlConsolePage from './pages/SqlConsolePage';
import TenantsPage from './pages/TenantsPage';
import AgentPage from './pages/AgentPage';
import MonitoringPage from './pages/MonitoringPage';
import EventsPage from './pages/EventsPage';
import SecurityPage from './pages/SecurityPage';
import PoliciesPage from './pages/PoliciesPage';
import SettingsPage from './pages/SettingsPage';
import TaskBoardPage from './pages/TaskBoardPage';
import WorkersPage from './pages/WorkersPage';
import MigrationsPage from './pages/MigrationsPage';

function AppContent() {
  const [page, setPage] = useState<'dashboard' | 'tables' | 'reducers' | 'sql' | 'agent' | 'events' | 'tasks' | 'workers' | 'operations' | 'instances' | 'monitoring' | 'policies' | 'security' | 'settings'>('dashboard');
  const [showConnect, setShowConnect] = useState(false);
  const { instances } = useConnection();

  const isConnected = instances.some(i => i.status === 'connected');

  // Show connect dialog if no instance is connected
  const shouldShowConnect = !isConnected && !showConnect;

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <DashboardPage onNavigate={(p: string) => setPage(p as typeof page)} />;
      case 'tables':
        return <TablesPage />;
      case 'reducers':
        return <ReducersPage />;
      case 'sql':
        return <SqlConsolePage />;
      case 'instances':
        return <TenantsPage />;
      case 'agent':
        return <AgentPage />;
      case 'events':
        return <EventsPage />;
      case 'tasks':
        return <TaskBoardPage />;
      case 'workers':
        return <WorkersPage />;
      case 'operations':
        return <MigrationsPage />;
      case 'monitoring':
        return <MonitoringPage />;
      case 'policies':
        return <PoliciesPage />;
      case 'security':
        return <SecurityPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <TablesPage />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar activePage={page} onNavigate={setPage} />
      <div className="app-main">
        <TopBar />
        {renderPage()}
      </div>

      {(showConnect || shouldShowConnect) && (
        <ConnectDialog onClose={() => setShowConnect(false)} />
      )}

      {/* FAB to add new connection */}
      {isConnected && (
        <button
          className="btn btn-primary"
          onClick={() => setShowConnect(true)}
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            width: 44,
            height: 44,
            borderRadius: '50%',
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            boxShadow: '0 4px 20px rgba(76, 154, 255, 0.3)',
            zIndex: 50,
          }}
          title="Add connection"
        >
          +
        </button>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ConnectionProvider>
      <AppContent />
    </ConnectionProvider>
  );
}
