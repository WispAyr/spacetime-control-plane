import { useState } from 'react';
import { ConnectionProvider, useConnection } from './hooks/useConnection';
import Sidebar, { type Page } from './components/Sidebar';
import TopBar from './components/TopBar';
import ConnectDialog from './components/ConnectDialog';
import TablesPage from './pages/TablesPage';
import ReducersPage from './pages/ReducersPage';
import SqlConsolePage from './pages/SqlConsolePage';
import TenantsPage from './pages/TenantsPage';
import AgentPage from './pages/AgentPage';
import MonitoringPage from './pages/MonitoringPage';
import EventsPage from './pages/EventsPage';
import SecurityPage from './pages/SecurityPage';
import SettingsPage from './pages/SettingsPage';

function AppContent() {
  const [activePage, setActivePage] = useState<Page>('tables');
  const [showConnect, setShowConnect] = useState(false);
  const { instances } = useConnection();

  const isConnected = instances.some(i => i.status === 'connected');

  // Show connect dialog if no instance is connected
  const shouldShowConnect = !isConnected && !showConnect;

  const renderPage = () => {
    switch (activePage) {
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
      case 'monitoring':
        return <MonitoringPage />;
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
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
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
