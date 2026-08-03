import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assertResolvedPathWithin } from '../security/pathContainment';
import type {
  ActionResult,
  BotDirectiveProgress,
  BotDirectiveEvent,
  BotProfile,
  BotTestDirective,
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
import { evaluateBotProfileCompatibility } from '../bot/BotProfileCompatibility';
import { defaultBotProfiles, TECHNICAL_BOT_PROFILE_IDS } from '../bot/defaultBotProfiles';
import { resolveRuntimeObservationConfig } from '../config/runtimeObservationConfig';

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
  | 'max_runtime_reached'
  | 'resource_warning'
  | 'visible_window_started'
  | 'visible_window_stopped'
  | 'observation_bot_changed'
  | 'observation_limit_reached'
  | 'adapter_request_timeout'
  | 'adapter_request_aborted'
  | 'adapter_response_too_large'
  | 'directive_created'
  | 'directive_queued'
  | 'directive_assigned'
  | 'directive_activated'
  | 'directive_action_selected'
  | 'directive_state_changed'
  | 'directive_condition_checked'
  | 'directive_evidence_captured'
  | 'directive_step_started'
  | 'directive_step_completed'
  | 'directive_step_failed'
  | 'directive_progress'
  | 'directive_succeeded'
  | 'directive_failed'
  | 'directive_unavailable'
  | 'directive_expired'
  | 'directive_cancelled'
  | 'directive_reassigned';

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
  saveActionTimeline?: boolean;
  saveStateSnapshots?: boolean;
}

export interface SessionConfigArtifact {
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  botProfiles?: BotProfile[];
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
  shutdownReason?: string;
  directives?: BotTestDirective[];
  directiveProgress?: BotDirectiveProgress[];
  directiveEvents?: BotDirectiveEvent[];
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
  actionSummaries?: Record<string, BotActionSummary>;
  screenshotCaptureScopes?: string[];
}

export interface BotActionSummary {
  total: number;
  failed: number;
  skipped: number;
  repeated: string[][];
  latest?: ActionReportRow;
  recent: ActionReportRow[];
}

function technicalTestReadiness(input: SessionSummaryReportInput) {
  const technicalIds = new Set<string>(TECHNICAL_BOT_PROFILE_IDS);
  const profilesById = new Map(defaultBotProfiles.map((profile) => [profile.profileId, profile]));

  return input.runConfig.botPools
    .filter((pool) => pool.enabled && pool.desiredCount > 0 && technicalIds.has(pool.profileId))
    .map((pool) => {
      const profile = profilesById.get(pool.profileId);
      const actualBots = input.bots.filter((bot) => bot.profileId === pool.profileId).length;
      if (!profile) {
        return {
          profileId: pool.profileId,
          profileName: pool.profileId,
          status: 'Unsupported',
          requestedBots: pool.desiredCount,
          actualBots,
          details: ['Technical profile definition was not available while generating the report.']
        };
      }

      const compatibility = evaluateBotProfileCompatibility(profile, input.gameProfile, input.runConfig);
      const details = [...compatibility.blockers, ...compatibility.warnings];
      if (actualBots === 0) details.push('No bot from this technical profile launched, so the test is incomplete.');

      return {
        profileId: pool.profileId,
        profileName: profile.displayName,
        status: compatibility.blockers.length > 0
          ? 'Unsupported'
          : compatibility.warnings.length > 0 || actualBots === 0
            ? 'Incomplete'
            : 'Supported',
        requestedBots: pool.desiredCount,
        actualBots,
        details
      };
    });
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
    eventType.includes('directive_') ||
    eventType.includes('recovery') ||
    eventType.includes('flow_') ||
    eventType.includes('instance_start') ||
    eventType.includes('instance_stop') ||
    eventType.includes('instance_crash') ||
    eventType.includes('instance_restart') ||
    eventType.includes('manual_stop') ||
    eventType.includes('max_runtime_reached') ||
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

export interface ActionReportRow {
  timestamp: string;
  actionId: string;
  actionType: string;
  quality: string;
  result: string;
  explanation: string;
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
  private pendingLines: string[] = [];
  private writeChain: Promise<void> = Promise.resolve();
  private drainScheduled = false;
  private writeError: unknown;

  constructor(readonly filePath: string) {
    ensureDirectory(dirname(filePath));
    if (!existsSync(filePath)) {
      writeFileSync(filePath, '', 'utf8');
    }
  }

  append(value: unknown): void {
    this.pendingLines.push(`${JSON.stringify(value)}\n`);
    if (!this.drainScheduled) {
      this.drainScheduled = true;
      queueMicrotask(() => this.drain());
    }
  }

  async flush(): Promise<void> {
    let observedChain: Promise<void>;
    do {
      this.drain();
      observedChain = this.writeChain;
      await observedChain;
    } while (this.pendingLines.length > 0 || observedChain !== this.writeChain);

    if (this.writeError) {
      const error = this.writeError;
      this.writeError = undefined;
      throw error;
    }
  }

  private drain(): void {
    this.drainScheduled = false;
    if (this.pendingLines.length === 0) {
      return;
    }

    const batch = this.pendingLines.join('');
    this.pendingLines = [];
    this.writeChain = this.writeChain
      .then(async () => {
        await appendFile(this.filePath, batch, 'utf8');
      })
      .catch((error: unknown) => {
        this.writeError ??= error;
      });
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
    const rootDir = resolve(options.rootDir);
    ensureDirectory(rootDir);
    this.sessionDir = assertResolvedPathWithin(
      rootDir,
      options.sessionDir ?? join(rootDir, `session-${safePathSegment(options.sessionId)}`),
      'Session directory',
      false
    );
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

    if (options.sessionDir) {
      ensureDirectory(this.sessionDir);
    } else {
      mkdirSync(this.sessionDir, { recursive: false });
    }
    ensureDirectory(this.screenshotsDir);
    ensureDirectory(this.reportsDir);
    ensureDirectory(this.exportsDir);
    if (options.saveActionTimeline !== false) {
      ensureDirectory(this.replayDir);
    }
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

  async flush(): Promise<void> {
    await this.logger.flush();
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
    const runtimeObservation = resolveRuntimeObservationConfig(input.runConfig);
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
    const actionTimelineEnabled = input.runConfig.saveActionTimeline;
    const stateSnapshotsEnabled = input.runConfig.saveStateSnapshots;
    const actionOutcomeRows = input.bots.map((bot) => {
      const summary = input.actionSummaries?.[bot.botId];
      const repeated = summary?.repeated
        .map(([actionType, count]) => `${actionType} (${count})`)
        .join(', ');
      const lastAction = summary?.latest;

      return [
        bot.botId,
        String(summary?.total ?? bot.actionCount),
        String(summary?.failed ?? 0),
        String(summary?.skipped ?? 0),
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
    const directiveRows = (input.directives ?? []).map((directive) => [
      directive.name,
      directive.directiveType,
      directive.directiveMode,
      directive.priority,
      directive.status,
      directive.target.allBots
        ? 'All bots'
        : [
            ...directive.target.botIds.map((value) => `Bot: ${value}`),
            ...directive.target.profileIds.map((value) => `Profile: ${value}`),
            ...directive.target.gameInstanceIds.map((value) => `Instance: ${value}`)
          ].join(', ')
    ]);
    const directiveProgressRows = (input.directiveProgress ?? []).map((progress) => [
      progress.directiveId,
      progress.botId,
      progress.instanceId,
      progress.status,
      String(progress.actionsAttempted),
      String(progress.attempts),
      progress.progressMessage ?? 'No progress message'
    ]);
    const technicalReadiness = technicalTestReadiness(input);
    const directivesById = new Map(
      (input.directives ?? []).map((directive) => [directive.directiveId, directive])
    );
    const userDirectedTestRows = (input.directiveProgress ?? []).map((progress) => {
      const directive = directivesById.get(progress.directiveId);
      const expectedConditionCount = Math.max(
        directive?.successConditions.length ?? 0,
        directive?.expectedState ? 1 : 0,
        directive?.targetScene || directive?.targetArea ? 1 : 0
      );
      const evidenceCount =
        (progress.screenshotPaths?.length ?? 0) + (progress.videoPaths?.length ?? 0);
      return [
        directive?.name ?? progress.directiveId,
        progress.botId,
        directive?.directiveMode ?? 'unknown',
        directive?.priority ?? 'unknown',
        progress.status,
        `${progress.actionsAttempted} (${progress.successfulActions ?? 0} succeeded, ${progress.failedActions ?? 0} failed)`,
        `${progress.conditionsMet?.length ?? 0}/${expectedConditionCount || 'manual'}`,
        String(progress.issueIds?.length ?? 0),
        evidenceCount > 0 ? `${evidenceCount} file(s)` : 'None'
      ];
    });
    const directiveTimelineRows = (input.directiveEvents ?? []).map((event) => [
      event.timestamp,
      directivesById.get(event.directiveId)?.name ?? event.directiveId,
      event.botId ?? 'Unassigned',
      event.eventType,
      String(event.payload.message ?? event.payload.summary ?? event.payload.condition ?? event.payload.action ?? '')
    ]);
    const directiveDetailLines = (input.directiveProgress ?? []).flatMap((progress) => {
      const directive = directivesById.get(progress.directiveId);
      return [
        `#### ${directive?.name ?? progress.directiveId} / ${progress.botId}`,
        '',
        `Result: ${progress.status}`,
        `Started: ${progress.startedAt ?? 'Not started'}`,
        `Ended: ${progress.completedAt ?? 'Not ended'}`,
        `Actions attempted: ${progress.actionsAttempted}`,
        `Matching actions: ${(progress.matchedActions ?? []).join(', ') || 'None'}`,
        `Unrelated actions: ${(progress.unrelatedActions ?? []).join(', ') || 'None'}`,
        `Successful actions: ${progress.successfulActions ?? 0}`,
        `Failed actions: ${progress.failedActions ?? 0}`,
        `Reached scenes: ${(progress.reachedScenes ?? []).join(', ') || 'None'}`,
        `Reached areas: ${(progress.reachedAreas ?? []).join(', ') || 'None'}`,
        `Observed state changes: ${(progress.observedStateChanges ?? []).join(' | ') || 'None'}`,
        `Conditions met: ${(progress.conditionsMet ?? []).join(' | ') || 'None'}`,
        `Issues discovered: ${(progress.issueIds ?? []).join(', ') || 'None'}`,
        `Screenshots: ${(progress.screenshotPaths ?? []).join(', ') || 'None'}`,
        `Videos: ${(progress.videoPaths ?? []).join(', ') || 'None'}`,
        `Failure reason: ${progress.failureReason ?? 'None'}`,
        ''
      ];
    });
    const lines = [
      `# GameplaySimulator Session: ${input.runConfig.sessionName ?? this.options.sessionId}`,
      '',
      `Session ID: ${this.options.sessionId}`,
      `Status: ${input.status}`,
      `Game: ${input.gameProfile.gameName}`,
      `Engine: ${input.gameProfile.engine.type}${engineVersion}`,
      `Version: ${input.gameProfile.version}`,
      `Build: ${gameBuild}`,
      `Adapter: ${input.runConfig.adapterType}`,
      `Observation mode: ${runtimeObservation.observationMode}`,
      `Visible gameplay: ${runtimeObservation.showBotGameplay ? 'yes' : 'no'}`,
      `Created: ${input.createdAt ?? 'Unknown'}`,
      `Started: ${input.startedAt ?? 'Not started'}`,
      `Stopped: ${input.stoppedAt ?? 'Not stopped'}`,
      `Shutdown reason: ${input.shutdownReason ?? 'None'}`,
      `Total runtime: ${formatDuration(input.startedAt, input.stoppedAt)}`,
      '',
      '## Live Observation',
      '',
      `Show bot gameplay: ${runtimeObservation.showBotGameplay ? 'yes' : 'no'}`,
      `Observation mode: ${runtimeObservation.observationMode}`,
      `Selected bot: ${runtimeObservation.selectedBotId ?? 'None'}`,
      `Bring game to front on action: ${runtimeObservation.bringGameToFrontOnAction ? 'yes' : 'no'}`,
      `Visible action delay: ${runtimeObservation.visibleActionDelayMs} ms`,
      `Show action information: ${runtimeObservation.showActionInformation ? 'yes' : 'no'}`,
      `Maximum visible game windows: ${runtimeObservation.maxVisibleGameWindows}`,
      '',
      '## Effective Session Settings',
      '',
      `Run until manually stopped: ${input.runConfig.runUntilStopped ? 'yes' : 'no'}`,
      `Maximum active runtime: ${
        input.runConfig.maxRuntimeMinutes === undefined
          ? 'No time limit'
          : `${input.runConfig.maxRuntimeMinutes} minute(s); paused time is excluded`
      }`,
      `Configured maximum actions per bot: ${input.runConfig.maxActionsPerBot ?? 'No action limit'}`,
      `Effective maximum actions per bot: ${
        input.runConfig.runUntilStopped
          ? 'Ignored while run-until-stopped is enabled'
          : input.runConfig.maxActionsPerBot ?? 'No action limit'
      }`,
      `Action timeline artifacts: ${actionTimelineEnabled ? 'enabled' : 'disabled'}`,
      `State snapshot artifacts: ${stateSnapshotsEnabled ? 'enabled' : 'disabled'}`,
      `Automatic bot-count scaling: ${input.runConfig.resourceLimits.allowAutoScaling ? 'enabled' : 'disabled'}`,
      `Screenshot evidence requested: ${input.runConfig.saveScreenshots ? 'yes' : 'no'}`,
      `Screenshot evidence required: ${input.runConfig.requireScreenshotEvidence ? 'yes' : 'no'}`,
      `Full-desktop capture consent: ${input.runConfig.allowFullDesktopCapture ? 'granted' : 'not granted'}`,
      `Actual screenshot capture scope: ${
        input.screenshotCaptureScopes?.length
          ? input.screenshotCaptureScopes.join(', ')
          : input.runConfig.saveScreenshots
            ? 'No screenshot captured'
            : 'Disabled'
      }`,
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
      '## User-Directed Tests',
      '',
      ...markdownTable(
        ['Direction', 'Bot', 'Mode', 'Priority', 'Result', 'Actions Used', 'Conditions Met', 'Issues Found', 'Evidence'],
        userDirectedTestRows,
        'No user-directed tests were assigned to bots'
      ),
      '',
      '### Directive Timeline',
      '',
      ...markdownTable(
        ['Time', 'Direction', 'Bot', 'Event', 'Details'],
        directiveTimelineRows,
        'No directive timeline events recorded'
      ),
      '',
      '### Directive Details',
      '',
      ...(directiveDetailLines.length > 0 ? directiveDetailLines : ['No directive details recorded']),
      '',
      '### Configured Directives',
      '',
      ...markdownTable(
        ['Name', 'Type', 'Mode', 'Priority', 'Status', 'Targets'],
        directiveRows,
        'No user test directives configured'
      ),
      '',
      '### Per-Bot Directive Progress',
      '',
      ...markdownTable(
        ['Directive', 'Bot', 'Instance', 'Status', 'Actions', 'Attempts', 'Progress'],
        directiveProgressRows,
        'No directive progress recorded'
      ),
      '',
      '## Technical Test Readiness',
      '',
      ...markdownTable(
        ['Profile', 'Status', 'Requested Bots', 'Actual Bots', 'Details'],
        technicalReadiness.map((item) => [
          item.profileName,
          item.status,
          String(item.requestedBots),
          String(item.actualBots),
          item.details.join(' ') || 'All declared technical requirements were available.'
        ]),
        'No specialized technical test profiles were requested'
      ),
      '',
      `Controlled network test confirmed: ${input.runConfig.technicalTesting?.controlledNetworkTestConfirmed ? 'yes' : 'no'}`,
      `Save migration test files: ${input.runConfig.technicalTesting?.saveMigrationTestPaths.length ?? 0}`,
      `Approved file test directories: ${input.runConfig.technicalTesting?.approvedFileTestDirectories.length ?? 0}`,
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
      `Recommended visible game instances: ${input.viabilityReport.observation.recommendedVisibleGameInstances}`,
      `Background game instances: ${input.viabilityReport.observation.backgroundGameInstances}`,
      `Observation CPU overhead: ${input.viabilityReport.observation.estimatedCpuPercent}%`,
      `Observation RAM overhead: ${input.viabilityReport.observation.estimatedRamMb} MB`,
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

  private readonly actionsLogger?: JsonlLogger;
  private readonly statesLogger?: JsonlLogger;
  private readonly issuesLogger: JsonlLogger;
  private readonly recentActions: ActionReportRow[] = [];
  private readonly actionCounts = new Map<string, number>();
  private totalActions = 0;
  private failedActionCount = 0;
  private skippedActionCount = 0;

  constructor(
    sessionDir: string,
    readonly botId: string,
    private readonly saveActionTimeline = true,
    private readonly saveStateSnapshots = true
  ) {
    this.botDir = join(sessionDir, 'bots', safePathSegment(botId));
    this.actionsPath = join(this.botDir, 'actions.jsonl');
    this.statesPath = join(this.botDir, 'states.jsonl');
    this.issuesPath = join(this.botDir, 'issues.jsonl');
    this.reportPath = join(this.botDir, 'bot-report.md');
    this.screenshotsDir = join(this.botDir, 'screenshots');
    this.videoDir = join(this.botDir, 'video');

    ensureDirectory(this.screenshotsDir);
    ensureDirectory(this.videoDir);
    if (saveActionTimeline) {
      this.actionsLogger = new JsonlLogger(this.actionsPath);
    }
    if (saveStateSnapshots) {
      this.statesLogger = new JsonlLogger(this.statesPath);
    }
    this.issuesLogger = new JsonlLogger(this.issuesPath);
  }

  logAction(event: StructuredLogEvent, action: GameAction, result?: ActionResult): void {
    const insight = actionInsightFromAction(action);
    const status = result?.status ?? 'not-recorded';
    const reportRow: ActionReportRow = {
      timestamp: event.timestamp,
      actionId: action.actionId,
      actionType: action.type,
      quality: insight?.quality ?? 'planned',
      result: result?.message ? `${status}: ${result.message}` : status,
      explanation:
        insight?.explanation ??
        `The bot chose ${action.type}; no detailed planner explanation was recorded.`
    };

    this.totalActions += 1;
    this.actionCounts.set(action.type, (this.actionCounts.get(action.type) ?? 0) + 1);
    if (status === 'failed' || status === 'timed_out') {
      this.failedActionCount += 1;
    }
    if (status === 'skipped') {
      this.skippedActionCount += 1;
    }
    this.recentActions.push(reportRow);
    if (this.recentActions.length > 100) {
      this.recentActions.splice(0, this.recentActions.length - 100);
    }

    this.actionsLogger?.append({
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
    this.statesLogger?.append({
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
    const actions = this.saveActionTimeline ? this.recentActions : [];
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
      ...(this.saveActionTimeline
        ? markdownTable(
            ['Time', 'Action', 'Quality', 'Result', 'Why'],
            actions.map((action) => [
              action.timestamp,
              action.actionType,
              action.quality,
              action.result,
              action.explanation
            ]),
            'No action timeline captured'
          )
        : ['Action timeline capture was disabled for this session.']),
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
      ...(this.saveActionTimeline
        ? [`Actions log: ${this.actionsPath}`]
        : ['Actions log: Disabled by session setting']),
      ...(this.saveStateSnapshots
        ? [`States log: ${this.statesPath}`]
        : ['States log: Disabled by session setting']),
      `Issues log: ${this.issuesPath}`
    ];

    writeFileSync(this.reportPath, `${lines.join('\n')}\n`, 'utf8');
  }

  getActionSummary(): BotActionSummary {
    return {
      total: this.totalActions,
      failed: this.failedActionCount,
      skipped: this.skippedActionCount,
      repeated: [...this.actionCounts.entries()]
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 10)
        .map(([actionType, count]) => [actionType, String(count)]),
      latest: this.recentActions.at(-1),
      recent: [...this.recentActions]
    };
  }

  async flush(): Promise<void> {
    await Promise.all([
      this.actionsLogger?.flush(),
      this.statesLogger?.flush(),
      this.issuesLogger.flush()
    ]);
  }
}

export class IssueLogger {
  readonly issuesDir: string;

  constructor(
    sessionDir: string,
    private readonly saveActionTimeline = true
  ) {
    this.issuesDir = join(sessionDir, 'issues');
    ensureDirectory(this.issuesDir);
  }

  writeIssue(event: StructuredLogEvent, issue: DetectedIssue, index: number, context: IssueEventLoggerContext = {}): string {
    const issuePath = join(this.issuesDir, `issue-${String(index).padStart(3, '0')}.md`);
    const attempts = recoveryAttempts(issue);
    const lastActions = issue.lastActions.slice(-20);
    const issuePayload = buildIssueEventPayload(issue, context);
    const screenshotEvidence = rawEvidenceRecord(issue).screenshotEvidence;
    const screenshotCaptureScope = isRecord(screenshotEvidence)
      ? stringValue(screenshotEvidence.captureScope)
      : undefined;
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
      `Screenshot capture scope: ${screenshotCaptureScope ?? 'Not recorded'}`,
      `Video: ${issue.videoPath ?? 'None'}`,
      ...(this.saveActionTimeline
        ? [
            '',
            '| Action Timeline IDs |',
            '| --- |',
            ...issue.actionTimelineIds.map((id) => `| ${mdEscape(id)} |`)
          ]
        : ['', 'Action timeline evidence was disabled for this session.'])
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

  async flush(): Promise<void> {
    await this.logger.flush();
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
  private readonly saveActionTimeline: boolean;
  private readonly saveStateSnapshots: boolean;
  private readonly fullStructuredLogsLogger: JsonlLogger;
  private readonly importantEventsLogger: JsonlLogger;
  private readonly replayActionLogger?: JsonlLogger;
  private totalLogCount = 0;
  private importantEventCount = 0;

  constructor(options: StructuredRunLoggerOptions) {
    this.saveActionTimeline = options.saveActionTimeline !== false;
    this.saveStateSnapshots = options.saveStateSnapshots !== false;
    this.sessionLogger = new SessionLogger(options);
    this.issueLogger = new IssueLogger(this.sessionLogger.sessionDir, this.saveActionTimeline);
    this.issueEventLogger = new IssueEventLogger();
    this.actionTimelineLogger = new ActionTimelineLogger(this.botLoggers);
    this.stateSnapshotLogger = new StateSnapshotLogger(this.botLoggers);
    this.fullStructuredLogsLogger = new JsonlLogger(this.sessionLogger.fullStructuredLogsPath);
    this.importantEventsLogger = new JsonlLogger(this.sessionLogger.importantEventsPath);
    this.replayActionLogger = this.saveActionTimeline
      ? new JsonlLogger(join(this.sessionLogger.replayDir, 'action-timeline.jsonl'))
      : undefined;
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

    const logger = new BotLogger(
      this.sessionDir,
      botId,
      this.saveActionTimeline,
      this.saveStateSnapshots
    );
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
    const actionSummaries = Object.fromEntries(
      [...this.botLoggers.entries()].map(([botId, logger]) => [botId, logger.getActionSummary()])
    );
    const enrichedInput = { ...input, actionSummaries };
    this.sessionLogger.writeSummary(enrichedInput);
    this.writeSessionBundle(enrichedInput);
  }

  logSession<TPayload extends Record<string, unknown>>(
    eventType: StructuredLogEventType,
    payload: TPayload,
    options: { botId?: string; gameInstanceId?: string; timestamp?: string } = {}
  ): StructuredLogEvent<TPayload> {
    const event = this.sessionLogger.log(eventType, payload, options);
    this.appendBundleRecord({ ...event }, 'session');
    return event;
  }

  logInstance(event: StructuredLogEvent, status?: GameInstanceStatus): void {
    if (event.gameInstanceId) {
      this.ensureInstance(event.gameInstanceId).log(event, status);
      this.appendBundleRecord({ ...event, status }, 'instance', undefined, event.gameInstanceId);
    }
  }

  logAction(event: StructuredLogEvent, action: GameAction, result?: ActionResult): void {
    this.ensureBot(action.botId);
    this.actionTimelineLogger.logAction(event, action, result);
    const record = { ...event, action, result };
    this.appendBundleRecord(record, 'bot-actions', action.botId, action.gameInstanceId);
    this.replayActionLogger?.append(record);
  }

  logState(event: StructuredLogEvent, snapshot: GameStateSnapshot): void {
    if (snapshot.botId) {
      this.ensureBot(snapshot.botId);
    }

    this.stateSnapshotLogger.logState(event, snapshot);
    this.appendBundleRecord(
      { ...event, snapshot },
      'bot-states',
      snapshot.botId,
      snapshot.gameInstanceId
    );
  }

  logIssue(event: StructuredLogEvent, issue: DetectedIssue, index: number, context: IssueEventLoggerContext = {}): string {
    const richEvent = this.issueEventLogger.enrichEvent(event, issue, context);

    if (issue.botId) {
      this.ensureBot(issue.botId).logIssue(richEvent, issue);
    }
    this.appendBundleRecord(
      { ...richEvent, issue },
      'bot-issues',
      issue.botId,
      issue.gameInstanceId ?? issue.instanceId
    );

    return this.issueLogger.writeIssue(richEvent, issue, index, context);
  }

  writeBotReports(bots: BotReportInput[]): void {
    for (const bot of bots) {
      this.ensureBot(bot.botId).writeReport(bot);
    }
  }

  async flush(): Promise<void> {
    await Promise.all([
      this.sessionLogger.flush(),
      this.fullStructuredLogsLogger.flush(),
      this.importantEventsLogger.flush(),
      this.replayActionLogger?.flush(),
      ...[...this.botLoggers.values()].map((logger) => logger.flush()),
      ...[...this.instanceLoggers.values()].map((logger) => logger.flush())
    ]);
  }

  private appendBundleRecord(
    record: Record<string, unknown>,
    source: StructuredLogFileSource['source'],
    botId?: string,
    instanceId?: string
  ): void {
    const bundled = {
      bundleSource: source,
      botId: botId ?? stringValue(record.botId),
      gameInstanceId: instanceId ?? stringValue(record.gameInstanceId),
      ...record
    };
    this.fullStructuredLogsLogger.append(bundled);
    this.totalLogCount += 1;
    if (isImportantStructuredEvent(bundled)) {
      this.importantEventsLogger.append(bundled);
      this.importantEventCount += 1;
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
      replayDirectory: this.saveActionTimeline ? this.sessionLogger.replayDir : undefined
    };
  }

  private writeSessionBundle(input: SessionSummaryReportInput): void {
    const paths = this.bundlePathsForSession();
    const runtimeObservation = resolveRuntimeObservationConfig(input.runConfig);
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
    const screenshotFiles = [...this.botLoggers.values()]
      .flatMap((logger) => listFilesRecursive(logger.screenshotsDir))
      .filter((path) => /\.(png|jpe?g|webp|gif|svg)$/i.test(path));
    const directivesById = new Map(
      (input.directives ?? []).map((directive) => [directive.directiveId, directive])
    );
    const userDirectedTests = (input.directiveProgress ?? []).map((progress) => ({
      directive: directivesById.get(progress.directiveId),
      assignedBot: progress.botId,
      gameInstanceId: progress.instanceId,
      startedAt: progress.startedAt,
      completedAt: progress.completedAt,
      actionsAttempted: progress.actionsAttempted,
      matchingActions: progress.matchedActions,
      unrelatedActions: progress.unrelatedActions ?? [],
      successfulActions: progress.successfulActions ?? 0,
      failedActions: progress.failedActions ?? 0,
      reachedScenes: progress.reachedScenes ?? [],
      reachedAreas: progress.reachedAreas ?? [],
      observedStateChanges: progress.observedStateChanges ?? [],
      conditionsMet: progress.conditionsMet ?? [],
      issuesDiscovered: progress.issueIds ?? [],
      screenshots: progress.screenshotPaths ?? [],
      videos: progress.videoPaths ?? [],
      finalResult: progress.status,
      failureReason: progress.failureReason
    }));
    const technicalReadiness = technicalTestReadiness(input);
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
      runtimeObservation,
      effectiveSettings: {
        runUntilStopped: input.runConfig.runUntilStopped,
        maxRuntimeMinutes: input.runConfig.maxRuntimeMinutes ?? null,
        runtimeClock: 'active-running-time',
        configuredMaxActionsPerBot: input.runConfig.maxActionsPerBot ?? null,
        effectiveMaxActionsPerBot: input.runConfig.runUntilStopped
          ? null
          : input.runConfig.maxActionsPerBot ?? null,
        saveActionTimeline: input.runConfig.saveActionTimeline,
        saveStateSnapshots: input.runConfig.saveStateSnapshots,
        allowAutoScaling: input.runConfig.resourceLimits.allowAutoScaling,
        saveScreenshots: input.runConfig.saveScreenshots,
        requireScreenshotEvidence: input.runConfig.requireScreenshotEvidence,
        allowFullDesktopCapture: input.runConfig.allowFullDesktopCapture,
        screenshotCaptureScopes: input.screenshotCaptureScopes ?? []
      },
      directives: input.directives ?? [],
      directiveProgress: input.directiveProgress ?? [],
      directiveTimeline: input.directiveEvents ?? [],
      userDirectedTests,
      technicalTesting: {
        config: input.runConfig.technicalTesting,
        readiness: technicalReadiness
      },
      createdAt: input.createdAt,
      startedAt: input.startedAt,
      stoppedAt: input.stoppedAt,
      shutdownReason: input.shutdownReason,
      totalRuntime: formatDuration(input.startedAt, input.stoppedAt),
      counts: {
        bots: input.bots.length,
        instances: input.instances.length,
        issues: input.issues.length,
        totalLogs: this.totalLogCount,
        importantEvents: this.importantEventCount,
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
      runtimeObservation,
      status: input.status,
      createdAt: input.createdAt ?? this.sessionLogger.createdAt,
      startedAt: input.startedAt,
      stoppedAt: input.stoppedAt,
      generatedAt: this.sessionLogger.currentTimestamp(),
      paths,
      counts: {
        totalLogs: this.totalLogCount,
        importantEvents: this.importantEventCount,
        issues: input.issues.length,
        bots: input.bots.length,
        instances: input.instances.length,
        screenshots: screenshotFiles.length
      }
    };

    ensureDirectory(paths.screenshotsDirectory);
    ensureDirectory(paths.reportsDirectory);
    ensureDirectory(paths.exportsDirectory);
    if (paths.replayDirectory) {
      ensureDirectory(paths.replayDirectory);
    }
    writeJson(paths.summaryJson, summaryJson);
    writeJson(paths.issuesJson, input.issues);
    writeJson(paths.issueTimelineJson, issueTimeline);
    writeJson(join(paths.sessionDirectory, 'user-directed-tests.json'), userDirectedTests);
    writeJson(join(paths.sessionDirectory, 'directive-timeline.json'), input.directiveEvents ?? []);
    writeJson(join(paths.screenshotsDirectory, 'manifest.json'), {
      sessionId: bundle.sessionId,
      screenshots: screenshotFiles
    });
    writeJson(paths.metadataJson, bundle);
    copyIfExists(paths.summaryJson, join(paths.reportsDirectory, 'session-summary.json'));
  }

  static directoryExists(path: string): boolean {
    return existsSync(path);
  }
}
