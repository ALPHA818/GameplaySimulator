import type { DetectedIssue, Severity } from '@core/types';
import type { GitHubIssueExportPreviewResult } from '../../../main/services/simulationService';
import { CheckCircle2, Copy, Download, ExternalLink, Eye, Filter, Search, Send, XCircle } from 'lucide-react';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';

const severityOptions: Severity[] = ['info', 'warning', 'error', 'critical'];
const severityRanks: Record<Severity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3
};

function issueId(issue: DetectedIssue): string {
  return issue.id ?? issue.issueId;
}

function issueScene(issue: DetectedIssue): string {
  return issue.scene ?? issue.area ?? 'Unknown';
}

function issueCategoryLabel(issue: DetectedIssue): string {
  return issue.category === 'exploit' ? 'possible exploit' : issue.category;
}

function searchableIssueText(issue: DetectedIssue): string {
  return [
    issue.title,
    issue.description,
    issue.category,
    issueCategoryLabel(issue),
    issue.severity,
    issue.scene,
    issue.area,
    issue.stateSummary,
    issue.expectedBehavior,
    issue.actualBehavior,
    issue.botId,
    issue.gameInstanceId,
    (issue.lastActions ?? []).join(' ')
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function recoveryAttempts(issue: DetectedIssue): Array<Record<string, unknown>> {
  const raw = issue.rawEvidence;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [];
  }

  const attempts = (raw as Record<string, unknown>).recoveryAttempts;
  return Array.isArray(attempts) ? attempts.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [];
}

function reproductionSteps(issue: DetectedIssue): string {
  const actions = (issue.lastActions ?? []).length > 0 ? issue.lastActions : ['No actions captured'];

  return [
    `Issue: ${issue.title}`,
    `Severity: ${issue.severity}`,
    `Category: ${issue.category}`,
    `Scene/area: ${issueScene(issue)}`,
    `Bot: ${issue.botId ?? 'Unknown'}`,
    '',
    'Last actions:',
    ...actions.map((action, index) => `${index + 1}. ${action}`),
    '',
    `Expected: ${issue.expectedBehavior ?? 'Not specified'}`,
    `Actual: ${issue.actualBehavior ?? issue.description ?? 'Not specified'}`,
    '',
    `State summary: ${issue.stateSummary ?? 'No state summary captured'}`
  ].join('\n');
}

function EvidenceList({ issue, sessionId }: { issue: DetectedIssue; sessionId: string | null }) {
  const evidence = unique([issue.screenshotPath, issue.videoPath, ...(issue.evidencePaths ?? [])]);

  if (evidence.length === 0) {
    return <div className="empty-row">No evidence files captured</div>;
  }

  async function openEvidence(path: string) {
    if (sessionId) {
      await window.gameplaySimulator.simulation.openEvidence(sessionId, path);
    }
  }

  return (
    <div className="evidence-list">
      {evidence.map((path) => (
        <div className="evidence-row" key={path}>
          <span>{path}</span>
          <button className="secondary-button" type="button" onClick={() => void openEvidence(path)}>
            <ExternalLink size={16} aria-hidden="true" />
            <span>Open</span>
          </button>
        </div>
      ))}
    </div>
  );
}

export function IssuesPage() {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const issues = useSessionStore((state) => state.issues);
  const runConfigs = useConfigStore((state) => state.runConfigs);
  const reviewedIssueIds = useSessionStore((state) => state.reviewedIssueIds);
  const falsePositiveIssueIds = useSessionStore((state) => state.falsePositiveIssueIds);
  const markIssueReviewed = useSessionStore((state) => state.markIssueReviewed);
  const markIssueFalsePositive = useSessionStore((state) => state.markIssueFalsePositive);
  const [severity, setSeverity] = useState('all');
  const [botId, setBotId] = useState('all');
  const [category, setCategory] = useState('all');
  const [scene, setScene] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState('Copy');
  const [exportSessionId, setExportSessionId] = useState('');
  const [exportIssueOptions, setExportIssueOptions] = useState<DetectedIssue[]>([]);
  const [selectedExportIssueIds, setSelectedExportIssueIds] = useState<string[]>([]);
  const [minimumSeverity, setMinimumSeverity] = useState<Severity>('warning');
  const [minimumConfidencePercent, setMinimumConfidencePercent] = useState('75');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [useConfiguredToken, setUseConfiguredToken] = useState(false);
  const [githubPreview, setGithubPreview] = useState<GitHubIssueExportPreviewResult | null>(null);
  const [githubMessage, setGithubMessage] = useState('');
  const [githubState, setGithubState] = useState<'ready' | 'loading' | 'error'>('ready');

  const severities = unique(issues.map((issue) => issue.severity));
  const botIds = unique(issues.map((issue) => issue.botId));
  const categories = unique(issues.map((issue) => issue.category));
  const scenes = unique(issues.map(issueScene));
  const sessionOptions = useMemo(() => {
    const options = runConfigs.map((config) => ({
      sessionId: config.sessionId,
      label: `${config.sessionId} (${config.gameProfilePath.replace('memory://game-profiles/', '')})`
    }));

    if (activeSessionId && !options.some((option) => option.sessionId === activeSessionId)) {
      options.unshift({ sessionId: activeSessionId, label: `${activeSessionId} (active session)` });
    }

    return options;
  }, [activeSessionId, runConfigs]);
  const filteredIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return issues.filter((issue) => {
      if (severity !== 'all' && issue.severity !== severity) return false;
      if (botId !== 'all' && issue.botId !== botId) return false;
      if (category !== 'all' && issue.category !== category) return false;
      if (scene !== 'all' && issueScene(issue) !== scene) return false;
      if (normalizedQuery && !searchableIssueText(issue).includes(normalizedQuery)) return false;
      return true;
    });
  }, [botId, category, issues, query, scene, severity]);
  const selectedIssue =
    filteredIssues.find((issue) => issueId(issue) === selectedIssueId) ?? filteredIssues[0] ?? null;
  const selectedIssueKey = selectedIssue ? issueId(selectedIssue) : null;
  const selectedReviewed = selectedIssueKey ? reviewedIssueIds.includes(selectedIssueKey) : false;
  const selectedFalsePositive = selectedIssueKey ? falsePositiveIssueIds.includes(selectedIssueKey) : false;
  const minimumConfidence = Math.max(0, Math.min(100, Number(minimumConfidencePercent) || 0)) / 100;
  const eligibleExportIssues = useMemo(
    () =>
      exportIssueOptions.filter(
        (issue) =>
          severityRanks[issue.severity] >= severityRanks[minimumSeverity] &&
          (issue.confidence ?? 0) >= minimumConfidence
      ),
    [exportIssueOptions, minimumConfidence, minimumSeverity]
  );
  const selectedEligibleCount = selectedExportIssueIds.filter((id) =>
    eligibleExportIssues.some((issue) => issueId(issue) === id)
  ).length;

  useEffect(() => {
    if (!exportSessionId) {
      const fallbackSessionId = activeSessionId ?? sessionOptions[0]?.sessionId;

      if (fallbackSessionId) {
        setExportSessionId(fallbackSessionId);
      }
    }
  }, [activeSessionId, exportSessionId, sessionOptions]);

  useEffect(() => {
    let cancelled = false;

    async function loadExportIssues() {
      if (!exportSessionId) {
        setExportIssueOptions([]);
        setSelectedExportIssueIds([]);
        return;
      }

      try {
        const loadedIssues =
          exportSessionId === activeSessionId ? issues : await window.gameplaySimulator.simulation.getIssues(exportSessionId);

        if (cancelled) {
          return;
        }

        const loadedIds = loadedIssues.map(issueId);
        setExportIssueOptions(loadedIssues);
        setSelectedExportIssueIds((current) => {
          const retained = current.filter((id) => loadedIds.includes(id));
          return retained.length > 0 ? retained : loadedIds;
        });
        setGithubPreview(null);
      } catch (error) {
        if (!cancelled) {
          setExportIssueOptions([]);
          setSelectedExportIssueIds([]);
          setGithubPreview(null);
          setGithubState('error');
          setGithubMessage(error instanceof Error ? error.message : 'Unable to load session issues.');
        }
      }
    }

    void loadExportIssues();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, exportSessionId, issues]);

  async function copySteps(issue: DetectedIssue) {
    await navigator.clipboard.writeText(reproductionSteps(issue));
    setCopyState('Copied');
    window.setTimeout(() => setCopyState('Copy'), 1400);
  }

  function githubExportPayload() {
    return {
      sessionId: exportSessionId,
      issueIds: selectedExportIssueIds,
      minimumSeverity,
      minimumConfidence
    };
  }

  function handleExportIssueSelection(event: ChangeEvent<HTMLSelectElement>) {
    setSelectedExportIssueIds(Array.from(event.target.selectedOptions).map((option) => option.value));
    setGithubPreview(null);
  }

  function selectEligibleExportIssues() {
    setSelectedExportIssueIds(eligibleExportIssues.map(issueId));
    setGithubPreview(null);
  }

  function validateGitHubExportSelection(): boolean {
    if (!exportSessionId) {
      setGithubState('error');
      setGithubMessage('Select a session before exporting.');
      return false;
    }

    if (selectedExportIssueIds.length === 0) {
      setGithubState('error');
      setGithubMessage('Select at least one issue.');
      return false;
    }

    return true;
  }

  async function previewGitHubIssues() {
    if (!validateGitHubExportSelection()) {
      return;
    }

    setGithubState('loading');
    setGithubMessage('Preparing GitHub issue preview...');

    try {
      const preview = await window.gameplaySimulator.simulation.previewGitHubIssueExport(githubExportPayload());
      setGithubPreview(preview);
      setGithubState('ready');
      setGithubMessage(`${preview.issueCount} issue${preview.issueCount === 1 ? '' : 's'} matched the export filters.`);
    } catch (error) {
      setGithubState('error');
      setGithubMessage(error instanceof Error ? error.message : 'Unable to preview GitHub issue export.');
    }
  }

  async function exportGitHubMarkdown() {
    if (!validateGitHubExportSelection()) {
      return;
    }

    setGithubState('loading');
    setGithubMessage('Exporting GitHub issue markdown...');

    try {
      const result = await window.gameplaySimulator.simulation.exportGitHubIssueMarkdown(githubExportPayload());
      setGithubState('ready');
      setGithubMessage(`${result.message} Index: ${result.indexPath}`);
      if (!githubPreview) {
        const preview = await window.gameplaySimulator.simulation.previewGitHubIssueExport(githubExportPayload());
        setGithubPreview(preview);
      }
    } catch (error) {
      setGithubState('error');
      setGithubMessage(error instanceof Error ? error.message : 'Unable to export GitHub issue markdown.');
    }
  }

  async function postGitHubIssues() {
    if (!validateGitHubExportSelection()) {
      return;
    }

    if (!githubOwner.trim() || !githubRepo.trim()) {
      setGithubState('error');
      setGithubMessage('GitHub owner and repository are required for posting.');
      return;
    }

    if (!githubToken.trim() && !useConfiguredToken) {
      setGithubState('error');
      setGithubMessage('Provide a token or choose the configured backend token before posting.');
      return;
    }

    const confirmed = window.confirm(
      `Post selected issues to ${githubOwner.trim()}/${githubRepo.trim()}? This will create GitHub issues.`
    );

    if (!confirmed) {
      setGithubState('ready');
      setGithubMessage('Posting cancelled. No GitHub issues were created.');
      return;
    }

    setGithubState('loading');
    setGithubMessage('Posting GitHub issues...');

    try {
      const result = await window.gameplaySimulator.simulation.postGitHubIssues({
        ...githubExportPayload(),
        owner: githubOwner.trim(),
        repo: githubRepo.trim(),
        token: githubToken.trim() || undefined,
        useConfiguredToken,
        confirmed: true,
        labels: []
      });
      setGithubState(result.failed.length > 0 ? 'error' : 'ready');
      setGithubMessage(result.message);
    } catch (error) {
      setGithubState('error');
      setGithubMessage(error instanceof Error ? error.message : 'Unable to post GitHub issues.');
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Review</p>
          <h1>Issues</h1>
        </div>
        <span className="status-pill">{filteredIssues.length} visible</span>
      </div>

      <section className="filter-surface" aria-label="Issue filters">
        <label className="filter-field filter-field--search">
          <Search size={16} aria-hidden="true" />
          <input
            className="input"
            value={query}
            placeholder="Search issues"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="filter-field">
          <Filter size={16} aria-hidden="true" />
          <select className="input" value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="all">All severities</option>
            {severities.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <select className="input" value={botId} onChange={(event) => setBotId(event.target.value)}>
            <option value="all">All bots</option>
            {botIds.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <select className="input" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <select className="input" value={scene} onChange={(event) => setScene(event.target.value)}>
            <option value="all">All scenes</option>
            {scenes.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="form-section" aria-label="GitHub issue export">
        <div className="section-header-row">
          <div>
            <p className="eyebrow">GitHub export</p>
            <h2>Issue Markdown</h2>
          </div>
          <span className="status-pill">
            {selectedEligibleCount} selected · {eligibleExportIssues.length} eligible
          </span>
        </div>

        <div className="field-grid">
          <label className="field">
            <span className="field__label">Session</span>
            <select className="input" value={exportSessionId} onChange={(event) => setExportSessionId(event.target.value)}>
              <option value="">Select session</option>
              {sessionOptions.map((option) => (
                <option value={option.sessionId} key={option.sessionId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Minimum Severity</span>
            <select
              className="input"
              value={minimumSeverity}
              onChange={(event) => {
                setMinimumSeverity(event.target.value as Severity);
                setGithubPreview(null);
              }}
            >
              {severityOptions.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Minimum Confidence</span>
            <input
              className="input"
              type="number"
              min="0"
              max="100"
              value={minimumConfidencePercent}
              onChange={(event) => {
                setMinimumConfidencePercent(event.target.value);
                setGithubPreview(null);
              }}
            />
          </label>

          <label className="field field--wide">
            <span className="field__label">Issues</span>
            <select
              className="input input--multi"
              multiple
              value={selectedExportIssueIds}
              onChange={handleExportIssueSelection}
            >
              {exportIssueOptions.map((issue) => (
                <option value={issueId(issue)} key={issueId(issue)}>
                  {issue.severity} · {Math.round((issue.confidence ?? 0) * 100)}% · {issue.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={selectEligibleExportIssues}>
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Select Eligible</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setSelectedExportIssueIds([]);
              setGithubPreview(null);
            }}
          >
            <XCircle size={16} aria-hidden="true" />
            <span>Clear</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => void previewGitHubIssues()}>
            <Eye size={16} aria-hidden="true" />
            <span>Preview</span>
          </button>
          <button className="primary-button" type="button" onClick={() => void exportGitHubMarkdown()}>
            <Download size={16} aria-hidden="true" />
            <span>Export Markdown</span>
          </button>
        </div>

        {githubMessage ? <div className={`inline-notice inline-notice--${githubState}`}>{githubMessage}</div> : null}

        {githubPreview ? (
          <section className="detail-section">
            <div className="section-header-row">
              <div>
                <p className="eyebrow">Preview</p>
                <h2>GitHub Issue Body</h2>
              </div>
              <span className="status-pill">{githubPreview.issueCount} issue bodies</span>
            </div>
            <pre className="code-block code-block--tall">{githubPreview.combinedMarkdown}</pre>
          </section>
        ) : null}

        <div className="field-grid">
          <label className="field">
            <span className="field__label">Owner</span>
            <input className="input" value={githubOwner} onChange={(event) => setGithubOwner(event.target.value)} />
          </label>

          <label className="field">
            <span className="field__label">Repository</span>
            <input className="input" value={githubRepo} onChange={(event) => setGithubRepo(event.target.value)} />
          </label>

          <label className="field">
            <span className="field__label">Token</span>
            <input
              className="input"
              type="password"
              value={githubToken}
              disabled={useConfiguredToken}
              onChange={(event) => setGithubToken(event.target.value)}
            />
          </label>

          <label className="toggle-row field--wide">
            <input
              type="checkbox"
              checked={useConfiguredToken}
              onChange={(event) => setUseConfiguredToken(event.target.checked)}
            />
            <span>Use configured backend token</span>
          </label>
        </div>

        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={githubState === 'loading'}
            onClick={() => void postGitHubIssues()}
          >
            <Send size={16} aria-hidden="true" />
            <span>Post to GitHub</span>
          </button>
        </div>
      </section>

      <section className="review-layout">
        <div className="review-list" aria-label="Issue list">
          {filteredIssues.length === 0 ? (
            <div className="empty-row">No matching issues</div>
          ) : (
            filteredIssues.map((issue) => {
              const key = issueId(issue);
              const isSelected = selectedIssue ? issueId(selectedIssue) === key : false;
              const isReviewed = reviewedIssueIds.includes(key);
              const isFalsePositive = falsePositiveIssueIds.includes(key);

              return (
                <button
                  className="review-list-row"
                  data-selected={isSelected}
                  type="button"
                  key={key}
                  onClick={() => setSelectedIssueId(key)}
                >
                  <span className={`severity-dot severity-dot--${issue.severity}`} />
                  <span>
                    <strong>{issue.title}</strong>
                    <small>
                      {issueCategoryLabel(issue)} · {issueScene(issue)}
                    </small>
                  </span>
                  <span className="status-stack">
                    {isFalsePositive ? <small>False positive</small> : null}
                    {isReviewed && !isFalsePositive ? <small>Reviewed</small> : null}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <article className="detail-surface">
          {!selectedIssue ? (
            <div className="empty-state">No issue selected</div>
          ) : (
            <>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">{selectedIssue.severity}</p>
                  <h2>{selectedIssue.title}</h2>
                </div>
                <div className="page-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => markIssueReviewed(issueId(selectedIssue))}
                    disabled={selectedReviewed}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <span>{selectedReviewed ? 'Reviewed' : 'Review'}</span>
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => markIssueFalsePositive(issueId(selectedIssue))}
                    disabled={selectedFalsePositive}
                  >
                    <XCircle size={16} aria-hidden="true" />
                    <span>{selectedFalsePositive ? 'False positive' : 'False positive'}</span>
                  </button>
                  <button className="secondary-button" type="button" onClick={() => void copySteps(selectedIssue)}>
                    <Copy size={16} aria-hidden="true" />
                    <span>{copyState}</span>
                  </button>
                </div>
              </div>

              <div className="issue-meta-grid">
                <div>
                  <span>Category</span>
                  <strong>{issueCategoryLabel(selectedIssue)}</strong>
                </div>
                <div>
                  <span>Bot</span>
                  <strong>{selectedIssue.botId ?? 'None'}</strong>
                </div>
                <div>
                  <span>Scene/area</span>
                  <strong>{issueScene(selectedIssue)}</strong>
                </div>
                <div>
                  <span>Confidence</span>
                  <strong>{selectedIssue.confidence !== undefined ? `${Math.round(selectedIssue.confidence * 100)}%` : 'Unknown'}</strong>
                </div>
              </div>

              <section className="detail-section">
                <h2>Behavior</h2>
                <dl className="detail-dl">
                  <dt>Expected</dt>
                  <dd>{selectedIssue.expectedBehavior ?? 'Not specified'}</dd>
                  <dt>Actual</dt>
                  <dd>{selectedIssue.actualBehavior ?? selectedIssue.description ?? 'Not specified'}</dd>
                </dl>
              </section>

              <section className="detail-section">
                <h2>Last Actions</h2>
                {(selectedIssue.lastActions ?? []).length === 0 ? (
                  <div className="empty-row">No actions captured</div>
                ) : (
                  <ol className="action-list">
                    {(selectedIssue.lastActions ?? []).map((action, index) => (
                      <li key={`${action}-${index}`}>{action}</li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="detail-section">
                <h2>State Summary</h2>
                <pre className="code-block">{selectedIssue.stateSummary ?? 'No state summary captured'}</pre>
              </section>

              <section className="detail-section">
                <h2>Evidence</h2>
                <EvidenceList issue={selectedIssue} sessionId={activeSessionId} />
              </section>

              <section className="detail-section">
                <h2>Recovery Attempts</h2>
                {recoveryAttempts(selectedIssue).length === 0 ? (
                  <div className="empty-row">No recovery attempts captured</div>
                ) : (
                  <div className="runtime-list">
                    {recoveryAttempts(selectedIssue).map((attempt, index) => (
                      <div className="runtime-list-row" key={`${String(attempt.attemptId)}-${index}`}>
                        <strong>{String(attempt.recoveryType ?? attempt.attemptId ?? `attempt-${index + 1}`)}</strong>
                        <small>{JSON.stringify(attempt)}</small>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="detail-section">
                <h2>Raw Evidence</h2>
                <pre className="code-block">{JSON.stringify(selectedIssue.rawEvidence ?? selectedIssue, null, 2)}</pre>
              </section>
            </>
          )}
        </article>
      </section>
    </section>
  );
}
