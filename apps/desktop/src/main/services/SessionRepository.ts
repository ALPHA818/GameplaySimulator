import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
  BotProfile,
  DetectedIssue,
  GameAction,
  GameInstanceStatus,
  GameProfile,
  GameStateSnapshot,
  RuntimeViabilityReport,
  SimulationRunConfig
} from '@core/types';
import {
  DetectedIssueSchema,
  GameProfileSchema,
  RuntimeViabilityReportSchema,
  SimulationRunConfigSchema
} from '@core/types';
import type { LogEntry } from '@core/logging/LogEntry';
import type { ContentCoverageSummary } from '@core/coverage/CoverageTracker';
import type { SimulationBotStatus, SimulationRuntimeStatus } from './simulationService';

export interface SessionIssueCounts {
  total: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface SessionBotCounts {
  requested: number;
  actual: number;
  running: number;
  stopped: number;
  stuck: number;
}

export interface SessionReportPaths {
  sessionDirectory: string;
  summaryMarkdown?: string;
  htmlReport?: string;
  sessionLog?: string;
  config?: string;
  viabilityReport?: string;
  githubExportDirectory?: string;
}

export interface PersistedSessionMetadata {
  sessionId: string;
  gameName: string;
  gameId?: string;
  version?: string;
  buildId?: string;
  engineType?: string;
  adapterType?: string;
  runMode?: string;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  status: SimulationRuntimeStatus;
  issueCounts: SessionIssueCounts;
  botCounts: SessionBotCounts;
  coveragePercentage?: number;
  reportPaths: SessionReportPaths;
}

export interface PersistedSessionArtifacts {
  metadata: PersistedSessionMetadata;
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  viabilityReport: RuntimeViabilityReport;
  botStatuses: SimulationBotStatus[];
  instanceStatuses: GameInstanceStatus[];
  issues: DetectedIssue[];
  logs: LogEntry[];
  coverageSummary?: ContentCoverageSummary;
  actions: GameAction[];
  states: GameStateSnapshot[];
  botProfiles: BotProfile[];
}

export interface SessionRepositoryWriteInput {
  sessionDir: string;
  sessionId: string;
  gameProfile: GameProfile;
  runConfig: SimulationRunConfig;
  status: SimulationRuntimeStatus;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  issues: DetectedIssue[];
  botStatuses: SimulationBotStatus[];
  coverageSummary?: ContentCoverageSummary;
  reportPaths: SessionReportPaths;
}

interface SessionConfigArtifact {
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function readJsonFileIfExists(path: string): unknown | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  return readJsonFile(path);
}

function readJsonl(path: string): Record<string, unknown>[] {
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
        return [];
      }
    });
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function countBy(items: DetectedIssue[], keyFor: (issue: DetectedIssue) => string | undefined): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of items) {
    const key = keyFor(item);

    if (key) {
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  return counts;
}

function issueId(issue: DetectedIssue): string {
  return issue.id ?? issue.issueId;
}

function issueCounts(issues: DetectedIssue[]): SessionIssueCounts {
  return {
    total: issues.length,
    bySeverity: countBy(issues, (issue) => issue.severity),
    byCategory: countBy(issues, (issue) => issue.category)
  };
}

function botCounts(runConfig: SimulationRunConfig, botStatuses: SimulationBotStatus[]): SessionBotCounts {
  const requested = runConfig.botPools.reduce((total, pool) => total + (pool.enabled ? pool.desiredCount : 0), 0);

  return {
    requested,
    actual: botStatuses.length,
    running: botStatuses.filter((bot) => bot.status === 'running').length,
    stopped: botStatuses.filter((bot) => ['stopped', 'completed'].includes(bot.status)).length,
    stuck: botStatuses.filter((bot) =>
      bot.status === 'blocked' ||
      bot.status === 'failed' ||
      bot.progressState.toLowerCase().includes('stuck') ||
      bot.progressState.toLowerCase().includes('recovery failed')
    ).length
  };
}

function latestTimestamp(events: Record<string, unknown>[], eventType: string): string | undefined {
  return events
    .filter((event) => event.eventType === eventType && typeof event.timestamp === 'string')
    .map((event) => String(event.timestamp))
    .sort()
    .at(-1);
}

function statusFromEvents(events: Record<string, unknown>[], fallback: SimulationRuntimeStatus): SimulationRuntimeStatus {
  const finalEvent = [...events].reverse().find((event) =>
    ['session_stop', 'manual_stop', 'crash', 'freeze'].includes(String(event.eventType ?? ''))
  );

  if (!finalEvent) {
    return fallback;
  }

  if (finalEvent.eventType === 'session_stop' || finalEvent.eventType === 'manual_stop') {
    return 'stopped';
  }

  return 'failed';
}

function logLevelForEvent(event: Record<string, unknown>): LogEntry['level'] {
  const type = String(event.eventType ?? '');

  if (type.includes('crash') || type.includes('failed') || type.includes('issue_detected')) {
    return 'error';
  }

  if (type.includes('warning') || type.includes('manual_stop') || type.includes('resource')) {
    return 'warn';
  }

  return 'info';
}

function logMessageForEvent(event: Record<string, unknown>): string {
  const payload = isRecord(event.payload) ? event.payload : {};
  const title = typeof payload.title === 'string' ? payload.title : undefined;
  const issueId = typeof payload.issueId === 'string' ? payload.issueId : undefined;
  const status = typeof payload.status === 'string' ? payload.status : undefined;
  const reason = typeof payload.reason === 'string' ? payload.reason : undefined;

  return [String(event.eventType ?? 'event'), title, issueId, status, reason].filter(Boolean).join(' · ');
}

function logEntriesFromEvents(events: Record<string, unknown>[], sessionId: string): LogEntry[] {
  return events.map((event, index) => ({
    id: typeof event.eventId === 'string' ? event.eventId : `${sessionId}-persisted-log-${index + 1}`,
    level: logLevelForEvent(event),
    message: logMessageForEvent(event),
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : new Date(0).toISOString(),
    source: typeof event.botId === 'string'
      ? `bot:${event.botId}`
      : typeof event.gameInstanceId === 'string'
        ? `instance:${event.gameInstanceId}`
        : 'persisted-session'
  }));
}

function parseBotReport(path: string, botId: string): Partial<SimulationBotStatus> & { actionCount?: number } {
  if (!existsSync(path)) {
    return {};
  }

  const values: Record<string, string> = {};

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^(Display name|Pool type|Playstyle|Status|Progress|Current area|Actions performed):\s*(.*)$/.exec(line);

    if (match) {
      values[match[1]] = match[2];
    }
  }

  return {
    botId,
    displayName: values['Display name'],
    profileId: values['Pool type'],
    playstyle: values.Playstyle,
    status: values.Status as SimulationBotStatus['status'] | undefined,
    progressState: values.Progress,
    currentArea: values['Current area'],
    actionCount: Number(values['Actions performed']) || undefined
  };
}

function safeBotStatusStatus(value: unknown): SimulationBotStatus['status'] {
  const status = typeof value === 'string' ? value : 'stopped';
  return [
    'queued',
    'starting',
    'running',
    'waiting',
    'blocked',
    'completed',
    'failed',
    'stopped'
  ].includes(status)
    ? status as SimulationBotStatus['status']
    : 'stopped';
}

function cloneIssue(issue: DetectedIssue): DetectedIssue {
  return {
    ...issue,
    lastActions: [...(issue.lastActions ?? [])],
    evidencePaths: [...(issue.evidencePaths ?? [])],
    actionTimelineIds: [...(issue.actionTimelineIds ?? [])]
  };
}

function reportPathsFor(sessionDir: string): SessionReportPaths {
  const githubExportDirectory = join(sessionDir, 'github-issues');

  return {
    sessionDirectory: sessionDir,
    summaryMarkdown: existsSync(join(sessionDir, 'session-summary.md')) ? join(sessionDir, 'session-summary.md') : undefined,
    htmlReport: existsSync(join(sessionDir, 'session-report.html')) ? join(sessionDir, 'session-report.html') : undefined,
    sessionLog: existsSync(join(sessionDir, 'session-log.jsonl')) ? join(sessionDir, 'session-log.jsonl') : undefined,
    config: existsSync(join(sessionDir, 'config.json')) ? join(sessionDir, 'config.json') : undefined,
    viabilityReport: existsSync(join(sessionDir, 'viability-report.json')) ? join(sessionDir, 'viability-report.json') : undefined,
    githubExportDirectory: existsSync(githubExportDirectory) ? githubExportDirectory : undefined
  };
}

export class SessionRepository {
  constructor(private readonly runsRoot: string) {
    mkdirSync(this.runsRoot, { recursive: true });
  }

  listSessionDirectories(): string[] {
    return readdirSync(this.runsRoot)
      .map((name) => join(this.runsRoot, name))
      .filter((path) => {
        try {
          return statSync(path).isDirectory() && existsSync(join(path, 'config.json'));
        } catch {
          return false;
        }
      })
      .sort();
  }

  listSessions(): PersistedSessionMetadata[] {
    return this.listSessionDirectories()
      .flatMap((sessionDir) => {
        try {
          return [this.loadSession(sessionDir).metadata];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  writeSessionMetadata(input: SessionRepositoryWriteInput): PersistedSessionMetadata {
    const metadata: PersistedSessionMetadata = {
      sessionId: input.sessionId,
      gameName: input.gameProfile.gameName,
      gameId: input.gameProfile.gameId,
      version: input.gameProfile.version,
      buildId: input.gameProfile.buildId,
      engineType: input.gameProfile.engine.type,
      adapterType: input.runConfig.adapterType,
      runMode: input.runConfig.runMode,
      createdAt: input.createdAt,
      startedAt: input.startedAt,
      stoppedAt: input.stoppedAt,
      status: input.status,
      issueCounts: issueCounts(input.issues),
      botCounts: botCounts(input.runConfig, input.botStatuses),
      coveragePercentage: input.coverageSummary?.percentage,
      reportPaths: input.reportPaths
    };

    writeJson(join(input.sessionDir, 'session.json'), metadata);
    return metadata;
  }

  loadSession(sessionDirOrId: string): PersistedSessionArtifacts {
    const sessionDir = this.resolveSessionDir(sessionDirOrId);
    const config = this.readConfig(sessionDir);
    const viabilityReport = RuntimeViabilityReportSchema.parse(
      readJsonFileIfExists(join(sessionDir, 'viability-report.json')) ?? {
        canRun: true,
        recommendedTotalBots: 0,
        recommendedGameInstances: 0,
        warnings: [],
        blockers: [],
        estimatedCpuPercent: 0,
        estimatedRamMb: 0,
        botAllocation: []
      }
    );
    const sessionEvents = readJsonl(join(sessionDir, 'session-log.jsonl'));
    const issues = this.readIssues(sessionDir);
    const botStatuses = this.readBotStatuses(sessionDir, config.runConfig, issues);
    const instanceStatuses = this.readInstanceStatuses(sessionDir, config.runConfig, config.gameProfile);
    const metadata = this.readMetadata(sessionDir, config, viabilityReport, issues, botStatuses, sessionEvents);
    const actions = this.readActions(sessionDir);
    const states = this.readStates(sessionDir);

    return {
      metadata,
      runConfig: config.runConfig,
      gameProfile: config.gameProfile,
      viabilityReport,
      botStatuses,
      instanceStatuses,
      issues,
      logs: logEntriesFromEvents(sessionEvents, metadata.sessionId),
      coverageSummary: undefined,
      actions,
      states,
      botProfiles: []
    };
  }

  resolveSessionDir(sessionDirOrId: string): string {
    if (existsSync(sessionDirOrId)) {
      return sessionDirOrId;
    }

    for (const dir of this.listSessionDirectories()) {
      const metadataPath = join(dir, 'session.json');

      if (existsSync(metadataPath)) {
        const metadata = readJsonFile(metadataPath);

        if (isRecord(metadata) && metadata.sessionId === sessionDirOrId) {
          return dir;
        }
      }

      try {
        const config = this.readConfig(dir);

        if (config.runConfig.sessionId === sessionDirOrId) {
          return dir;
        }
      } catch {
        // Ignore unreadable session directories while resolving.
      }
    }

    throw new Error(`Persisted session "${sessionDirOrId}" was not found in ${this.runsRoot}.`);
  }

  private readConfig(sessionDir: string): SessionConfigArtifact {
    const artifact = readJsonFile(join(sessionDir, 'config.json'));

    if (!isRecord(artifact)) {
      throw new Error(`Invalid config.json in ${sessionDir}.`);
    }

    return {
      runConfig: SimulationRunConfigSchema.parse(artifact.runConfig),
      gameProfile: GameProfileSchema.parse(artifact.gameProfile)
    };
  }

  private readMetadata(
    sessionDir: string,
    config: SessionConfigArtifact,
    _viabilityReport: RuntimeViabilityReport,
    issues: DetectedIssue[],
    botStatuses: SimulationBotStatus[],
    sessionEvents: Record<string, unknown>[]
  ): PersistedSessionMetadata {
    const metadata = readJsonFileIfExists(join(sessionDir, 'session.json'));

    if (isRecord(metadata)) {
      return {
        sessionId: String(metadata.sessionId ?? config.runConfig.sessionId),
        gameName: String(metadata.gameName ?? config.gameProfile.gameName),
        gameId: typeof metadata.gameId === 'string' ? metadata.gameId : config.gameProfile.gameId,
        version: typeof metadata.version === 'string' ? metadata.version : config.gameProfile.version,
        buildId: typeof metadata.buildId === 'string' ? metadata.buildId : config.gameProfile.buildId,
        engineType: typeof metadata.engineType === 'string' ? metadata.engineType : config.gameProfile.engine.type,
        adapterType: typeof metadata.adapterType === 'string' ? metadata.adapterType : config.runConfig.adapterType,
        runMode: typeof metadata.runMode === 'string' ? metadata.runMode : config.runConfig.runMode,
        createdAt: String(metadata.createdAt ?? latestTimestamp(sessionEvents, 'session_start') ?? new Date(0).toISOString()),
        startedAt: typeof metadata.startedAt === 'string' ? metadata.startedAt : latestTimestamp(sessionEvents, 'session_start'),
        stoppedAt: typeof metadata.stoppedAt === 'string' ? metadata.stoppedAt : latestTimestamp(sessionEvents, 'session_stop'),
        status: safeRuntimeStatus(metadata.status),
        issueCounts: isRecord(metadata.issueCounts) ? metadata.issueCounts as unknown as SessionIssueCounts : issueCounts(issues),
        botCounts: isRecord(metadata.botCounts) ? metadata.botCounts as unknown as SessionBotCounts : botCounts(config.runConfig, botStatuses),
        coveragePercentage: typeof metadata.coveragePercentage === 'number' ? metadata.coveragePercentage : undefined,
        reportPaths: isRecord(metadata.reportPaths) ? metadata.reportPaths as unknown as SessionReportPaths : reportPathsFor(sessionDir)
      };
    }

    const createdAt = latestTimestamp(sessionEvents, 'session_start') ??
      statSync(join(sessionDir, 'config.json')).mtime.toISOString();
    const startedAt = latestTimestamp(sessionEvents, 'session_start');
    const stoppedAt = latestTimestamp(sessionEvents, 'session_stop');

    return {
      sessionId: config.runConfig.sessionId,
      gameName: config.gameProfile.gameName,
      gameId: config.gameProfile.gameId,
      version: config.gameProfile.version,
      buildId: config.gameProfile.buildId,
      engineType: config.gameProfile.engine.type,
      adapterType: config.runConfig.adapterType,
      runMode: config.runConfig.runMode,
      createdAt,
      startedAt,
      stoppedAt,
      status: statusFromEvents(sessionEvents, stoppedAt ? 'stopped' : 'created'),
      issueCounts: issueCounts(issues),
      botCounts: botCounts(config.runConfig, botStatuses),
      reportPaths: reportPathsFor(sessionDir)
    };
  }

  private readIssues(sessionDir: string): DetectedIssue[] {
    const byId = new Map<string, DetectedIssue>();
    const botsDir = join(sessionDir, 'bots');

    if (!existsSync(botsDir)) {
      return [];
    }

    for (const botDirName of readdirSync(botsDir)) {
      const issueEvents = readJsonl(join(botsDir, botDirName, 'issues.jsonl'));

      for (const event of issueEvents) {
        const issueValue = event.issue;

        if (!isRecord(issueValue)) {
          continue;
        }

        const parsed = DetectedIssueSchema.safeParse(issueValue);

        if (parsed.success) {
          byId.set(issueId(parsed.data), cloneIssue(parsed.data));
        }
      }
    }

    return [...byId.values()].sort((a, b) => (a.firstSeenAt ?? a.timestamp ?? '').localeCompare(b.firstSeenAt ?? b.timestamp ?? ''));
  }

  private readBotStatuses(
    sessionDir: string,
    runConfig: SimulationRunConfig,
    issues: DetectedIssue[]
  ): SimulationBotStatus[] {
    const botsDir = join(sessionDir, 'bots');
    const botIds = existsSync(botsDir) ? readdirSync(botsDir) : [];

    return botIds.map((botId) => {
      const botDir = join(botsDir, botId);
      const report = parseBotReport(join(botDir, 'bot-report.md'), botId);
      const actionEvents = readJsonl(join(botDir, 'actions.jsonl'));
      const stateEvents = readJsonl(join(botDir, 'states.jsonl'));
      const lastAction = actionEvents.at(-1);
      const lastState = stateEvents.at(-1);
      const snapshot = isRecord(lastState?.snapshot) ? lastState.snapshot : undefined;
      const profileId = report.profileId ?? runConfig.botPools.find((pool) => botId.startsWith(pool.profileId.replace(/-bot$/, '')))?.profileId ?? botId;

      return {
        botId,
        profileId,
        displayName: report.displayName ?? botId,
        playstyle: report.playstyle ?? profileId,
        status: safeBotStatusStatus(report.status),
        gameInstanceId: typeof lastAction?.gameInstanceId === 'string'
          ? lastAction.gameInstanceId
          : typeof lastState?.gameInstanceId === 'string'
            ? lastState.gameInstanceId
            : undefined,
        currentGoalId: undefined,
        lastActionId: isRecord(lastAction?.action) && typeof lastAction.action.actionId === 'string' ? lastAction.action.actionId : undefined,
        currentArea:
          report.currentArea ??
          (isRecord(snapshot) && typeof snapshot.scene === 'string' ? snapshot.scene : 'Persisted session'),
        progressState: report.progressState ?? 'Loaded from disk',
        issueCount: issues.filter((issue) => issue.botId === botId).length,
        actionCount: report.actionCount ?? actionEvents.length,
        message: 'Loaded from persisted run files.'
      };
    });
  }

  private readInstanceStatuses(
    sessionDir: string,
    runConfig: SimulationRunConfig,
    gameProfile: GameProfile
  ): GameInstanceStatus[] {
    const instancesDir = join(sessionDir, 'instances');
    const statuses: GameInstanceStatus[] = [];

    if (existsSync(instancesDir)) {
      for (const instanceDirName of readdirSync(instancesDir)) {
        const events = readJsonl(join(instancesDir, instanceDirName, 'instance-log.jsonl'));
        const status = [...events].reverse().find((event) => isRecord(event.status))?.status;

        if (isRecord(status)) {
          statuses.push(status as unknown as GameInstanceStatus);
        }
      }
    }

    if (statuses.length > 0) {
      return statuses;
    }

    return [
      {
        instanceId: 'persisted-instance-001',
        gameProfileId: gameProfile.gameId,
        adapterType: runConfig.adapterType,
        status: 'stopped',
        assignedBots: [],
        startTime: new Date(0).toISOString(),
        lastHeartbeat: new Date(0).toISOString()
      }
    ];
  }

  private readActions(sessionDir: string): GameAction[] {
    const botsDir = join(sessionDir, 'bots');

    if (!existsSync(botsDir)) {
      return [];
    }

    return readdirSync(botsDir).flatMap((botDirName) =>
      readJsonl(join(botsDir, botDirName, 'actions.jsonl'))
        .map((event) => event.action)
        .filter(isRecord)
        .map((action) => action as unknown as GameAction)
    );
  }

  private readStates(sessionDir: string): GameStateSnapshot[] {
    const botsDir = join(sessionDir, 'bots');

    if (!existsSync(botsDir)) {
      return [];
    }

    return readdirSync(botsDir).flatMap((botDirName) =>
      readJsonl(join(botsDir, botDirName, 'states.jsonl'))
        .map((event) => event.snapshot)
        .filter(isRecord)
        .map((snapshot) => snapshot as unknown as GameStateSnapshot)
    );
  }
}

function safeRuntimeStatus(value: unknown): SimulationRuntimeStatus {
  const status = typeof value === 'string' ? value : 'stopped';
  return ['idle', 'created', 'starting', 'running', 'paused', 'stopping', 'stopped', 'failed'].includes(status)
    ? status as SimulationRuntimeStatus
    : 'stopped';
}
