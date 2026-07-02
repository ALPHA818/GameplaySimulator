import { AppShell } from './components/AppShell';
import { BotProfilesPage } from './pages/BotProfilesPage';
import { DashboardPage } from './pages/DashboardPage';
import { GameProfileEditorPage } from './pages/GameProfileEditorPage';
import { GameProfilesPage } from './pages/GameProfilesPage';
import { NewSessionPage } from './pages/NewSessionPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useConfigStore } from './store/configStore';

export function App() {
  const currentPage = useConfigStore((state) => state.currentPage);

  return (
    <AppShell>
      {currentPage === 'dashboard' ? <DashboardPage /> : null}
      {currentPage === 'gameProfiles' ? <GameProfilesPage /> : null}
      {currentPage === 'gameProfileEditor' ? <GameProfileEditorPage /> : null}
      {currentPage === 'botProfiles' ? <BotProfilesPage /> : null}
      {currentPage === 'newSession' ? <NewSessionPage /> : null}
      {currentPage === 'reports' ? <ReportsPage /> : null}
      {currentPage === 'settings' ? <SettingsPage /> : null}
    </AppShell>
  );
}

export default App;
