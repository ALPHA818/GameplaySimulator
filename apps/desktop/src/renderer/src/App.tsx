import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { BotProfilesPage } from './pages/BotProfilesPage';
import { DashboardPage } from './pages/DashboardPage';
import { GameProfileEditorPage } from './pages/GameProfileEditorPage';
import { GameProfilesPage } from './pages/GameProfilesPage';
import { HelpFirstTestPage } from './pages/HelpFirstTestPage';
import { IssuesPage } from './pages/IssuesPage';
import { LiveSessionPage } from './pages/LiveSessionPage';
import { LogsPage } from './pages/LogsPage';
import { NewSessionPage } from './pages/NewSessionPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useConfigStore } from './store/configStore';
import { useSessionStore } from './store/sessionStore';

export function App() {
  const currentPage = useConfigStore((state) => state.currentPage);
  const applySessionSnapshot = useSessionStore((state) => state.applySessionSnapshot);
  const applyRuntimeDetails = useSessionStore((state) => state.applyRuntimeDetails);

  useEffect(() => {
    let cancelled = false;

    async function refreshSessionState() {
      try {
        const status = await window.gameplaySimulator.sessions.getStatus();

        if (cancelled) {
          return;
        }

        applySessionSnapshot(status);

        if (!status.activeSessionId) {
          return;
        }

        const [botStatuses, instanceStatuses, issues, logs, coverage] = await Promise.all([
          window.gameplaySimulator.simulation.getBotStatuses(status.activeSessionId),
          window.gameplaySimulator.simulation.getInstanceStatuses(status.activeSessionId),
          window.gameplaySimulator.simulation.getIssues(status.activeSessionId),
          window.gameplaySimulator.simulation.getLogs(status.activeSessionId),
          window.gameplaySimulator.simulation.getCoverage(status.activeSessionId)
        ]);

        if (!cancelled) {
          applyRuntimeDetails({ botStatuses, instanceStatuses, issues, logs, coverage });
        }
      } catch {
        if (!cancelled) {
          applySessionSnapshot({
            status: 'idle',
            label: 'No session running',
            activeSessionId: null,
            botCount: 0,
            instanceCount: 0
          });
        }
      }
    }

    void refreshSessionState();
    const intervalId = window.setInterval(refreshSessionState, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [applyRuntimeDetails, applySessionSnapshot]);

  return (
    <AppShell>
      {currentPage === 'dashboard' ? <DashboardPage /> : null}
      {currentPage === 'gameProfiles' ? <GameProfilesPage /> : null}
      {currentPage === 'gameProfileEditor' ? <GameProfileEditorPage /> : null}
      {currentPage === 'botProfiles' ? <BotProfilesPage /> : null}
      {currentPage === 'newSession' ? <NewSessionPage /> : null}
      {currentPage === 'liveSession' ? <LiveSessionPage /> : null}
      {currentPage === 'issues' ? <IssuesPage /> : null}
      {currentPage === 'logs' ? <LogsPage /> : null}
      {currentPage === 'reports' ? <ReportsPage /> : null}
      {currentPage === 'helpFirstTest' ? <HelpFirstTestPage /> : null}
      {currentPage === 'settings' ? <SettingsPage /> : null}
    </AppShell>
  );
}

export default App;
