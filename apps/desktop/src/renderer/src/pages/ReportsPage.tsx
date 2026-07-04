import { useEffect, useMemo, useState } from 'react';
import { useConfigStore } from '../store/configStore';

export function ReportsPage() {
  const runConfigs = useConfigStore((state) => state.runConfigs);
  const sessionOptions = useMemo(
    () =>
      runConfigs.map((config) => ({
        sessionId: config.sessionId,
        label: `${config.sessionId} (${config.gameProfilePath.replace('memory://game-profiles/', '')})`
      })),
    [runConfigs]
  );
  const [oldSessionId, setOldSessionId] = useState('');
  const [newSessionId, setNewSessionId] = useState('');
  const [comparisonMessage, setComparisonMessage] = useState('');
  const [comparisonState, setComparisonState] = useState<'ready' | 'loading' | 'error'>('ready');

  useEffect(() => {
    if (!newSessionId && sessionOptions[0]) {
      setNewSessionId(sessionOptions[0].sessionId);
    }

    if (!oldSessionId && sessionOptions[1]) {
      setOldSessionId(sessionOptions[1].sessionId);
    }
  }, [newSessionId, oldSessionId, sessionOptions]);

  async function openReport(sessionId: string) {
    await window.gameplaySimulator.simulation.openReport(sessionId);
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
      </div>

      <section className="form-section">
        <div className="section-header-row">
          <div>
            <p className="eyebrow">Build comparison</p>
            <h2>Compare Sessions</h2>
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
          <label className="field">
            <span className="field__label">Old Session</span>
            <select
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
          </label>

          <label className="field">
            <span className="field__label">New Session</span>
            <select
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
          </label>
        </div>

        {sessionOptions.length < 2 ? (
          <div className="empty-row">Create at least two sessions to compare builds.</div>
        ) : comparisonMessage ? (
          <div className={`inline-notice inline-notice--${comparisonState}`}>{comparisonMessage}</div>
        ) : null}
      </section>

      <div className="table-surface">
        <div className="table-row table-row--head table-row--report">
          <span>Session</span>
          <span>Profile</span>
          <span>Mode</span>
          <span>Bots</span>
          <span>Evidence</span>
          <span>Report</span>
        </div>
        {runConfigs.length === 0 ? (
          <div className="empty-row">No reports yet</div>
        ) : (
          runConfigs.map((config) => {
            const botCount = config.botPools.reduce(
              (total, pool) => total + (pool.enabled ? pool.desiredCount : 0),
              0
            );

            return (
              <div className="table-row table-row--report" key={config.sessionId}>
                <span>{config.sessionId}</span>
                <span>{config.gameProfilePath.replace('memory://game-profiles/', '')}</span>
                <span>{config.runMode}</span>
                <span>{botCount}</span>
                <span>
                  {config.saveScreenshots ? 'Screenshots' : 'No screenshots'}
                  {config.saveVideo ? ' + video' : ''}
                </span>
                <span>
                  <button className="secondary-button" type="button" onClick={() => void openReport(config.sessionId)}>
                    Open
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
