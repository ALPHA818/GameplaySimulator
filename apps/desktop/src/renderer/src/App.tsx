import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { BotProfilesPage } from './pages/BotProfilesPage';
import { BotProfileEditorPage } from './pages/BotProfileEditorPage';
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
import {
  configureWorkspacePersistence,
  createWorkspaceSnapshot,
  flushWorkspacePersistence,
  migrateLegacyRuntimeObservation
} from './store/workspacePersistence';
import { pollRuntimeDetails, readableError } from './runtimePolling';

export function App() {
  const currentPage = useConfigStore((state) => state.currentPage);
  const workspaceHydrated = useConfigStore((state) => state.workspaceHydrated);
  const workspaceWarning = useConfigStore((state) => state.workspaceWarning);
  const hydrateWorkspace = useConfigStore((state) => state.hydrateWorkspace);
  const setWorkspaceWarning = useConfigStore((state) => state.setWorkspaceWarning);
  const applySessionSnapshot = useSessionStore((state) => state.applySessionSnapshot);
  const applyRuntimeDetails = useSessionStore((state) => state.applyRuntimeDetails);
  const runtimeWarnings = useSessionStore((state) => state.runtimeWarnings);
  const setRuntimeWarnings = useSessionStore((state) => state.setRuntimeWarnings);
  const hydrateIssueReviewState = useSessionStore((state) => state.hydrateIssueReviewState);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      try {
        const result = await window.gameplaySimulator.workspace.load();
        const migration = migrateLegacyRuntimeObservation(
          result.data,
          typeof window === 'undefined' ? undefined : window.localStorage
        );
        let warning = result.warning;

        if (!result.data.migrations.runtimeObservationLocalStorageImported) {
          try {
            await window.gameplaySimulator.workspace.save(migration.data);
            if (migration.imported) {
              warning = [warning, 'Existing Live Bot Observation settings were imported into the workspace.']
                .filter(Boolean)
                .join(' ');
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Workspace migration could not be saved.';
            warning = [warning, message].filter(Boolean).join(' ');
          }
        }

        if (cancelled) {
          return;
        }

        hydrateIssueReviewState(
          migration.data.reviewedIssueIds,
          migration.data.falsePositiveIssueIds
        );
        hydrateWorkspace(migration.data, warning);

        configureWorkspacePersistence(async () => {
          const workspace = createWorkspaceSnapshot(
            useConfigStore.getState(),
            useSessionStore.getState()
          );

          try {
            await window.gameplaySimulator.workspace.save(workspace);
          } catch (error) {
            setWorkspaceWarning(
              error instanceof Error ? error.message : 'Workspace changes could not be saved.'
            );
          }
        });
      } catch (error) {
        if (!cancelled) {
          hydrateWorkspace(
            {
              schemaVersion: 1,
              gameProfiles: [],
              customBotProfiles: [],
              botProfileOverrides: [],
              runConfigs: [],
              lastValidatedRunConfig: null,
              runtimeObservation: useConfigStore.getState().runtimeObservation,
              reviewedIssueIds: [],
              falsePositiveIssueIds: [],
              migrations: {
                runtimeObservationLocalStorageImported: false
              }
            },
            error instanceof Error ? error.message : 'Workspace data could not be loaded.'
          );
        }
      }
    }

    void loadWorkspace();

    return () => {
      cancelled = true;
      void flushWorkspacePersistence().finally(() => {
        configureWorkspacePersistence(null);
      });
    };
  }, [hydrateIssueReviewState, hydrateWorkspace, setWorkspaceWarning]);

  useEffect(() => {
    if (!workspaceHydrated) {
      return undefined;
    }

    let cancelled = false;
    let refreshInProgress = false;

    async function refreshSessionState() {
      if (refreshInProgress) {
        return;
      }
      refreshInProgress = true;

      try {
        const status = await window.gameplaySimulator.sessions.getStatus();

        if (cancelled) {
          return;
        }

        applySessionSnapshot(status);

        if (!status.activeSessionId) {
          setRuntimeWarnings([]);
          return;
        }

        const result = await pollRuntimeDetails(
          window.gameplaySimulator.simulation,
          status.activeSessionId
        );

        if (!cancelled) {
          applyRuntimeDetails(result.details);
          setRuntimeWarnings(result.warnings);
        }
      } catch (error) {
        if (!cancelled) {
          setRuntimeWarnings([`Session connection: ${readableError(error)}`]);
        }
      } finally {
        refreshInProgress = false;
      }
    }

    void refreshSessionState();
    const intervalId = window.setInterval(refreshSessionState, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [applyRuntimeDetails, applySessionSnapshot, setRuntimeWarnings, workspaceHydrated]);

  if (!workspaceHydrated) {
    return (
      <AppShell>
        <section className="empty-state">
          <h1>Loading workspace</h1>
          <p>Restoring profiles, settings, and saved session configurations.</p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {workspaceWarning ? (
        <div className="inline-notice inline-notice--error" role="alert">
          <strong>Workspace warning</strong>
          <span>{workspaceWarning}</span>
        </div>
      ) : null}
      {runtimeWarnings.length > 0 ? (
        <div className="inline-notice inline-notice--error runtime-connection-warning" role="status">
          <strong>Some live information could not be refreshed</strong>
          <span>{runtimeWarnings.join(' ')}</span>
          <span>The last valid information remains visible. GameplaySimulator will retry automatically.</span>
        </div>
      ) : null}
      {currentPage === 'dashboard' ? <DashboardPage /> : null}
      {currentPage === 'gameProfiles' ? <GameProfilesPage /> : null}
      {currentPage === 'gameProfileEditor' ? <GameProfileEditorPage /> : null}
      {currentPage === 'botProfiles' ? <BotProfilesPage /> : null}
      {currentPage === 'botProfileEditor' ? <BotProfileEditorPage /> : null}
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
