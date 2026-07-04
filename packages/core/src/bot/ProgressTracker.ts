import type { ActionResult, GameAction, GameStateSnapshot } from '../types';

export interface ProgressTrackerOptions {
  maxRecentEntries?: number;
  stablePositionLimit?: number;
  stableSceneLimit?: number;
  stableUiLimit?: number;
  stableStateLimit?: number;
  repeatedActionLimit?: number;
  failedActionLimit?: number;
  noAvailableActionsLimit?: number;
  noMeaningfulProgressMs?: number;
  loadingScreenMs?: number;
  heartbeatTimeoutMs?: number;
  unresponsiveLimit?: number;
  stateLoopLimit?: number;
  cannotMoveLimit?: number;
}

export interface ProgressSummary {
  makingProgress: boolean;
  possiblyStuck: boolean;
  stuckReason?: string;
  stateCount: number;
  actionCount: number;
  latestScene?: string;
  latestPosition?: string;
  latestUiState?: string;
  noAvailableActionStreak: number;
  failedActionStreak: number;
  repeatedActionStreak: number;
  millisecondsSinceMeaningfulProgress: number;
  summary: string;
}

interface StateObservation {
  timestampMs: number;
  stateSignature: string;
  contentSignature: string;
  positionSignature?: string;
  sceneSignature?: string;
  uiSignature?: string;
  questSignature?: string;
  inventorySignature?: string;
  isLoading: boolean;
  processAlive?: boolean;
  processResponsive?: boolean;
  playerAlive?: boolean;
  canMove?: boolean;
  heartbeatAtMs?: number;
}

interface ActionObservation {
  timestampMs: number;
  actionType: string;
  resultStatus?: ActionResult['status'];
}

const DEFAULT_OPTIONS: Required<ProgressTrackerOptions> = {
  maxRecentEntries: 20,
  stablePositionLimit: 8,
  stableSceneLimit: 10,
  stableUiLimit: 8,
  stableStateLimit: 8,
  repeatedActionLimit: 7,
  failedActionLimit: 3,
  noAvailableActionsLimit: 3,
  noMeaningfulProgressMs: 30000,
  loadingScreenMs: 15000,
  heartbeatTimeoutMs: 10000,
  unresponsiveLimit: 3,
  stateLoopLimit: 4,
  cannotMoveLimit: 5
};

function timestampMs(value?: string): number {
  if (!value) {
    return Date.now();
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim().toLowerCase();
  }

  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['true', 'yes', 'running', 'responsive', 'alive', 'enabled'].includes(normalized)) {
      return true;
    }

    if (['false', 'no', 'stopped', 'unresponsive', 'dead', 'disabled'].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stableStringify(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item) ?? 'null').join(',')}]`;
  }

  if (!isRecord(value)) {
    return String(value);
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${key}:${stableStringify(value[key]) ?? 'null'}`);

  return `{${entries.join(',')}}`;
}

function pickFirst(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) {
      return source[key];
    }
  }

  return undefined;
}

function readPath(source: unknown, path: string[]): unknown {
  let current = source;

  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function objectFromCoordinates(source: Record<string, unknown>): Record<string, number> | undefined {
  const x = numericValue(source.x ?? source.posX ?? source.positionX);
  const y = numericValue(source.y ?? source.posY ?? source.positionY);
  const z = numericValue(source.z ?? source.posZ ?? source.positionZ);
  const output: Record<string, number> = {};

  if (x !== undefined) {
    output.x = Math.round(x * 100) / 100;
  }

  if (y !== undefined) {
    output.y = Math.round(y * 100) / 100;
  }

  if (z !== undefined) {
    output.z = Math.round(z * 100) / 100;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function extractPosition(snapshot: GameStateSnapshot): string | undefined {
  const state = snapshot.state;
  const candidates = [
    state.position,
    state.playerPosition,
    readPath(state, ['player', 'position']),
    readPath(state, ['player', 'transform', 'position']),
    readPath(state, ['transform', 'position']),
    objectFromCoordinates(state),
    objectFromCoordinates(snapshot.metrics)
  ];

  return candidates.map(stableStringify).find(Boolean);
}

function extractScene(snapshot: GameStateSnapshot): string | undefined {
  const state = snapshot.state;
  return (
    normalizeText(snapshot.scene) ??
    normalizeText(pickFirst(state, ['scene', 'currentScene', 'currentArea', 'area', 'location', 'screen', 'screenName']))
  );
}

function extractUiState(snapshot: GameStateSnapshot): string | undefined {
  const state = snapshot.state;
  const candidate = pickFirst(state, [
    'uiState',
    'ui',
    'menu',
    'dialogue',
    'dialog',
    'hud',
    'windowState',
    'currentScreen'
  ]);

  return stableStringify(candidate);
}

function extractQuestState(snapshot: GameStateSnapshot): string | undefined {
  const state = snapshot.state;
  return stableStringify(
    pickFirst(state, ['questState', 'quests', 'activeQuest', 'objective', 'objectives', 'mission', 'missionState'])
  );
}

function extractInventoryState(snapshot: GameStateSnapshot): string | undefined {
  const state = snapshot.state;
  return stableStringify(pickFirst(state, ['inventory', 'items', 'equipment', 'currency', 'wallet']));
}

function extractLoading(snapshot: GameStateSnapshot): boolean {
  const state = snapshot.state;
  const explicitLoading = booleanValue(pickFirst(state, ['loading', 'isLoading', 'loadingScreen', 'inLoadingScreen']));

  if (explicitLoading !== undefined) {
    return explicitLoading;
  }

  const scene = extractScene(snapshot) ?? '';
  const uiState = extractUiState(snapshot) ?? '';

  return scene.includes('loading') || uiState.includes('loading');
}

function extractProcessAlive(snapshot: GameStateSnapshot): boolean | undefined {
  const value = pickFirst(snapshot.state, ['processAlive', 'isProcessAlive', 'processStatus', 'windowStatus']);
  return booleanValue(value);
}

function extractResponsive(snapshot: GameStateSnapshot): boolean | undefined {
  const value = pickFirst(snapshot.state, [
    'responsive',
    'processResponsive',
    'windowResponsive',
    'isResponsive',
    'acceptingInput'
  ]);

  return booleanValue(value);
}

function extractPlayerAlive(snapshot: GameStateSnapshot): boolean | undefined {
  const state = snapshot.state;
  const explicit = booleanValue(pickFirst(state, ['alive', 'playerAlive', 'isAlive']));

  if (explicit !== undefined) {
    return explicit;
  }

  const health = numericValue(pickFirst(state, ['health', 'hp', 'playerHealth']));
  return health !== undefined ? health > 0 : undefined;
}

function extractCanMove(snapshot: GameStateSnapshot): boolean | undefined {
  return booleanValue(pickFirst(snapshot.state, ['canMove', 'playerCanMove', 'movementEnabled', 'inputEnabled']));
}

function extractHeartbeat(snapshot: GameStateSnapshot): number | undefined {
  const value = pickFirst(snapshot.state, ['lastHeartbeat', 'heartbeatAt', 'instanceHeartbeat']);

  if (typeof value === 'string') {
    return timestampMs(value);
  }

  return numericValue(value);
}

function buildObservation(snapshot: GameStateSnapshot, observedAt?: string): StateObservation {
  const positionSignature = extractPosition(snapshot);
  const sceneSignature = extractScene(snapshot);
  const uiSignature = extractUiState(snapshot);
  const questSignature = extractQuestState(snapshot);
  const inventorySignature = extractInventoryState(snapshot);
  const isLoading = extractLoading(snapshot);
  const processAlive = extractProcessAlive(snapshot);
  const processResponsive = extractResponsive(snapshot);
  const playerAlive = extractPlayerAlive(snapshot);
  const canMove = extractCanMove(snapshot);
  const heartbeatAtMs = extractHeartbeat(snapshot);
  const contentSignature =
    stableStringify({
      position: positionSignature,
      scene: sceneSignature,
      ui: uiSignature,
      quest: questSignature,
      inventory: inventorySignature,
      loading: isLoading,
      processAlive,
      processResponsive,
      playerAlive,
      canMove
    }) ?? 'unknown';

  return {
    timestampMs: timestampMs(observedAt ?? snapshot.capturedAt),
    stateSignature:
      stableStringify({
        scene: sceneSignature,
        state: snapshot.state,
        metrics: snapshot.metrics,
        screenshotPath: snapshot.screenshotPath
      }) ?? 'unknown',
    contentSignature,
    positionSignature,
    sceneSignature,
    uiSignature,
    questSignature,
    inventorySignature,
    isLoading,
    processAlive,
    processResponsive,
    playerAlive,
    canMove,
    heartbeatAtMs
  };
}

function countTrailing<T>(items: T[], predicate: (item: T) => boolean): number {
  let count = 0;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!predicate(items[index])) {
      break;
    }

    count += 1;
  }

  return count;
}

function repeatedTrailingValue<T>(items: T[], read: (item: T) => string | undefined): number {
  const latest = items.at(-1);
  const latestValue = latest ? read(latest) : undefined;

  if (!latestValue) {
    return 0;
  }

  return countTrailing(items, (item) => read(item) === latestValue);
}

export class ProgressTracker {
  private readonly options: Required<ProgressTrackerOptions>;
  private readonly states: StateObservation[] = [];
  private readonly actions: ActionObservation[] = [];
  private noAvailableActionStreak = 0;
  private failedActionStreak = 0;
  private unresponsiveStreak = 0;
  private lastMeaningfulProgressAt = Date.now();
  private lastObservedAt = Date.now();
  private stuckReason?: string;

  constructor(options: ProgressTrackerOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options
    };
  }

  recordState(snapshot: GameStateSnapshot | null, observedAt?: string): void {
    const observedMs = timestampMs(observedAt ?? snapshot?.capturedAt);
    this.lastObservedAt = observedMs;

    if (!snapshot) {
      this.unresponsiveStreak += 1;
      this.evaluate();
      return;
    }

    const observation = buildObservation(snapshot, observedAt);
    const previous = this.states.at(-1);

    this.states.push(observation);
    this.trim(this.states);

    if (!previous || previous.contentSignature !== observation.contentSignature) {
      this.lastMeaningfulProgressAt = observation.timestampMs;
    }

    if (observation.processResponsive === false) {
      this.unresponsiveStreak += 1;
    } else if (observation.processResponsive === true) {
      this.unresponsiveStreak = 0;
    }

    this.evaluate();
  }

  recordAvailableActions(actionCount: number, observedAt?: string): void {
    this.lastObservedAt = timestampMs(observedAt);
    this.noAvailableActionStreak = actionCount <= 0 ? this.noAvailableActionStreak + 1 : 0;
    this.evaluate();
  }

  recordAction(action: GameAction, observedAt?: string): void {
    this.lastObservedAt = timestampMs(observedAt ?? action.requestedAt);
    this.actions.push({
      timestampMs: this.lastObservedAt,
      actionType: action.type
    });
    this.trim(this.actions);
    this.evaluate();
  }

  recordActionResult(result: ActionResult, observedAt?: string): void {
    this.lastObservedAt = timestampMs(observedAt ?? result.completedAt);

    const latest = this.actions.at(-1);
    if (latest && latest.actionType) {
      latest.resultStatus = result.status;
    }

    if (result.status === 'failed' || result.status === 'timed_out') {
      this.failedActionStreak += 1;
    } else if (result.status === 'succeeded' || result.status === 'skipped') {
      this.failedActionStreak = 0;
    }

    if (result.status === 'succeeded' && result.stateSnapshotId) {
      this.lastMeaningfulProgressAt = this.lastObservedAt;
    }

    this.evaluate();
  }

  recordHeartbeat(heartbeatAt: string | undefined, processResponsive?: boolean, observedAt?: string): void {
    this.lastObservedAt = timestampMs(observedAt);

    if (heartbeatAt) {
      const heartbeatMs = timestampMs(heartbeatAt);
      const syntheticState = this.states.at(-1);

      if (syntheticState) {
        syntheticState.heartbeatAtMs = heartbeatMs;
      }
    }

    if (processResponsive === false) {
      this.unresponsiveStreak += 1;
    } else if (processResponsive === true) {
      this.unresponsiveStreak = 0;
    }

    this.evaluate();
  }

  isMakingProgress(): boolean {
    this.evaluate();
    return !this.stuckReason && this.lastObservedAt - this.lastMeaningfulProgressAt <= this.options.noMeaningfulProgressMs;
  }

  isPossiblyStuck(): boolean {
    this.evaluate();
    return this.stuckReason !== undefined;
  }

  getStuckReason(): string | undefined {
    this.evaluate();
    return this.stuckReason;
  }

  getProgressSummary(): ProgressSummary {
    this.evaluate();

    const latestState = this.states.at(-1);
    const latestAction = this.actions.at(-1);
    const repeatedActionStreak = latestAction
      ? repeatedTrailingValue(this.actions, (action) => action.actionType)
      : 0;
    const millisecondsSinceMeaningfulProgress = Math.max(0, this.lastObservedAt - this.lastMeaningfulProgressAt);
    const summary = this.stuckReason
      ? `Possibly stuck: ${this.stuckReason}`
      : `Progressing; ${millisecondsSinceMeaningfulProgress}ms since last meaningful state change.`;

    return {
      makingProgress: this.stuckReason === undefined,
      possiblyStuck: this.stuckReason !== undefined,
      stuckReason: this.stuckReason,
      stateCount: this.states.length,
      actionCount: this.actions.length,
      latestScene: latestState?.sceneSignature,
      latestPosition: latestState?.positionSignature,
      latestUiState: latestState?.uiSignature,
      noAvailableActionStreak: this.noAvailableActionStreak,
      failedActionStreak: this.failedActionStreak,
      repeatedActionStreak,
      millisecondsSinceMeaningfulProgress,
      summary
    };
  }

  private trim<T>(items: T[]): void {
    if (items.length > this.options.maxRecentEntries) {
      items.splice(0, items.length - this.options.maxRecentEntries);
    }
  }

  private evaluate(): void {
    this.stuckReason = this.computeStuckReason();
  }

  private computeStuckReason(): string | undefined {
    const latestState = this.states.at(-1);
    const latestAction = this.actions.at(-1);
    const repeatedActionStreak = latestAction
      ? repeatedTrailingValue(this.actions, (action) => action.actionType)
      : 0;

    if (this.noAvailableActionStreak >= this.options.noAvailableActionsLimit) {
      return 'No available actions have been reported repeatedly.';
    }

    if (this.failedActionStreak >= this.options.failedActionLimit) {
      return 'Actions are repeatedly failing or timing out.';
    }

    if (repeatedActionStreak >= this.options.repeatedActionLimit) {
      return `Action "${latestAction?.actionType}" repeated ${repeatedActionStreak} times without enough progress.`;
    }

    if (!latestState) {
      if (this.unresponsiveStreak >= this.options.unresponsiveLimit) {
        return 'No readable state has been returned repeatedly.';
      }

      return undefined;
    }

    if (latestState.processResponsive === false && this.unresponsiveStreak >= this.options.unresponsiveLimit) {
      return 'Game process or window appears unresponsive.';
    }

    if (
      latestState.heartbeatAtMs !== undefined &&
      this.lastObservedAt - latestState.heartbeatAtMs > this.options.heartbeatTimeoutMs
    ) {
      return 'Game instance heartbeat is stale.';
    }

    if (latestState.isLoading) {
      const loadingCount = countTrailing(this.states, (state) => state.isLoading);
      const firstLoading = this.states[this.states.length - loadingCount];
      const loadingStartedAt = firstLoading?.timestampMs ?? latestState.timestampMs;

      if (latestState.timestampMs - loadingStartedAt >= this.options.loadingScreenMs) {
        return 'Loading screen has lasted too long.';
      }
    }

    if (latestState.playerAlive === true && latestState.canMove === false) {
      const cannotMoveCount = countTrailing(
        this.states,
        (state) => state.playerAlive === true && state.canMove === false
      );

      if (cannotMoveCount >= this.options.cannotMoveLimit) {
        return 'Player is alive but movement remains unavailable.';
      }
    }

    const repeatedStateCount = repeatedTrailingValue(this.states, (state) => state.stateSignature);
    if (repeatedStateCount >= this.options.stableStateLimit) {
      return 'Game state is not changing.';
    }

    const repeatedPositionCount = repeatedTrailingValue(this.states, (state) => state.positionSignature);
    if (repeatedPositionCount >= this.options.stablePositionLimit) {
      return 'Player position has not changed for too many observations.';
    }

    const repeatedSceneCount = repeatedTrailingValue(this.states, (state) => state.sceneSignature);
    const hasStableContent = repeatedTrailingValue(this.states, (state) => state.contentSignature) >= this.options.stableSceneLimit;
    if (repeatedSceneCount >= this.options.stableSceneLimit && hasStableContent) {
      return 'Scene or screen has not changed for too long.';
    }

    const repeatedUiCount = repeatedTrailingValue(this.states, (state) => state.uiSignature);
    const latestUi = latestState.uiSignature ?? '';
    if (
      repeatedUiCount >= this.options.stableUiLimit &&
      (latestUi.includes('menu') || latestUi.includes('dialog') || latestUi.includes('pause'))
    ) {
      return 'Bot appears trapped in a menu or dialogue state.';
    }

    const loopCount = this.states.filter((state) => state.contentSignature === latestState.contentSignature).length;
    if (loopCount >= this.options.stateLoopLimit && repeatedStateCount < loopCount) {
      return 'Bot keeps returning to the same state loop.';
    }

    if (this.lastObservedAt - this.lastMeaningfulProgressAt > this.options.noMeaningfulProgressMs) {
      return 'No meaningful quest, location, inventory, UI, or position change has been observed.';
    }

    return undefined;
  }
}
