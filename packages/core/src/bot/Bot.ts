import type {
  ActionResult,
  BotProfile,
  BotStatus,
  DetectedIssue,
  GameAction,
  GameStateSnapshot,
  RuntimeBotSnapshot,
  UIFlow
} from '../types';
import type { LogEntry, LogLevel } from '../logging/LogEntry';
import {
  ActionPlanner,
  type AvailableGameActionLike,
  type CoverageData
} from './ActionPlanner';
import { actionInsightFromAction, actionResultSummary } from './ActionExplanation';
import { currentUIScreen } from './UIJourneyPlanner';
import { ProgressTracker, type ProgressTrackerOptions, type ProgressSummary } from './ProgressTracker';
import { RecoveryManager, type RecoveryAttemptRecord } from './RecoveryManager';

export interface BotAdapter {
  getState(instanceId: string, botId: string): Promise<GameStateSnapshot | null>;
  getAvailableActions(instanceId: string, botId: string): Promise<AvailableGameActionLike[]>;
  performAction(instanceId: string, botId: string, action: GameAction): Promise<ActionResult>;
}

export interface BotLogger {
  log(entry: LogEntry): void | Promise<void>;
}

export interface BotMemory {
  actionCount: number;
  stateCount: number;
  errorCount: number;
  previousState: GameStateSnapshot | null;
  lastState: GameStateSnapshot | null;
  lastAction: GameAction | null;
  lastResult: ActionResult | null;
  recentActionTypes: string[];
  currentArea?: string;
  progressState?: string;
  stuckReason?: string;
  progressSummary?: ProgressSummary;
  recoveryMode?: boolean;
  recoveryAttempts: RecoveryAttemptRecord[];
  lastRecoveryAction?: GameAction;
  recoveredFromStuckReason?: string;
}

export interface BotOptions {
  botId: string;
  sessionId: string;
  profile: BotProfile;
  assignedInstanceId: string;
  adapter: BotAdapter;
  logger: BotLogger;
  actionDelayMs: number;
  maxActionsPerBot?: number;
  planner?: ActionPlanner;
  seed?: number;
  getCoverageData?: () => CoverageData;
  getRecentIssues?: () => DetectedIssue[];
  uiFlows?: UIFlow[];
  getInstanceHeartbeat?: (instanceId: string) => string | undefined;
  getProcessResponsive?: (instanceId: string) => boolean | undefined;
  progressTracker?: ProgressTracker;
  progressTrackerOptions?: ProgressTrackerOptions;
  recoveryManager?: RecoveryManager;
  maxRecoveryAttempts?: number;
  allowRestartGameInstanceRecovery?: boolean;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  onStatusChange?: (status: RuntimeBotSnapshot, memory: BotMemory) => void | Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sceneFromState(state: GameStateSnapshot | null): string | undefined {
  if (state?.scene) {
    return state.scene;
  }

  const scene = state?.state.scene ?? state?.state.currentArea ?? state?.state.area;
  return typeof scene === 'string' ? scene : undefined;
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/[\s_]+/g, '-') ?? '';
}

function isUIJourneyProfile(profile: BotProfile): boolean {
  const text = normalize([profile.profileId, profile.botType, profile.playstyle].filter(Boolean).join(' '));
  return text.includes('ui-journey') || text.includes('journey');
}

function isUIJourneyAction(action: GameAction | null): boolean {
  return action?.payload.planner === 'ui-journey';
}

function numberPayloadValue(payload: Record<string, unknown>, key: string): number | undefined {
  return typeof payload[key] === 'number' && Number.isFinite(payload[key]) ? payload[key] : undefined;
}

export class Bot {
  readonly botId: string;
  readonly profile: BotProfile;
  readonly assignedInstanceId: string;
  readonly adapter: BotAdapter;
  readonly logger: BotLogger;
  readonly memory: BotMemory = {
    actionCount: 0,
    stateCount: 0,
    errorCount: 0,
    previousState: null,
    lastState: null,
    lastAction: null,
    lastResult: null,
    recentActionTypes: [],
    recoveryAttempts: [],
    progressState: 'Queued'
  };

  private readonly sessionId: string;
  private readonly actionDelayMs: number;
  private readonly maxActionsPerBot?: number;
  private readonly planner: ActionPlanner;
  private readonly seed?: number;
  private readonly getCoverageData?: () => CoverageData;
  private readonly getRecentIssues?: () => DetectedIssue[];
  private readonly uiFlows?: UIFlow[];
  private readonly getInstanceHeartbeat?: (instanceId: string) => string | undefined;
  private readonly getProcessResponsive?: (instanceId: string) => boolean | undefined;
  private readonly progressTracker: ProgressTracker;
  private readonly recoveryManager: RecoveryManager;
  private readonly now: () => string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onStatusChange?: BotOptions['onStatusChange'];
  private stopRequested = false;
  private pauseRequested = false;
  private runPromise: Promise<void> | null = null;
  status: BotStatus = 'queued';

  constructor(options: BotOptions) {
    this.botId = options.botId;
    this.sessionId = options.sessionId;
    this.profile = options.profile;
    this.assignedInstanceId = options.assignedInstanceId;
    this.adapter = options.adapter;
    this.logger = options.logger;
    this.actionDelayMs = Math.max(0, options.actionDelayMs);
    this.maxActionsPerBot = options.maxActionsPerBot;
    this.planner = options.planner ?? new ActionPlanner();
    this.seed = options.seed;
    this.getCoverageData = options.getCoverageData;
    this.getRecentIssues = options.getRecentIssues;
    this.uiFlows = options.uiFlows;
    this.getInstanceHeartbeat = options.getInstanceHeartbeat;
    this.getProcessResponsive = options.getProcessResponsive;
    this.progressTracker = options.progressTracker ?? new ProgressTracker(options.progressTrackerOptions);
    this.now = options.now ?? (() => new Date().toISOString());
    this.recoveryManager =
      options.recoveryManager ??
      new RecoveryManager({
        sessionId: this.sessionId,
        gameInstanceId: this.assignedInstanceId,
        botId: this.botId,
        seed: this.seed,
        maxAttempts: options.maxRecoveryAttempts,
        allowRestartGameInstance: options.allowRestartGameInstanceRecovery,
        now: this.now
      });
    this.sleep = options.sleep ?? defaultSleep;
    this.onStatusChange = options.onStatusChange;
  }

  start(): Promise<void> {
    if (!this.runPromise) {
      this.stopRequested = false;
      this.pauseRequested = false;
      this.runPromise = this.runLoop().finally(() => {
        this.runPromise = null;
      });
    }

    return this.runPromise;
  }

  pause(): void {
    if (this.status === 'running' || this.status === 'starting') {
      this.pauseRequested = true;
      this.setStatus('waiting', 'Paused.');
    }
  }

  resume(): void {
    if (this.pauseRequested) {
      this.pauseRequested = false;
      this.setStatus('running', 'Resumed.');
    }
  }

  stop(): void {
    this.stopRequested = true;
    this.pauseRequested = false;
    this.setStatus('stopped', 'Stop requested.');
  }

  getStatusSnapshot(): RuntimeBotSnapshot {
    const actionInsight = actionInsightFromAction(this.memory.lastAction);

    return {
      botId: this.botId,
      profileId: this.profile.profileId,
      status: this.status,
      gameInstanceId: this.assignedInstanceId,
      currentGoalId: this.profile.goals[0]?.goalId,
      currentGoal: this.profile.goals[0]?.name,
      lastActionId: this.memory.lastAction?.actionId,
      currentAction: this.memory.lastAction?.type,
      actionReason: actionInsight?.explanation,
      actionQuality: actionInsight?.quality,
      lastResult: actionResultSummary(this.memory.lastResult),
      nextLikelyAction: actionInsight?.nextLikelyAction,
      message: this.memory.progressState
    };
  }

  private async runLoop(): Promise<void> {
    await this.setStatus('starting', 'Starting bot loop.');

    try {
      await this.log('info', 'Bot loop started.');
      await this.setStatus('running', 'Running.');

      while (!this.stopRequested) {
        if (this.maxActionsPerBot !== undefined && this.memory.actionCount >= this.maxActionsPerBot) {
          await this.setStatus('completed', 'Maximum action count reached.');
          await this.log('info', `Stopped after ${this.memory.actionCount} action(s).`);
          return;
        }

        if (this.pauseRequested) {
          await this.setStatus('waiting', 'Paused.');
          await this.sleep(Math.max(50, this.actionDelayMs));
          continue;
        }

        const state = await this.readAndRecordState();

        if (this.shouldRunConfiguredUiJourney() && this.uiFlows?.[0]?.endState) {
          const currentScreen = currentUIScreen(state);

          if (normalize(currentScreen) === normalize(this.uiFlows[0].endState)) {
            await this.setStatus('completed', `UI flow reached ${this.uiFlows[0].endState}.`);
            await this.log('info', `UI journey flow "${this.uiFlows[0].name}" already reached its end state.`);
            return;
          }
        }

        const availableActions = await this.adapter.getAvailableActions(this.assignedInstanceId, this.botId);
        this.progressTracker.recordAvailableActions(availableActions.length, this.now());
        this.updateProgressSummary();

        const stuckState = await this.handleStuck(availableActions);
        if (stuckState === 'failed') {
          return;
        }

        if (stuckState === 'recovered') {
          continue;
        }

        if (availableActions.length === 0 && !this.shouldRunConfiguredUiJourney()) {
          await this.setStatus('waiting', 'No available actions; retrying.');
          await this.log('warn', 'No available actions were reported; retrying before declaring the bot stuck.');
          await this.sleep(Math.max(50, this.actionDelayMs));
          continue;
        }

        const action = this.planner.chooseAction({
          sessionId: this.sessionId,
          gameInstanceId: this.assignedInstanceId,
          botId: this.botId,
          profile: this.profile,
          state,
          availableActions,
          actionIndex: this.memory.actionCount,
          now: this.now(),
          seed: this.seed,
          memory: this.memory,
          coverageData: this.getCoverageData?.(),
          recentIssues: this.getRecentIssues?.(),
          uiFlows: this.uiFlows
        });

        if (!action) {
          await this.setStatus('blocked', 'No available actions.');
          await this.log('warn', 'Bot blocked because no actions were available.');
          return;
        }

        this.memory.lastAction = action;
        this.progressTracker.recordAction(action, action.requestedAt);
        this.updateProgressSummary();
        const actionInsight = actionInsightFromAction(action);
        await this.log(
          'info',
          `${actionInsight?.explanation ?? `Performing action ${action.type}.`} Quality: ${actionInsight?.quality ?? 'planned'}.`
        );

        const result = await this.adapter.performAction(this.assignedInstanceId, this.botId, action);
        this.memory.lastResult = result;
        this.memory.actionCount += 1;
        this.memory.recentActionTypes = [action.type, ...this.memory.recentActionTypes].slice(0, 12);
        this.progressTracker.recordActionResult(result, result.completedAt ?? this.now());
        this.updateProgressSummary();
        this.memory.progressState = `${action.type}: ${result.status}`;
        await this.log(
          result.status === 'failed' ? 'warn' : 'info',
          `Action ${action.type} ${actionResultSummary(result) ?? result.status}.`
        );
        await this.emitStatus();

        if (this.shouldCompleteUiJourney(action, result)) {
          await this.setStatus('completed', `UI flow completed after ${this.memory.actionCount} action(s).`);
          await this.log('info', `UI journey completed after action ${action.type}.`);
          return;
        }

        const postActionStuckState = await this.handleStuck(availableActions);
        if (postActionStuckState === 'failed') {
          return;
        }

        if (postActionStuckState === 'recovered') {
          continue;
        }

        if (result.status === 'failed' || result.status === 'timed_out') {
          await this.setStatus('waiting', result.message ?? `Action ${result.status}; retrying.`);
          await this.sleep(Math.max(50, this.actionDelayMs));
          continue;
        }

        if (this.actionDelayMs > 0) {
          await this.sleep(this.actionDelayMs);
        }
      }

      await this.setStatus('stopped', 'Stopped cleanly.');
      await this.log('info', 'Bot loop stopped.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown bot runtime error.';

      this.memory.errorCount += 1;
      this.memory.progressState = message;
      await this.setStatus('failed', message);
      await this.log('error', message);
    }
  }

  private async setStatus(status: BotStatus, message?: string): Promise<void> {
    this.status = status;
    this.memory.progressState = message ?? this.memory.progressState;
    await this.emitStatus();
  }

  private async emitStatus(): Promise<void> {
    await this.onStatusChange?.(this.getStatusSnapshot(), this.memory);
  }

  private async readAndRecordState(message?: string): Promise<GameStateSnapshot | null> {
    const stateReadAt = this.now();
    const state = await this.adapter.getState(this.assignedInstanceId, this.botId);

    this.progressTracker.recordState(state, stateReadAt);
    this.progressTracker.recordHeartbeat(
      this.getInstanceHeartbeat?.(this.assignedInstanceId),
      this.getProcessResponsive?.(this.assignedInstanceId),
      stateReadAt
    );
    this.updateProgressSummary();
    this.memory.previousState = this.memory.lastState;
    this.memory.lastState = state;
    this.memory.stateCount += 1;
    this.memory.currentArea = sceneFromState(state) ?? this.memory.currentArea ?? 'Unknown';
    this.memory.progressState = message ?? `Read state ${this.memory.stateCount}.`;
    await this.log('debug', `${message ?? 'State read'} ${this.memory.stateCount}.`);
    await this.emitStatus();

    return state;
  }

  private updateProgressSummary(): void {
    this.memory.progressSummary = this.progressTracker.getProgressSummary();
    this.memory.stuckReason = this.memory.progressSummary.stuckReason;
    this.memory.recoveryAttempts = this.recoveryManager.getAttempts();
  }

  private async handleStuck(availableActions: AvailableGameActionLike[]): Promise<'not-stuck' | 'recovered' | 'failed'> {
    if (!this.progressTracker.isPossiblyStuck()) {
      return 'not-stuck';
    }

    const reason = this.progressTracker.getStuckReason() ?? 'Bot appears stuck.';
    this.updateProgressSummary();
    this.memory.stuckReason = reason;
    this.memory.recoveryMode = true;
    await this.log('warn', `Bot is stuck: ${reason}`);
    await this.setStatus('waiting', `Recovering: ${reason}`);

    let currentAvailableActions = availableActions;

    while (!this.stopRequested) {
      const attempt = this.recoveryManager.createNextAttempt({
        stuckReason: reason,
        availableActions: currentAvailableActions
      });

      if (!attempt) {
        break;
      }

      this.updateProgressSummary();
      await this.log('info', `Recovery attempt ${attempt.attemptId}: ${attempt.recoveryType}.`);
      await this.setStatus('waiting', `Recovery attempt: ${attempt.recoveryType}`);

      let attemptInterrupted = false;

      for (const action of attempt.actions) {
        if (this.stopRequested) {
          attemptInterrupted = true;
          break;
        }

        this.memory.lastAction = action;
        this.memory.lastRecoveryAction = action;
        this.progressTracker.recordAction(action, action.requestedAt);
        this.updateProgressSummary();
        const actionInsight = actionInsightFromAction(action);
        await this.log('info', `${actionInsight?.explanation ?? `Performing recovery action ${action.type}.`} Quality: recovery.`);

        const result = await this.adapter.performAction(this.assignedInstanceId, this.botId, action);
        this.recoveryManager.recordActionResult(attempt.attemptId, result);
        this.memory.lastResult = result;
        this.memory.actionCount += 1;
        this.memory.recentActionTypes = [action.type, ...this.memory.recentActionTypes].slice(0, 12);
        this.progressTracker.recordActionResult(result, result.completedAt ?? this.now());
        this.updateProgressSummary();
        this.memory.progressState = `Recovery ${action.type}: ${result.status}`;
        await this.log(
          result.status === 'failed' ? 'warn' : 'info',
          `Recovery action ${action.type} ${actionResultSummary(result) ?? result.status}.`
        );
        await this.emitStatus();

        if (result.status === 'failed' || result.status === 'timed_out') {
          attemptInterrupted = true;
          break;
        }

        await this.readAndRecordState('Recovery state check');
        currentAvailableActions = await this.adapter.getAvailableActions(this.assignedInstanceId, this.botId);
        this.progressTracker.recordAvailableActions(currentAvailableActions.length, this.now());
        this.updateProgressSummary();

        if (!this.progressTracker.isPossiblyStuck() && this.progressTracker.isMakingProgress()) {
          this.recoveryManager.markRecovered(attempt.attemptId);
          this.updateProgressSummary();
          this.memory.recoveryMode = false;
          this.memory.recoveredFromStuckReason = reason;
          this.memory.stuckReason = undefined;
          this.memory.progressState = `Recovered from: ${reason}`;
          await this.log('info', `Recovered from stuck state after ${attempt.recoveryType}: ${reason}`);
          this.recoveryManager.resetCurrentEpisode();
          await this.setStatus('running', this.memory.progressState);
          return 'recovered';
        }

        if (this.actionDelayMs > 0) {
          await this.sleep(this.actionDelayMs);
        }
      }

      this.recoveryManager.markFailed(attempt.attemptId);
      this.updateProgressSummary();

      if (attemptInterrupted && this.stopRequested) {
        return 'failed';
      }
    }

    this.memory.recoveryMode = false;
    this.memory.stuckReason = reason;
    this.memory.progressState = `Recovery failed after ${this.recoveryManager.currentAttemptCount} attempt(s): ${reason}`;
    this.updateProgressSummary();
    await this.log('warn', this.memory.progressState);
    await this.setStatus('blocked', this.memory.progressState);
    return 'failed';
  }

  private async log(level: LogLevel, message: string): Promise<void> {
    await this.logger.log({
      id: `${this.sessionId}-${this.botId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      message,
      timestamp: this.now(),
      source: `bot:${this.botId}`
    });
  }

  private shouldRunConfiguredUiJourney(): boolean {
    return isUIJourneyProfile(this.profile) && Boolean(this.uiFlows?.some((flow) => flow.steps.length > 0));
  }

  private shouldCompleteUiJourney(action: GameAction, result: ActionResult): boolean {
    if (!isUIJourneyAction(action) || result.status !== 'succeeded') {
      return false;
    }

    const stepIndex = numberPayloadValue(action.payload, 'stepIndex');
    const stepCount = numberPayloadValue(action.payload, 'flowStepCount');

    return stepIndex !== undefined && stepCount !== undefined && stepIndex + 1 >= stepCount;
  }
}
