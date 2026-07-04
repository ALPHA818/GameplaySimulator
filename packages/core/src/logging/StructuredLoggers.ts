import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ActionResult,
  DetectedIssue,
  GameAction,
  GameInstanceStatus,
  GameProfile,
  GameStateSnapshot,
  RuntimeViabilityReport,
  SimulationRunConfig
} from '../types';

export type StructuredLogEventType =
  | 'session_start'
  | 'session_stop'
  | 'instance_start'
  | 'instance_stop'
  | 'bot_start'
  | 'bot_stop'
  | 'action_performed'
  | 'state_snapshot'
  | 'issue_detected'
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
}

export interface IssueReportContext {
  gameName?: string;
  gameEngine?: string;
  gameVersion?: string;
  gameBuild?: string;
  adapterType?: string;
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
  readonly summaryPath: string;
  readonly htmlReportPath: string;
  readonly configPath: string;
  readonly viabilityReportPath: string;

  private readonly logger: JsonlLogger;
  private readonly now: () => string;
  private sequence = 0;

  constructor(private readonly options: StructuredRunLoggerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.sessionDir = join(options.rootDir, `session-${timestampForFolder(options.createdAt)}`);
    this.sessionLogPath = join(this.sessionDir, 'session-log.jsonl');
    this.summaryPath = join(this.sessionDir, 'session-summary.md');
    this.htmlReportPath = join(this.sessionDir, 'session-report.html');
    this.configPath = join(this.sessionDir, 'config.json');
    this.viabilityReportPath = join(this.sessionDir, 'viability-report.json');

    ensureDirectory(this.sessionDir);
    this.logger = new JsonlLogger(this.sessionLogPath);
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
    const gameBuild = input.gameProfile.buildId ?? 'Not specified';
    const engineVersion = input.gameProfile.engine.version ? ` ${input.gameProfile.engine.version}` : '';
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
    this.actionsLogger.append({
      ...event,
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

  writeIssue(event: StructuredLogEvent, issue: DetectedIssue, index: number, context: IssueReportContext = {}): string {
    const issuePath = join(this.issuesDir, `issue-${String(index).padStart(3, '0')}.md`);
    const attempts = recoveryAttempts(issue);
    const lastActions = issue.lastActions.slice(-20);
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
  readonly actionTimelineLogger: ActionTimelineLogger;
  readonly stateSnapshotLogger: StateSnapshotLogger;

  private readonly botLoggers = new Map<string, BotLogger>();
  private readonly instanceLoggers = new Map<string, InstanceLogger>();

  constructor(options: StructuredRunLoggerOptions) {
    this.sessionLogger = new SessionLogger(options);
    this.issueLogger = new IssueLogger(this.sessionLogger.sessionDir);
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

  logIssue(event: StructuredLogEvent, issue: DetectedIssue, index: number, context: IssueReportContext = {}): string {
    if (issue.botId) {
      this.ensureBot(issue.botId).logIssue(event, issue);
    }

    return this.issueLogger.writeIssue(event, issue, index, context);
  }

  writeBotReports(bots: BotReportInput[]): void {
    for (const bot of bots) {
      this.ensureBot(bot.botId).writeReport(bot);
    }
  }

  static directoryExists(path: string): boolean {
    return existsSync(path);
  }
}
