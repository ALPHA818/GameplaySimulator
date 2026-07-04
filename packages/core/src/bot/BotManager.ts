import type { LogEntry } from '../logging/LogEntry';
import type {
  BotLaunchPlan,
  BotProfile,
  BotStatus,
  DetectedIssue,
  RuntimeBotSnapshot,
  SimulationRunConfig
} from '../types';
import type { CoverageData } from './ActionPlanner';
import { Bot, type BotAdapter, type BotMemory } from './Bot';

export interface BotManagerStatusEvent {
  plan: BotLaunchPlan;
  profile: BotProfile;
  status: RuntimeBotSnapshot;
  memory: BotMemory;
}

export interface BotManagerLogEvent {
  plan: BotLaunchPlan;
  profile: BotProfile;
  entry: LogEntry;
}

export interface BotManagerOptions {
  sessionId: string;
  runConfig: SimulationRunConfig;
  launchPlans: BotLaunchPlan[];
  botProfiles: BotProfile[];
  adapter: BotAdapter;
  maxConcurrentBots?: number;
  getCoverageData?: () => CoverageData;
  getRecentIssues?: () => DetectedIssue[];
  getInstanceHeartbeat?: (instanceId: string) => string | undefined;
  getProcessResponsive?: (instanceId: string) => boolean | undefined;
  maxRecoveryAttempts?: number;
  allowRestartGameInstanceRecovery?: boolean;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  onStatusChange?: (event: BotManagerStatusEvent) => void | Promise<void>;
  onLog?: (event: BotManagerLogEvent) => void | Promise<void>;
  onIdle?: () => void | Promise<void>;
}

interface ManagedBotRecord {
  plan: BotLaunchPlan;
  profile: BotProfile;
  bot: Bot;
  logs: LogEntry[];
  runPromise: Promise<void> | null;
}

const ACTIVE_STATUSES = new Set<BotStatus>(['starting', 'running', 'waiting']);
const TERMINAL_STATUSES = new Set<BotStatus>(['blocked', 'completed', 'failed', 'stopped']);

function concurrencyLimit(input: {
  runConfig: SimulationRunConfig;
  launchPlans: BotLaunchPlan[];
  maxConcurrentBots?: number;
}): number {
  const botCount = input.launchPlans.length;

  if (botCount === 0) {
    return 0;
  }

  if (input.runConfig.runMode === 'sequential') {
    return 1;
  }

  if (input.runConfig.runMode === 'parallel') {
    return botCount;
  }

  if (input.maxConcurrentBots !== undefined) {
    return Math.max(1, Math.min(botCount, input.maxConcurrentBots));
  }

  const instanceCount = new Set(input.launchPlans.map((plan) => plan.assignedGameInstanceId).filter(Boolean)).size;
  const effectiveInstanceCount = Math.max(1, instanceCount);
  const perInstanceLimit = Math.max(1, input.runConfig.perGameInstanceBotLimit);

  return Math.max(1, Math.min(botCount, effectiveInstanceCount * perInstanceLimit));
}

function assignedInstanceId(plan: BotLaunchPlan): string {
  return plan.assignedGameInstanceId ?? 'game-instance-001';
}

function isTerminal(status: BotStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export class BotManager {
  private readonly records = new Map<string, ManagedBotRecord>();
  private readonly orderedBotIds: string[];
  private readonly maxConcurrentBots: number;
  private readonly onStatusChange?: BotManagerOptions['onStatusChange'];
  private readonly onLog?: BotManagerOptions['onLog'];
  private readonly onIdle?: BotManagerOptions['onIdle'];
  private readonly idleResolvers: Array<() => void> = [];
  private running = false;
  private paused = false;
  private stopped = false;

  constructor(private readonly options: BotManagerOptions) {
    this.onStatusChange = options.onStatusChange;
    this.onLog = options.onLog;
    this.onIdle = options.onIdle;
    this.maxConcurrentBots = concurrencyLimit({
      runConfig: options.runConfig,
      launchPlans: options.launchPlans,
      maxConcurrentBots: options.maxConcurrentBots
    });

    const profilesById = new Map(options.botProfiles.map((profile) => [profile.profileId, profile]));
    const sortedPlans = [...options.launchPlans].sort((a, b) => a.launchIndex - b.launchIndex);

    this.orderedBotIds = sortedPlans.map((plan) => plan.botId);

    for (const plan of sortedPlans) {
      const profile = profilesById.get(plan.profileId);

      if (!profile) {
        continue;
      }

      const logs: LogEntry[] = [];
      const record: ManagedBotRecord = {
        plan,
        profile,
        logs,
        runPromise: null,
        bot: new Bot({
          botId: plan.botId,
          sessionId: options.sessionId,
          profile,
          assignedInstanceId: assignedInstanceId(plan),
          adapter: options.adapter,
          logger: {
            log: (entry) => {
              logs.push(entry);
              return this.onLog?.({
                plan,
                profile,
                entry
              });
            }
          },
          actionDelayMs: options.runConfig.actionDelayMs,
          maxActionsPerBot: options.runConfig.maxActionsPerBot,
          seed: plan.seed,
          getCoverageData: options.getCoverageData,
          getRecentIssues: options.getRecentIssues,
          getInstanceHeartbeat: options.getInstanceHeartbeat,
          getProcessResponsive: options.getProcessResponsive,
          maxRecoveryAttempts: options.maxRecoveryAttempts,
          allowRestartGameInstanceRecovery: options.allowRestartGameInstanceRecovery,
          now: options.now,
          sleep: options.sleep,
          onStatusChange: (status, memory) => this.handleStatusChange(plan.botId, status, memory)
        })
      };

      this.records.set(plan.botId, record);
    }
  }

  get concurrency(): number {
    return this.maxConcurrentBots;
  }

  get size(): number {
    return this.records.size;
  }

  startAll(): void {
    this.running = true;
    this.paused = false;
    this.stopped = false;
    this.dispatch();
    this.notifyIdleIfNeeded();
  }

  pauseAll(): void {
    this.paused = true;

    for (const record of this.records.values()) {
      record.bot.pause();
    }
  }

  resumeAll(): void {
    this.paused = false;

    for (const record of this.records.values()) {
      record.bot.resume();
    }

    if (this.running && !this.stopped) {
      this.dispatch();
    }
  }

  stopAll(): void {
    this.running = false;
    this.paused = false;
    this.stopped = true;

    for (const record of this.records.values()) {
      record.bot.stop();
    }

    this.notifyIdleIfNeeded();
  }

  stopBot(botId: string): boolean {
    const record = this.records.get(botId);

    if (!record || record.bot.status === 'stopped') {
      return false;
    }

    record.bot.stop();
    this.notifyIdleIfNeeded();
    return true;
  }

  stopBotPool(profileId: string): number {
    let stoppedCount = 0;

    for (const record of this.records.values()) {
      if (record.plan.profileId === profileId && this.stopBot(record.plan.botId)) {
        stoppedCount += 1;
      }
    }

    return stoppedCount;
  }

  getStatusSnapshots(): RuntimeBotSnapshot[] {
    return this.orderedRecords().map((record) => record.bot.getStatusSnapshot());
  }

  getMemory(botId: string): BotMemory | undefined {
    return this.records.get(botId)?.bot.memory;
  }

  getBotLogs(botId: string): LogEntry[] {
    return [...(this.records.get(botId)?.logs ?? [])];
  }

  getLogs(): LogEntry[] {
    return this.orderedRecords().flatMap((record) => record.logs.map((entry) => ({ ...entry })));
  }

  isIdle(): boolean {
    return this.activeCount() === 0 && this.nextQueuedRecord() === undefined;
  }

  whenIdle(): Promise<void> {
    if (this.isIdle()) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private orderedRecords(): ManagedBotRecord[] {
    return this.orderedBotIds
      .map((botId) => this.records.get(botId))
      .filter((record): record is ManagedBotRecord => record !== undefined);
  }

  private activeCount(): number {
    let count = 0;

    for (const record of this.records.values()) {
      if (record.runPromise || ACTIVE_STATUSES.has(record.bot.status)) {
        count += 1;
      }
    }

    return count;
  }

  private nextQueuedRecord(): ManagedBotRecord | undefined {
    return this.orderedRecords().find((record) => record.bot.status === 'queued' && !record.runPromise);
  }

  private dispatch(): void {
    if (!this.running || this.paused || this.stopped || this.maxConcurrentBots <= 0) {
      return;
    }

    while (this.activeCount() < this.maxConcurrentBots) {
      const next = this.nextQueuedRecord();

      if (!next) {
        break;
      }

      this.startRecord(next);
    }
  }

  private startRecord(record: ManagedBotRecord): void {
    if (record.runPromise || isTerminal(record.bot.status)) {
      return;
    }

    const runPromise = record.bot.start();
    record.runPromise = runPromise
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown bot manager runtime error.';
        record.logs.push({
          id: `${this.options.sessionId}-${record.plan.botId}-manager-error-${Date.now()}`,
          level: 'error',
          message,
          timestamp: this.options.now?.() ?? new Date().toISOString(),
          source: `bot-manager:${record.plan.botId}`
        });
      })
      .finally(() => {
        record.runPromise = null;

        if (this.running && !this.paused && !this.stopped) {
          this.dispatch();
        }

        this.notifyIdleIfNeeded();
      });
  }

  private handleStatusChange(botId: string, status: RuntimeBotSnapshot, memory: BotMemory): void | Promise<void> {
    const record = this.records.get(botId);

    if (!record) {
      return undefined;
    }

    if (!ACTIVE_STATUSES.has(status.status)) {
      this.notifyIdleIfNeeded();
    }

    return this.onStatusChange?.({
      plan: record.plan,
      profile: record.profile,
      status,
      memory
    });
  }

  private notifyIdleIfNeeded(): void {
    if (!this.isIdle()) {
      return;
    }

    while (this.idleResolvers.length > 0) {
      this.idleResolvers.shift()?.();
    }

    void this.onIdle?.();
  }
}
