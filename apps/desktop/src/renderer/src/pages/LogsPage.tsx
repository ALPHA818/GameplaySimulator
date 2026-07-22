import { Copy, Download, ExternalLink, FileJson, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { PersistedSessionMetadata } from '../../../main/services/simulationService';
import { FieldHelp, FieldLabel, ToggleInput } from '../components/FormFields';
import { useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';

type StructuredLogItem = Awaited<
  ReturnType<Window['gameplaySimulator']['simulation']['getStructuredLogs']>
>['logs'][number];

type LogTabId =
  | 'overview'
  | 'important-events'
  | 'full-logs'
  | 'session'
  | 'bot-actions'
  | 'bot-states'
  | 'bot-issues'
  | 'game-instances'
  | 'adapter-logs'
  | 'console-page-errors'
  | 'raw-files';

type VisibleLogEntry = {
  key: string;
  log: StructuredLogItem;
  repeatCount: number;
};

type LogSourceFilter = 'all' | StructuredLogItem['source'];

type LogFilterOptions = {
  activeTab: LogTabId;
  botId: string;
  eventType: string;
  hideNoisyStateSnapshots: boolean;
  instanceId: string;
  onlyImportantLogs: boolean;
  query: string;
  source: LogSourceFilter;
};

const sourceLabels: Record<StructuredLogItem['source'], string> = {
  session: 'Session',
  'bot-actions': 'Bot actions',
  'bot-states': 'Bot states',
  'bot-issues': 'Bot issues',
  instance: 'Instance'
};

const tabDefinitions: Array<{ id: LogTabId; label: string; helpText: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    helpText:
      'This shows the most useful log entries first. It keeps setup, issues, warnings, crashes, and recovery messages together so you do not have to read every small state update. Beginners should start here.'
  },
  {
    id: 'important-events',
    label: 'Important Events',
    helpText:
      'This shows the saved important-events bundle. It focuses on issues, warnings, crashes, recovery, adapter launches, stops, and setup flow messages. Use this first after a long run with lots of routine state logs.'
  },
  {
    id: 'full-logs',
    label: 'Full Logs',
    helpText:
      'This shows the full structured log bundle for the selected session. It includes session events, bot actions, bot states, bot issues, and instance logs. Use this when you need the complete timeline.'
  },
  {
    id: 'session',
    label: 'Session',
    helpText:
      'These logs describe the whole test session. They show when the run started, stopped, paused, launched adapters, or hit session-wide problems. If the whole test failed, check this tab first.'
  },
  {
    id: 'bot-actions',
    label: 'Bot Actions',
    helpText:
      'These logs show what buttons or direct actions each bot tried. The simulator uses them as steps to reproduce a bug. If actions repeat too much, turn on Collapse repeated actions.'
  },
  {
    id: 'bot-states',
    label: 'Bot States',
    helpText:
      'These logs show what each bot saw in the game state. They can be noisy because bots save many snapshots. Beginners can keep Hide noisy state snapshots on unless they are debugging state details.'
  },
  {
    id: 'bot-issues',
    label: 'Bot Issues',
    helpText:
      'These logs show possible bugs found by bots. They include crashes, stuck states, UI problems, and possible exploits. This tab is usually the fastest place to find important problems.'
  },
  {
    id: 'game-instances',
    label: 'Game Instances',
    helpText:
      'These logs show each running copy of the game. They are used to see launches, stops, crashes, restarts, health checks, and process problems. Check this when a bot could not start playing.'
  },
  {
    id: 'adapter-logs',
    label: 'Adapter Logs',
    helpText:
      'These logs show adapter setup and shutdown messages. The adapter is the part that opens and controls your game. If a profile fails to launch, check this tab for the adapter reason.'
  },
  {
    id: 'console-page-errors',
    label: 'Console/Page Errors',
    helpText:
      'These logs show browser console errors, page errors, JavaScript crashes, and similar page messages. They are most useful for browser games. If this tab is empty, no browser page errors were captured.'
  },
  {
    id: 'raw-files',
    label: 'Raw Files',
    helpText:
      'This helps inspect the original saved JSON rows from the run bundle. It is useful for advanced debugging when a summary hides a detail you need. Beginners should use Important Events or Bot Issues first.'
  }
];

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function sessionLabel(session: PersistedSessionMetadata): string {
  const build = [session.version, session.buildId].filter(Boolean).join(' / ');
  return `${session.sessionId} (${session.gameName}${build ? ` ${build}` : ''})`;
}

function logKey(log: StructuredLogItem, index: number): string {
  const eventId = typeof log.raw.eventId === 'string' ? log.raw.eventId : undefined;
  return eventId ?? `${log.source}:${log.botId ?? log.instanceId ?? 'session'}:${log.timestamp ?? 'untimed'}:${index}`;
}

function rawText(log: StructuredLogItem): string {
  return [
    log.source,
    log.eventType,
    log.timestamp,
    log.summary,
    log.botId,
    log.instanceId,
    JSON.stringify(log.raw)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function searchableLogText(log: StructuredLogItem): string {
  return rawText(log);
}

function rawString(log: StructuredLogItem, key: string): string | undefined {
  const value = log.raw[key];
  return typeof value === 'string' ? value : undefined;
}

function logSeverity(log: StructuredLogItem): string {
  return [rawString(log, 'severity'), rawString(log, 'level'), rawString(log, 'status')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isWarningLog(log: StructuredLogItem): boolean {
  const level = logSeverity(log);
  const text = rawText(log);
  return level.includes('warn') || text.includes('warning') || text.includes('resource_warning');
}

function isErrorLog(log: StructuredLogItem): boolean {
  const level = logSeverity(log);
  const text = rawText(log);

  return (
    level.includes('critical') ||
    level.includes('error') ||
    level.includes('fatal') ||
    level.includes('failed') ||
    text.includes('crash') ||
    text.includes('freeze') ||
    text.includes('unresponsive') ||
    text.includes('exception') ||
    text.includes('cannot launch') ||
    text.includes('launch failed')
  );
}

function isNoisyStateSnapshot(log: StructuredLogItem): boolean {
  const event = log.eventType?.toLowerCase() ?? '';
  const text = rawText(log);
  return log.source === 'bot-states' || event === 'state_snapshot' || text.includes('state_snapshot');
}

function isAdapterLog(log: StructuredLogItem): boolean {
  const event = log.eventType?.toLowerCase() ?? '';
  const text = rawText(log);

  return (
    event.includes('adapter') ||
    event.includes('instance_start') ||
    event.includes('instance_stop') ||
    event.includes('instance_restart') ||
    event.includes('instance_crash') ||
    event.includes('instance_health') ||
    text.includes('adapter') ||
    text.includes('launchinstance') ||
    text.includes('stopinstance') ||
    text.includes('adapter runtime')
  );
}

function isConsolePageErrorLog(log: StructuredLogItem): boolean {
  const event = log.eventType?.toLowerCase() ?? '';
  const text = rawText(log);

  return (
    event.includes('console') ||
    event.includes('page_error') ||
    event.includes('pageerror') ||
    text.includes('console error') ||
    text.includes('console warning') ||
    text.includes('page error') ||
    text.includes('pageerror') ||
    text.includes('javascript error') ||
    text.includes('uncaught')
  );
}

function isImportantLog(log: StructuredLogItem): boolean {
  const event = log.eventType?.toLowerCase() ?? '';
  const text = rawText(log);

  return (
    log.source === 'bot-issues' ||
    isErrorLog(log) ||
    isWarningLog(log) ||
    event.includes('issue') ||
    event.includes('crash') ||
    event.includes('freeze') ||
    event.includes('stuck') ||
    event.includes('recovery') ||
    event.includes('adapter') ||
    event.includes('instance_start') ||
    event.includes('instance_stop') ||
    event.includes('instance_restart') ||
    event.includes('instance_crash') ||
    text.includes('stuck') ||
    text.includes('recovery') ||
    text.includes('softlock') ||
    text.includes('blocker')
  );
}

function logMatchesTab(log: StructuredLogItem, tabId: LogTabId): boolean {
  switch (tabId) {
    case 'overview':
      return log.source === 'session' || isImportantLog(log);
    case 'important-events':
      return isImportantLog(log);
    case 'full-logs':
      return true;
    case 'session':
      return log.source === 'session';
    case 'bot-actions':
      return log.source === 'bot-actions';
    case 'bot-states':
      return log.source === 'bot-states';
    case 'bot-issues':
      return log.source === 'bot-issues';
    case 'game-instances':
      return log.source === 'instance';
    case 'adapter-logs':
      return isAdapterLog(log);
    case 'console-page-errors':
      return isConsolePageErrorLog(log);
    case 'raw-files':
      return true;
  }
}

function tabForSource(source: StructuredLogItem['source']): LogTabId {
  switch (source) {
    case 'session':
      return 'session';
    case 'bot-actions':
      return 'bot-actions';
    case 'bot-states':
      return 'bot-states';
    case 'bot-issues':
      return 'bot-issues';
    case 'instance':
      return 'game-instances';
  }
}

function logMatchesFilters(log: StructuredLogItem, filters: LogFilterOptions): boolean {
  const normalizedQuery = filters.query.trim().toLowerCase();

  if (filters.source !== 'all' && log.source !== filters.source) return false;
  if (!logMatchesTab(log, filters.activeTab)) return false;
  if (filters.onlyImportantLogs && !isImportantLog(log)) return false;
  if (filters.hideNoisyStateSnapshots && isNoisyStateSnapshot(log) && filters.activeTab !== 'bot-states') return false;
  if (filters.eventType !== 'all' && log.eventType !== filters.eventType) return false;
  if (filters.botId !== 'all' && log.botId !== filters.botId) return false;
  if (filters.instanceId !== 'all' && log.instanceId !== filters.instanceId) return false;
  if (normalizedQuery && !searchableLogText(log).includes(normalizedQuery)) return false;
  return true;
}

function collapseRepeatedActionLogs(logs: StructuredLogItem[]): VisibleLogEntry[] {
  const entries: VisibleLogEntry[] = [];

  logs.forEach((log, index) => {
    const key = logKey(log, index);
    const previous = entries[entries.length - 1];

    if (
      previous &&
      log.source === 'bot-actions' &&
      previous.log.source === 'bot-actions' &&
      previous.log.botId === log.botId &&
      previous.log.eventType === log.eventType &&
      previous.log.summary === log.summary
    ) {
      previous.repeatCount += 1;
      return;
    }

    entries.push({ key, log, repeatCount: 1 });
  });

  return entries;
}

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return 'No timestamp';
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return timestamp;
  }

  return new Date(parsed).toLocaleString();
}

function compactTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return 'Not recorded';
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return timestamp;
  }

  return new Date(parsed).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function gameBuildLabel(session?: PersistedSessionMetadata): string {
  if (!session) {
    return 'Unknown game';
  }

  const build = [session.version, session.buildId].filter(Boolean).join(' / ');
  return build ? `${session.gameName} (${build})` : session.gameName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function recordField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function stringArrayField(record: Record<string, unknown> | undefined, key: string): string[] {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function recordArrayField(record: Record<string, unknown> | undefined, key: string): Array<Record<string, unknown>> {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function issuePayloadFromLog(log: StructuredLogItem): Record<string, unknown> | null {
  const payload = recordField(log.raw, 'payload');

  if (payload && (stringField(payload, 'issueId') || stringField(payload, 'title'))) {
    return payload;
  }

  const issue = recordField(log.raw, 'issue');

  if (!issue) {
    return log.eventType === 'issue_detected' ? payload ?? null : null;
  }

  return {
    issueId: stringField(issue, 'issueId') ?? stringField(issue, 'id'),
    title: stringField(issue, 'title') ?? log.summary,
    severity: stringField(issue, 'severity') ?? 'warning',
    category: stringField(issue, 'category') ?? 'unknown',
    confidence: numberField(issue, 'confidence'),
    botId: stringField(issue, 'botId'),
    gameInstanceId: stringField(issue, 'gameInstanceId') ?? stringField(issue, 'instanceId'),
    sceneArea: stringField(issue, 'scene') ?? stringField(issue, 'area') ?? 'Unknown',
    lastAction: stringArrayField(issue, 'lastActions').slice(-1)[0],
    last10Actions: stringArrayField(issue, 'lastActions').slice(-10),
    currentStateSummary: stringField(issue, 'stateSummary'),
    expectedBehavior: stringField(issue, 'expectedBehavior'),
    actualBehavior: stringField(issue, 'actualBehavior') ?? stringField(issue, 'description'),
    screenshotPath: stringField(issue, 'screenshotPath'),
    videoPath: stringField(issue, 'videoPath'),
    evidencePaths: stringArrayField(issue, 'evidencePaths'),
    likelyCause: 'Review the issue evidence, recent actions, and raw state before confirming this bug.',
    reproductionSteps: stringArrayField(issue, 'lastActions').map((action, index) => `${index + 1}. Replay action: ${action}`),
    recoveryAttempts: [],
    occurrence: 'new',
    summary: log.summary,
    timeline: [],
    whyFlagged: {
      detectorName: `${stringField(issue, 'category') ?? 'issue'} detector`,
      detectorRule: 'This older log did not include rich detector details. Inspect raw JSON for saved evidence.',
      triggeredData: issue
    },
    whatToCheckNext: [
      'Open screenshot if available.',
      'Inspect raw state in this log entry.',
      'Replay or read the action timeline before the issue.',
      'Compare with a previous run if this build was tested before.',
      'Export a GitHub issue when the evidence looks good.'
    ]
  };
}

function actionPayloadFromLog(log: StructuredLogItem): Record<string, unknown> | null {
  if (log.eventType !== 'action_performed' && log.source !== 'bot-actions') {
    return null;
  }

  const payload = recordField(log.raw, 'payload') ?? {};
  const action = recordField(log.raw, 'action');
  const actionPayload = recordField(action, 'payload') ?? {};
  const result = recordField(log.raw, 'result');

  return {
    ...actionPayload,
    ...payload,
    actionType: stringField(payload, 'actionType') ?? stringField(action, 'type'),
    status: stringField(payload, 'status') ?? stringField(result, 'status'),
    resultMessage: stringField(payload, 'resultMessage') ?? stringField(result, 'message'),
    actionQuality: stringField(payload, 'actionQuality') ?? stringField(actionPayload, 'quality'),
    explanation: stringField(payload, 'explanation') ?? stringField(actionPayload, 'explanation'),
    nextLikelyAction: stringField(payload, 'nextLikelyAction') ?? stringField(actionPayload, 'nextLikelyAction'),
    plannerMetadata: recordField(payload, 'plannerMetadata') ?? {
      planner: stringField(actionPayload, 'planner'),
      score: numberField(actionPayload, 'score'),
      randomValue: numberField(actionPayload, 'random'),
      reason: stringField(actionPayload, 'reason'),
      profileKey: stringField(actionPayload, 'profileKey'),
      seed: numberField(actionPayload, 'seed')
    }
  };
}

function issueSeverity(payload: Record<string, unknown> | null): string {
  return stringField(payload ?? undefined, 'severity') ?? 'warning';
}

function confidenceText(confidence: number | undefined): string {
  return confidence === undefined ? 'Unknown' : `${Math.round(confidence * 100)}%`;
}

function evidencePathsFromIssuePayload(payload: Record<string, unknown>): string[] {
  return unique([
    stringField(payload, 'screenshotPath'),
    stringField(payload, 'videoPath'),
    ...stringArrayField(payload, 'evidencePaths')
  ]);
}

function SummaryCard({
  detail,
  helpText,
  label,
  value
}: {
  detail?: string;
  helpText: string;
  label: string;
  value: string | number;
}) {
  return (
    <div className="metric-card">
      <FieldLabel label={label} helpText={helpText} />
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function ActionDecisionView({ payload }: { payload: Record<string, unknown> }) {
  const planner = recordField(payload, 'plannerMetadata');
  const status = stringField(payload, 'status') ?? 'not recorded';
  const resultMessage = stringField(payload, 'resultMessage');

  return (
    <section className="detail-section action-decision-log">
      <h2>
        <FieldLabel
          label="Action Decision"
          helpText="This explains why the bot performed the selected action. The simulator shows the planner rule, action quality, score, random value, and seed so the decision can be understood and reproduced. If a value is missing, the action came from an older run or a simpler adapter. Beginners should read the explanation first."
        />
      </h2>
      <p className="detail-copy">
        {stringField(payload, 'explanation') ?? 'This action did not record a readable explanation.'}
      </p>
      <div className="issue-meta-grid log-detail-grid">
        <div>
          <FieldLabel label="Current Action" />
          <strong>{stringField(payload, 'actionType') ?? 'Unknown'}</strong>
        </div>
        <div>
          <FieldLabel label="Action Quality" />
          <strong className="action-quality-pill">{stringField(payload, 'actionQuality') ?? 'not-known'}</strong>
        </div>
        <div>
          <FieldLabel label="Last Result" />
          <strong>{resultMessage ? `${status}: ${resultMessage}` : status}</strong>
        </div>
        <div>
          <FieldLabel
            label="Planner Type"
            helpText="This shows which decision system chose the action. Rule-based uses bot profile scores, UI journey follows a configured menu flow, and recovery tries to escape a stuck state. If it says unknown, the older log did not save this value. Beginners can leave this unchanged."
          />
          <strong>{stringField(planner, 'planner') ?? 'Unknown'}</strong>
        </div>
        <div>
          <FieldLabel
            label="Planner Score"
            helpText="This is the number the planner gave the action after checking profile rules and game context. A larger score made the action more likely to be chosen. For example, a UI action scores higher for a UI Tester. If it looks surprising, compare the planner reason and profile rule. Beginners can treat it as a comparison number, not a grade."
          />
          <strong>{numberField(planner, 'score') ?? 'Not used'}</strong>
        </div>
        <div>
          <FieldLabel
            label="Random Value"
            helpText="This is the seeded random value used to keep bots from behaving exactly the same. The same seed and state produce the same value. For example, chaos bots use it more strongly than story bots. If it changes, the chosen action may also change. Beginners do not need to edit it."
          />
          <strong>{numberField(planner, 'randomValue') ?? 'Not used'}</strong>
        </div>
        <div>
          <FieldLabel
            label="Profile Rule"
            helpText="This is the short profile group used to score the action. For example, explorer favors movement and unvisited actions, while UI favors menus. If it does not match the selected bot, check the bot profile. Beginners should expect a familiar name here."
          />
          <strong>{stringField(planner, 'profileKey') ?? 'Not used'}</strong>
        </div>
        <div>
          <FieldLabel
            label="Planner Reason"
            helpText="This is the planner's compact internal reason before it was turned into a full sentence. For example, rule match or unvisited action. If it contains an avoid warning, the action may have scored lower. Beginners should use the full explanation above first."
          />
          <strong>{stringField(planner, 'reason') ?? 'Not recorded'}</strong>
        </div>
        <div>
          <FieldLabel
            label="Planner Seed"
            helpText="This number makes random choices repeatable for debugging. Using the same seed with the same state and actions should produce the same decision. If the seed changes, equally good actions may be chosen differently. Beginners should leave it as generated."
          />
          <strong>{numberField(planner, 'seed') ?? 'Not used'}</strong>
        </div>
        <div>
          <FieldLabel label="Next Likely Action" />
          <strong>{stringField(payload, 'nextLikelyAction') ?? 'Not known'}</strong>
        </div>
      </div>
    </section>
  );
}

function IssueDiagnosisView({
  onOpenEvidence,
  onOpenIssue,
  payload
}: {
  onOpenEvidence: (path: string) => void;
  onOpenIssue: (issueId: string | undefined) => void;
  payload: Record<string, unknown>;
}) {
  const issueId = stringField(payload, 'issueId');
  const severity = stringField(payload, 'severity') ?? 'warning';
  const category = stringField(payload, 'category') ?? 'unknown';
  const confidence = numberField(payload, 'confidence');
  const title = stringField(payload, 'title') ?? 'Issue detected';
  const timeline = recordArrayField(payload, 'timeline');
  const whyFlagged = recordField(payload, 'whyFlagged');
  const evidencePaths = evidencePathsFromIssuePayload(payload);
  const reproductionSteps = stringArrayField(payload, 'reproductionSteps');
  const whatToCheckNext = stringArrayField(payload, 'whatToCheckNext');
  const recoveryAttempts = payload.recoveryAttempts;

  return (
    <section className={`issue-diagnosis issue-diagnosis--${severity}`}>
      <div className="issue-diagnosis__header">
        <div>
          <FieldLabel
            label="Issue Diagnosis"
            helpText="This explains the issue in plain language. The simulator uses the detector, bot actions, game state, and evidence to summarize why this log matters. Start here before reading raw JSON."
          />
          <h3>{title}</h3>
          <p>{stringField(payload, 'summary') ?? 'A bot detected a possible issue.'}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => onOpenIssue(issueId)}>
          <ExternalLink size={16} aria-hidden="true" />
          <span>Open in Issues</span>
        </button>
      </div>

      <div className="issue-meta-grid log-detail-grid">
        <div>
          <FieldLabel label="Issue ID" />
          <strong>{issueId ?? 'Unknown'}</strong>
        </div>
        <div>
          <FieldLabel label="Severity" />
          <strong className={`severity-text severity-text--${severity}`}>{severity}</strong>
        </div>
        <div>
          <FieldLabel label="Category" />
          <strong>{category}</strong>
        </div>
        <div>
          <FieldLabel label="Confidence" />
          <strong>{confidenceText(confidence)}</strong>
        </div>
        <div>
          <FieldLabel label="Scene/area" />
          <strong>{stringField(payload, 'sceneArea') ?? 'Unknown'}</strong>
        </div>
        <div>
          <FieldLabel label="Last action" />
          <strong>{stringField(payload, 'lastAction') ?? 'None captured'}</strong>
        </div>
      </div>

      <div className="issue-diagnosis-grid">
        <section className="detail-section">
          <h2>
            <FieldLabel
              label="Expected Behavior"
              helpText="This is what the game should have done. The simulator uses it to compare normal behavior with what happened. If it says Not specified, the detector did not know the expected result."
            />
          </h2>
          <p className="detail-copy">{stringField(payload, 'expectedBehavior') ?? 'Not specified'}</p>
        </section>
        <section className="detail-section">
          <h2>
            <FieldLabel
              label="Actual Behavior"
              helpText="This is what the bot observed instead. The simulator uses it to explain the possible bug. Compare this with expected behavior before confirming the issue."
            />
          </h2>
          <p className="detail-copy">{stringField(payload, 'actualBehavior') ?? 'Not specified'}</p>
        </section>
      </div>

      <section className="detail-section">
        <h2>
          <FieldLabel
            label="Issue Timeline"
            helpText="This shows the key moments around the issue. The simulator uses it to connect the action before the issue, the state before the issue, evidence capture, and recovery attempts. Read it from top to bottom."
          />
        </h2>
        <div className="issue-timeline">
          {timeline.length === 0 ? (
            <div className="empty-row">No issue timeline captured</div>
          ) : (
            timeline.map((item, index) => (
              <div className="issue-timeline-row" key={`${String(item.step ?? 'step')}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{String(item.label ?? item.step ?? 'Timeline step')}</strong>
                  <small>{String(item.summary ?? 'No summary')}</small>
                  {item.timestamp ? <small>{String(item.timestamp)}</small> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="detail-section">
        <h2>
          <FieldLabel
            label="Why This Was Flagged"
            helpText="This explains which detector raised the issue and what rule matched. The simulator uses this to avoid making you guess why a log is important. If the rule seems wrong, review the raw data before marking a false positive."
          />
        </h2>
        <div className="why-flagged-grid">
          <div>
            <FieldLabel label="Detector Name" />
            <strong>{stringField(whyFlagged, 'detectorName') ?? 'Unknown detector'}</strong>
          </div>
          <div>
            <FieldLabel label="Detector Rule" />
            <strong>{stringField(whyFlagged, 'detectorRule') ?? 'No rule captured'}</strong>
          </div>
        </div>
        <pre className="code-block">{JSON.stringify(whyFlagged?.triggeredData ?? null, null, 2)}</pre>
      </section>

      <section className="detail-section">
        <h2>
          <FieldLabel
            label="Evidence"
            helpText="These are screenshots, videos, or other files linked to this issue. The simulator uses them as proof and context. Open evidence before deciding whether the issue is real."
          />
        </h2>
        <div className="evidence-list">
          {evidencePaths.length === 0 ? (
            <div className="empty-row">No evidence paths captured</div>
          ) : (
            evidencePaths.map((path) => (
              <div className="evidence-row" key={path}>
                <span className="evidence-row__path">{path}</span>
                <button className="secondary-button" type="button" onClick={() => onOpenEvidence(path)}>
                  <ExternalLink size={16} aria-hidden="true" />
                  <span>Open</span>
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="detail-section">
        <h2>
          <FieldLabel
            label="Reproduction Steps"
            helpText="These steps show what the bot did before the issue. The simulator builds them from recent actions. Use them to try the same path by hand or in a replay later."
          />
        </h2>
        <ol className="action-list">
          {reproductionSteps.length === 0 ? <li>No reproduction steps captured.</li> : null}
          {reproductionSteps.map((step) => (
            <li key={step}>{step.replace(/^\d+\.\s*/, '')}</li>
          ))}
        </ol>
      </section>

      <section className="detail-section">
        <h2>
          <FieldLabel
            label="What To Check Next"
            helpText="These are practical next steps after reading the issue. The simulator suggests them so you can confirm the bug, gather evidence, compare builds, or export a report."
          />
        </h2>
        <ul className="action-list">
          {whatToCheckNext.length === 0 ? <li>No follow-up checks captured.</li> : null}
          {whatToCheckNext.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="detail-section">
        <h2>
          <FieldLabel
            label="Recovery Attempts"
            helpText="This shows what the bot tried after getting stuck or finding an issue. The simulator uses it to tell whether the bot recovered or gave up. If recovery failed, the issue is more serious."
          />
        </h2>
        <pre className="code-block">{JSON.stringify(recoveryAttempts ?? [], null, 2)}</pre>
      </section>

      <section className="detail-section">
        <h2>
          <FieldLabel
            label="Current State Summary"
            helpText="This is the saved game state near the issue. The simulator uses it to show scene, UI, inventory, quest, or process context. If it is hard to read, open Raw JSON for the full event."
          />
        </h2>
        <pre className="code-block">{stringField(payload, 'currentStateSummary') ?? 'No state summary captured'}</pre>
      </section>
    </section>
  );
}

export function LogsPage() {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const navigate = useConfigStore((state) => state.navigate);
  const setReviewSessionId = useSessionStore((state) => state.setReviewSessionId);
  const setReviewIssueId = useSessionStore((state) => state.setReviewIssueId);
  const [sessions, setSessions] = useState<PersistedSessionMetadata[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [logs, setLogs] = useState<StructuredLogItem[]>([]);
  const [activeTab, setActiveTab] = useState<LogTabId>('overview');
  const [source, setSource] = useState<LogSourceFilter>('all');
  const [eventType, setEventType] = useState('all');
  const [botId, setBotId] = useState('all');
  const [instanceId, setInstanceId] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedLogKey, setSelectedLogKey] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loadMessage, setLoadMessage] = useState('');
  const [showRawJson, setShowRawJson] = useState(true);
  const [copyState, setCopyState] = useState('Copy');
  const [onlyImportantLogs, setOnlyImportantLogs] = useState(false);
  const [hideNoisyStateSnapshots, setHideNoisyStateSnapshots] = useState(true);
  const [collapseRepeatedActions, setCollapseRepeatedActions] = useState(true);

  const selectedSession = sessions.find((session) => session.sessionId === selectedSessionId);
  const sessionOptions = useMemo(() => {
    const options = sessions.map((session) => ({
      sessionId: session.sessionId,
      label: sessionLabel(session)
    }));

    if (activeSessionId && !options.some((option) => option.sessionId === activeSessionId)) {
      options.unshift({
        sessionId: activeSessionId,
        label: `${activeSessionId} (active session)`
      });
    }

    return options;
  }, [activeSessionId, sessions]);

  async function loadSessions(reload = false) {
    try {
      const loadedSessions = reload
        ? await window.gameplaySimulator.simulation.reloadSessions()
        : await window.gameplaySimulator.simulation.listSessions();

      setSessions(loadedSessions);
      setSelectedSessionId((current) => {
        if (current && loadedSessions.some((session) => session.sessionId === current)) {
          return current;
        }

        if (activeSessionId) {
          return activeSessionId;
        }

        return loadedSessions[0]?.sessionId ?? '';
      });
    } catch (error) {
      setLoadState('error');
      setLoadMessage(error instanceof Error ? error.message : 'Unable to load saved sessions.');
    }
  }

  async function loadLogs(sessionId = selectedSessionId) {
    if (!sessionId) {
      setLogs([]);
      setLoadState('idle');
      setLoadMessage('No session selected.');
      return;
    }

    setLoadState('loading');

    try {
      const result = await window.gameplaySimulator.simulation.getStructuredLogs(sessionId);
      setLogs(result.logs);
      setLoadState('ready');
      setLoadMessage(`${result.logs.length} structured log entries loaded for ${sessionId}.`);
    } catch (error) {
      setLoadState('error');
      setLoadMessage(error instanceof Error ? error.message : 'Unable to load structured logs.');
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    if (!selectedSessionId && activeSessionId) {
      setSelectedSessionId(activeSessionId);
    }
  }, [activeSessionId, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId && sessions[0]) {
      setSelectedSessionId(sessions[0].sessionId);
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setLogs([]);
      setLoadState('idle');
      setLoadMessage('No session selected.');
      return undefined;
    }

    let cancelled = false;

    async function refresh() {
      setLoadState((current) => (current === 'idle' ? 'loading' : current));

      try {
        const result = await window.gameplaySimulator.simulation.getStructuredLogs(selectedSessionId);

        if (!cancelled) {
          setLogs(result.logs);
          setLoadState('ready');
          setLoadMessage(`${result.logs.length} structured log entries loaded for ${selectedSessionId}.`);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadState('error');
          setLoadMessage(error instanceof Error ? error.message : 'Unable to load structured logs.');
        }
      }
    }

    void refresh();

    if (selectedSessionId !== activeSessionId) {
      return () => {
        cancelled = true;
      };
    }

    const intervalId = window.setInterval(refresh, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeSessionId, selectedSessionId]);

  const eventTypes = unique(logs.map((log) => log.eventType));
  const botIds = unique(logs.map((log) => log.botId));
  const instanceIds = unique(logs.map((log) => log.instanceId));
  const filterOptions = useMemo<LogFilterOptions>(
    () => ({
      activeTab,
      botId,
      eventType,
      hideNoisyStateSnapshots,
      instanceId,
      onlyImportantLogs,
      query,
      source
    }),
    [activeTab, botId, eventType, hideNoisyStateSnapshots, instanceId, onlyImportantLogs, query, source]
  );
  const tabCounts = useMemo(
    () =>
      Object.fromEntries(
        tabDefinitions.map((tab) => [
          tab.id,
          logs.filter((log) => logMatchesFilters(log, { ...filterOptions, activeTab: tab.id })).length
        ])
      ),
    [filterOptions, logs]
  ) as Record<LogTabId, number>;
  const filteredLogs = useMemo(() => logs.filter((log) => logMatchesFilters(log, filterOptions)), [filterOptions, logs]);
  const groupedCounts = useMemo(
    () => ({
      session: filteredLogs.filter((log) => log.source === 'session').length,
      botActions: filteredLogs.filter((log) => log.source === 'bot-actions').length,
      botStates: filteredLogs.filter((log) => log.source === 'bot-states').length,
      botIssues: filteredLogs.filter((log) => log.source === 'bot-issues').length,
      instances: filteredLogs.filter((log) => log.source === 'instance').length,
      errors: filteredLogs.filter(isErrorLog).length,
      warnings: filteredLogs.filter(isWarningLog).length
    }),
    [filteredLogs]
  );
  const visibleEntries = useMemo(
    () =>
      collapseRepeatedActions
        ? collapseRepeatedActionLogs(filteredLogs)
        : filteredLogs.map((log, index) => ({ key: logKey(log, index), log, repeatCount: 1 })),
    [collapseRepeatedActions, filteredLogs]
  );
  const selectedEntry = visibleEntries.find((entry) => entry.key === selectedLogKey) ?? visibleEntries[0] ?? null;
  const selectedLog = selectedEntry?.log ?? null;
  const selectedKey = selectedEntry?.key ?? null;
  const selectedIssuePayload = selectedLog ? issuePayloadFromLog(selectedLog) : null;
  const selectedActionPayload = selectedLog ? actionPayloadFromLog(selectedLog) : null;
  const filteredBotIds = unique(filteredLogs.map((log) => log.botId));
  const filteredInstanceIds = unique(filteredLogs.map((log) => log.instanceId));
  const issueCount = filteredLogs.filter((log) => log.source === 'bot-issues').length;
  const botCount = filteredBotIds.length;
  const instanceCount = filteredInstanceIds.length;
  const startedTime = compactTimestamp(selectedSession?.startedAt ?? selectedSession?.createdAt);
  const stoppedTime = selectedSession?.stoppedAt ? compactTimestamp(selectedSession.stoppedAt) : 'Still running or not stopped';
  const activeTabLabel = tabDefinitions.find((tab) => tab.id === activeTab)?.label ?? activeTab;
  const activeFilterChips = [
    activeTab !== 'full-logs' ? { label: 'Group', value: activeTabLabel } : undefined,
    source !== 'all' ? { label: 'Source', value: sourceLabels[source] } : undefined,
    eventType !== 'all' ? { label: 'Event', value: eventType } : undefined,
    botId !== 'all' ? { label: 'Bot', value: botId } : undefined,
    instanceId !== 'all' ? { label: 'Instance', value: instanceId } : undefined,
    query.trim() ? { label: 'Search', value: query.trim() } : undefined,
    onlyImportantLogs ? { label: 'Importance', value: 'Important only' } : undefined,
    hideNoisyStateSnapshots ? { label: 'State snapshots', value: 'Hidden outside Bot States' } : undefined
  ].filter((chip): chip is { label: string; value: string } => Boolean(chip));

  useEffect(() => {
    if (visibleEntries.length === 0) {
      if (selectedLogKey !== null) {
        setSelectedLogKey(null);
      }

      return;
    }

    const selectedStillVisible = selectedLogKey
      ? visibleEntries.some((entry) => entry.key === selectedLogKey)
      : false;

    if (!selectedStillVisible) {
      setSelectedLogKey(visibleEntries[0].key);
    }
  }, [selectedLogKey, visibleEntries]);

  async function copyRawJson() {
    if (!selectedLog) {
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify(selectedLog.raw, null, 2));
    setCopyState('Copied');
    window.setTimeout(() => setCopyState('Copy'), 1400);
  }

  function exportVisibleLogs() {
    const payload = filteredLogs.map((log) => ({
      sessionId: selectedSessionId,
      gameName: selectedSession?.gameName,
      buildId: selectedSession?.buildId,
      ...log
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedSessionId || 'logs'}-${activeTab}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function clearFilters() {
    setActiveTab('full-logs');
    setSource('all');
    setEventType('all');
    setBotId('all');
    setInstanceId('all');
    setQuery('');
    setOnlyImportantLogs(false);
    setHideNoisyStateSnapshots(false);
    setSelectedLogKey(null);
  }

  function moveSelection(offset: number) {
    if (visibleEntries.length === 0) {
      setSelectedLogKey(null);
      return;
    }

    const currentIndex = selectedKey ? visibleEntries.findIndex((entry) => entry.key === selectedKey) : -1;
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), visibleEntries.length - 1);
    setSelectedLogKey(visibleEntries[nextIndex].key);
  }

  async function openEvidence(path: string) {
    if (!selectedSessionId) {
      return;
    }

    const result = await window.gameplaySimulator.simulation.openEvidence(selectedSessionId, path);
    setLoadState(result.opened ? 'ready' : 'error');
    setLoadMessage(result.message);
  }

  function openIssueDetail(issueId: string | undefined) {
    setReviewSessionId(selectedSessionId || null);
    setReviewIssueId(issueId ?? null);
    navigate('issues');
  }

  return (
    <section className="page-stack log-page logs-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Inspect</p>
          <h1>Logs</h1>
        </div>
        <div className="page-actions">
          <span className="status-pill">
            {filteredLogs.length} matching{visibleEntries.length !== filteredLogs.length ? `, ${visibleEntries.length} rows` : ''}
          </span>
          <button className="secondary-button" type="button" onClick={() => void loadSessions(true)}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Reload Sessions</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => void loadLogs()}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh Logs</span>
          </button>
        </div>
      </div>

      <section className="filter-surface filter-surface--logs" aria-label="Log filters">
        <div className="filter-field filter-field--session">
          <FieldLabel
            label="Session"
            htmlFor="log-session-filter"
            helpText="This chooses which test run to inspect. The simulator loads logs only for this run so different tests do not get mixed together. Choose the active session for live logs, or an older saved session to review past results. If you choose the wrong session, you may read logs for the wrong game build."
          />
          <select
            id="log-session-filter"
            className="input"
            value={selectedSessionId}
            onChange={(event) => {
              setSelectedSessionId(event.target.value);
              setSelectedLogKey(null);
            }}
          >
            {sessionOptions.length === 0 ? <option value="">No sessions found</option> : null}
            {sessionOptions.map((item) => (
              <option value={item.sessionId} key={item.sessionId}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field filter-field--search">
          <FieldLabel label="Search" htmlFor="log-search" />
          <Search size={16} aria-hidden="true" />
          <input
            id="log-search"
            className="input"
            value={query}
            placeholder="Search logs"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedLogKey(null);
            }}
          />
        </div>
        <div className="filter-field">
          <FieldLabel
            label="Source"
            htmlFor="log-source-filter"
            helpText="This chooses the kind of log to show. For example, Bot actions shows what bots tried, while Game instances shows launch and process messages. If you choose a source with no matches, the list will be empty. Beginners can leave this on All sources."
          />
          <select
            id="log-source-filter"
            className="input"
            value={source}
            onChange={(event) => {
              const nextSource = event.target.value as LogSourceFilter;
              setSource(nextSource);
              setSelectedLogKey(null);

              if (nextSource !== 'all') {
                setActiveTab(tabForSource(nextSource));
              }
            }}
          >
            <option value="all">All sources</option>
            {Object.entries(sourceLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <FieldLabel label="Event Type" htmlFor="log-event-type-filter" />
          <select
            id="log-event-type-filter"
            className="input"
            value={eventType}
            onChange={(event) => {
              setEventType(event.target.value);
              setSelectedLogKey(null);
            }}
          >
            <option value="all">All event types</option>
            {eventTypes.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <FieldLabel label="Bot" htmlFor="log-bot-filter" />
          <select
            id="log-bot-filter"
            className="input"
            value={botId}
            onChange={(event) => {
              setBotId(event.target.value);
              setSelectedLogKey(null);
            }}
          >
            <option value="all">All bots</option>
            {botIds.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <FieldLabel label="Instance" htmlFor="log-instance-filter" />
          <select
            id="log-instance-filter"
            className="input"
            value={instanceId}
            onChange={(event) => {
              setInstanceId(event.target.value);
              setSelectedLogKey(null);
            }}
          >
            <option value="all">All instances</option>
            {instanceIds.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="filter-chip-row" aria-label="Active log filters">
        <FieldLabel
          label="Active Filters"
          helpText="These chips show the filters currently changing the log list, counters, detail pane, and export. For example, Source: Bot actions means only bot action logs are being shown. If the list looks too small, clear the filters."
        />
        <div className="filter-chip-list">
          {activeFilterChips.length === 0 ? (
            <span className="filter-chip filter-chip--empty">No filters</span>
          ) : (
            activeFilterChips.map((chip) => (
              <span className="filter-chip" key={`${chip.label}:${chip.value}`}>
                {chip.label}: {chip.value}
              </span>
            ))
          )}
        </div>
        <button className="secondary-button" type="button" onClick={clearFilters}>
          Clear Filters
        </button>
      </section>

      <section className="metric-grid metric-grid--session log-summary-grid" aria-label="Log session summary">
        <SummaryCard
          label="Session ID"
          value={selectedSessionId || 'None selected'}
          helpText="This is the exact test run being shown. The simulator prints it on every log row so you do not mix one run with another. If this ID is not the run you wanted, choose a different session above."
        />
        <SummaryCard
          label="Session Label"
          value={selectedSession?.sessionLabel ?? 'Custom'}
          helpText="This is the short label for the run, like Smoke Test, Regression, UI Flow, Stress Test, or Custom. The simulator uses it to help you find the right run after many tests. If it is wrong, choose a clearer label before the next run."
        />
        <SummaryCard
          label="Game"
          value={gameBuildLabel(selectedSession)}
          helpText="This is the game and build connected to the selected logs. The simulator uses it to show which test run the entries came from. If it looks wrong, you may be viewing the wrong saved session."
        />
        <SummaryCard
          label="Adapter Runtime"
          value={selectedSession?.adapterType ?? 'Unknown'}
          helpText="This shows which adapter controlled the game during this run. For example, browser, desktop-window, or instrumented. If it is not what you expected, check the game profile before running more bots."
        />
        <SummaryCard
          detail={`Stopped: ${stoppedTime}`}
          label="Started/stopped time"
          value={`Started: ${startedTime}`}
          helpText="This shows when the run began and when it ended. The simulator uses it to separate old tests from new tests. If stopped time is missing, the session may still be active or was interrupted."
        />
        <SummaryCard
          label="Total Logs"
          value={filteredLogs.length}
          detail={`${logs.length} saved before filters`}
          helpText="This is the number of log entries currently matching your filters. The smaller detail shows how many logs were saved before filters. If this looks too low, clear filters or choose Raw."
        />
        <SummaryCard
          label="Issue Count"
          value={issueCount}
          helpText="This is how many possible issues were saved in this run. The simulator uses it to help you decide what to review first. If this is high, open Bot Issues or the Issues page."
        />
        <SummaryCard
          label="Bot Count"
          value={botCount}
          helpText="This is how many bots were part of the selected run. The simulator uses it to explain how much testing happened. If it is lower than expected, the run may have been scaled down or stopped early."
        />
        <SummaryCard
          label="Instance Count"
          value={instanceCount}
          helpText="This is how many game instances appear in these logs. The simulator uses it to separate game windows or endpoints. If this is zero during a real run, the game may not have launched."
        />
      </section>

      <section className="metric-grid log-counter-grid" aria-label="Log group counters">
        <SummaryCard
          label="Session Logs"
          value={groupedCounts.session}
          helpText="This counts logs about the whole test run. These include session start, stop, pause, resume, and setup messages. Use it when checking if the session itself behaved correctly."
        />
        <SummaryCard
          label="Bot Action Logs"
          value={groupedCounts.botActions}
          helpText="This counts bot action entries. These show what each bot tried to do. If this number is very large, turn on Collapse repeated actions or filter by one bot."
        />
        <SummaryCard
          label="Bot State Logs"
          value={groupedCounts.botStates}
          helpText="This counts saved state snapshots from bots. These can be useful but noisy. Beginners should hide noisy snapshots unless they need exact state details."
        />
        <SummaryCard
          label="Bot Issue Logs"
          value={groupedCounts.botIssues}
          helpText="This counts issue log entries written by bots. These are possible bugs and usually deserve review before raw action or state logs."
        />
        <SummaryCard
          label="Instance Logs"
          value={groupedCounts.instances}
          helpText="This counts logs from game instances. These show game launch, stop, health, crash, and restart messages. Check these when the game window or process misbehaves."
        />
        <SummaryCard
          label="Error Logs"
          value={groupedCounts.errors}
          helpText="This counts log entries that look like errors, crashes, failed launches, exceptions, or unresponsive states. Beginners should review these first."
        />
        <SummaryCard
          label="Warning Logs"
          value={groupedCounts.warnings}
          helpText="This counts log entries that look like warnings. Warnings may not stop a run, but they can explain missing evidence, heavy resource use, or adapter limitations."
        />
      </section>

      <section className="log-run-separator" aria-label="Selected run separator">
        <FieldLabel
          label="Selected Run"
          helpText="This label marks which run the log list belongs to. The simulator repeats the session ID on each row so you never have to guess which test produced a log entry. If the run is wrong, choose another session above."
        />
        <strong>{selectedSessionId || 'No session selected'}</strong>
        <span>{gameBuildLabel(selectedSession)}</span>
      </section>

      <section className="log-tabs" aria-label="Log groups">
        {tabDefinitions.map((tab) => (
          <span className="log-tab-item" data-active={activeTab === tab.id} key={tab.id}>
            <button
              className="log-tab-button"
              data-active={activeTab === tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedLogKey(null);
              }}
            >
              <span>{tab.label}</span>
              <small>{tabCounts[tab.id] ?? 0}</small>
            </button>
            <FieldHelp label={tab.label} helpText={tab.helpText} />
          </span>
        ))}
      </section>

      <section className="log-controls" aria-label="Log view settings">
        <ToggleInput
          checked={onlyImportantLogs}
          helpText="This shows only logs that look important, like errors, warnings, issues, crashes, stuck or recovery messages, and adapter launch or stop events. Use it when a run has too many routine entries. If it hides something you need, turn it off."
          id="log-only-important"
          label="Only important logs"
          onChange={(event) => setOnlyImportantLogs(event.target.checked)}
        />
        <ToggleInput
          checked={hideNoisyStateSnapshots}
          helpText="This hides frequent state snapshot logs outside the Bot States tab. The simulator saves many snapshots, so they can bury issues and warnings. Beginners should leave this on and open Bot States only when debugging exact game state."
          id="log-hide-noisy-states"
          label="Hide noisy state snapshots"
          onChange={(event) => setHideNoisyStateSnapshots(event.target.checked)}
        />
        <ToggleInput
          checked={collapseRepeatedActions}
          helpText="This groups repeated bot action logs that happen right after each other. It makes spammy action loops easier to read. If you need every single action line, turn it off."
          id="log-collapse-repeated-actions"
          label="Collapse repeated actions"
          onChange={(event) => setCollapseRepeatedActions(event.target.checked)}
        />
        <button className="secondary-button log-export-button" type="button" onClick={exportVisibleLogs}>
          <Download size={16} aria-hidden="true" />
          <span>Export visible logs</span>
        </button>
      </section>

      {loadMessage ? <div className={`inline-notice inline-notice--${loadState}`}>{loadMessage}</div> : null}

      <section className="review-layout review-layout--logs">
        <div
          className="review-list log-list"
          aria-label="Log entries"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveSelection(1);
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveSelection(-1);
            }
          }}
        >
          {!selectedSessionId ? (
            <div className="empty-row">No session selected</div>
          ) : visibleEntries.length === 0 ? (
            <div className="empty-row">No matching log entries</div>
          ) : (
            visibleEntries.map(({ key, log, repeatCount }) => {
              const issuePayload = issuePayloadFromLog(log);
              const severity = issueSeverity(issuePayload);

              return (
              <button
                className={[
                  'log-list-row',
                  issuePayload ? 'log-list-row--issue' : undefined,
                  issuePayload ? `log-list-row--${severity}` : undefined
                ].filter(Boolean).join(' ')}
                data-selected={selectedKey === key}
                type="button"
                key={key}
                onClick={() => setSelectedLogKey(key)}
              >
                <span className={`source-pill source-pill--${log.source}`}>{sourceLabels[log.source]}</span>
                <span className="log-row-main">
                  <strong>
                    {log.eventType ?? log.source}
                    {repeatCount > 1 ? ` (repeated ${repeatCount}x)` : ''}
                  </strong>
                  <small>{log.summary}</small>
                  <small className="log-row-session">Session: {selectedSessionId}</small>
                </span>
                <span className="log-row-meta">
                  <small>{formatTimestamp(log.timestamp)}</small>
                  <small>{log.botId ?? log.instanceId ?? 'session'}</small>
                </span>
              </button>
              );
            })
          )}
        </div>

        <article className={`detail-surface${selectedIssuePayload ? ` detail-surface--issue detail-surface--${issueSeverity(selectedIssuePayload)}` : ''}`}>
          {!selectedLog ? (
            <div className="empty-state">No log selected</div>
          ) : (
            <>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">{sourceLabels[selectedLog.source]}</p>
                  <h2>{selectedLog.eventType ?? 'Log entry'}</h2>
                </div>
                <div className="page-actions">
                  <button className="secondary-button" type="button" onClick={() => setShowRawJson((value) => !value)}>
                    <FileJson size={16} aria-hidden="true" />
                    <span>{showRawJson ? 'Hide Raw JSON' : 'Open Raw JSON'}</span>
                  </button>
                  <button className="secondary-button" type="button" onClick={() => void copyRawJson()}>
                    <Copy size={16} aria-hidden="true" />
                    <span>{copyState}</span>
                  </button>
                </div>
              </div>

              <div className="issue-meta-grid log-detail-grid">
                <div>
                  <FieldLabel
                    label="Session ID"
                    helpText="This is the test run that produced the selected log entry. The simulator shows it here so you can copy the exact run ID into notes or reports. If it is wrong, pick another session."
                  />
                  <strong>{selectedSessionId}</strong>
                </div>
                <div>
                  <FieldLabel
                    label="Game/build"
                    helpText="This is the game and build connected to the selected log. The simulator uses it to keep logs tied to the right test build. If it looks wrong, you may be reviewing the wrong saved run."
                  />
                  <strong>{gameBuildLabel(selectedSession)}</strong>
                </div>
                <div>
                  <FieldLabel label="Timestamp" />
                  <strong>{formatTimestamp(selectedLog.timestamp)}</strong>
                </div>
                <div>
                  <FieldLabel label="Bot" />
                  <strong>{selectedLog.botId ?? 'None'}</strong>
                </div>
                <div>
                  <FieldLabel label="Instance" />
                  <strong>{selectedLog.instanceId ?? 'None'}</strong>
                </div>
	                <div>
	                  <FieldLabel label="Source" />
	                  <strong>{sourceLabels[selectedLog.source]}</strong>
	                </div>
	                <div>
	                  <FieldLabel label="Raw File" />
	                  <strong>{typeof selectedLog.raw.bundleFile === 'string' ? selectedLog.raw.bundleFile : 'Original file not recorded'}</strong>
	                </div>
	              </div>

              <section className="detail-section">
                <h2>
                  <FieldLabel
                    label="Log Summary"
                    helpText="This is the short readable message for the selected log. The simulator uses it to explain the important part without making you read raw JSON first. If the summary is unclear, open Raw JSON below."
                  />
                </h2>
                <pre className="code-block">{selectedLog.summary}</pre>
              </section>

              {selectedActionPayload ? <ActionDecisionView payload={selectedActionPayload} /> : null}

              {selectedIssuePayload ? (
                <IssueDiagnosisView
                  onOpenEvidence={(path) => void openEvidence(path)}
                  onOpenIssue={openIssueDetail}
                  payload={selectedIssuePayload}
                />
              ) : null}

              {showRawJson ? (
                <section className="detail-section">
                  <h2>
                    <FieldLabel
                      label="Raw JSON"
                      helpText="This is the original structured data saved for the selected log. It is useful for advanced debugging or when a report needs exact values. Beginners can read the summary first and use this only when needed."
                    />
                  </h2>
                  <pre className="code-block code-block--tall">{JSON.stringify(selectedLog.raw, null, 2)}</pre>
                </section>
              ) : null}
            </>
          )}
        </article>
      </section>
    </section>
  );
}
