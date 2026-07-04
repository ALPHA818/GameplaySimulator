import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { type BotAdapter, type BotMemory } from '@core/bot/Bot';
import { BotManager } from '@core/bot/BotManager';
import { resolveBotPools } from '@core/bot/BotPoolResolver';
import type { AvailableGameActionLike, CoverageData } from '@core/bot/ActionPlanner';
import { CoverageTracker, type ContentCoverageSummary } from '@core/coverage/CoverageTracker';
import { IssueDetectionRunner } from '@core/detection/IssueDetectors';
import type { LogEntry } from '@core/logging/LogEntry';
import { StructuredRunLogger, type BotReportInput } from '@core/logging/StructuredLoggers';
import { resourceManager, type SystemResourceSnapshot } from '@core/resources/ResourceManager';
import { planGameInstances } from '@core/sessions/GameInstanceManager';
import type {
  BotProfile,
  GameAction,
  DetectedIssue,
  ActionResult,
  GameInstanceStatus,
  GameProfile,
  GameStateSnapshot,
  RuntimeBotSnapshot,
  RuntimeViabilityReport,
  Severity,
  SimulationRunConfig
} from '@core/types';
import {
  BotProfileSchema,
  GameProfileSchema,
  RuntimeViabilityReportSchema,
  SimulationRunConfigSchema
} from '@core/types';

export type SimulationRuntimeStatus =
  | 'idle'
  | 'created'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface SimulationValidationError {
  path: string;
  message: string;
}

export interface SimulationValidationResult {
  valid: boolean;
  errors: SimulationValidationError[];
}

export interface SimulationSessionRequest {
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  botProfiles?: BotProfile[];
}

export interface SimulationBotStatus extends RuntimeBotSnapshot {
  displayName: string;
  playstyle: string;
  currentArea: string;
  progressState: string;
  issueCount: number;
}

export interface SimulationSessionStatusSnapshot {
  status: SimulationRuntimeStatus;
  label: string;
  activeSessionId: string | null;
  sessionId?: string;
  createdAt?: string;
  startedAt?: string;
  stoppedAt?: string;
  botCount: number;
  instanceCount: number;
}

export interface SimulationSessionCreateResult {
  sessionId: string;
  status: SimulationSessionStatusSnapshot;
  viabilityReport: RuntimeViabilityReport;
  botStatuses: SimulationBotStatus[];
  instanceStatuses: GameInstanceStatus[];
  logs: LogEntry[];
}

export type { ContentCoverageSummary };

export interface OpenReportResult {
  sessionId: string;
  reportPath: string;
  opened: boolean;
  message: string;
}

export interface OpenLogsResult {
  sessionId: string;
  logsPath: string;
  opened: boolean;
  message: string;
}

export interface OpenEvidenceResult {
  sessionId: string;
  evidencePath: string;
  opened: boolean;
  message: string;
}

export interface ComparisonReportSummary {
  oldTotalIssues: number;
  newTotalIssues: number;
  newIssues: number;
  fixedIssues: number;
  repeatedIssues: number;
  worsenedIssues: number;
  coverageDeltaPercent: number;
  crashFrequencyDelta: number;
}

export interface ComparisonReportResult {
  oldSessionId: string;
  newSessionId: string;
  reportPath: string;
  opened: boolean;
  message: string;
  summary: ComparisonReportSummary;
}

export interface StructuredLogItem {
  source: 'session' | 'bot-actions' | 'bot-states' | 'bot-issues' | 'instance';
  botId?: string;
  instanceId?: string;
  eventType?: string;
  timestamp?: string;
  summary: string;
  raw: Record<string, unknown>;
}

export interface StructuredLogReadResult {
  sessionId: string;
  logs: StructuredLogItem[];
}

export interface SimulationServiceOptions {
  now?: () => string;
  reportRoot?: string;
  openPath?: (path: string) => Promise<string>;
  systemSnapshot?: SystemResourceSnapshot;
}

const SimulationSessionRequestSchema = z.object({
  runConfig: SimulationRunConfigSchema,
  gameProfile: GameProfileSchema,
  botProfiles: z.array(BotProfileSchema).default([])
});

interface SimulationSessionRecord {
  request: Required<SimulationSessionRequest>;
  viabilityReport: RuntimeViabilityReport;
  status: SimulationRuntimeStatus;
  label: string;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  botStatuses: SimulationBotStatus[];
  instanceStatuses: GameInstanceStatus[];
  issues: DetectedIssue[];
  logs: LogEntry[];
  tick: number;
  botManager: BotManager;
  issueDetectionRunner: IssueDetectionRunner;
  coverageTracker: CoverageTracker;
  structuredLogger: StructuredRunLogger;
  loggedStateSnapshotIds: Set<string>;
  loggedActionIds: Set<string>;
  loggedIssueIds: Set<string>;
  loggedStartedBotIds: Set<string>;
  loggedStoppedBotIds: Set<string>;
  loggedStartedInstanceIds: Set<string>;
  loggedStoppedInstanceIds: Set<string>;
  loggedRecoveryAttemptIds: Set<string>;
  loggedRecoverySuccessIds: Set<string>;
  loggedRecoveryFailedIds: Set<string>;
  loggedEvidenceKeys: Set<string>;
  lastPeriodicScreenshotActionCountByBot: Map<string, number>;
  videoPathsByBot: Map<string, string>;
  sessionStartLogged: boolean;
  sessionStopLogged: boolean;
  adapter: MockBotRuntimeAdapter;
  startupTimer?: NodeJS.Timeout;
}

function fallbackBotProfiles(runConfig: SimulationRunConfig, botProfiles: BotProfile[]): BotProfile[] {
  const profilesById = new Map(botProfiles.map((profile) => [profile.profileId, profile]));

  for (const pool of runConfig.botPools) {
    if (!profilesById.has(pool.profileId)) {
      profilesById.set(pool.profileId, {
        profileId: pool.profileId,
        displayName: pool.profileId,
        botType: pool.profileId,
        goals: [],
        recommendedMinCount: pool.minCount,
        recommendedMaxCount: Math.max(1, pool.maxCount),
        defaultResourceWeight: pool.resourceWeight,
        tags: [],
        config: {}
      });
    }
  }

  return [...profilesById.values()];
}

function validationErrors(error: z.ZodError): SimulationValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'config',
    message: issue.message
  }));
}

function cloneStatus(status: GameInstanceStatus): GameInstanceStatus {
  return {
    ...status,
    assignedBots: [...status.assignedBots],
    resourceUsage: status.resourceUsage ? { ...status.resourceUsage } : undefined
  };
}

function playstyleFor(profile: BotProfile | undefined): string {
  if (profile?.playstyle && profile.playstyle.trim().length > 0) {
    return profile.playstyle.trim();
  }

  const configured = profile?.config.playstyle;
  return typeof configured === 'string' && configured.trim().length > 0
    ? configured.trim()
    : profile?.botType ?? 'unknown';
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim().length > 0)))].sort();
}

function safePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

const severityRanks: Record<Severity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3
};

interface IssueComparisonGroup {
  fingerprint: string;
  exactFingerprints: string[];
  issues: DetectedIssue[];
  exemplar: DetectedIssue;
  maxSeverity: Severity;
  maxSeverityRank: number;
}

interface BotProgressComparison {
  botId: string;
  profileId: string;
  displayName: string;
  status: string;
  actionCount: number;
  currentArea: string;
  progressState: string;
  issueCount: number;
}

interface ResourceComparisonSnapshot {
  estimatedCpuPercent: number;
  estimatedRamMb: number;
  estimatedGpuPercent?: number;
  currentCpuPercent: number;
  currentRamMb: number;
  currentGpuPercent?: number;
}

interface SessionComparisonData {
  oldRecord: SimulationSessionRecord;
  newRecord: SimulationSessionRecord;
  newIssueGroups: IssueComparisonGroup[];
  fixedIssueGroups: IssueComparisonGroup[];
  repeatedIssuePairs: Array<{ oldGroup: IssueComparisonGroup; newGroup: IssueComparisonGroup }>;
  worsenedIssuePairs: Array<{ oldGroup: IssueComparisonGroup; newGroup: IssueComparisonGroup }>;
  improvedSeverityPairs: Array<{ oldGroup: IssueComparisonGroup; newGroup: IssueComparisonGroup }>;
  coverage: {
    oldSummary: ContentCoverageSummary;
    newSummary: ContentCoverageSummary;
    newlyCovered: string[];
    noLongerCovered: string[];
  };
  botProgress: {
    further: Array<{ oldBot: BotProgressComparison; newBot: BotProgressComparison }>;
    stuckEarlier: Array<{ oldBot: BotProgressComparison; newBot: BotProgressComparison }>;
  };
  performance: {
    oldSnapshot: ResourceComparisonSnapshot;
    newSnapshot: ResourceComparisonSnapshot;
  };
  crashFrequency: {
    oldCount: number;
    newCount: number;
  };
  summary: ComparisonReportSummary;
}

function normalizeFingerprintSegment(value: string | undefined, maxWords = 12): string {
  const normalized = (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ');

  return normalized || 'unknown';
}

function issueLocation(issue: DetectedIssue): string {
  return issue.scene ?? issue.area ?? 'unknown';
}

function issueActionPattern(issue: DetectedIssue): string {
  return (issue.lastActions ?? [])
    .slice(-6)
    .map((action) => normalizeFingerprintSegment(action, 6))
    .filter((action) => action !== 'unknown')
    .join('>') || 'no-actions';
}

function issueStateSignature(issue: DetectedIssue): string {
  return normalizeFingerprintSegment(issue.stateSummary, 16);
}

function issueComparableFingerprint(issue: DetectedIssue): string {
  return [
    issue.category,
    normalizeFingerprintSegment(issueLocation(issue), 8),
    normalizeFingerprintSegment(issue.title, 10),
    issueStateSignature(issue),
    issueActionPattern(issue)
  ].join('|');
}

function issueExactFingerprint(issue: DetectedIssue): string {
  return [
    issue.category,
    issue.severity,
    normalizeFingerprintSegment(issueLocation(issue), 8),
    normalizeFingerprintSegment(issue.title, 10),
    issueStateSignature(issue),
    issueActionPattern(issue)
  ].join('|');
}

function markdownEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function markdownTable(headers: string[], rows: string[][], emptyMessage = '_None._'): string {
  if (rows.length === 0) {
    return `${emptyMessage}\n`;
  }

  return [
    `| ${headers.map(markdownEscape).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(markdownEscape).join(' | ')} |`)
  ].join('\n') + '\n';
}

function formatSignedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatPercent(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : 'n/a';
}

function formatMegabytes(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} MB` : 'n/a';
}

function average(values: number[]): number | undefined {
  const finiteValues = values.filter((value) => Number.isFinite(value));

  if (finiteValues.length === 0) {
    return undefined;
  }

  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function sum(values: number[]): number {
  return values.filter((value) => Number.isFinite(value)).reduce((total, value) => total + value, 0);
}

function fingerprintPreview(fingerprint: string): string {
  return fingerprint.length > 84 ? `${fingerprint.slice(0, 81)}...` : fingerprint;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function screenshotSvg(input: {
  sessionId: string;
  botId: string;
  instanceId?: string;
  reason: string;
  capturedAt: string;
  area?: string;
  lastAction?: string;
  progressState?: string;
}): string {
  const lines = [
    `Session: ${input.sessionId}`,
    `Bot: ${input.botId}`,
    `Instance: ${input.instanceId ?? 'none'}`,
    `Reason: ${input.reason}`,
    `Area: ${input.area ?? 'unknown'}`,
    `Last action: ${input.lastAction ?? 'none'}`,
    `Progress: ${input.progressState ?? 'unknown'}`,
    `Captured: ${input.capturedAt}`
  ];

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
    '<rect width="1280" height="720" fill="#101216"/>',
    '<rect x="48" y="48" width="1184" height="624" rx="18" fill="#191b20" stroke="#2dd4bf" stroke-width="3"/>',
    '<text x="82" y="110" fill="#eef2f7" font-family="monospace" font-size="34" font-weight="700">GameplaySimulator Evidence</text>',
    ...lines.map(
      (line, index) =>
        `<text x="82" y="${170 + index * 52}" fill="#d8e0eb" font-family="monospace" font-size="26">${xmlEscape(line)}</text>`
    ),
    '</svg>'
  ].join('');
}

function areaForTick(tick: number, index: number): string {
  const areas = ['Boot', 'Main Menu', 'Start Area', 'Traversal Loop', 'Interaction Check', 'Results Review'];
  return areas[(tick + index) % areas.length];
}

function pickKnownContent(values: string[] | undefined, fallback: string, index: number): string {
  if (!values || values.length === 0) {
    return fallback;
  }

  return values[Math.abs(index) % values.length];
}

function progressForTick(tick: number, index: number): string {
  const progress = ['Queued', 'Loading', 'Exploring', 'Interacting', 'Recovering', 'Reporting'];
  return progress[(tick + index) % progress.length];
}

function maxConcurrentBotsForHybrid(
  runConfig: SimulationRunConfig,
  viabilityReport: RuntimeViabilityReport,
  launchPlanCount: number
): number | undefined {
  if (runConfig.runMode !== 'hybrid' || launchPlanCount === 0) {
    return undefined;
  }

  const recommendedInstances = Math.max(1, viabilityReport.recommendedGameInstances);
  const perInstanceLimit = Math.max(1, runConfig.perGameInstanceBotLimit);
  const recommendedBots = Math.max(1, viabilityReport.recommendedTotalBots);

  return Math.max(1, Math.min(launchPlanCount, recommendedBots, recommendedInstances * perInstanceLimit));
}

class MockBotRuntimeAdapter implements BotAdapter {
  private readonly countsByBot = new Map<string, number>();
  private readonly lastActionByBot = new Map<string, string>();

  constructor(
    private readonly sessionId: string,
    private readonly gameProfile: GameProfile,
    private readonly now: () => string
  ) {}

  async getState(instanceId: string, botId: string): Promise<GameStateSnapshot> {
    const count = this.countsByBot.get(botId) ?? 0;
    const scene = pickKnownContent(
      [...(this.gameProfile.knownContent.scenes ?? []), ...(this.gameProfile.knownContent.locations ?? [])],
      areaForTick(count, botId.length),
      count + botId.length
    );
    const lastAction = this.lastActionByBot.get(botId);
    const state: Record<string, unknown> = {
      scene,
      level: pickKnownContent(this.gameProfile.knownContent.levels, `Level ${Math.max(1, count + 1)}`, count),
      adapterType: this.gameProfile.adapter.type,
      structuredStateAvailable: this.gameProfile.adapter.supportsStateRead,
      mockRuntime: true
    };

    if (lastAction === 'follow-main-objective') {
      state.mainQuest = pickKnownContent(this.gameProfile.knownContent.mainQuests, 'Main objective', count);
      state.quest = state.mainQuest;
    }

    if (lastAction === 'accept-side-quest') {
      state.sideQuest = pickKnownContent(this.gameProfile.knownContent.sideQuests, 'Side quest', count);
      state.quest = state.sideQuest;
      state.npc = pickKnownContent(
        [...(this.gameProfile.knownContent.npcs ?? []), ...(this.gameProfile.knownContent.characters ?? [])],
        'Quest giver',
        count
      );
    }

    if (lastAction === 'turn-in-quest') {
      state.completedQuest = pickKnownContent(this.gameProfile.knownContent.quests, 'Completed quest', count);
    }

    if (lastAction === 'open-settings-menu' || lastAction === 'open-menu' || lastAction === 'random-menu-spam') {
      state.openedMenu = pickKnownContent(this.gameProfile.knownContent.menus, 'Settings menu', count);
    }

    if (lastAction === 'buy-shop-item') {
      state.shop = pickKnownContent(this.gameProfile.knownContent.shops, 'General shop', count);
      state.item = pickKnownContent(this.gameProfile.knownContent.items, 'Shop item', count);
    }

    if (lastAction === 'attack-enemy' || lastAction === 'block-dodge') {
      state.boss = pickKnownContent(this.gameProfile.knownContent.bosses, 'Enemy encounter', count);
    }

    if (lastAction === 'start-minigame') {
      state.minigame = pickKnownContent(this.gameProfile.knownContent.minigames, 'Minigame', count);
    }

    if (lastAction === 'inspect-hidden-area' || lastAction === 'enter-locked-area-early') {
      state.hiddenArea = pickKnownContent(this.gameProfile.knownContent.hiddenAreas, 'Hidden area', count);
    }

    if (lastAction === 'equip-inventory-item') {
      state.item = pickKnownContent(this.gameProfile.knownContent.items, 'Inventory item', count);
      state.collectible = pickKnownContent(this.gameProfile.knownContent.collectibles, 'Collectible', count);
    }

    if (lastAction === 'talk-dialogue-branch' || lastAction === 'speedrun-skip-dialogue') {
      state.dialogueBranch = pickKnownContent(this.gameProfile.knownContent.dialogueBranches, 'Dialogue branch', count);
      state.npc = pickKnownContent(
        [...(this.gameProfile.knownContent.npcs ?? []), ...(this.gameProfile.knownContent.characters ?? [])],
        'Dialogue NPC',
        count
      );
    }

    if (lastAction === 'idle-wait') {
      state.optionalStory = pickKnownContent(this.gameProfile.knownContent.optionalStories, 'Ambient optional story', count);
    }

    if (lastAction === 'load-checkpoint' || lastAction === 'reload-save') {
      state.postGameContent = pickKnownContent(this.gameProfile.knownContent.postGameContent, 'Post-game checkpoint', count);
    }

    if (lastAction === 'boundary-jump-corner') {
      state.position = { x: 12, y: -250, z: 4 };
      state.outOfWorld = true;
    }

    if (lastAction === 'enter-locked-area-early') {
      state.enteredLockedAreaEarly = true;
    }

    if (lastAction === 'buy-shop-item') {
      state.currency = -5;
    }

    return {
      snapshotId: `${botId}-state-${count + 1}`,
      sessionId: this.sessionId,
      gameId: this.gameProfile.gameId,
      gameInstanceId: instanceId,
      botId,
      capturedAt: this.now(),
      tick: count,
      scene,
      state,
      metrics: {
        actionCount: count
      }
    };
  }

  async getAvailableActions(): Promise<AvailableGameActionLike[]> {
    return [
      { actionType: 'follow-main-objective', label: 'Follow Main Objective' },
      { actionType: 'accept-side-quest', label: 'Accept Side Quest' },
      { actionType: 'move-forward', label: 'Move Forward' },
      { actionType: 'inspect-hidden-area', label: 'Inspect Hidden Area' },
      { actionType: 'boundary-jump-corner', label: 'Boundary Jump Corner' },
      { actionType: 'speedrun-skip-dialogue', label: 'Speedrun Skip Dialogue' },
      { actionType: 'random-menu-spam', label: 'Random Menu Spam' },
      { actionType: 'open-settings-menu', label: 'Open Settings Menu' },
      { actionType: 'buy-shop-item', label: 'Buy Shop Item' },
      { actionType: 'attack-enemy', label: 'Attack Enemy' },
      { actionType: 'block-dodge', label: 'Block And Dodge' },
      { actionType: 'turn-in-quest', label: 'Turn In Quest' },
      { actionType: 'start-minigame', label: 'Start Minigame' },
      { actionType: 'idle-wait', label: 'Idle Wait' },
      { actionType: 'equip-inventory-item', label: 'Equip Inventory Item' },
      { actionType: 'talk-dialogue-branch', label: 'Talk Dialogue Branch' },
      { actionType: 'enter-locked-area-early', label: 'Enter Locked Area Early' },
      { actionType: 'spawn-load-effects', label: 'Spawn Load Effects' },
      { actionType: 'save-game', label: 'Save Game' },
      { actionType: 'load-checkpoint', label: 'Load Checkpoint' },
      { actionType: 'wait', label: 'Wait' },
      { actionType: 'close-menu', label: 'Close Menu' },
      { actionType: 'open-menu', label: 'Open Menu' },
      { actionType: 'cancel-back', label: 'Cancel / Back' },
      { actionType: 'move-backward', label: 'Move Backward' },
      { actionType: 'move-random-direction', label: 'Move Random Direction' },
      { actionType: 'jump', label: 'Jump' },
      { actionType: 'interact', label: 'Interact' },
      { actionType: 'reload-checkpoint', label: 'Reload Checkpoint' },
      { actionType: 'restart-level', label: 'Restart Level' },
      { actionType: 'reload-save', label: 'Reload Save' }
    ];
  }

  async performAction(_instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    const nextCount = (this.countsByBot.get(botId) ?? 0) + 1;
    this.countsByBot.set(botId, nextCount);
    this.lastActionByBot.set(botId, action.type);

    return {
      actionId: action.actionId,
      botId,
      status: 'succeeded',
      startedAt: action.requestedAt,
      completedAt: this.now(),
      durationMs: 1,
      message: `Mock adapter performed ${action.type}.`,
      issueIds: []
    };
  }
}

function statusLabel(record: SimulationSessionRecord): string {
  const botCount = record.botStatuses.length;

  if (record.status === 'created') {
    return `Session ready (${botCount} bots)`;
  }

  if (record.status === 'starting') {
    return `Starting ${record.request.runConfig.sessionId}`;
  }

  if (record.status === 'running') {
    return `Running ${record.request.runConfig.sessionId} (${botCount} bots)`;
  }

  if (record.status === 'paused') {
    return `Paused ${record.request.runConfig.sessionId}`;
  }

  if (record.status === 'stopping') {
    return `Stopping ${record.request.runConfig.sessionId}`;
  }

  if (record.status === 'stopped') {
    return `Stopped ${record.request.runConfig.sessionId}`;
  }

  return `Failed ${record.request.runConfig.sessionId}`;
}

function createIdleSnapshot(): SimulationSessionStatusSnapshot {
  return {
    status: 'idle',
    label: 'No session running',
    activeSessionId: null,
    botCount: 0,
    instanceCount: 0
  };
}

export class SimulationService {
  private readonly sessions = new Map<string, SimulationSessionRecord>();
  private activeSessionId: string | null = null;
  private readonly now: () => string;
  private readonly reportRoot: string;
  private readonly openPath: (path: string) => Promise<string>;
  private readonly systemSnapshot?: SystemResourceSnapshot;

  constructor(options: SimulationServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.reportRoot = options.reportRoot ?? resolve(process.cwd(), 'runs');
    this.openPath = options.openPath ?? (async () => '');
    this.systemSnapshot = options.systemSnapshot;
  }

  validateSessionConfig(payload: unknown): SimulationValidationResult {
    const result = SimulationSessionRequestSchema.safeParse(payload);

    if (result.success) {
      return {
        valid: true,
        errors: []
      };
    }

    return {
      valid: false,
      errors: validationErrors(result.error)
    };
  }

  estimateViability(payload: unknown): RuntimeViabilityReport {
    const request = SimulationSessionRequestSchema.parse(payload);
    const report = resourceManager.estimateViabilitySync({
      runConfig: request.runConfig,
      gameProfile: request.gameProfile,
      systemSnapshot: this.systemSnapshot
    });

    return RuntimeViabilityReportSchema.parse(report);
  }

  createSession(payload: unknown): SimulationSessionCreateResult {
    const request = SimulationSessionRequestSchema.parse(payload);
    const botProfiles = fallbackBotProfiles(request.runConfig, request.botProfiles);
    const viabilityReport = this.estimateViability({
      ...request,
      botProfiles
    });
    const launchPlans = resolveBotPools({
      runConfig: request.runConfig,
      botProfiles,
      viabilityReport
    });
    const instancePlan = planGameInstances({
      runConfig: request.runConfig,
      gameProfile: request.gameProfile,
      launchPlans,
      adapterCapabilities: {
        supportsMultipleInstances: request.gameProfile.adapter.supportsMultipleInstances,
        supportsSaveIsolation: request.gameProfile.adapter.supportsSaveIsolation
      },
      now: this.now()
    });
    const sessionId = request.runConfig.sessionId;
    const createdAt = this.now();
    const profilesById = new Map(botProfiles.map((profile) => [profile.profileId, profile]));
    const adapter = new MockBotRuntimeAdapter(sessionId, request.gameProfile, this.now);
    const coverageTracker = new CoverageTracker(request.gameProfile);
    const structuredLogger = new StructuredRunLogger({
      rootDir: this.reportRoot,
      sessionId,
      createdAt,
      now: this.now
    });
    let record!: SimulationSessionRecord;
    const botManager = new BotManager({
      sessionId,
      runConfig: request.runConfig,
      launchPlans,
      botProfiles,
      adapter,
      maxConcurrentBots: maxConcurrentBotsForHybrid(request.runConfig, viabilityReport, launchPlans.length),
      getCoverageData: () => this.coverageForRecord(record),
      getRecentIssues: () => this.getIssues(sessionId),
      getInstanceHeartbeat: (instanceId) =>
        record.instanceStatuses.find((instance) => instance.instanceId === instanceId)?.lastHeartbeat,
      getProcessResponsive: (instanceId) => {
        const status = record.instanceStatuses.find((instance) => instance.instanceId === instanceId)?.status;
        return status ? status !== 'unresponsive' && status !== 'crashed' : undefined;
      },
      now: this.now,
      onStatusChange: ({ status, memory }) => {
        this.updateBotStatus(record, status, memory);
      },
      onLog: ({ entry }) => {
        record.logs.push(entry);
      },
      onIdle: () => {
        this.completeSessionIfNoActiveBots(record);
      }
    });

    record = {
      request: {
        runConfig: request.runConfig,
        gameProfile: request.gameProfile,
        botProfiles
      },
      viabilityReport,
      status: 'created',
      label: 'Session ready',
      createdAt,
      botStatuses: launchPlans.map((plan) => {
        const profile = profilesById.get(plan.profileId);

        return {
          botId: plan.botId,
          profileId: plan.profileId,
          displayName: plan.displayName,
          playstyle: plan.playstyle || playstyleFor(profile),
          status: 'queued',
          gameInstanceId: plan.assignedGameInstanceId,
          currentGoalId: profile?.goals[0]?.goalId,
          lastActionId: undefined,
          currentArea: 'Queued',
          progressState: 'Queued',
          issueCount: 0,
          message: 'Queued for mock session start.'
        };
      }),
      instanceStatuses: instancePlan.instances.map((instance, index) => ({
        ...cloneStatus(instance.status),
        resourceUsage: {
          cpuPercent: 0,
          ramMb: 0,
          gpuPercent: request.runConfig.saveVideo ? 2 + index : undefined
        }
      })),
      issues: [],
      logs: [
        this.createLog(
          sessionId,
          'info',
          `Created mock session with ${launchPlans.length} bot${launchPlans.length === 1 ? '' : 's'}.`
        )
      ],
      tick: 0,
      botManager,
      issueDetectionRunner: new IssueDetectionRunner(),
      coverageTracker,
      structuredLogger,
      loggedStateSnapshotIds: new Set(),
      loggedActionIds: new Set(),
      loggedIssueIds: new Set(),
      loggedStartedBotIds: new Set(),
      loggedStoppedBotIds: new Set(),
      loggedStartedInstanceIds: new Set(),
      loggedStoppedInstanceIds: new Set(),
      loggedRecoveryAttemptIds: new Set(),
      loggedRecoverySuccessIds: new Set(),
      loggedRecoveryFailedIds: new Set(),
      loggedEvidenceKeys: new Set(),
      lastPeriodicScreenshotActionCountByBot: new Map(),
      videoPathsByBot: new Map(),
      sessionStartLogged: false,
      sessionStopLogged: false,
      adapter
    };

    record.structuredLogger.writeConfig({
      runConfig: request.runConfig,
      gameProfile: request.gameProfile
    });
    record.structuredLogger.writeViabilityReport(viabilityReport);
    for (const bot of record.botStatuses) {
      record.structuredLogger.ensureBot(bot.botId);
      const profile = profilesById.get(bot.profileId);
      record.coverageTracker.registerBot(bot.botId, profile ?? bot.profileId);
    }
    for (const instance of record.instanceStatuses) {
      record.structuredLogger.ensureInstance(instance.instanceId);
    }
    for (const warning of viabilityReport.warnings) {
      record.structuredLogger.logSession('resource_warning', { warning });
    }
    this.writeStructuredReports(record);

    record.label = statusLabel(record);
    this.clearSessionTimer(sessionId);
    this.sessions.set(sessionId, record);
    this.activeSessionId = sessionId;

    return {
      sessionId,
      status: this.snapshotFor(record),
      viabilityReport,
      botStatuses: this.getBotStatuses(sessionId),
      instanceStatuses: this.getInstanceStatuses(sessionId),
      logs: this.getLogs(sessionId)
    };
  }

  startSession(sessionId: string): SimulationSessionStatusSnapshot {
    const record = this.requireSession(sessionId);

    if (record.viabilityReport.blockers.length > 0) {
      record.status = 'failed';
      record.logs.push(this.createLog(sessionId, 'error', 'Session cannot start because viability blockers remain.'));
      record.label = statusLabel(record);
      return this.snapshotFor(record);
    }

    this.activeSessionId = sessionId;
    record.status = 'starting';
    record.startedAt = record.startedAt ?? this.now();
    record.stoppedAt = undefined;
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: bot.status === 'stopped' ? 'stopped' : 'starting',
      currentArea: bot.status === 'stopped' ? bot.currentArea : 'Boot',
      progressState: bot.status === 'stopped' ? bot.progressState : 'Starting',
      message: bot.status === 'stopped' ? bot.message : 'Mock bot is starting.'
    }));
    record.instanceStatuses = record.instanceStatuses.map((instance) => ({
      ...instance,
      status: 'starting',
      lastHeartbeat: this.now()
    }));
    record.logs.push(this.createLog(sessionId, 'info', 'Starting mock simulation session.'));
    record.label = statusLabel(record);
    this.logSessionStart(record);
    this.startVideoEvidence(record);
    this.writeStructuredReports(record);

    this.clearSessionTimer(sessionId);
    const startupTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);

      if (!current || current.status !== 'starting') {
        return;
      }

      current.status = 'running';
      current.botStatuses = current.botStatuses.map((bot) => ({
        ...bot,
        status: bot.status === 'stopped' ? 'stopped' : 'running',
        currentArea: bot.status === 'stopped' ? bot.currentArea : 'Start Area',
        progressState: bot.status === 'stopped' ? bot.progressState : 'Running',
        message: bot.status === 'stopped' ? bot.message : 'Mock bot is running.'
      }));
      current.instanceStatuses = current.instanceStatuses.map((instance) => ({
        ...instance,
        status: 'running',
        lastHeartbeat: this.now()
      }));
      current.logs.push(this.createLog(sessionId, 'info', 'Bot runtime loops are running.'));
      current.label = statusLabel(current);
      for (const instance of current.instanceStatuses) {
        this.logInstanceStart(current, instance);
      }
      this.writeStructuredReports(current);
      current.botManager.startAll();
    }, 300);

    startupTimer.unref?.();
    record.startupTimer = startupTimer;
    return this.snapshotFor(record);
  }

  stopSession(sessionId: string): SimulationSessionStatusSnapshot {
    const record = this.requireSession(sessionId);

    record.status = 'stopping';
    record.label = statusLabel(record);
    record.logs.push(this.createLog(sessionId, 'info', 'Stopping mock simulation session.'));
    this.clearSessionTimer(sessionId);
    record.botManager.stopAll();
    record.structuredLogger.logSession('manual_stop', {
      scope: 'session',
      reason: 'Stop Session requested from UI or backend API.'
    });

    record.status = 'stopped';
    record.stoppedAt = this.now();
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: 'stopped',
      progressState: 'Stopped',
      message: 'Mock session stopped.'
    }));
    record.instanceStatuses = record.instanceStatuses.map((instance) => ({
      ...instance,
      status: 'stopped',
      lastHeartbeat: this.now()
    }));
    record.logs.push(this.createLog(sessionId, 'info', 'Mock simulation stopped.'));
    record.label = statusLabel(record);
    this.logSessionStop(record, 'manual_stop');
    this.stopVideoEvidence(record);
    this.writeStructuredReports(record);

    return this.snapshotFor(record);
  }

  pauseSession(sessionId: string): SimulationSessionStatusSnapshot {
    const record = this.requireSession(sessionId);

    if (record.status !== 'running') {
      return this.snapshotFor(record);
    }

    this.clearSessionTimer(sessionId);
    record.botManager.pauseAll();
    record.status = 'paused';
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: bot.status === 'stopped' ? 'stopped' : 'waiting',
      progressState: bot.status === 'stopped' ? bot.progressState : 'Paused',
      message: bot.status === 'stopped' ? bot.message : 'Mock session paused.'
    }));
    record.logs.push(this.createLog(sessionId, 'info', 'Mock simulation paused.'));
    record.label = statusLabel(record);

    return this.snapshotFor(record);
  }

  resumeSession(sessionId: string): SimulationSessionStatusSnapshot {
    const record = this.requireSession(sessionId);

    if (record.status !== 'paused') {
      return this.snapshotFor(record);
    }

    record.status = 'running';
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: ['stopped', 'completed', 'failed'].includes(bot.status) ? bot.status : 'running',
      progressState: ['stopped', 'completed', 'failed'].includes(bot.status) ? bot.progressState : 'Running',
      message: ['stopped', 'completed', 'failed'].includes(bot.status) ? bot.message : 'Mock session resumed.'
    }));
    record.instanceStatuses = record.instanceStatuses.map((instance) => ({
      ...instance,
      status: 'running',
      lastHeartbeat: this.now()
    }));
    record.logs.push(this.createLog(sessionId, 'info', 'Mock simulation resumed.'));
    record.label = statusLabel(record);
    record.botManager.resumeAll();

    return this.snapshotFor(record);
  }

  getStatus(): SimulationSessionStatusSnapshot {
    if (!this.activeSessionId) {
      return createIdleSnapshot();
    }

    const record = this.sessions.get(this.activeSessionId);
    return record ? this.snapshotFor(record) : createIdleSnapshot();
  }

  getSessionStatus(sessionId?: string): SimulationSessionStatusSnapshot {
    if (!sessionId) {
      return this.getStatus();
    }

    const record = this.sessions.get(sessionId);
    return record ? this.snapshotFor(record) : createIdleSnapshot();
  }

  getBotStatuses(sessionId: string): SimulationBotStatus[] {
    return this.requireSession(sessionId).botStatuses.map((bot) => ({ ...bot }));
  }

  stopBot(sessionId: string, botId: string): SimulationBotStatus[] {
    const record = this.requireSession(sessionId);
    const stopped = record.botManager.stopBot(botId);

    record.botStatuses = record.botStatuses.map((bot) => {
      if (bot.botId !== botId || bot.status === 'stopped') {
        return bot;
      }

      return {
        ...bot,
        status: 'stopped',
        progressState: 'Stopped manually',
        message: 'Stopped from Live Session controls.'
      };
    });

    if (stopped) {
      record.logs.push(this.createLog(sessionId, 'warn', `Stopped bot ${botId}.`));
      record.structuredLogger.logSession('manual_stop', {
        scope: 'bot',
        botId
      }, {
        botId
      });
      this.logBotStop(record, botId, 'manual_stop');
      this.completeSessionIfNoActiveBots(record);
      this.writeStructuredReports(record);
    }

    return this.getBotStatuses(sessionId);
  }

  stopBotPool(sessionId: string, profileId: string): SimulationBotStatus[] {
    const record = this.requireSession(sessionId);
    const stoppedCount = record.botManager.stopBotPool(profileId);

    record.botStatuses = record.botStatuses.map((bot) => {
      if (bot.profileId !== profileId || bot.status === 'stopped') {
        return bot;
      }

      return {
        ...bot,
        status: 'stopped',
        progressState: 'Pool stopped manually',
        message: 'Stopped with its bot pool from Live Session controls.'
      };
    });

    if (stoppedCount > 0) {
      record.logs.push(this.createLog(sessionId, 'warn', `Stopped ${stoppedCount} bot(s) in pool ${profileId}.`));
      record.structuredLogger.logSession('manual_stop', {
        scope: 'bot_pool',
        profileId,
        stoppedCount
      });
      for (const bot of record.botStatuses.filter((item) => item.profileId === profileId)) {
        this.logBotStop(record, bot.botId, 'manual_stop');
      }
      this.completeSessionIfNoActiveBots(record);
      this.writeStructuredReports(record);
    }

    return this.getBotStatuses(sessionId);
  }

  getInstanceStatuses(sessionId: string): GameInstanceStatus[] {
    return this.requireSession(sessionId).instanceStatuses.map(cloneStatus);
  }

  getIssues(sessionId: string): DetectedIssue[] {
    return this.requireSession(sessionId).issues.map((issue) => ({
      ...issue,
      lastActions: [...issue.lastActions],
      evidencePaths: [...issue.evidencePaths],
      actionTimelineIds: [...issue.actionTimelineIds]
    }));
  }

  getLogs(sessionId: string): LogEntry[] {
    return this.requireSession(sessionId).logs.map((log) => ({ ...log }));
  }

  getCoverage(sessionId: string): ContentCoverageSummary {
    return this.requireSession(sessionId).coverageTracker.getSummary();
  }

  async openReport(sessionId: string): Promise<OpenReportResult> {
    const record = this.requireSession(sessionId);
    this.writeStructuredReports(record);
    const reportPath = record.structuredLogger.summaryPath;

    const openError = await this.openPath(reportPath);

    return {
      sessionId,
      reportPath,
      opened: openError.length === 0,
      message: openError.length === 0 ? 'Report opened.' : openError
    };
  }

  async openLogs(sessionId: string): Promise<OpenLogsResult> {
    const record = this.requireSession(sessionId);
    this.writeStructuredReports(record);
    const logsPath = record.structuredLogger.sessionLogPath;

    const openError = await this.openPath(logsPath);

    return {
      sessionId,
      logsPath,
      opened: openError.length === 0,
      message: openError.length === 0 ? 'Logs opened.' : openError
    };
  }

  async getStructuredLogs(sessionId: string): Promise<StructuredLogReadResult> {
    const record = this.requireSession(sessionId);
    this.writeStructuredReports(record);

    const logs: StructuredLogItem[] = [];
    logs.push(
      ...(await this.readStructuredLogFile(record.structuredLogger.sessionLogPath, {
        source: 'session'
      }))
    );

    for (const bot of record.botStatuses) {
      const botLogger = record.structuredLogger.ensureBot(bot.botId);
      logs.push(
        ...(await this.readStructuredLogFile(botLogger.actionsPath, {
          source: 'bot-actions',
          botId: bot.botId
        })),
        ...(await this.readStructuredLogFile(botLogger.statesPath, {
          source: 'bot-states',
          botId: bot.botId
        })),
        ...(await this.readStructuredLogFile(botLogger.issuesPath, {
          source: 'bot-issues',
          botId: bot.botId
        }))
      );
    }

    for (const instance of record.instanceStatuses) {
      const instanceLogger = record.structuredLogger.ensureInstance(instance.instanceId);
      logs.push(
        ...(await this.readStructuredLogFile(instanceLogger.logPath, {
          source: 'instance',
          instanceId: instance.instanceId
        }))
      );
    }

    logs.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));

    return {
      sessionId,
      logs
    };
  }

  async openEvidence(sessionId: string, evidencePath: string): Promise<OpenEvidenceResult> {
    const record = this.requireSession(sessionId);
    const normalizedPath = resolve(evidencePath);
    const sessionDirectory = resolve(record.structuredLogger.sessionDir);
    const issueEvidencePaths = new Set(
      record.issues.flatMap((issue) => [
        issue.screenshotPath,
        issue.videoPath,
        ...issue.evidencePaths
      ]).filter((path): path is string => typeof path === 'string' && path.length > 0)
        .map((path) => resolve(path))
    );
    const isAllowed = normalizedPath.startsWith(sessionDirectory) || issueEvidencePaths.has(normalizedPath);

    if (!isAllowed) {
      return {
        sessionId,
        evidencePath,
        opened: false,
        message: 'Evidence path is not part of this session.'
      };
    }

    const openError = await this.openPath(normalizedPath);

    return {
      sessionId,
      evidencePath: normalizedPath,
      opened: openError.length === 0,
      message: openError.length === 0 ? 'Evidence opened.' : openError
    };
  }

  async compareSessions(oldSessionId: string, newSessionId: string): Promise<ComparisonReportResult> {
    if (oldSessionId === newSessionId) {
      throw new Error('Choose two different sessions to compare.');
    }

    const oldRecord = this.requireSession(oldSessionId);
    const newRecord = this.requireSession(newSessionId);
    this.writeStructuredReports(oldRecord);
    this.writeStructuredReports(newRecord);

    const comparison = this.createSessionComparisonData(oldRecord, newRecord);
    const reportPath = join(
      newRecord.structuredLogger.sessionDir,
      `comparison-${safePathSegment(oldSessionId)}-to-${safePathSegment(newSessionId)}.md`
    );

    writeFileSync(reportPath, this.renderComparisonReport(comparison), 'utf8');
    const openError = await this.openPath(reportPath);

    return {
      oldSessionId,
      newSessionId,
      reportPath,
      opened: openError.length === 0,
      message: openError.length === 0 ? 'Comparison report opened.' : openError,
      summary: comparison.summary
    };
  }

  private createSessionComparisonData(
    oldRecord: SimulationSessionRecord,
    newRecord: SimulationSessionRecord
  ): SessionComparisonData {
    const oldGroups = this.groupIssuesForComparison(oldRecord.issues);
    const newGroups = this.groupIssuesForComparison(newRecord.issues);
    const newIssueGroups = [...newGroups.entries()]
      .filter(([fingerprint]) => !oldGroups.has(fingerprint))
      .map(([, group]) => group);
    const fixedIssueGroups = [...oldGroups.entries()]
      .filter(([fingerprint]) => !newGroups.has(fingerprint))
      .map(([, group]) => group);
    const repeatedIssuePairs = [...newGroups.entries()]
      .filter(([fingerprint]) => oldGroups.has(fingerprint))
      .map(([fingerprint, newGroup]) => ({
        oldGroup: oldGroups.get(fingerprint)!,
        newGroup
      }));
    const worsenedIssuePairs = repeatedIssuePairs.filter(
      ({ oldGroup, newGroup }) => newGroup.maxSeverityRank > oldGroup.maxSeverityRank
    );
    const improvedSeverityPairs = repeatedIssuePairs.filter(
      ({ oldGroup, newGroup }) => newGroup.maxSeverityRank < oldGroup.maxSeverityRank
    );
    const oldCoverage = oldRecord.coverageTracker.getSummary();
    const newCoverage = newRecord.coverageTracker.getSummary();
    const oldCovered = new Map(
      oldCoverage.testedContent.map((item) => [`${item.category}:${item.contentId}`, `${item.category}: ${item.label}`])
    );
    const newCovered = new Map(
      newCoverage.testedContent.map((item) => [`${item.category}:${item.contentId}`, `${item.category}: ${item.label}`])
    );
    const oldProgress = this.botProgressForRecord(oldRecord);
    const newProgress = this.botProgressForRecord(newRecord);
    const further: Array<{ oldBot: BotProgressComparison; newBot: BotProgressComparison }> = [];
    const stuckEarlier: Array<{ oldBot: BotProgressComparison; newBot: BotProgressComparison }> = [];

    for (const [botId, newBot] of newProgress.entries()) {
      const oldBot = oldProgress.get(botId);

      if (!oldBot) {
        continue;
      }

      if (
        newBot.actionCount > oldBot.actionCount ||
        (newBot.status === 'completed' && oldBot.status !== 'completed')
      ) {
        further.push({ oldBot, newBot });
      }

      if (this.isStuckProgress(newBot) && newBot.actionCount < oldBot.actionCount) {
        stuckEarlier.push({ oldBot, newBot });
      }
    }

    const oldCrashCount = this.countCrashIssues(oldRecord.issues);
    const newCrashCount = this.countCrashIssues(newRecord.issues);
    const summary: ComparisonReportSummary = {
      oldTotalIssues: oldRecord.issues.length,
      newTotalIssues: newRecord.issues.length,
      newIssues: newIssueGroups.length,
      fixedIssues: fixedIssueGroups.length,
      repeatedIssues: repeatedIssuePairs.length,
      worsenedIssues: worsenedIssuePairs.length,
      coverageDeltaPercent: newCoverage.percentage - oldCoverage.percentage,
      crashFrequencyDelta: newCrashCount - oldCrashCount
    };

    return {
      oldRecord,
      newRecord,
      newIssueGroups,
      fixedIssueGroups,
      repeatedIssuePairs,
      worsenedIssuePairs,
      improvedSeverityPairs,
      coverage: {
        oldSummary: oldCoverage,
        newSummary: newCoverage,
        newlyCovered: [...newCovered.entries()]
          .filter(([key]) => !oldCovered.has(key))
          .map(([, label]) => label)
          .sort(),
        noLongerCovered: [...oldCovered.entries()]
          .filter(([key]) => !newCovered.has(key))
          .map(([, label]) => label)
          .sort()
      },
      botProgress: {
        further,
        stuckEarlier
      },
      performance: {
        oldSnapshot: this.resourceSnapshotForRecord(oldRecord),
        newSnapshot: this.resourceSnapshotForRecord(newRecord)
      },
      crashFrequency: {
        oldCount: oldCrashCount,
        newCount: newCrashCount
      },
      summary
    };
  }

  private groupIssuesForComparison(issues: DetectedIssue[]): Map<string, IssueComparisonGroup> {
    const groups = new Map<string, IssueComparisonGroup>();

    for (const issue of issues) {
      const fingerprint = issueComparableFingerprint(issue);
      const exactFingerprint = issueExactFingerprint(issue);
      const severityRank = severityRanks[issue.severity];
      const existing = groups.get(fingerprint);

      if (!existing) {
        groups.set(fingerprint, {
          fingerprint,
          exactFingerprints: [exactFingerprint],
          issues: [issue],
          exemplar: issue,
          maxSeverity: issue.severity,
          maxSeverityRank: severityRank
        });
        continue;
      }

      existing.issues.push(issue);
      if (!existing.exactFingerprints.includes(exactFingerprint)) {
        existing.exactFingerprints.push(exactFingerprint);
      }

      if (severityRank > existing.maxSeverityRank) {
        existing.exemplar = issue;
        existing.maxSeverity = issue.severity;
        existing.maxSeverityRank = severityRank;
      }
    }

    return groups;
  }

  private botProgressForRecord(record: SimulationSessionRecord): Map<string, BotProgressComparison> {
    return new Map(
      record.botStatuses.map((bot) => {
        const memory = record.botManager.getMemory(bot.botId);

        return [
          bot.botId,
          {
            botId: bot.botId,
            profileId: bot.profileId,
            displayName: bot.displayName,
            status: bot.status,
            actionCount: memory?.actionCount ?? 0,
            currentArea: memory?.currentArea ?? bot.currentArea,
            progressState: memory?.progressState ?? bot.progressState,
            issueCount: record.issues.filter((issue) => issue.botId === bot.botId).length
          }
        ];
      })
    );
  }

  private isStuckProgress(bot: BotProgressComparison): boolean {
    const progressText = `${bot.status} ${bot.progressState}`.toLowerCase();

    return (
      bot.status === 'blocked' ||
      bot.status === 'failed' ||
      progressText.includes('stuck') ||
      progressText.includes('blocked') ||
      progressText.includes('recovery failed')
    );
  }

  private countCrashIssues(issues: DetectedIssue[]): number {
    return issues.filter((issue) =>
      issue.category === 'crash' ||
      issue.title.toLowerCase().includes('crash') ||
      issue.description?.toLowerCase().includes('crash')
    ).length;
  }

  private resourceSnapshotForRecord(record: SimulationSessionRecord): ResourceComparisonSnapshot {
    const cpuValues = record.instanceStatuses
      .map((instance) => instance.resourceUsage?.cpuPercent)
      .filter((value): value is number => typeof value === 'number');
    const ramValues = record.instanceStatuses
      .map((instance) => instance.resourceUsage?.ramMb)
      .filter((value): value is number => typeof value === 'number');
    const gpuValues = record.instanceStatuses
      .map((instance) => instance.resourceUsage?.gpuPercent)
      .filter((value): value is number => typeof value === 'number');

    return {
      estimatedCpuPercent: record.viabilityReport.estimatedCpuPercent,
      estimatedRamMb: record.viabilityReport.estimatedRamMb,
      estimatedGpuPercent: record.viabilityReport.estimatedGpuPercent,
      currentCpuPercent: cpuValues.length > 0 ? Math.min(100, sum(cpuValues)) : record.viabilityReport.estimatedCpuPercent,
      currentRamMb: ramValues.length > 0 ? sum(ramValues) : record.viabilityReport.estimatedRamMb,
      currentGpuPercent: gpuValues.length > 0 ? average(gpuValues) : record.viabilityReport.estimatedGpuPercent
    };
  }

  private renderComparisonReport(data: SessionComparisonData): string {
    const oldRecord = data.oldRecord;
    const newRecord = data.newRecord;
    const oldSessionId = oldRecord.request.runConfig.sessionId;
    const newSessionId = newRecord.request.runConfig.sessionId;
    const oldBuild = oldRecord.request.gameProfile.buildId ?? 'n/a';
    const newBuild = newRecord.request.gameProfile.buildId ?? 'n/a';
    const oldPerf = data.performance.oldSnapshot;
    const newPerf = data.performance.newSnapshot;

    return [
      `# Build Comparison: ${oldSessionId} -> ${newSessionId}`,
      '',
      `Generated: ${this.now()}`,
      '',
      '## Sessions',
      markdownTable(
        ['Field', 'Old Session', 'New Session'],
        [
          ['Session ID', oldSessionId, newSessionId],
          ['Game', oldRecord.request.gameProfile.gameName, newRecord.request.gameProfile.gameName],
          ['Version', oldRecord.request.gameProfile.version, newRecord.request.gameProfile.version],
          ['Build', oldBuild, newBuild],
          ['Engine', oldRecord.request.gameProfile.engine.type, newRecord.request.gameProfile.engine.type],
          ['Adapter', oldRecord.request.runConfig.adapterType, newRecord.request.runConfig.adapterType],
          ['Status', oldRecord.status, newRecord.status],
          ['Started', oldRecord.startedAt ?? 'not started', newRecord.startedAt ?? 'not started'],
          ['Stopped', oldRecord.stoppedAt ?? 'not stopped', newRecord.stoppedAt ?? 'not stopped']
        ]
      ),
      '## Summary',
      markdownTable(
        ['Metric', 'Value'],
        [
          ['Old total issues', String(data.summary.oldTotalIssues)],
          ['New total issues', String(data.summary.newTotalIssues)],
          ['New issue fingerprints', String(data.summary.newIssues)],
          ['Fixed issue fingerprints', String(data.summary.fixedIssues)],
          ['Repeated issue fingerprints', String(data.summary.repeatedIssues)],
          ['Worsened repeated issues', String(data.summary.worsenedIssues)],
          ['Issue count change', formatSignedNumber(data.summary.newTotalIssues - data.summary.oldTotalIssues)],
          ['Coverage change', `${formatSignedNumber(data.summary.coverageDeltaPercent)} percentage points`],
          ['Crash frequency change', formatSignedNumber(data.summary.crashFrequencyDelta)]
        ]
      ),
      '## New Issues',
      markdownTable(
        ['Title', 'Category', 'Severity', 'Scene/Area', 'Bots', 'Count', 'Fingerprint'],
        this.issueGroupRows(data.newIssueGroups),
        '_No new issue fingerprints._'
      ),
      '## Fixed Issues',
      markdownTable(
        ['Title', 'Category', 'Severity', 'Scene/Area', 'Bots', 'Count', 'Fingerprint'],
        this.issueGroupRows(data.fixedIssueGroups),
        '_No fixed issue fingerprints._'
      ),
      '## Repeated Issues',
      markdownTable(
        ['Title', 'Category', 'Severity Change', 'Scene/Area', 'Old Count', 'New Count', 'Fingerprint'],
        this.repeatedIssueRows(data.repeatedIssuePairs),
        '_No repeated issue fingerprints._'
      ),
      '## Worsened Issues',
      markdownTable(
        ['Title', 'Category', 'Severity Change', 'Scene/Area', 'Old Count', 'New Count', 'Fingerprint'],
        this.repeatedIssueRows(data.worsenedIssuePairs),
        '_No repeated issues worsened in severity._'
      ),
      '## Improved Issue Count',
      markdownTable(
        ['Metric', 'Old', 'New', 'Delta'],
        [
          [
            'Total issues',
            String(data.summary.oldTotalIssues),
            String(data.summary.newTotalIssues),
            formatSignedNumber(data.summary.newTotalIssues - data.summary.oldTotalIssues)
          ],
          [
            'Repeated issues with improved severity',
            String(data.improvedSeverityPairs.length),
            String(data.improvedSeverityPairs.length),
            data.improvedSeverityPairs.length > 0 ? 'severity improved' : 'no severity improvement'
          ]
        ]
      ),
      '## Coverage Difference',
      markdownTable(
        ['Metric', 'Old', 'New', 'Delta'],
        [
          [
            'Known content coverage',
            `${oldRecord.coverageTracker.getSummary().percentage}%`,
            `${newRecord.coverageTracker.getSummary().percentage}%`,
            `${formatSignedNumber(data.summary.coverageDeltaPercent)} points`
          ],
          [
            'Tested known content',
            `${data.coverage.oldSummary.testedKnown}/${data.coverage.oldSummary.totalKnown}`,
            `${data.coverage.newSummary.testedKnown}/${data.coverage.newSummary.totalKnown}`,
            formatSignedNumber(data.coverage.newSummary.testedKnown - data.coverage.oldSummary.testedKnown)
          ],
          [
            'Observed content',
            String(data.coverage.oldSummary.totalObserved),
            String(data.coverage.newSummary.totalObserved),
            formatSignedNumber(data.coverage.newSummary.totalObserved - data.coverage.oldSummary.totalObserved)
          ]
        ]
      ),
      '### Newly Covered Content',
      markdownTable(['Content'], data.coverage.newlyCovered.map((item) => [item]), '_No newly covered content._'),
      '### No Longer Covered Content',
      markdownTable(['Content'], data.coverage.noLongerCovered.map((item) => [item]), '_No previously covered content was lost._'),
      '## Bot Progress',
      '### Bots That Got Further Than Before',
      markdownTable(
        ['Bot', 'Profile', 'Old Actions', 'New Actions', 'Old Area', 'New Area', 'Status Change'],
        data.botProgress.further.map(({ oldBot, newBot }) => [
          newBot.botId,
          newBot.profileId,
          String(oldBot.actionCount),
          String(newBot.actionCount),
          oldBot.currentArea,
          newBot.currentArea,
          `${oldBot.status} -> ${newBot.status}`
        ]),
        '_No bots got further than the old session._'
      ),
      '### Bots That Got Stuck Earlier Than Before',
      markdownTable(
        ['Bot', 'Profile', 'Old Actions', 'New Actions', 'Old Progress', 'New Progress'],
        data.botProgress.stuckEarlier.map(({ oldBot, newBot }) => [
          newBot.botId,
          newBot.profileId,
          String(oldBot.actionCount),
          String(newBot.actionCount),
          oldBot.progressState,
          newBot.progressState
        ]),
        '_No bots got stuck earlier than before._'
      ),
      '## Performance Changes',
      markdownTable(
        ['Metric', 'Old', 'New', 'Delta'],
        [
          [
            'Estimated CPU',
            formatPercent(oldPerf.estimatedCpuPercent),
            formatPercent(newPerf.estimatedCpuPercent),
            `${formatSignedNumber(Math.round(newPerf.estimatedCpuPercent - oldPerf.estimatedCpuPercent))} points`
          ],
          [
            'Estimated RAM',
            formatMegabytes(oldPerf.estimatedRamMb),
            formatMegabytes(newPerf.estimatedRamMb),
            formatMegabytes(newPerf.estimatedRamMb - oldPerf.estimatedRamMb)
          ],
          [
            'Estimated GPU',
            formatPercent(oldPerf.estimatedGpuPercent),
            formatPercent(newPerf.estimatedGpuPercent),
            typeof oldPerf.estimatedGpuPercent === 'number' && typeof newPerf.estimatedGpuPercent === 'number'
              ? `${formatSignedNumber(Math.round(newPerf.estimatedGpuPercent - oldPerf.estimatedGpuPercent))} points`
              : 'n/a'
          ],
          [
            'Current CPU estimate',
            formatPercent(oldPerf.currentCpuPercent),
            formatPercent(newPerf.currentCpuPercent),
            `${formatSignedNumber(Math.round(newPerf.currentCpuPercent - oldPerf.currentCpuPercent))} points`
          ],
          [
            'Current RAM estimate',
            formatMegabytes(oldPerf.currentRamMb),
            formatMegabytes(newPerf.currentRamMb),
            formatMegabytes(newPerf.currentRamMb - oldPerf.currentRamMb)
          ],
          [
            'Current GPU estimate',
            formatPercent(oldPerf.currentGpuPercent),
            formatPercent(newPerf.currentGpuPercent),
            typeof oldPerf.currentGpuPercent === 'number' && typeof newPerf.currentGpuPercent === 'number'
              ? `${formatSignedNumber(Math.round(newPerf.currentGpuPercent - oldPerf.currentGpuPercent))} points`
              : 'n/a'
          ]
        ]
      ),
      '## Crash Frequency Changes',
      markdownTable(
        ['Metric', 'Old', 'New', 'Delta'],
        [
          [
            'Crash issues',
            String(data.crashFrequency.oldCount),
            String(data.crashFrequency.newCount),
            formatSignedNumber(data.crashFrequency.newCount - data.crashFrequency.oldCount)
          ]
        ]
      ),
      '## Fingerprinting Notes',
      [
        'Issue comparisons use normalized category, scene/area, title, state-summary signature, and last-action pattern.',
        'Exact fingerprints also track severity. Severity changes are evaluated on comparable fingerprints so repeated issues can still be marked as worsened or improved.'
      ].join('\n'),
      ''
    ].join('\n');
  }

  private issueGroupRows(groups: IssueComparisonGroup[]): string[][] {
    return groups.map((group) => {
      const issue = group.exemplar;
      const botIds = uniqueStrings(group.issues.map((item) => item.botId));

      return [
        issue.title,
        issue.category,
        group.maxSeverity,
        issueLocation(issue),
        botIds.length > 0 ? botIds.join(', ') : 'n/a',
        String(group.issues.length),
        fingerprintPreview(group.fingerprint)
      ];
    });
  }

  private repeatedIssueRows(pairs: Array<{ oldGroup: IssueComparisonGroup; newGroup: IssueComparisonGroup }>): string[][] {
    return pairs.map(({ oldGroup, newGroup }) => {
      const issue = newGroup.exemplar;

      return [
        issue.title,
        issue.category,
        `${oldGroup.maxSeverity} -> ${newGroup.maxSeverity}`,
        issueLocation(issue),
        String(oldGroup.issues.length),
        String(newGroup.issues.length),
        fingerprintPreview(newGroup.fingerprint)
      ];
    });
  }

  private snapshotFor(record: SimulationSessionRecord): SimulationSessionStatusSnapshot {
    return {
      status: record.status,
      label: record.label,
      activeSessionId: record.request.runConfig.sessionId,
      sessionId: record.request.runConfig.sessionId,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      stoppedAt: record.stoppedAt,
      botCount: record.botStatuses.length,
      instanceCount: record.instanceStatuses.length
    };
  }

  private clearSessionTimer(sessionId: string): void {
    const record = this.sessions.get(sessionId);

    if (record?.startupTimer) {
      clearTimeout(record.startupTimer);
      record.startupTimer = undefined;
    }
  }

  private captureScreenshotEvidence(
    record: SimulationSessionRecord,
    input: {
      botId?: string;
      instanceId?: string;
      reason: string;
      memory?: BotMemory;
      issueId?: string;
      evidenceKey?: string;
    }
  ): string | undefined {
    if (!record.request.runConfig.saveScreenshots || !input.botId) {
      return undefined;
    }

    const evidenceKey = input.evidenceKey ?? `${input.botId}:${input.reason}:${input.issueId ?? 'manual'}`;

    if (record.loggedEvidenceKeys.has(evidenceKey)) {
      return undefined;
    }

    record.loggedEvidenceKeys.add(evidenceKey);

    try {
      const botLogger = record.structuredLogger.ensureBot(input.botId);
      mkdirSync(botLogger.screenshotsDir, { recursive: true });
      const capturedAt = this.now();
      const fileName = `${safePathSegment(input.reason)}-${safePathSegment(input.issueId ?? String(record.loggedEvidenceKeys.size))}.svg`;
      const screenshotPath = join(botLogger.screenshotsDir, fileName);
      const svg = screenshotSvg({
        sessionId: record.request.runConfig.sessionId,
        botId: input.botId,
        instanceId: input.instanceId,
        reason: input.reason,
        capturedAt,
        area: input.memory?.currentArea,
        lastAction: input.memory?.lastAction?.type,
        progressState: input.memory?.progressState
      });

      writeFileSync(screenshotPath, svg, 'utf8');

      if (input.memory?.lastState) {
        input.memory.lastState.screenshotPath = screenshotPath;
      }

      record.structuredLogger.logSession(
        'state_snapshot',
        {
          evidence: 'screenshot',
          reason: input.reason,
          screenshotPath,
          issueId: input.issueId
        },
        {
          botId: input.botId,
          gameInstanceId: input.instanceId,
          timestamp: capturedAt
        }
      );

      return screenshotPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Screenshot capture failed.';
      record.logs.push(this.createLog(record.request.runConfig.sessionId, 'warn', `Screenshot capture failed: ${message}`));
      return undefined;
    }
  }

  private startVideoEvidence(record: SimulationSessionRecord): void {
    if (!record.request.runConfig.saveVideo) {
      return;
    }

    for (const bot of record.botStatuses) {
      if (!bot.gameInstanceId) {
        continue;
      }

      try {
        const botLogger = record.structuredLogger.ensureBot(bot.botId);
        mkdirSync(botLogger.videoDir, { recursive: true });
        const videoPath = join(botLogger.videoDir, `${safePathSegment(bot.botId)}-video-capture.json`);
        const startedAt = this.now();

        writeFileSync(
          videoPath,
          `${JSON.stringify(
            {
              type: 'mock-video-capture',
              status: 'recording',
              sessionId: record.request.runConfig.sessionId,
              botId: bot.botId,
              instanceId: bot.gameInstanceId,
              startedAt
            },
            null,
            2
          )}\n`,
          'utf8'
        );
        record.videoPathsByBot.set(bot.botId, videoPath);
        record.structuredLogger.logSession(
          'state_snapshot',
          {
            evidence: 'video_start',
            videoPath
          },
          {
            botId: bot.botId,
            gameInstanceId: bot.gameInstanceId,
            timestamp: startedAt
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Video capture failed to start.';
        record.logs.push(this.createLog(record.request.runConfig.sessionId, 'warn', `Video capture failed to start: ${message}`));
      }
    }
  }

  private stopVideoEvidenceForBot(record: SimulationSessionRecord, botId: string): void {
    const videoPath = record.videoPathsByBot.get(botId);

    if (!videoPath) {
      return;
    }

    const bot = record.botStatuses.find((item) => item.botId === botId);
    const stoppedAt = this.now();

    try {
      writeFileSync(
        videoPath,
        `${JSON.stringify(
          {
            type: 'mock-video-capture',
            status: 'stopped',
            sessionId: record.request.runConfig.sessionId,
            botId,
            instanceId: bot?.gameInstanceId,
            startedAt: record.startedAt,
            stoppedAt
          },
          null,
          2
        )}\n`,
        'utf8'
      );
      record.structuredLogger.logSession(
        'state_snapshot',
        {
          evidence: 'video_stop',
          videoPath
        },
        {
          botId,
          gameInstanceId: bot?.gameInstanceId,
          timestamp: stoppedAt
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Video capture failed to stop.';
      record.logs.push(this.createLog(record.request.runConfig.sessionId, 'warn', `Video capture failed to stop: ${message}`));
    }
  }

  private stopVideoEvidence(record: SimulationSessionRecord): void {
    for (const botId of record.videoPathsByBot.keys()) {
      this.stopVideoEvidenceForBot(record, botId);
    }
  }

  private addEvidencePath(issue: DetectedIssue, evidencePath: string | undefined): void {
    if (!evidencePath) {
      return;
    }

    issue.evidencePaths = [...new Set([...(issue.evidencePaths ?? []), evidencePath])];
  }

  private async readStructuredLogFile(
    path: string,
    source: Pick<StructuredLogItem, 'source' | 'botId' | 'instanceId'>
  ): Promise<StructuredLogItem[]> {
    let contents = '';

    try {
      contents = await readFile(path, 'utf8');
    } catch {
      return [];
    }

    return contents
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return {
            eventType: 'invalid_json',
            timestamp: this.now(),
            line
          };
        }
      })
      .map((raw) => this.structuredLogItemFromRaw(raw, source));
  }

  private structuredLogItemFromRaw(
    raw: Record<string, unknown>,
    source: Pick<StructuredLogItem, 'source' | 'botId' | 'instanceId'>
  ): StructuredLogItem {
    const eventType = typeof raw.eventType === 'string' ? raw.eventType : undefined;
    const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : undefined;
    const botId =
      source.botId ??
      (typeof raw.botId === 'string' ? raw.botId : undefined) ??
      this.valueAtPath(raw, ['action', 'botId']) ??
      this.valueAtPath(raw, ['snapshot', 'botId']) ??
      this.valueAtPath(raw, ['issue', 'botId']);
    const instanceId =
      source.instanceId ??
      (typeof raw.gameInstanceId === 'string' ? raw.gameInstanceId : undefined) ??
      this.valueAtPath(raw, ['action', 'gameInstanceId']) ??
      this.valueAtPath(raw, ['snapshot', 'gameInstanceId']) ??
      this.valueAtPath(raw, ['issue', 'gameInstanceId']);
    const actionType = this.valueAtPath(raw, ['action', 'type']);
    const issueTitle = this.valueAtPath(raw, ['issue', 'title']);
    const scene = this.valueAtPath(raw, ['snapshot', 'scene']);
    const payloadSummary =
      typeof raw.payload === 'object' && raw.payload !== null
        ? JSON.stringify(raw.payload)
        : undefined;

    return {
      ...source,
      botId,
      instanceId,
      eventType,
      timestamp,
      summary:
        issueTitle ??
        actionType ??
        scene ??
        payloadSummary ??
        eventType ??
        source.source,
      raw
    };
  }

  private valueAtPath(raw: Record<string, unknown>, path: string[]): string | undefined {
    let current: unknown = raw;

    for (const part of path) {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        return undefined;
      }

      current = (current as Record<string, unknown>)[part];
    }

    return typeof current === 'string' ? current : undefined;
  }

  private logSessionStart(record: SimulationSessionRecord): void {
    if (record.sessionStartLogged) {
      return;
    }

    record.sessionStartLogged = true;
    record.structuredLogger.logSession(
      'session_start',
      {
        status: record.status,
        gameName: record.request.gameProfile.gameName,
        runMode: record.request.runConfig.runMode,
        botCount: record.botStatuses.length,
        instanceCount: record.instanceStatuses.length
      },
      { timestamp: record.startedAt }
    );
  }

  private logSessionStop(record: SimulationSessionRecord, reason: string): void {
    if (record.sessionStopLogged) {
      return;
    }

    record.sessionStopLogged = true;
    for (const instance of record.instanceStatuses) {
      this.logInstanceStop(record, instance, reason);
    }
    for (const bot of record.botStatuses) {
      if (['blocked', 'completed', 'failed', 'stopped'].includes(bot.status)) {
        this.logBotStop(record, bot.botId, reason);
      }
    }
    record.structuredLogger.logSession(
      'session_stop',
      {
        status: record.status,
        reason,
        botCount: record.botStatuses.length,
        issueCount: record.issues.length
      },
      { timestamp: record.stoppedAt }
    );
  }

  private logInstanceStart(record: SimulationSessionRecord, instance: GameInstanceStatus): void {
    if (record.loggedStartedInstanceIds.has(instance.instanceId)) {
      return;
    }

    record.loggedStartedInstanceIds.add(instance.instanceId);
    const event = record.structuredLogger.logSession(
      'instance_start',
      {
        status: instance.status,
        adapterType: instance.adapterType,
        assignedBots: instance.assignedBots
      },
      {
        gameInstanceId: instance.instanceId,
        timestamp: instance.startTime
      }
    );
    record.structuredLogger.logInstance(event, instance);
  }

  private logInstanceStop(record: SimulationSessionRecord, instance: GameInstanceStatus, reason: string): void {
    if (record.loggedStoppedInstanceIds.has(instance.instanceId)) {
      return;
    }

    record.loggedStoppedInstanceIds.add(instance.instanceId);
    const event = record.structuredLogger.logSession(
      'instance_stop',
      {
        status: instance.status,
        reason,
        assignedBots: instance.assignedBots
      },
      {
        gameInstanceId: instance.instanceId,
        timestamp: instance.lastHeartbeat
      }
    );
    record.structuredLogger.logInstance(event, instance);
  }

  private logBotStart(record: SimulationSessionRecord, botId: string): void {
    if (record.loggedStartedBotIds.has(botId)) {
      return;
    }

    const bot = record.botStatuses.find((item) => item.botId === botId);
    if (!bot) {
      return;
    }

    record.loggedStartedBotIds.add(botId);
    record.structuredLogger.logSession(
      'bot_start',
      {
        profileId: bot.profileId,
        displayName: bot.displayName,
        playstyle: bot.playstyle,
        status: bot.status
      },
      {
        botId,
        gameInstanceId: bot.gameInstanceId
      }
    );
  }

  private logBotStop(record: SimulationSessionRecord, botId: string, reason: string): void {
    if (record.loggedStoppedBotIds.has(botId)) {
      return;
    }

    const bot = record.botStatuses.find((item) => item.botId === botId);
    if (!bot) {
      return;
    }

    record.loggedStoppedBotIds.add(botId);
    this.stopVideoEvidenceForBot(record, botId);
    record.structuredLogger.logSession(
      'bot_stop',
      {
        profileId: bot.profileId,
        displayName: bot.displayName,
        status: bot.status,
        reason,
        lastActionId: bot.lastActionId,
        progressState: bot.progressState
      },
      {
        botId,
        gameInstanceId: bot.gameInstanceId
      }
    );
  }

  private logRuntimeArtifacts(
    record: SimulationSessionRecord,
    status: RuntimeBotSnapshot,
    memory: BotMemory
  ): void {
    if (['starting', 'running', 'waiting'].includes(status.status)) {
      this.logBotStart(record, status.botId);
    }

    if (memory.lastState && !record.loggedStateSnapshotIds.has(memory.lastState.snapshotId)) {
      record.loggedStateSnapshotIds.add(memory.lastState.snapshotId);
      const event = record.structuredLogger.logSession(
        'state_snapshot',
        {
          snapshotId: memory.lastState.snapshotId,
          scene: memory.lastState.scene,
          screenshotPath: memory.lastState.screenshotPath
        },
        {
          botId: status.botId,
          gameInstanceId: status.gameInstanceId,
          timestamp: memory.lastState.capturedAt
        }
      );
      record.structuredLogger.logState(event, memory.lastState);
      record.coverageTracker.recordSnapshot(memory.lastState, {
        botId: status.botId,
        profileId: status.profileId
      });
    }

    if (memory.lastAction && !record.loggedActionIds.has(memory.lastAction.actionId)) {
      record.loggedActionIds.add(memory.lastAction.actionId);
      const event = record.structuredLogger.logSession(
        'action_performed',
        {
          actionId: memory.lastAction.actionId,
          actionType: memory.lastAction.type,
          status: memory.lastResult?.status,
          durationMs: memory.lastResult?.durationMs,
          recovery: memory.lastAction.payload.recovery === true
        },
        {
          botId: status.botId,
          gameInstanceId: status.gameInstanceId,
          timestamp: memory.lastResult?.completedAt ?? memory.lastAction.requestedAt
        }
      );
      record.structuredLogger.logAction(event, memory.lastAction, memory.lastResult ?? undefined);
      record.coverageTracker.recordAction(memory.lastAction, {
        botId: status.botId,
        profileId: status.profileId
      });

      const everyNActions = record.request.runConfig.screenshotEveryNActions;
      if (
        everyNActions &&
        memory.actionCount > 0 &&
        memory.actionCount % everyNActions === 0 &&
        record.lastPeriodicScreenshotActionCountByBot.get(status.botId) !== memory.actionCount
      ) {
        record.lastPeriodicScreenshotActionCountByBot.set(status.botId, memory.actionCount);
        this.captureScreenshotEvidence(record, {
          botId: status.botId,
          instanceId: status.gameInstanceId,
          reason: `action-${memory.actionCount}`,
          memory,
          evidenceKey: `${status.botId}:periodic:${memory.actionCount}`
        });
      }
    }

    if (memory.stuckReason && ['waiting', 'blocked'].includes(status.status)) {
      this.captureScreenshotEvidence(record, {
        botId: status.botId,
        instanceId: status.gameInstanceId,
        reason: 'stuck',
        memory,
        evidenceKey: `${status.botId}:stuck:${memory.stuckReason}`
      });
    }

    if (memory.progressState?.startsWith('Recovery failed')) {
      this.captureScreenshotEvidence(record, {
        botId: status.botId,
        instanceId: status.gameInstanceId,
        reason: 'recovery-failed',
        memory,
        evidenceKey: `${status.botId}:recovery-failed:${memory.actionCount}`
      });
    }

    for (const attempt of memory.recoveryAttempts) {
      if (!record.loggedRecoveryAttemptIds.has(attempt.attemptId)) {
        record.loggedRecoveryAttemptIds.add(attempt.attemptId);
        record.structuredLogger.logSession(
          'recovery_attempt',
          {
            attemptId: attempt.attemptId,
            recoveryType: attempt.recoveryType,
            resultStatuses: attempt.resultStatuses
          },
          {
            botId: status.botId,
            gameInstanceId: status.gameInstanceId,
            timestamp: attempt.startedAt
          }
        );
      }

      if (attempt.recovered === true && !record.loggedRecoverySuccessIds.has(attempt.attemptId)) {
        record.loggedRecoverySuccessIds.add(attempt.attemptId);
        record.structuredLogger.logSession(
          'recovery_success',
          {
            attemptId: attempt.attemptId,
            recoveryType: attempt.recoveryType,
            resultStatuses: attempt.resultStatuses
          },
          {
            botId: status.botId,
            gameInstanceId: status.gameInstanceId,
            timestamp: attempt.completedAt
          }
        );
      }

      if (attempt.recovered === false && !record.loggedRecoveryFailedIds.has(attempt.attemptId)) {
        record.loggedRecoveryFailedIds.add(attempt.attemptId);
        record.structuredLogger.logSession(
          'recovery_failed',
          {
            attemptId: attempt.attemptId,
            recoveryType: attempt.recoveryType,
            resultStatuses: attempt.resultStatuses
          },
          {
            botId: status.botId,
            gameInstanceId: status.gameInstanceId,
            timestamp: attempt.completedAt
          }
        );
      }
    }

    if (['blocked', 'completed', 'failed', 'stopped'].includes(status.status)) {
      this.logBotStop(record, status.botId, status.status);
    }
  }

  private logDetectedIssue(record: SimulationSessionRecord, issue: DetectedIssue): void {
    if (record.loggedIssueIds.has(issue.issueId)) {
      return;
    }

    record.loggedIssueIds.add(issue.issueId);
    const event = record.structuredLogger.logSession(
      'issue_detected',
      {
        issueId: issue.issueId,
        severity: issue.severity,
        category: issue.category,
        title: issue.title
      },
      {
        botId: issue.botId,
        gameInstanceId: issue.gameInstanceId,
        timestamp: issue.firstSeenAt
      }
    );
    record.structuredLogger.logIssue(event, issue, record.loggedIssueIds.size, {
      gameName: record.request.gameProfile.gameName,
      gameEngine: record.request.gameProfile.engine.version
        ? `${record.request.gameProfile.engine.type} ${record.request.gameProfile.engine.version}`
        : record.request.gameProfile.engine.type,
      gameVersion: record.request.gameProfile.version,
      gameBuild: record.request.gameProfile.buildId,
      adapterType: record.request.runConfig.adapterType
    });

    if (issue.category === 'crash') {
      record.structuredLogger.logSession('crash', { issueId: issue.issueId, title: issue.title }, {
        botId: issue.botId,
        gameInstanceId: issue.gameInstanceId,
        timestamp: issue.firstSeenAt
      });
    }

    if (issue.category === 'hang') {
      record.structuredLogger.logSession('freeze', { issueId: issue.issueId, title: issue.title }, {
        botId: issue.botId,
        gameInstanceId: issue.gameInstanceId,
        timestamp: issue.firstSeenAt
      });
    }
  }

  private writeStructuredReports(record: SimulationSessionRecord): void {
    const bots = this.botReportInputsForRecord(record);
    const coverage = this.contentCoverageForRecord(record);

    record.structuredLogger.writeSummary({
      status: record.status,
      runConfig: record.request.runConfig,
      gameProfile: record.request.gameProfile,
      viabilityReport: record.viabilityReport,
      bots,
      instances: record.instanceStatuses,
      issues: record.issues,
      contentCoveragePercent: coverage.percentage,
      testedContent: coverage.testedContent,
      untestedContent: coverage.untestedContent,
      contentWithIssues: coverage.contentWithIssues,
      contentByBotType: coverage.contentByBotType,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      stoppedAt: record.stoppedAt
    });
    record.structuredLogger.writeBotReports(bots);
  }

  private botReportInputsForRecord(record: SimulationSessionRecord): BotReportInput[] {
    return record.botStatuses.map((bot) => {
      const memory = record.botManager.getMemory(bot.botId);
      const issues = record.issues.filter((issue) => issue.botId === bot.botId);
      const areasVisited = uniqueStrings([
        bot.currentArea,
        memory?.currentArea,
        memory?.progressSummary?.latestScene,
        memory?.lastState?.scene,
        ...issues.flatMap((issue) => [issue.scene, issue.area])
      ]);
      const finalState = memory?.lastState?.state ?? {
        status: bot.status,
        currentArea: bot.currentArea,
        progressState: bot.progressState,
        message: bot.message
      };

      return {
        botId: bot.botId,
        displayName: bot.displayName,
        profileId: bot.profileId,
        playstyle: bot.playstyle,
        status: bot.status,
        actionCount: memory?.actionCount ?? 0,
        issueCount: issues.length,
        lastActionId: bot.lastActionId,
        progressState: bot.progressState,
        currentArea: bot.currentArea,
        stopReason: bot.message ?? bot.progressState,
        areasVisited,
        issues,
        lastActions: memory?.recentActionTypes ?? [],
        recoveryAttempts: memory?.recoveryAttempts ?? [],
        finalState
      };
    });
  }

  private contentCoverageForRecord(record: SimulationSessionRecord): {
    percentage: number;
    testedContent: string[];
    untestedContent: string[];
    contentWithIssues: string[];
    contentByBotType: string[];
  } {
    const summary = record.coverageTracker.getSummary();

    return {
      percentage: summary.percentage,
      testedContent:
        summary.testedContent.length > 0
          ? summary.testedContent.map((item) => `${item.category}: ${item.label}`)
          : ['No content coverage observed'],
      untestedContent:
        summary.untestedContent.length > 0
          ? summary.untestedContent.map((item) => `${item.category}: ${item.label}`)
          : ['No untested known content'],
      contentWithIssues:
        summary.contentWithIssues.length > 0
          ? summary.contentWithIssues.map((item) => `${item.category}: ${item.label} (${item.issueIds.length} issue${item.issueIds.length === 1 ? '' : 's'})`)
          : ['No issue-linked content'],
      contentByBotType:
        summary.byBotType.length > 0
          ? summary.byBotType.map((item) => `${item.botType}: ${item.testedCount} content item${item.testedCount === 1 ? '' : 's'}`)
          : ['No bot-type coverage yet']
    };
  }

  private coverageForRecord(record: SimulationSessionRecord): CoverageData {
    const visitedScenes = new Set<string>();
    const visitedActions = new Set<string>();
    const actionCounts: Record<string, number> = {};
    const sceneCounts: Record<string, number> = {};

    for (const bot of record.botStatuses) {
      if (bot.currentArea) {
        visitedScenes.add(bot.currentArea);
        sceneCounts[bot.currentArea] = (sceneCounts[bot.currentArea] ?? 0) + 1;
      }

      const memory = record.botManager.getMemory(bot.botId);

      for (const actionType of memory?.recentActionTypes ?? []) {
        visitedActions.add(actionType);
        actionCounts[actionType] = (actionCounts[actionType] ?? 0) + 1;
      }
    }

    return {
      visitedScenes: [...visitedScenes],
      visitedActions: [...visitedActions],
      actionCounts,
      sceneCounts,
      discoveredContentIds: record.issues.map((issue) => issue.issueId)
    };
  }

  private updateBotStatus(
    record: SimulationSessionRecord,
    status: RuntimeBotSnapshot,
    memory: BotMemory
  ): void {
    const botIndex = record.botStatuses.findIndex((bot) => bot.botId === status.botId);

    if (botIndex === -1) {
      return;
    }

    const current = record.botStatuses[botIndex];
    const issueCount = record.issues.filter((issue) => issue.botId === status.botId).length;

    record.botStatuses[botIndex] = {
      ...current,
      status: status.status,
      gameInstanceId: status.gameInstanceId,
      currentGoalId: status.currentGoalId,
      lastActionId: status.lastActionId,
      currentArea: memory.currentArea ?? current.currentArea,
      progressState: memory.progressState ?? status.message ?? current.progressState,
      issueCount,
      message: status.message
    };
    record.tick = record.botStatuses.reduce((total, bot) => {
      const memory = record.botManager.getMemory(bot.botId);
      return total + (memory?.actionCount ?? 0);
    }, 0);
    record.instanceStatuses = record.instanceStatuses.map((instance, index) => ({
      ...instance,
      status: record.status === 'running' ? 'running' : instance.status,
      lastHeartbeat: this.now(),
      resourceUsage: {
        cpuPercent: Math.min(95, 10 + record.tick * 1.5 + index * 3),
        ramMb: 512 + record.botStatuses.length * 96 + index * 160,
        gpuPercent: record.request.runConfig.saveVideo ? Math.min(80, 6 + record.tick + index) : undefined
      }
    }));
    record.label = statusLabel(record);

    if (['blocked', 'failed'].includes(status.status)) {
      this.createSyntheticIssue(record, status, memory);
    }

    this.detectAutomaticIssues(record, status, memory);
    this.logRuntimeArtifacts(record, status, memory);
    this.writeStructuredReports(record);
    this.completeSessionIfNoActiveBots(record);
  }

  private detectAutomaticIssues(
    record: SimulationSessionRecord,
    status: RuntimeBotSnapshot,
    memory: BotMemory
  ): void {
    const instanceStatus = status.gameInstanceId
      ? record.instanceStatuses.find((instance) => instance.instanceId === status.gameInstanceId)
      : undefined;
    const issues = record.issueDetectionRunner.detect({
      sessionId: record.request.runConfig.sessionId,
      botId: status.botId,
      instanceId: status.gameInstanceId,
      timestamp: this.now(),
      memory,
      instanceStatus,
      recentIssues: record.issues
    });

    for (const issue of issues) {
      this.recordDetectedIssue(record, issue);
    }

    if (issues.some((issue) => issue.severity === 'critical') && record.request.runConfig.stopOnCriticalIssue) {
      this.stopForCriticalIssue(record, issues.find((issue) => issue.severity === 'critical'));
    }
  }

  private recordDetectedIssue(record: SimulationSessionRecord, issue: DetectedIssue): boolean {
    if (record.issues.some((existing) => existing.issueId === issue.issueId || existing.id === issue.id)) {
      return false;
    }

    const memory = issue.botId ? record.botManager.getMemory(issue.botId) : undefined;
    const screenshotPath = this.captureScreenshotEvidence(record, {
      botId: issue.botId,
      instanceId: issue.gameInstanceId,
      reason: 'issue-detected',
      memory,
      issueId: issue.issueId,
      evidenceKey: `${issue.botId ?? 'session'}:issue:${issue.issueId}`
    });
    const videoPath = issue.botId ? record.videoPathsByBot.get(issue.botId) : undefined;

    issue.screenshotPath = issue.screenshotPath ?? screenshotPath;
    issue.videoPath = issue.videoPath ?? videoPath;
    this.addEvidencePath(issue, issue.screenshotPath);
    this.addEvidencePath(issue, issue.videoPath);

    record.issues.push(issue);
    record.coverageTracker.recordIssue(issue);
    this.logDetectedIssue(record, issue);
    return true;
  }

  private stopForCriticalIssue(record: SimulationSessionRecord, issue: DetectedIssue | undefined): void {
    if (record.status === 'stopped' || record.status === 'stopping') {
      return;
    }

    const sessionId = record.request.runConfig.sessionId;
    record.logs.push(this.createLog(sessionId, 'error', `Critical issue stopped session: ${issue?.title ?? 'Unknown issue'}.`));
    record.structuredLogger.logSession('manual_stop', {
      scope: 'session',
      reason: 'critical_issue',
      issueId: issue?.issueId,
      title: issue?.title
    });
    this.clearSessionTimer(sessionId);
    record.botManager.stopAll();
    record.status = 'stopped';
    record.stoppedAt = this.now();
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: ['blocked', 'completed', 'failed'].includes(bot.status) ? bot.status : 'stopped',
      progressState: ['blocked', 'completed', 'failed'].includes(bot.status)
        ? bot.progressState
        : `Stopped after critical issue: ${issue?.title ?? 'Unknown issue'}`,
      message: ['blocked', 'completed', 'failed'].includes(bot.status)
        ? bot.message
        : `Stopped after critical issue: ${issue?.title ?? 'Unknown issue'}`
    }));
    record.instanceStatuses = record.instanceStatuses.map((instance) => ({
      ...instance,
      status: 'stopped',
      lastHeartbeat: this.now()
    }));
    record.label = statusLabel(record);
    this.logSessionStop(record, 'critical_issue');
    this.stopVideoEvidence(record);
  }

  private createSyntheticIssue(
    record: SimulationSessionRecord,
    status: RuntimeBotSnapshot,
    memory: BotMemory
  ): void {
    const issueId = `${record.request.runConfig.sessionId}-${status.botId}-${status.status}`;
    const recoveryFailed = memory.progressState?.startsWith('Recovery failed') ?? false;

    if (record.issues.some((issue) => issue.issueId === issueId)) {
      return;
    }

    const lastActions = memory.recentActionTypes.slice(0, 10);
    const issue: DetectedIssue = {
      id: issueId,
      issueId,
      timestamp: this.now(),
      sessionId: record.request.runConfig.sessionId,
      instanceId: status.gameInstanceId,
      gameInstanceId: status.gameInstanceId,
      botId: status.botId,
      severity: status.status === 'failed' || recoveryFailed ? 'error' : 'warning',
      category: status.status === 'failed' ? 'unknown' : recoveryFailed ? 'progression' : 'navigation',
      title: status.status === 'failed' ? 'Bot runtime failure' : recoveryFailed ? 'Bot recovery failed' : 'Bot runtime blocked',
      description: memory.progressState,
      scene: memory.lastState?.scene,
      area: memory.currentArea,
      lastActions,
      stateSummary: memory.lastState ? JSON.stringify(memory.lastState.state).slice(0, 2000) : undefined,
      expectedBehavior: 'The bot should continue progressing or recover cleanly.',
      actualBehavior: memory.progressState,
      confidence: recoveryFailed ? 0.9 : 0.7,
      screenshotPath: memory.lastState?.screenshotPath,
      rawEvidence: {
        status,
        progressSummary: memory.progressSummary,
        recoveryAttempts: memory.recoveryAttempts
      },
      evidencePaths: [],
      actionTimelineIds: memory.lastAction ? [memory.lastAction.actionId] : [],
      firstSeenAt: this.now(),
      reproducible: false
    };

    this.recordDetectedIssue(record, issue);
  }

  private createLog(sessionId: string, level: LogEntry['level'], message: string): LogEntry {
    return {
      id: `${sessionId}-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      message,
      timestamp: this.now(),
      source: 'simulation-service'
    };
  }

  private completeSessionIfNoActiveBots(record: SimulationSessionRecord): void {
    const hasActiveBots = record.botStatuses.some(
      (bot) => !['blocked', 'stopped', 'completed', 'failed'].includes(bot.status)
    );

    if (hasActiveBots) {
      record.label = statusLabel(record);
      return;
    }

    this.clearSessionTimer(record.request.runConfig.sessionId);
    record.status = 'stopped';
    record.stoppedAt = this.now();
    record.instanceStatuses = record.instanceStatuses.map((instance) => ({
      ...instance,
      status: 'stopped',
      lastHeartbeat: this.now()
    }));
    record.logs.push(this.createLog(record.request.runConfig.sessionId, 'info', 'All mock bots are stopped.'));
    record.label = statusLabel(record);
    this.logSessionStop(record, 'all_bots_idle');
    this.stopVideoEvidence(record);
    this.writeStructuredReports(record);
  }

  private requireSession(sessionId: string): SimulationSessionRecord {
    const record = this.sessions.get(sessionId);

    if (!record) {
      throw new Error(`Session "${sessionId}" does not exist.`);
    }

    return record;
  }
}

export const simulationService = new SimulationService();
