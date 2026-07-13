import { useEffect, useMemo, useState } from 'react';
import type { PersistedSessionMetadata } from '../../../main/services/simulationService';
import { FieldLabel } from '../components/FormFields';
import { useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';

function sessionLabel(session: PersistedSessionMetadata): string {
  const build = [session.version, session.buildId].filter(Boolean).join(' / ');
  return `${session.sessionId} (${session.gameName}${build ? ` ${build}` : ''})`;
}

function formatCoverage(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : 'Not measured';
}

export function ReportsPage() {
  const navigate = useConfigStore((state) => state.navigate);
  const setReviewSessionId = useSessionStore((state) => state.setReviewSessionId);
  const [sessions, setSessions] = useState<PersistedSessionMetadata[]>([]);
  const [oldSessionId, setOldSessionId] = useState('');
  const [newSessionId, setNewSessionId] = useState('');
  const [comparisonMessage, setComparisonMessage] = useState('');
  const [comparisonState, setComparisonState] = useState<'ready' | 'loading' | 'error'>('ready');
  const [loadMessage, setLoadMessage] = useState('');
  const [loadState, setLoadState] = useState<'ready' | 'loading' | 'error'>('loading');
  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => ({
        sessionId: session.sessionId,
        label: sessionLabel(session)
      })),
    [sessions]
  );

  async function loadSessions(reload = false) {
    setLoadState('loading');
    setLoadMessage(reload ? 'Reloading saved sessions...' : 'Loading saved sessions...');

    try {
      const loadedSessions = reload
        ? await window.gameplaySimulator.simulation.reloadSessions()
        : await window.gameplaySimulator.simulation.listSessions();

      setSessions(loadedSessions);
      setLoadState('ready');
      setLoadMessage(
        loadedSessions.length === 0
          ? 'No saved sessions were found in the runs folder.'
          : `${loadedSessions.length} saved session${loadedSessions.length === 1 ? '' : 's'} loaded from the runs folder.`
      );
    } catch (error) {
      setLoadState('error');
      setLoadMessage(error instanceof Error ? error.message : 'Unable to load saved sessions.');
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    if (!newSessionId && sessionOptions[0]) {
      setNewSessionId(sessionOptions[0].sessionId);
    }

    if (!oldSessionId && sessionOptions[1]) {
      setOldSessionId(sessionOptions[1].sessionId);
    }
  }, [newSessionId, oldSessionId, sessionOptions]);

  async function openReport(sessionId: string) {
    const result = await window.gameplaySimulator.simulation.openReport(sessionId);
    setLoadState(result.opened ? 'ready' : 'error');
    setLoadMessage(result.message);
  }

  async function openLogs(sessionId: string) {
    const result = await window.gameplaySimulator.simulation.openLogs(sessionId);
    setLoadState(result.opened ? 'ready' : 'error');
    setLoadMessage(result.message);
  }

  function viewIssues(sessionId: string) {
    setReviewSessionId(sessionId);
    navigate('issues');
  }

  function exportIssues(sessionId: string) {
    setReviewSessionId(sessionId);
    navigate('issues');
  }

  async function generateComparison() {
    if (!oldSessionId || !newSessionId) {
      setComparisonState('error');
      setComparisonMessage('Select two sessions to compare.');
      return;
    }

    if (oldSessionId === newSessionId) {
      setComparisonState('error');
      setComparisonMessage('Choose two different sessions.');
      return;
    }

    setComparisonState('loading');
    setComparisonMessage('Generating comparison report...');

    try {
      const result = await window.gameplaySimulator.simulation.compareSessions(oldSessionId, newSessionId);
      setComparisonState('ready');
      setComparisonMessage(
        `${result.message} New: ${result.summary.newIssues}, fixed: ${result.summary.fixedIssues}, repeated: ${result.summary.repeatedIssues}, worsened: ${result.summary.worsenedIssues}.`
      );
    } catch (error) {
      setComparisonState('error');
      setComparisonMessage(error instanceof Error ? error.message : 'Unable to generate comparison report.');
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Output</p>
          <h1>Reports</h1>
        </div>
        <div className="page-actions">
          <FieldLabel label="Reload Sessions" />
          <button
            className="secondary-button"
            type="button"
            disabled={loadState === 'loading'}
            onClick={() => void loadSessions(true)}
          >
            Reload
          </button>
        </div>
      </div>

      {loadMessage ? <div className={`inline-notice inline-notice--${loadState}`}>{loadMessage}</div> : null}

      <section className="form-section">
        <div className="section-header-row">
          <div>
            <p className="eyebrow">Build comparison</p>
            <h2><FieldLabel label="Compare Sessions" /></h2>
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={sessionOptions.length < 2 || comparisonState === 'loading'}
            onClick={() => void generateComparison()}
          >
            Generate Comparison
          </button>
        </div>

        <div className="field-grid">
          <div className="field">
            <FieldLabel label="Old Session" htmlFor="old-session-comparison" />
            <select
              id="old-session-comparison"
              className="input"
              value={oldSessionId}
              disabled={sessionOptions.length < 2}
              onChange={(event) => setOldSessionId(event.target.value)}
            >
              <option value="">Select old session</option>
              {sessionOptions.map((option) => (
                <option value={option.sessionId} key={option.sessionId}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <FieldLabel label="New Session" htmlFor="new-session-comparison" />
            <select
              id="new-session-comparison"
              className="input"
              value={newSessionId}
              disabled={sessionOptions.length < 2}
              onChange={(event) => setNewSessionId(event.target.value)}
            >
              <option value="">Select new session</option>
              {sessionOptions.map((option) => (
                <option value={option.sessionId} key={option.sessionId}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {sessionOptions.length < 2 ? (
          <div className="empty-row">Create at least two sessions to compare builds.</div>
        ) : comparisonMessage ? (
          <div className={`inline-notice inline-notice--${comparisonState}`}>{comparisonMessage}</div>
        ) : null}
      </section>

      <div className="table-surface">
        <div className="table-row table-row--head table-row--report">
          <FieldLabel label="Session" />
          <FieldLabel label="Session Status" />
          <FieldLabel label="Issue Count" />
          <FieldLabel label="Coverage Percentage" />
          <FieldLabel label="Mode" />
          <FieldLabel label="Bots" />
          <FieldLabel label="Report Actions" />
        </div>
        {sessions.length === 0 ? (
          <div className="empty-row">No reports yet</div>
        ) : (
          sessions.map((session) => (
            <div className="table-row table-row--report" key={session.sessionId}>
              <span>
                <strong>{session.sessionId}</strong>
                <small>{session.gameName}{session.buildId ? ` · ${session.buildId}` : ''}</small>
              </span>
              <span>{session.status}</span>
              <span>{session.issueCounts.total}</span>
              <span>{formatCoverage(session.coveragePercentage)}</span>
              <span>{session.runMode ?? 'unknown'}</span>
              <span>
                {session.botCounts.actual}/{session.botCounts.requested}
                <small>{session.botCounts.stuck} stuck</small>
              </span>
              <span className="report-actions">
                <button className="secondary-button" type="button" onClick={() => void openReport(session.sessionId)}>
                  Open report
                </button>
                <button className="secondary-button" type="button" onClick={() => viewIssues(session.sessionId)}>
                  View issues
                </button>
                <button className="secondary-button" type="button" onClick={() => void openLogs(session.sessionId)}>
                  View logs
                </button>
                <button className="secondary-button" type="button" onClick={() => exportIssues(session.sessionId)}>
                  Export issues
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
