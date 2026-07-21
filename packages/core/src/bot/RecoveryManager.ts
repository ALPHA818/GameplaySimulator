import type { ActionResult, GameAction } from '../types';
import type { AvailableGameActionLike } from './ActionPlanner';

export type RecoveryActionType =
  | 'wait'
  | 'close-menu'
  | 'open-menu-then-close-menu'
  | 'cancel-back'
  | 'move-backward'
  | 'move-random-direction'
  | 'jump'
  | 'interact'
  | 'reload-checkpoint'
  | 'restart-level'
  | 'reload-save'
  | 'restart-game-instance';

export interface RecoveryActionStep {
  type: string;
  label: string;
  payload?: Record<string, unknown>;
}

export interface RecoveryAttempt {
  attemptId: string;
  recoveryType: RecoveryActionType;
  reason: string;
  actions: GameAction[];
}

export interface RecoveryAttemptRecord {
  attemptId: string;
  recoveryType: RecoveryActionType;
  startedAt: string;
  completedAt?: string;
  recovered?: boolean;
  resultStatuses: ActionResult['status'][];
}

export interface RecoveryManagerOptions {
  sessionId: string;
  gameInstanceId: string;
  botId: string;
  seed?: number;
  maxAttempts?: number;
  allowRestartGameInstance?: boolean;
  now?: () => string;
}

interface RecoveryDefinition {
  type: RecoveryActionType;
  steps: RecoveryActionStep[];
  requiresAdvertisedAction?: boolean;
  requiresRestartAllowed?: boolean;
}

const RECOVERY_DEFINITIONS: RecoveryDefinition[] = [
  {
    type: 'wait',
    steps: [{ type: 'wait', label: 'Wait' }]
  },
  {
    type: 'close-menu',
    steps: [{ type: 'close-menu', label: 'Close Menu' }]
  },
  {
    type: 'open-menu-then-close-menu',
    steps: [
      { type: 'open-menu', label: 'Open Menu' },
      { type: 'close-menu', label: 'Close Menu' }
    ]
  },
  {
    type: 'cancel-back',
    steps: [{ type: 'cancel-back', label: 'Cancel / Back' }]
  },
  {
    type: 'move-backward',
    steps: [{ type: 'move-backward', label: 'Move Backward' }]
  },
  {
    type: 'move-random-direction',
    steps: [{ type: 'move-random-direction', label: 'Move Random Direction' }]
  },
  {
    type: 'jump',
    steps: [{ type: 'jump', label: 'Jump' }]
  },
  {
    type: 'interact',
    steps: [{ type: 'interact', label: 'Interact' }]
  },
  {
    type: 'reload-checkpoint',
    steps: [{ type: 'reload-checkpoint', label: 'Reload Checkpoint' }],
    requiresAdvertisedAction: true
  },
  {
    type: 'restart-level',
    steps: [{ type: 'restart-level', label: 'Restart Level' }],
    requiresAdvertisedAction: true
  },
  {
    type: 'reload-save',
    steps: [{ type: 'reload-save', label: 'Reload Save' }],
    requiresAdvertisedAction: true
  },
  {
    type: 'restart-game-instance',
    steps: [{ type: 'restart-game-instance', label: 'Restart Game Instance' }],
    requiresRestartAllowed: true
  }
];

const ACTION_ALIASES: Record<string, string[]> = {
  wait: ['wait', 'idle-wait', 'idle', 'observe'],
  'close-menu': ['close-menu', 'menu-close', 'close-ui', 'exit-menu', 'escape', 'back', 'cancel'],
  'open-menu': ['open-menu', 'menu', 'pause', 'open-settings-menu', 'settings'],
  'cancel-back': ['cancel-back', 'cancel', 'back', 'escape', 'close-dialogue', 'dialogue-back'],
  'move-backward': ['move-backward', 'backward', 'move-down', 'step-back', 'retreat'],
  'move-random-direction': ['move-random-direction', 'move-random', 'move-forward', 'move', 'travel'],
  jump: ['jump', 'hop'],
  interact: ['interact', 'use', 'confirm', 'talk', 'activate'],
  'reload-checkpoint': ['reload-checkpoint', 'checkpoint-reload', 'load-checkpoint'],
  'restart-level': ['restart-level', 'reset-level', 'restart-scene'],
  'reload-save': ['reload-save', 'load-save', 'load-game'],
  'restart-game-instance': ['restart-game-instance', 'restart-instance', 'restart-game']
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function actionText(action: AvailableGameActionLike): string {
  return normalize([action.actionType, action.label, action.description].filter(Boolean).join(' '));
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function pickAdvertisedAction(
  stepType: string,
  availableActions: AvailableGameActionLike[]
): AvailableGameActionLike | undefined {
  const aliases = ACTION_ALIASES[stepType] ?? [stepType];

  return availableActions.find((action) => {
    const text = actionText(action);
    return aliases.some((alias) => text.includes(normalize(alias)));
  });
}

function directActionAllowed(stepType: string): boolean {
  return ['wait', 'close-menu', 'open-menu', 'cancel-back', 'move-backward', 'move-random-direction', 'jump', 'interact'].includes(
    stepType
  );
}

export class RecoveryManager {
  private readonly maxAttempts: number;
  private readonly allowRestartGameInstance: boolean;
  private readonly now: () => string;
  private readonly attemptedTypes = new Set<RecoveryActionType>();
  private readonly records: RecoveryAttemptRecord[] = [];
  private currentEpisodeAttemptCount = 0;

  constructor(private readonly options: RecoveryManagerOptions) {
    this.maxAttempts = options.maxAttempts ?? RECOVERY_DEFINITIONS.length;
    this.allowRestartGameInstance = options.allowRestartGameInstance ?? false;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get attemptCount(): number {
    return this.records.length;
  }

  get currentAttemptCount(): number {
    return this.currentEpisodeAttemptCount;
  }

  get remainingAttempts(): number {
    return Math.max(0, this.maxAttempts - this.currentEpisodeAttemptCount);
  }

  getAttempts(): RecoveryAttemptRecord[] {
    return this.records.map((record) => ({
      ...record,
      resultStatuses: [...record.resultStatuses]
    }));
  }

  reset(): void {
    this.attemptedTypes.clear();
    this.currentEpisodeAttemptCount = 0;
    this.records.splice(0, this.records.length);
  }

  resetCurrentEpisode(): void {
    this.attemptedTypes.clear();
    this.currentEpisodeAttemptCount = 0;
  }

  createNextAttempt(input: {
    stuckReason: string;
    availableActions: AvailableGameActionLike[];
  }): RecoveryAttempt | null {
    if (this.currentEpisodeAttemptCount >= this.maxAttempts) {
      return null;
    }

    const definition = this.nextDefinition(input.availableActions);

    if (!definition) {
      return null;
    }

    const attemptNumber = this.records.length + 1;
    const attemptId = `${this.options.botId}-recovery-${String(attemptNumber).padStart(3, '0')}`;
    const actions = definition.steps
      .map((step, index) =>
        this.createGameAction({
          attemptId,
          step,
          index,
          availableActions: input.availableActions,
          stuckReason: input.stuckReason
        })
      )
      .filter((action): action is GameAction => action !== null);

    if (actions.length === 0) {
      this.attemptedTypes.add(definition.type);
      this.currentEpisodeAttemptCount += 1;
      return this.createNextAttempt(input);
    }

    this.attemptedTypes.add(definition.type);
    this.currentEpisodeAttemptCount += 1;
    this.records.push({
      attemptId,
      recoveryType: definition.type,
      startedAt: this.now(),
      resultStatuses: []
    });

    return {
      attemptId,
      recoveryType: definition.type,
      reason: input.stuckReason,
      actions
    };
  }

  recordActionResult(attemptId: string, result: ActionResult): void {
    const record = this.records.find((item) => item.attemptId === attemptId);

    if (!record) {
      return;
    }

    record.resultStatuses.push(result.status);
  }

  markRecovered(attemptId: string): void {
    const record = this.records.find((item) => item.attemptId === attemptId);

    if (!record) {
      return;
    }

    record.recovered = true;
    record.completedAt = this.now();
  }

  markFailed(attemptId: string): void {
    const record = this.records.find((item) => item.attemptId === attemptId);

    if (!record) {
      return;
    }

    record.recovered = false;
    record.completedAt = this.now();
  }

  private nextDefinition(availableActions: AvailableGameActionLike[]): RecoveryDefinition | undefined {
    return RECOVERY_DEFINITIONS.find((definition) => {
      if (this.attemptedTypes.has(definition.type)) {
        return false;
      }

      if (definition.requiresRestartAllowed && !this.allowRestartGameInstance) {
        return false;
      }

      if (definition.requiresAdvertisedAction) {
        return definition.steps.every((step) => pickAdvertisedAction(step.type, availableActions));
      }

      return true;
    });
  }

  private createGameAction(input: {
    attemptId: string;
    step: RecoveryActionStep;
    index: number;
    availableActions: AvailableGameActionLike[];
    stuckReason: string;
  }): GameAction | null {
    const advertised = pickAdvertisedAction(input.step.type, input.availableActions);

    if (!advertised && !directActionAllowed(input.step.type) && input.step.type !== 'restart-game-instance') {
      return null;
    }

    const actionType = advertised?.actionType ?? input.step.type;
    const label = advertised?.label ?? input.step.label;
    const salt = `${this.options.seed ?? 0}:${input.attemptId}:${actionType}:${input.index}`;

    return {
      actionId: `${input.attemptId}-action-${String(input.index + 1).padStart(2, '0')}`,
      sessionId: this.options.sessionId,
      gameInstanceId: this.options.gameInstanceId,
      botId: this.options.botId,
      type: actionType,
      payload: {
        planner: 'recovery',
        recovery: true,
        recoveryAttemptId: input.attemptId,
        recoveryLabel: label,
        recoveryStepType: input.step.type,
        stuckReason: input.stuckReason,
        reason: input.stuckReason,
        quality: 'recovery',
        explanation: `The bot chose ${actionType} as a recovery action because it was stuck: ${input.stuckReason}.`,
        randomDirectionSeed: hashString(salt)
      },
      requestedAt: this.now()
    };
  }
}
