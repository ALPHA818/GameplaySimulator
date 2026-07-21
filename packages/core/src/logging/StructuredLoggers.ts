import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ActionResult,
  BotProfile,
  DetectedIssue,
  GameAction,
  GameInstanceStatus,
  GameProfile,
  GameStateSnapshot,
  RuntimeViabilityReport,
  SessionBundle,
  SessionBundlePaths,
  SessionLabel,
  SimulationRunConfig
} from '../types';
import { actionInsightFromAction, plannerMetadataForLog } from '../bot/ActionExplanation';

export type StructuredLogEventType =
  | 'session_start'
  | 'session_stop'
  | 'instance_start'
  | 'instance_stop'
  | 'instance_crash'
  | 'instance_health_warning'
  | 'instance_restart'
  | 'instance_save_isolation'
  | 'bot_start'
  | 'bot_stop'
  | 'action_performed'
  | 'state_snapshot'
  | 'issue_detected'
  | 'flow_started'
  | 'flow_step_started'
  | 'flow_step_succeeded'
  | 'flow_step_failed'
  | 'flow_completed'
  | 'flow_abandoned'
  | 'recovery_attempt'
  | 'recovery_success'
  | 'recovery_failed'
  | 'crash'
  | 'freeze'
  | 'manual_stop'
  | 'resource_warning';

export interface StructuredLogEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string;
  eventType: StructuredLogEventType;
  sessionId: string;
  timestamp: string;
  botId?: string;
  gameInstanceId?: string;
  payload: TPayload;
}

export interface StructuredRunLoggerOptions {
  rootDir: string;
  sessionId: string;
  createdAt: string;
  sessionDir?: string;
  now?: () => string;
}

export interface SessionConfigArtifact {
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
}

export interface BotReportInput {
  botId: string;
  displayName: string;
  profileId: string;
  playstyle?: string;
  status: string;
  actionCount: number;
  issueCount: number;
  lastActionId?: string;
  progressState?: string;
  currentArea?: string;
  stopReason?: string;
  areasVisited: string[];
  issues: DetectedIssue[];
  lastActions: string[];
  recoveryAttempts: unknown[];
  finalState?: unknown;
}

export interface SessionSummaryReportInput {
  status: string;
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  viabilityReport: RuntimeViabilityReport;
  bots: BotReportInput[];
  instances: GameInstanceStatus[];
  issues: DetectedIssue[];
  contentCoveragePercent: number;
  testedContent: string[];
  untestedContent: string[];
  contentWithIssues: string[];
  contentByBotType: string[];
  createdAt?: string;
  startedAt?: string;
  stoppedAt?: string;
  startupFlow?: {
    flowId: string;
    flowName: string;
    status: string;
    message?: string;
    startedAt?: string;
    completedAt?: string;
    timeoutMs?: number;
    issueId?: string;
    screenshotPath?: string;
    timeline?: Array<Record<string, unknown>>;
  };
}

interface StructuredLogFileSource {
  path: string;
  source: 'session' | 'bot-actions' | 'bot-states' | 'bot-issues' | 'instance';
  botId?: string;
  instanceId?: string;
}

export interface IssueReportContext {
  gameName?: string;
  gameEngine?: string;
  gameVersion?: string;
  gameBuild?: string;
  adapterType?: string;
}

export interface IssueEventLoggerContext extends IssueReportContext {
  botProfile?: BotProfile;
  lastAction?: GameAction | null;
  previousState?: GameStateSnapshot | null;
  currentState?: GameStateSnapshot | null;
  recoveryAttempts?: unknown[];
  isRepeated?: boolean;
}

export interface RichIssueEventPayload extends Record<string, unknown> {
  issueId: string;
  title: string;
  severity: string;
  category: string;
  confidence?: number;
  botId?: string;
  botProfile?: Record<string, unknown>;
  gameInstanceId?: string;
  sceneArea: string;
  lastAction?: string;
  last10Actions: string[];
  currentStateSummary?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  screenshotPath?: string;
  videoPath?: string;
  evidencePaths: string[];
  likelyCause: string;
  reproductionSteps: string[];
  recoveryAttempts: unknown[];
  occurrence: 'new' | 'repeated';
  summary: string;
  timeline: Array<Record<string, unknown>>;
  whyFlagged: {
    detectorName: string;
    detectorRule: string;
    triggeredData: unknown;
  };
  whatToCheckNext: string[];
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function appendJsonl(path: string, value: unknown): void {
  appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function writeJsonl(path: string, values: unknown[]): void {
  ensureDirectory(dirname(path));
  writeFileSync(path, values.map((value) => JSON.stringify(value)).join('\n') + (values.length > 0 ? '\n' : ''), 'utf8');
}

function timestampForFolder(timestamp: string): string {
  const parsed = new Date(timestamp);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}-${hh}-${min}-${ss}`;
}

function safePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function mdEscape(value: string | undefined): string {
  return value?.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|') ?? '';
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textOrNone(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null || value === '') {
    return 'None';
  }

  return String(value);
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim().length > 0)))].sort();
}

function bulletList(items: string[], empty = 'None'): string[] {
  if (items.length === 0) {
    return [`- ${empty}`];
  }

  return items.map((item) => `- ${item}`);
}

function markdownTable(headers: string[], rows: string[][], empty = 'None'): string[] {
  if (rows.length === 0) {
    return [`_${empty}_`];
  }

  return [
    `| ${headers.map((header) => mdEscape(header)).join(' |')} |`,
    `| ${headers.map(() => '---').join(' |')} |`,
    ...rows.map((row) => `| ${row.map((cell) => mdEscape(cell)).join(' |')} |`)
  ];
}

function countBy<T>(items: T[], keyFor: (item: T) => string | undefined): Array<[string, number]> {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = keyFor(item);

    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function formatDuration(startedAt?: string, stoppedAt?: string): string {
  if (!startedAt) {
    return 'Not started';
  }

  const start = Date.parse(startedAt);
  const end = stoppedAt ? Date.parse(stoppedAt) : Date.now();

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 'Unknown';
  }

  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function jsonBlock(value: unknown): string[] {
  return ['```json', JSON.stringify(value ?? null, null, 2), '```'];
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

function readJsonlRecords(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return isRecord(parsed) ? [parsed] : [];
      } catch {
        return [
          {
            eventType: 'invalid_json',
            line
          }
        ];
      }
    });
}

function sourcedJsonlRecords(source: StructuredLogFileSource): Array<Record<string, unknown>> {
  return readJsonlRecords(source.path).map((record) => ({
    bundleSource: source.source,
    bundleFile: source.path,
    botId: source.botId ?? stringValue(record.botId) ?? stringValue(record.action && isRecord(record.action) ? record.action.botId : undefined),
    gameInstanceId:
      source.instanceId ??
      stringValue(record.gameInstanceId) ??
      stringValue(record.action && isRecord(record.action) ? record.action.gameInstanceId : undefined),
    ...record
  }));
}

function isImportantStructuredEvent(record: Record<string, unknown>): boolean {
  const eventType = String(record.eventType ?? '').toLowerCase();
  const source = String(record.bundleSource ?? '').toLowerCase();
  const payload = isRecord(record.payload) ? record.payload : {};
  const payloadText = compactJson(payload).toLowerCase();

  return (
    source === 'bot-issues' ||
    eventType.includes('issue') ||
    eventType.includes('crash') ||
    eventType.includes('freeze') ||
    eventType.includes('failed') ||
    eventType.includes('warning') ||
    eventType.includes('resource') ||
    eventType.includes('recovery') ||
    eventType.includes('flow_') ||
    eventType.includes('instance_start') ||
    eventType.includes('instance_stop') ||
    eventType.includes('instance_crash') ||
    eventType.includes('instance_restart') ||
    eventType.includes('manual_stop') ||
    payloadText.includes('critical') ||
    payloadText.includes('error') ||
    payloadText.includes('warning') ||
    payloadText.includes('failed') ||
    payloadText.includes('stuck')
  );
}

function listFilesRecursive(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }

  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    const stats = statSync(child);
    return stats.isDirectory() ? listFilesRecursive(child) : [child];
  });
}

function copyIfExists(source: string, destination: string): void {
  if (!existsSync(source)) {
    return;
  }

  ensureDirectory(dirname(destination));
  copyFileSync(source, destination);
}

function bundleLabel(runConfig: SimulationRunConfig): SessionLabel {
  return runConfig.sessionLabel ?? 'Custom';
}

function recoveryAttempts(issue: DetectedIssue): unknown[] {
  const raw = issue.rawEvidence;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [];
  }

  const attempts = (raw as Record<string, unknown>).recoveryAttempts;
  return Array.isArray(attempts) ? attempts : [];
}

function reproductionSteps(issue: DetectedIssue): string[] {
  const actions = issue.lastActions.slice(-20);

  if (actions.length === 0) {
    return ['1. No action timeline was captured for this issue.'];
  }

  return actions.map((action, index) => `${index + 1}. Perform or replay action: ${action}`);
}

function issueArea(issue: DetectedIssue): string {
  return issue.scene ?? issue.area ?? 'Unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

interface ActionReportRow {
  timestamp: string;
  actionId: string;
  actionType: string;
  quality: string;
  result: string;
  explanation: string;
}

function actionReportRows(path: string): ActionReportRow[] {
  return readJsonlRecords(path).flatMap((record) => {
    const action = isRecord(record.action) ? record.action : undefined;

    if (!action) {
      return [];
    }

    const payload = isRecord(action.payload) ? action.payload : {};
    const result = isRecord(record.result) ? record.result : {};
    const actionType = stringValue(action.type) ?? 'unknown-action';
    const resultStatus = stringValue(result.status) ?? 'not-recorded';
    const resultMessage = stringValue(result.message);

    return [{
      timestamp: stringValue(record.timestamp) ?? stringValue(action.requestedAt) ?? 'Unknown',
      actionId: stringValue(action.actionId) ?? 'Unknown',
      actionType,
      quality: stringValue(payload.quality) ?? (payload.recovery === true ? 'recovery' : 'planned'),
      result: resultMessage ? `${resultStatus}: ${resultMessage}` : resultStatus,
      explanation:
        stringValue(payload.explanation) ??
        stringValue(payload.reason) ??
        `The bot chose ${actionType}; this older action did not record a full planner explanation.`
    }];
  });
}

function topRepeatedActionRows(actions: ActionReportRow[]): string[][] {
  const counts = new Map<string, number>();

  for (const action of actions) {
    counts.set(action.actionType, (counts.get(action.actionType) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([actionType, count]) => [actionType, String(count)]);
}

function rawEvidenceRecord(issue: DetectedIssue): Record<string, unknown> {
  return isRecord(issue.rawEvidence) ? issue.rawEvidence : {};
}

function detectorName(issue: DetectedIssue): string {
  const raw = rawEvidenceRecord(issue);
  const explicitName =
    stringValue(raw.detectorName) ??
    stringValue(raw.detectorId) ??
    stringValue(raw.detector) ??
    stringValue(raw.sourceDetector);

  if (explicitName) {
    return explicitName;
  }

  return `${issue.category.replace(/_/g, ' ')} detector`;
}

function detectorRule(issue: DetectedIssue): string {
  const raw = rawEvidenceRecord(issue);
  const explicitRule =
    stringValue(raw.detectorRule) ??
    stringValue(raw.rule) ??
    stringValue(raw.reason) ??
    stringValue(raw.stuckReason);

  if (explicitRule) {
    return explicitRule;
  }

  switch (issue.category) {
    case 'crash':
      return 'The game process, page, or adapter reported a crash or fatal error.';
    case 'hang':
      return 'The game was alive but stopped responding or stopped changing for too long.';
    case 'softlock':
      return 'The bot appeared unable to continue progression even though the game was still running.';
    case 'world_boundary':
      return 'The player position or scene state looked outside the expected playable bounds.';
    case 'exploit':
      return 'State changed in a way that could allow unintended rewards, progression, or resource gain.';
    case 'ui':
      return 'The UI state matched a broken, trapped, missing, or invalid interface pattern.';
    case 'quest':
      return 'Quest state or objective progress did not match expected progression rules.';
    case 'inventory':
      return 'Inventory state changed in an impossible or unsafe way.';
    case 'economy':
      return 'Currency, price, buy/sell, or reward data looked unsafe.';
    case 'performance':
      return 'Performance metrics crossed a configured warning or failure threshold.';
    default:
      return `The ${issue.category.replace(/_/g, ' ')} detector matched the saved state or action evidence.`;
  }
}

function likelyCause(issue: DetectedIssue): string {
  const raw = rawEvidenceRecord(issue);
  const explicitCause = stringValue(raw.likelyCause) ?? stringValue(raw.cause) ?? stringValue(raw.exploitType);

  if (explicitCause) {
    return explicitCause.replace(/_/g, ' ');
  }

  switch (issue.category) {
    case 'crash':
      return 'The game or adapter reported a crash. Check engine logs, console errors, and the action immediately before the issue.';
    case 'world_boundary':
      return 'Collision, level bounds, spawn placement, or movement handling may have allowed the player outside the playable space.';
    case 'softlock':
      return 'Progression, UI state, loading, or available actions may have reached a state with no safe way forward.';
    case 'exploit':
      return 'A state diff found a possible unintended reward, resource, flag, or progression change.';
    case 'ui':
      return 'The UI may be stuck, missing a usable control, or failing to close after the last action.';
    case 'quest':
      return 'Quest flags, objective updates, NPC availability, or turn-in logic may not match the expected flow.';
    case 'inventory':
      return 'Item quantities, equipment state, or inventory limits may have changed unexpectedly.';
    case 'economy':
      return 'Currency, pricing, reward, buy/sell, or crafting rules may allow an unsafe loop or invalid value.';
    case 'performance':
      return 'Runtime metrics suggest the scene, action, or instance created too much load.';
    default:
      return 'The detector matched saved evidence. Review the state, last action, and screenshot before confirming it is a bug.';
  }
}

function botProfileSummary(profile: BotProfile | undefined): Record<string, unknown> | undefined {
  if (!profile) {
    return undefined;
  }

  return {
    profileId: profile.profileId,
    displayName: profile.displayName,
    botType: profile.botType,
    playstyle: profile.playstyle,
    description: profile.description
  };
}

function lastActionText(issue: DetectedIssue, context: IssueEventLoggerContext): string | undefined {
  return context.lastAction?.type ?? issue.lastActions[issue.lastActions.length - 1];
}

function stateBeforeIssueSummary(context: IssueEventLoggerContext): string | undefined {
  const state = context.previousState ?? context.currentState;

  if (!state) {
    return undefined;
  }

  return compactJson({
    snapshotId: state.snapshotId,
    scene: state.scene,
    capturedAt: state.capturedAt,
    state: state.state,
    screenshotPath: state.screenshotPath
  }).slice(0, 2000);
}

function issueTimeline(issue: DetectedIssue, context: IssueEventLoggerContext): Array<Record<string, unknown>> {
  const action = context.lastAction;
  const state = context.previousState ?? context.currentState;
  const attempts = context.recoveryAttempts ?? recoveryAttempts(issue);
  const latestAttempt = attempts[attempts.length - 1];
  const screenshotEvidence = rawEvidenceRecord(issue).screenshotEvidence;

  return [
    {
      step: 'action_before_issue',
      label: 'Action before issue',
      timestamp: action?.requestedAt ?? issue.timestamp ?? issue.firstSeenAt,
      summary: action?.type ?? issue.lastActions[0] ?? 'No action captured',
      actionId: action?.actionId
    },
    {
      step: 'state_before_issue',
      label: 'State before issue',
      timestamp: state?.capturedAt ?? issue.timestamp ?? issue.firstSeenAt,
      summary: state ? stateBeforeIssueSummary(context) : issue.stateSummary ?? 'No state snapshot captured',
      snapshotId: state?.snapshotId
    },
    {
      step: 'issue_detected',
      label: 'Issue detected',
      timestamp: issue.timestamp ?? issue.firstSeenAt,
      summary: issue.title,
      severity: issue.severity,
      category: issue.category
    },
    {
      step: 'screenshot_captured',
      label: 'Screenshot captured',
      timestamp: isRecord(screenshotEvidence) ? stringValue(screenshotEvidence.capturedAt) : undefined,
      summary: issue.screenshotPath ? 'Screenshot evidence is attached.' : 'No screenshot evidence was captured.',
      screenshotPath: issue.screenshotPath
    },
    {
      step: 'recovery_attempted',
      label: 'Recovery attempted',
      summary: attempts.length > 0 ? `${attempts.length} recovery attempt(s) captured.` : 'No recovery attempts captured.',
      attempts
    },
    {
      step: 'recovery_result',
      label: 'Recovery result',
      summary: isRecord(latestAttempt)
        ? `Last recovery attempt: ${String(latestAttempt.recovered ?? latestAttempt.status ?? 'unknown')}`
        : 'No recovery result captured.',
      result: latestAttempt
    }
  ];
}

function whatToCheckNext(issue: DetectedIssue): string[] {
  const checks = [
    issue.screenshotPath ? `Open screenshot: ${issue.screenshotPath}` : 'Open screenshot if available after evidence capture.',
    'Inspect raw state in this log entry.',
    'Replay or read the action timeline before the issue.',
    'Compare with a previous run if this game build was tested before.',
    'Export a GitHub issue when the confidence and evidence look good.'
  ];

  if (issue.videoPath) {
    checks.unshift(`Open video evidence: ${issue.videoPath}`);
  }

  return checks;
}

function issueSummary(issue: DetectedIssue, context: IssueEventLoggerContext): string {
  const lastAction = lastActionText(issue, context) ?? 'no action captured';
  const confidence = issue.confidence === undefined ? 'unknown confidence' : `${Math.round(issue.confidence * 100)}% confidence`;
  const evidence = issue.screenshotPath ? ` Screenshot: ${issue.screenshotPath}.` : '';

  return `${issue.severity.toUpperCase()} ${issue.category}: ${issue.title} in ${issueArea(issue)} after ${lastAction}. ${confidence}.${evidence}`;
}

function buildIssueEventPayload(issue: DetectedIssue, context: IssueEventLoggerContext = {}): RichIssueEventPayload {
  const attempts = context.recoveryAttempts ?? recoveryAttempts(issue);

  return {
    issueId: issue.issueId,
    title: issue.title,
    severity: issue.severity,
    category: issue.category,
    confidence: issue.confidence,
    botId: issue.botId,
    botProfile: botProfileSummary(context.botProfile),
    gameInstanceId: issue.gameInstanceId ?? issue.instanceId,
    sceneArea: issueArea(issue),
    lastAction: lastActionText(issue, context),
    last10Actions: issue.lastActions.slice(-10),
    currentStateSummary: issue.stateSummary ?? stateBeforeIssueSummary(context),
    expectedBehavior: issue.expectedBehavior,
    actualBehavior: issue.actualBehavior ?? issue.description,
    screenshotPath: issue.screenshotPath,
    videoPath: issue.videoPath,
    evidencePaths: unique([issue.screenshotPath, issue.videoPath, ...(issue.evidencePaths ?? [])]),
    likelyCause: likelyCause(issue),
    reproductionSteps: reproductionSteps(issue),
    recoveryAttempts: attempts,
    occurrence: context.isRepeated ? 'repeated' : 'new',
    summary: issueSummary(issue, context),
    timeline: issueTimeline(issue, context),
    whyFlagged: {
      detectorName: detectorName(issue),
      detectorRule: detectorRule(issue),
      triggeredData: issue.rawEvidence ?? {
        stateSummary: issue.stateSummary,
        lastActions: issue.lastActions,
        severity: issue.severity,
        category: issue.category
      }
    },
    whatToCheckNext: whatToCheckNext(issue)
  };
}

export class IssueEventLogger {
  buildPayload(issue: DetectedIssue, context: IssueEventLoggerContext = {}): RichIssueEventPayload {
    return buildIssueEventPayload(issue, context);
  }

  enrichEvent(
    event: StructuredLogEvent,
    issue: DetectedIssue,
    context: IssueEventLoggerContext = {}
  ): StructuredLogEvent<RichIssueEventPayload> {
    return {
      ...event,
      payload: this.buildPayload(issue, context)
    };
  }
}

export class JsonlLogger {
  constructor(readonly filePath: string) {
    ensureDirectory(dirname(filePath));
    appendFileSync(filePath, '', 'utf8');
  }

  append(value: unknown): void {
    appendJsonl(this.filePath, value);
  }
}

export class SessionLogger {
  readonly sessionDir: string;
  readonly sessionLogPath: string;
  readonly summaryJsonPath: string;
  readonly summaryPath: string;
  readonly htmlReportPath: string;
  readonly configPath: string;
  readonly viabilityReportPath: string;
  readonly importantEventsPath: string;
  readonly fullStructuredLogsPath: string;
  readonly issuesJsonPath: string;
  readonly issueTimelinePath: string;
  readonly metadataPath: string;
  readonly screenshotsDir: string;
  readonly reportsDir: string;
  readonly exportsDir: string;
  readonly replayDir: string;

  private readonly logger: JsonlLogger;
  private readonly now: () => string;
  private sequence = 0;

  constructor(private readonly options: StructuredRunLoggerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.sessionDir = options.sessionDir ?? join(options.rootDir, `session-${timestampForFolder(options.createdAt)}`);
    this.sessionLogPath = join(this.sessionDir, 'session-log.jsonl');
    this.summaryJsonPath = join(this.sessionDir, 'session-summary.json');
    this.summaryPath = join(this.sessionDir, 'session-summary.md');
    this.htmlReportPath = join(this.sessionDir, 'session-report.html');
    this.configPath = join(this.sessionDir, 'config.json');
    this.viabilityReportPath = join(this.sessionDir, 'viability-report.json');
    this.importantEventsPath = join(this.sessionDir, 'important-events.jsonl');
    this.fullStructuredLogsPath = join(this.sessionDir, 'full-structured-logs.jsonl');
    this.issuesJsonPath = join(this.sessionDir, 'issues.json');
    this.issueTimelinePath = join(this.sessionDir, 'issue-timeline.json');
    this.metadataPath = join(this.sessionDir, 'metadata.json');
    this.screenshotsDir = join(this.sessionDir, 'screenshots');
    this.reportsDir = join(this.sessionDir, 'reports');
    this.exportsDir = join(this.sessionDir, 'exports');
    this.replayDir = join(this.sessionDir, 'replay');

    ensureDirectory(this.sessionDir);
    ensureDirectory(this.screenshotsDir);
    ensureDirectory(this.reportsDir);
    ensureDirectory(this.exportsDir);
    ensureDirectory(this.replayDir);
    this.logger = new JsonlLogger(this.sessionLogPath);
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  get createdAt(): string {
    return this.options.createdAt;
  }

  currentTimestamp(): string {
    return this.now();
  }

  log<TPayload extends Record<string, unknown>>(
    eventType: StructuredLogEventType,
    payload: TPayload,
    options: { botId?: string; gameInstanceId?: string; timestamp?: string } = {}
  ): StructuredLogEvent<TPayload> {
    this.sequence += 1;
    const event: StructuredLogEvent<TPayload> = {
      eventId: `${this.options.sessionId}-${String(this.sequence).padStart(6, '0')}`,
      eventType,
      sessionId: this.options.sessionId,
      timestamp: options.timestamp ?? this.now(),
      botId: options.botId,
      gameInstanceId: options.gameInstanceId,
      payload
    };

    this.logger.append(event);
    return event;
  }

  writeConfig(config: SessionConfigArtifact): void {
    writeJson(this.configPath, config);
  }

  writeViabilityReport(report: RuntimeViabilityReport): void {
    writeJson(this.viabilityReportPath, report);
  }

  writeSummary(input: SessionSummaryReportInput): void {
    const requestedBotRows = input.runConfig.botPools.map((pool) => [
      pool.profileId,
      pool.enabled ? 'yes' : 'no',
      String(pool.minCount),
      String(pool.desiredCount),
      String(pool.maxCount),
      pool.scalingMode,
      String(pool.priority),
      pool.resourceWeight
    ]);
    const actualBotRows = countBy(input.bots, (bot) => bot.profileId).map(([profileId, count]) => [
      profileId,
      String(count)
    ]);
    const issueSeverityRows = countBy(input.issues, (issue) => issue.severity).map(([severity, count]) => [
      severity,
      String(count)
    ]);
    const issueCategoryRows = countBy(input.issues, (issue) => issue.category).map(([category, count]) => [
      category,
      String(count)
    ]);
    const stuckBots = input.bots.filter((bot) =>
      bot.status === 'blocked' ||
      bot.status === 'waiting' ||
      bot.progressState?.toLowerCase().includes('stuck') === true ||
      bot.progressState?.toLowerCase().includes('recovery failed') === true
    );
    const crashedBotIds = unique(
      input.issues
        .filter((issue) => issue.category === 'crash')
        .map((issue) => issue.botId)
    );
    const manuallyStoppedBots = input.bots.filter((bot) =>
      bot.status === 'stopped' &&
      (bot.stopReason?.toLowerCase().includes('manual') === true ||
        bot.stopReason?.toLowerCase().includes('stop') === true)
    );
    const totalActions = input.bots.reduce((total, bot) => total + bot.actionCount, 0);
    const actionOutcomeRows = input.bots.map((bot) => {
      const actions = actionReportRows(join(this.sessionDir, 'bots', safePathSegment(bot.botId), 'actions.jsonl'));
      const failed = actions.filter((action) => action.result.startsWith('failed') || action.result.startsWith('timed_out')).length;
      const skipped = actions.filter((action) => action.result.startsWith('skipped')).length;
      const repeated = topRepeatedActionRows(actions).map(([actionType, count]) => `${actionType} (${count})`).join(', ');
      const lastAction = actions.at(-1);

      return [
        bot.botId,
        String(actions.length || bot.actionCount),
        String(failed),
        String(skipped),
        repeated || 'None',
        lastAction ? `${lastAction.actionType}: ${lastAction.explanation}` : 'None captured'
      ];
    });
    const gameBuild = input.gameProfile.buildId ?? 'Not specified';
    const engineVersion = input.gameProfile.engine.version ? ` ${input.gameProfile.engine.version}` : '';
    const saveIsolationRows = input.instances.map((instance) => [
      instance.instanceId,
      instance.saveIsolationMode ?? input.gameProfile.saveIsolation?.mode ?? 'none',
      instance.saveProfileId ?? 'Shared/default',
      instance.isolatedSaveDirectory ?? 'None',
      instance.saveIsolationCleanedUp ? 'yes' : 'no'
    ]);
    const startupTimelineRows = (input.startupFlow?.timeline ?? []).map((item) => [
      String(item.eventType ?? 'event'),
      String(item.stepId ?? item.completedStepId ?? item.lastStepId ?? item.flowId ?? ''),
      String(item.resultStatus ?? item.status ?? item.botStatus ?? ''),
      String(item.message ?? item.resultMessage ?? item.reason ?? ''),
      String(item.timestamp ?? '')
    ]);
    const lines = [
      `# GameplaySimulator Session: ${this.options.sessionId}`,
      '',
      `Status: ${input.status}`,
      `Game: ${input.gameProfile.gameName}`,
      `Engine: ${input.gameProfile.engine.type}${engineVersion}`,
      `Version: ${input.gameProfile.version}`,
      `Build: ${gameBuild}`,
      `Adapter: ${input.runConfig.adapterType}`,
      `Created: ${input.createdAt ?? 'Unknown'}`,
      `Started: ${input.startedAt ?? 'Not started'}`,
      `Stopped: ${input.stoppedAt ?? 'Not stopped'}`,
      `Total runtime: ${formatDuration(input.startedAt, input.stoppedAt)}`,
      '',
      '## Startup Flow',
      '',
      input.startupFlow
        ? `Flow: ${input.startupFlow.flowName} (${input.startupFlow.flowId})`
        : 'Flow: None configured',
      input.startupFlow ? `Status: ${input.startupFlow.status}` : 'Status: Not used',
      input.startupFlow ? `Message: ${input.startupFlow.message ?? 'None'}` : 'Message: None',
      input.startupFlow ? `Timeout: ${input.startupFlow.timeoutMs ?? 'Default'} ms` : 'Timeout: None',
      input.startupFlow ? `Issue: ${input.startupFlow.issueId ?? 'None'}` : 'Issue: None',
      input.startupFlow ? `Screenshot: ${input.startupFlow.screenshotPath ?? 'None'}` : 'Screenshot: None',
      '',
      '### Startup Flow Timeline',
      '',
      ...markdownTable(
        ['Event', 'Step', 'Status', 'Message', 'Timestamp'],
        startupTimelineRows,
        input.startupFlow ? 'No startup flow timeline events captured' : 'No startup flow configured'
      ),
      '',
      '## Bot Counts',
      '',
      '### Requested Bot Pools',
      '',
      ...markdownTable(
        ['Profile', 'Enabled', 'Min', 'Desired', 'Max', 'Scaling', 'Priority', 'Weight'],
        requestedBotRows,
        'No bot pools requested'
      ),
      '',
      '### Actual Bots Launched',
      '',
      ...markdownTable(['Profile', 'Actual count'], actualBotRows, 'No bots launched'),
      '',
      `Total bots: ${input.bots.length}`,
      `Game instances: ${input.instances.length}`,
      `Total actions: ${totalActions}`,
      `Total issues: ${input.issues.length}`,
      '',
      '## Save/Profile Isolation',
      '',
      `Configured mode: ${input.gameProfile.saveIsolation?.mode ?? 'none'}`,
      `Source save path: ${input.gameProfile.saveIsolation?.sourceSavePath ?? 'None'}`,
      `Working save root: ${input.gameProfile.saveIsolation?.workingSaveRoot ?? 'Default session saves folder'}`,
      '',
      ...markdownTable(
        ['Instance', 'Mode', 'Profile', 'Save path', 'Cleaned up'],
        saveIsolationRows,
        'No game instances planned'
      ),
      '',
      '## Resource Viability',
      '',
      `Can run: ${input.viabilityReport.canRun ? 'yes' : 'no'}`,
      `Recommended total bots: ${input.viabilityReport.recommendedTotalBots}`,
      `Recommended game instances: ${input.viabilityReport.recommendedGameInstances}`,
      `Estimated CPU: ${input.viabilityReport.estimatedCpuPercent}%`,
      `Estimated RAM: ${input.viabilityReport.estimatedRamMb} MB`,
      `Estimated GPU: ${
        input.viabilityReport.estimatedGpuPercent === undefined
          ? 'Not estimated'
          : `${input.viabilityReport.estimatedGpuPercent}%`
      }`,
      '',
      '### Warnings',
      '',
      ...bulletList(input.viabilityReport.warnings, 'No warnings'),
      '',
      '### Blockers',
      '',
      ...bulletList(input.viabilityReport.blockers, 'No blockers'),
      '',
      '### Bot Allocation',
      '',
      ...markdownTable(
        ['Profile', 'Requested', 'Recommended', 'Reason'],
        input.viabilityReport.botAllocation.map((allocation) => [
          allocation.profileId,
          String(allocation.requestedCount),
          String(allocation.recommendedCount),
          allocation.reason
        ]),
        'No allocation adjustments reported'
      ),
      '',
      '## Issues',
      '',
      '### Issues By Severity',
      '',
      ...markdownTable(['Severity', 'Count'], issueSeverityRows, 'No issues found'),
      '',
      '### Issues By Category',
      '',
      ...markdownTable(['Category', 'Count'], issueCategoryRows, 'No issues found'),
      '',
      '### Issue List',
      '',
      ...markdownTable(
        ['Severity', 'Category', 'Title', 'Bot', 'Area'],
        input.issues.map((issue) => [
          issue.severity,
          issue.category,
          issue.title,
          issue.botId ?? 'None',
          issueArea(issue)
        ]),
        'No issues found'
      ),
      '',
      '## Action Outcomes',
      '',
      ...markdownTable(
        ['Bot', 'Actions', 'Failed', 'Skipped', 'Top Repeated', 'Latest Explained Action'],
        actionOutcomeRows,
        'No bot actions captured'
      ),
      '',
      '## Bot Outcomes',
      '',
      '### Stuck Bots',
      '',
      ...bulletList(
        stuckBots.map((bot) => `${bot.botId}: ${bot.progressState ?? bot.status}`),
        'No stuck bots'
      ),
      '',
      '### Crashed Bots',
      '',
      ...bulletList(crashedBotIds, 'No crashed bots'),
      '',
      '### Manually Stopped Bots',
      '',
      ...bulletList(
        manuallyStoppedBots.map((bot) => `${bot.botId}: ${bot.stopReason ?? bot.status}`),
        'No manually stopped bots'
      ),
      '',
      '## Content Coverage',
      '',
      `Coverage: ${input.contentCoveragePercent}%`,
      '',
      '### Tested Content',
      '',
      ...bulletList(input.testedContent, 'No content coverage observed'),
      '',
      '### Untested Content',
      '',
      ...bulletList(input.untestedContent, 'No untested known content'),
      '',
      '### Content Tested By Bot Type',
      '',
      ...bulletList(input.contentByBotType, 'No bot-type coverage yet'),
      '',
      '### Content With Issues',
      '',
      ...bulletList(input.contentWithIssues, 'No issue-linked content'),
      '',
      `Session log: ${this.sessionLogPath}`,
      `Config: ${this.configPath}`,
      `Viability report: ${this.viabilityReportPath}`,
      `HTML report: ${this.htmlReportPath}`
    ];

    writeFileSync(this.summaryPath, `${lines.join('\n')}\n`, 'utf8');
    writeFileSync(
      this.htmlReportPath,
      [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${htmlEscape(input.gameProfile.gameName)} GameplaySimulator Report</title>`,
        '<style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#111114;color:#eef2f7;}main{max-width:1040px;margin:0 auto;padding:32px;}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;background:#191b20;border:1px solid #303541;border-radius:8px;padding:18px;}a{color:#5eead4;}</style>',
        '</head>',
        '<body>',
        '<main>',
        `<pre>${htmlEscape(lines.join('\n'))}</pre>`,
        '</main>',
        '</body>',
        '</html>'
      ].join('\n'),
      'utf8'
    );
    copyIfExists(this.summaryPath, join(this.reportsDir, 'session-summary.md'));
    copyIfExists(this.htmlReportPath, join(this.reportsDir, 'session-report.html'));
  }
}

export class BotLogger {
  readonly botDir: string;
  readonly actionsPath: string;
  readonly statesPath: string;
  readonly issuesPath: string;
  readonly reportPath: string;
  readonly screenshotsDir: string;
  readonly videoDir: string;

  private readonly actionsLogger: JsonlLogger;
  private readonly statesLogger: JsonlLogger;
  private readonly issuesLogger: JsonlLogger;

  constructor(sessionDir: string, readonly botId: string) {
    this.botDir = join(sessionDir, 'bots', safePathSegment(botId));
    this.actionsPath = join(this.botDir, 'actions.jsonl');
    this.statesPath = join(this.botDir, 'states.jsonl');
    this.issuesPath = join(this.botDir, 'issues.jsonl');
    this.reportPath = join(this.botDir, 'bot-report.md');
    this.screenshotsDir = join(this.botDir, 'screenshots');
    this.videoDir = join(this.botDir, 'video');

    ensureDirectory(this.screenshotsDir);
    ensureDirectory(this.videoDir);
    this.actionsLogger = new JsonlLogger(this.actionsPath);
    this.statesLogger = new JsonlLogger(this.statesPath);
    this.issuesLogger = new JsonlLogger(this.issuesPath);
  }

  logAction(event: StructuredLogEvent, action: GameAction, result?: ActionResult): void {
    const insight = actionInsightFromAction(action);

    this.actionsLogger.append({
      ...event,
      payload: {
        ...event.payload,
        actionId: action.actionId,
        actionType: action.type,
        status: result?.status,
        resultMessage: result?.message,
        actionQuality: insight?.quality,
        explanation: insight?.explanation,
        nextLikelyAction: insight?.nextLikelyAction,
        plannerMetadata: plannerMetadataForLog(action)
      },
      action,
      result
    });
  }

  logState(event: StructuredLogEvent, snapshot: GameStateSnapshot): void {
    this.statesLogger.append({
      ...event,
      snapshot
    });
  }

  logIssue(event: StructuredLogEvent, issue: DetectedIssue): void {
    this.issuesLogger.append({
      ...event,
      issue
    });
  }

  writeReport(input: BotReportInput): void {
    const actions = actionReportRows(this.actionsPath);
    const failedActions = actions.filter((action) => action.result.startsWith('failed') || action.result.startsWith('timed_out'));
    const skippedActions = actions.filter((action) => action.result.startsWith('skipped'));
    const lines = [
      `# Bot Report: ${this.botId}`,
      '',
      `Display name: ${input.displayName}`,
      `Bot ID: ${input.botId}`,
      `Pool type: ${input.profileId}`,
      `Playstyle: ${input.playstyle ?? 'Unknown'}`,
      `Status: ${input.status}`,
      `Stop reason: ${input.stopReason ?? input.progressState ?? 'Unknown'}`,
      `Actions performed: ${input.actionCount}`,
      `Issues found: ${input.issueCount}`,
      `Last action: ${input.lastActionId ?? 'None'}`,
      `Progress: ${input.progressState ?? 'Unknown'}`,
      `Current area: ${input.currentArea ?? 'Unknown'}`,
      '',
      '## Areas Visited',
      '',
      ...bulletList(input.areasVisited, 'No areas captured'),
      '',
      '## Recent Actions',
      '',
      ...bulletList(input.lastActions.slice(-20), 'No actions captured'),
      '',
      '## Action Timeline With Explanations',
      '',
      ...markdownTable(
        ['Time', 'Action', 'Quality', 'Result', 'Why'],
        actions.map((action) => [
          action.timestamp,
          action.actionType,
          action.quality,
          action.result,
          action.explanation
        ]),
        'No action timeline captured'
      ),
      '',
      '## Top Repeated Actions',
      '',
      ...markdownTable(['Action', 'Count'], topRepeatedActionRows(actions), 'No repeated actions'),
      '',
      '## Failed Actions',
      '',
      ...markdownTable(
        ['Time', 'Action', 'Result', 'Why'],
        failedActions.map((action) => [action.timestamp, action.actionType, action.result, action.explanation]),
        'No failed actions'
      ),
      '',
      '## Skipped Actions',
      '',
      ...markdownTable(
        ['Time', 'Action', 'Result', 'Why'],
        skippedActions.map((action) => [action.timestamp, action.actionType, action.result, action.explanation]),
        'No skipped actions'
      ),
      '',
      '## Issues Found',
      '',
      ...markdownTable(
        ['Severity', 'Category', 'Title', 'Area'],
        input.issues.map((issue) => [issue.severity, issue.category, issue.title, issueArea(issue)]),
        'No issues found'
      ),
      '',
      '## Recovery Attempts',
      '',
      ...(input.recoveryAttempts.length === 0
        ? bulletList([], 'No recovery attempts captured')
        : jsonBlock(input.recoveryAttempts)),
      '',
      '## Final State',
      '',
      ...jsonBlock(input.finalState ?? input.progressState ?? input.status),
      '',
      `Actions log: ${this.actionsPath}`,
      `States log: ${this.statesPath}`,
      `Issues log: ${this.issuesPath}`
    ];

    writeFileSync(this.reportPath, `${lines.join('\n')}\n`, 'utf8');
  }
}

export class IssueLogger {
  readonly issuesDir: string;

  constructor(sessionDir: string) {
    this.issuesDir = join(sessionDir, 'issues');
    ensureDirectory(this.issuesDir);
  }

  writeIssue(event: StructuredLogEvent, issue: DetectedIssue, index: number, context: IssueEventLoggerContext = {}): string {
    const issuePath = join(this.issuesDir, `issue-${String(index).padStart(3, '0')}.md`);
    const attempts = recoveryAttempts(issue);
    const lastActions = issue.lastActions.slice(-20);
    const issuePayload = buildIssueEventPayload(issue, context);
    const timelineRows = issuePayload.timeline.map((item) => [
      String(item.label ?? item.step ?? 'Unknown'),
      String(item.summary ?? 'No summary'),
      String(item.timestamp ?? 'No timestamp')
    ]);
    const lines = [
      `# ${issue.title}`,
      '',
      `Issue ID: ${issue.issueId}`,
      `Event ID: ${event.eventId}`,
      `Severity: ${issue.severity}`,
      `Category: ${issue.category}`,
      `Bot: ${issue.botId ?? 'None'}`,
      `Instance: ${issue.gameInstanceId ?? 'None'}`,
      `Scene/area: ${issueArea(issue)}`,
      `Game: ${context.gameName ?? 'Unknown'}`,
      `Engine: ${context.gameEngine ?? 'Unknown'}`,
      `Version: ${context.gameVersion ?? 'Unknown'}`,
      `Build: ${context.gameBuild ?? 'Not specified'}`,
      `Adapter: ${context.adapterType ?? 'Unknown'}`,
      `First seen: ${issue.firstSeenAt}`,
      `Last seen: ${issue.lastSeenAt ?? issue.firstSeenAt}`,
      `Confidence: ${issue.confidence !== undefined ? `${Math.round(issue.confidence * 100)}%` : 'Unknown'}`,
      '',
      issue.description ?? '',
      '',
      '## Steps To Reproduce',
      '',
      ...reproductionSteps(issue),
      '',
      '## Expected Behavior',
      '',
      issue.expectedBehavior ?? 'Not specified',
      '',
      '## Actual Behavior',
      '',
      issue.actualBehavior ?? issue.description ?? 'Not specified',
      '',
      '## Last 20 Actions',
      '',
      ...bulletList(lastActions, 'No actions captured'),
      '',
      '## State Summary',
      '',
      issue.stateSummary ?? 'No state summary captured',
      '',
      '## Likely Cause',
      '',
      issuePayload.likelyCause,
      '',
      '## Why This Was Flagged',
      '',
      `Detector: ${issuePayload.whyFlagged.detectorName}`,
      `Rule: ${issuePayload.whyFlagged.detectorRule}`,
      '',
      ...jsonBlock(issuePayload.whyFlagged.triggeredData),
      '',
      '## Issue Timeline',
      '',
      ...markdownTable(['Step', 'Summary', 'Timestamp'], timelineRows, 'No timeline captured'),
      '',
      '## What To Check Next',
      '',
      ...bulletList(issuePayload.whatToCheckNext, 'No follow-up checks captured'),
      '',
      '## Recovery Attempts',
      '',
      ...(attempts.length === 0 ? bulletList([], 'No recovery attempts captured') : jsonBlock(attempts)),
      '',
      '## Evidence',
      '',
      `Screenshot: ${issue.screenshotPath ?? 'None'}`,
      `Video: ${issue.videoPath ?? 'None'}`,
      '',
      '| Action Timeline IDs |',
      '| --- |',
      ...issue.actionTimelineIds.map((id) => `| ${mdEscape(id)} |`)
    ];

    writeFileSync(issuePath, `${lines.join('\n')}\n`, 'utf8');
    return issuePath;
  }
}

export class ActionTimelineLogger {
  constructor(private readonly botLoggers: Map<string, BotLogger>) {}

  logAction(event: StructuredLogEvent, action: GameAction, result?: ActionResult): void {
    this.botLoggers.get(action.botId)?.logAction(event, action, result);
  }
}

export class StateSnapshotLogger {
  constructor(private readonly botLoggers: Map<string, BotLogger>) {}

  logState(event: StructuredLogEvent, snapshot: GameStateSnapshot): void {
    if (snapshot.botId) {
      this.botLoggers.get(snapshot.botId)?.logState(event, snapshot);
    }
  }
}

export class InstanceLogger {
  readonly instanceDir: string;
  readonly logPath: string;
  private readonly logger: JsonlLogger;

  constructor(sessionDir: string, readonly instanceId: string) {
    this.instanceDir = join(sessionDir, 'instances', safePathSegment(instanceId));
    this.logPath = join(this.instanceDir, 'instance-log.jsonl');
    ensureDirectory(this.instanceDir);
    this.logger = new JsonlLogger(this.logPath);
  }

  log(event: StructuredLogEvent, status?: GameInstanceStatus): void {
    this.logger.append({
      ...event,
      status
    });
  }
}

export class StructuredRunLogger {
  readonly sessionLogger: SessionLogger;
  readonly issueLogger: IssueLogger;
  readonly issueEventLogger: IssueEventLogger;
  readonly actionTimelineLogger: ActionTimelineLogger;
  readonly stateSnapshotLogger: StateSnapshotLogger;

  private readonly botLoggers = new Map<string, BotLogger>();
  private readonly instanceLoggers = new Map<string, InstanceLogger>();

  constructor(options: StructuredRunLoggerOptions) {
    this.sessionLogger = new SessionLogger(options);
    this.issueLogger = new IssueLogger(this.sessionLogger.sessionDir);
    this.issueEventLogger = new IssueEventLogger();
    this.actionTimelineLogger = new ActionTimelineLogger(this.botLoggers);
    this.stateSnapshotLogger = new StateSnapshotLogger(this.botLoggers);
  }

  get sessionDir(): string {
    return this.sessionLogger.sessionDir;
  }

  get summaryPath(): string {
    return this.sessionLogger.summaryPath;
  }

  get sessionLogPath(): string {
    return this.sessionLogger.sessionLogPath;
  }

  get bundlePaths(): SessionBundlePaths {
    return this.bundlePathsForSession();
  }

  ensureBot(botId: string): BotLogger {
    const existing = this.botLoggers.get(botId);

    if (existing) {
      return existing;
    }

    const logger = new BotLogger(this.sessionDir, botId);
    this.botLoggers.set(botId, logger);
    return logger;
  }

  ensureInstance(instanceId: string): InstanceLogger {
    const existing = this.instanceLoggers.get(instanceId);

    if (existing) {
      return existing;
    }

    const logger = new InstanceLogger(this.sessionDir, instanceId);
    this.instanceLoggers.set(instanceId, logger);
    return logger;
  }

  writeConfig(config: SessionConfigArtifact): void {
    this.sessionLogger.writeConfig(config);
  }

  writeViabilityReport(report: RuntimeViabilityReport): void {
    this.sessionLogger.writeViabilityReport(report);
  }

  writeSummary(input: SessionSummaryReportInput): void {
    this.sessionLogger.writeSummary(input);
    this.writeSessionBundle(input);
  }

  logSession<TPayload extends Record<string, unknown>>(
    eventType: StructuredLogEventType,
    payload: TPayload,
    options: { botId?: string; gameInstanceId?: string; timestamp?: string } = {}
  ): StructuredLogEvent<TPayload> {
    return this.sessionLogger.log(eventType, payload, options);
  }

  logInstance(event: StructuredLogEvent, status?: GameInstanceStatus): void {
    if (event.gameInstanceId) {
      this.ensureInstance(event.gameInstanceId).log(event, status);
    }
  }

  logAction(event: StructuredLogEvent, action: GameAction, result?: ActionResult): void {
    this.ensureBot(action.botId);
    this.actionTimelineLogger.logAction(event, action, result);
  }

  logState(event: StructuredLogEvent, snapshot: GameStateSnapshot): void {
    if (snapshot.botId) {
      this.ensureBot(snapshot.botId);
    }

    this.stateSnapshotLogger.logState(event, snapshot);
  }

  logIssue(event: StructuredLogEvent, issue: DetectedIssue, index: number, context: IssueEventLoggerContext = {}): string {
    const richEvent = this.issueEventLogger.enrichEvent(event, issue, context);

    if (issue.botId) {
      this.ensureBot(issue.botId).logIssue(richEvent, issue);
    }

    return this.issueLogger.writeIssue(richEvent, issue, index, context);
  }

  writeBotReports(bots: BotReportInput[]): void {
    for (const bot of bots) {
      this.ensureBot(bot.botId).writeReport(bot);
    }
  }

  private bundlePathsForSession(): SessionBundlePaths {
    return {
      sessionDirectory: this.sessionDir,
      metadataJson: this.sessionLogger.metadataPath,
      summaryJson: this.sessionLogger.summaryJsonPath,
      summaryMarkdown: this.sessionLogger.summaryPath,
      importantEventsJsonl: this.sessionLogger.importantEventsPath,
      fullStructuredLogsJsonl: this.sessionLogger.fullStructuredLogsPath,
      issuesJson: this.sessionLogger.issuesJsonPath,
      issueTimelineJson: this.sessionLogger.issueTimelinePath,
      screenshotsDirectory: this.sessionLogger.screenshotsDir,
      reportsDirectory: this.sessionLogger.reportsDir,
      exportsDirectory: this.sessionLogger.exportsDir,
      replayDirectory: this.sessionLogger.replayDir
    };
  }

  private structuredLogSources(): StructuredLogFileSource[] {
    return [
      {
        path: this.sessionLogger.sessionLogPath,
        source: 'session'
      },
      ...[...this.botLoggers.values()].flatMap((logger): StructuredLogFileSource[] => [
        {
          path: logger.actionsPath,
          source: 'bot-actions',
          botId: logger.botId
        },
        {
          path: logger.statesPath,
          source: 'bot-states',
          botId: logger.botId
        },
        {
          path: logger.issuesPath,
          source: 'bot-issues',
          botId: logger.botId
        }
      ]),
      ...[...this.instanceLoggers.values()].map((logger): StructuredLogFileSource => ({
        path: logger.logPath,
        source: 'instance',
        instanceId: logger.instanceId
      }))
    ];
  }

  private writeSessionBundle(input: SessionSummaryReportInput): void {
    const paths = this.bundlePathsForSession();
    const fullLogs = this.structuredLogSources()
      .flatMap(sourcedJsonlRecords)
      .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')));
    const importantEvents = fullLogs.filter(isImportantStructuredEvent);
    const issueTimeline = input.issues.map((issue) => ({
      issueId: issue.issueId,
      title: issue.title,
      severity: issue.severity,
      category: issue.category,
      botId: issue.botId,
      gameInstanceId: issue.gameInstanceId ?? issue.instanceId,
      sceneArea: issueArea(issue),
      firstSeenAt: issue.firstSeenAt,
      lastSeenAt: issue.lastSeenAt,
      evidencePaths: unique([issue.screenshotPath, issue.videoPath, ...(issue.evidencePaths ?? [])]),
      timeline: buildIssueEventPayload(issue).timeline
    }));
    const actionTimeline = fullLogs
      .filter((event) => event.eventType === 'action_performed' || isRecord(event.action))
      .map((event) => ({
        eventId: event.eventId,
        timestamp: event.timestamp,
        botId: event.botId,
        gameInstanceId: event.gameInstanceId,
        actionId: stringValue(isRecord(event.action) ? event.action.actionId : undefined) ??
          stringValue(isRecord(event.payload) ? event.payload.actionId : undefined),
        actionType: stringValue(isRecord(event.action) ? event.action.type : undefined) ??
          stringValue(isRecord(event.payload) ? event.payload.actionType : undefined),
        status: stringValue(isRecord(event.result) ? event.result.status : undefined) ??
          stringValue(isRecord(event.payload) ? event.payload.status : undefined),
        quality: stringValue(isRecord(event.payload) ? event.payload.actionQuality : undefined) ??
          stringValue(isRecord(event.action) && isRecord(event.action.payload) ? event.action.payload.quality : undefined),
        explanation: stringValue(isRecord(event.payload) ? event.payload.explanation : undefined) ??
          stringValue(isRecord(event.action) && isRecord(event.action.payload) ? event.action.payload.explanation : undefined),
        nextLikelyAction: stringValue(isRecord(event.payload) ? event.payload.nextLikelyAction : undefined) ??
          stringValue(isRecord(event.action) && isRecord(event.action.payload) ? event.action.payload.nextLikelyAction : undefined),
        plannerMetadata: isRecord(event.payload) && isRecord(event.payload.plannerMetadata)
          ? event.payload.plannerMetadata
          : undefined
      }));
    const screenshotFiles = [...this.botLoggers.values()]
      .flatMap((logger) => listFilesRecursive(logger.screenshotsDir))
      .filter((path) => /\.(png|jpe?g|webp|gif|svg)$/i.test(path));
    const summaryJson = {
      sessionId: this.sessionLogger.sessionId,
      label: bundleLabel(input.runConfig),
      status: input.status,
      game: {
        gameId: input.gameProfile.gameId,
        gameName: input.gameProfile.gameName,
        version: input.gameProfile.version,
        buildId: input.gameProfile.buildId,
        engine: input.gameProfile.engine
      },
      adapterType: input.runConfig.adapterType,
      createdAt: input.createdAt,
      startedAt: input.startedAt,
      stoppedAt: input.stoppedAt,
      totalRuntime: formatDuration(input.startedAt, input.stoppedAt),
      counts: {
        bots: input.bots.length,
        instances: input.instances.length,
        issues: input.issues.length,
        totalLogs: fullLogs.length,
        importantEvents: importantEvents.length,
        screenshots: screenshotFiles.length
      },
      issuesBySeverity: Object.fromEntries(countBy(input.issues, (issue) => issue.severity)),
      issuesByCategory: Object.fromEntries(countBy(input.issues, (issue) => issue.category)),
      contentCoveragePercent: input.contentCoveragePercent,
      bundlePaths: paths
    };
    const bundle: SessionBundle = {
      schemaVersion: 1,
      sessionId: this.sessionLogger.sessionId,
      label: bundleLabel(input.runConfig),
      gameName: input.gameProfile.gameName,
      gameId: input.gameProfile.gameId,
      version: input.gameProfile.version,
      buildId: input.gameProfile.buildId,
      adapterType: input.runConfig.adapterType,
      status: input.status,
      createdAt: input.createdAt ?? this.sessionLogger.createdAt,
      startedAt: input.startedAt,
      stoppedAt: input.stoppedAt,
      generatedAt: this.sessionLogger.currentTimestamp(),
      paths,
      counts: {
        totalLogs: fullLogs.length,
        importantEvents: importantEvents.length,
        issues: input.issues.length,
        bots: input.bots.length,
        instances: input.instances.length,
        screenshots: screenshotFiles.length
      }
    };

    ensureDirectory(paths.screenshotsDirectory);
    ensureDirectory(paths.reportsDirectory);
    ensureDirectory(paths.exportsDirectory);
    ensureDirectory(paths.replayDirectory);
    writeJson(paths.summaryJson, summaryJson);
    writeJson(paths.issuesJson, input.issues);
    writeJson(paths.issueTimelineJson, issueTimeline);
    writeJson(join(paths.screenshotsDirectory, 'manifest.json'), {
      sessionId: bundle.sessionId,
      screenshots: screenshotFiles
    });
    writeJson(join(paths.replayDirectory, 'action-timeline.json'), {
      sessionId: bundle.sessionId,
      actions: actionTimeline
    });
    writeJson(paths.metadataJson, bundle);
    copyIfExists(paths.summaryJson, join(paths.reportsDirectory, 'session-summary.json'));
    writeJsonl(paths.fullStructuredLogsJsonl, fullLogs);
    writeJsonl(paths.importantEventsJsonl, importantEvents);
  }

  static directoryExists(path: string): boolean {
    return existsSync(path);
  }
}
