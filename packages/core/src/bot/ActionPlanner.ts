import type {
  ActionQuality,
  BotDirectiveProgress,
  BotDirectiveStep,
  BotProfile,
  BotTestDirective,
  DetectedIssue,
  GameAction,
  GameStateSnapshot,
  UIFlow
} from '../types';
import { resolveAvailableActionType, resolveDirectiveActionAvailability } from '../types';
import { buildPlannerExplanation } from './ActionExplanation';
import { UIJourneyPlanner } from './UIJourneyPlanner';

export interface AvailableGameActionLike {
  actionType: string;
  label?: string;
  description?: string;
  payloadSchema?: Record<string, unknown>;
}

export interface ActionPlannerMemory {
  actionCount: number;
  stateCount: number;
  errorCount: number;
  recentActionTypes: string[];
  currentArea?: string;
}

export interface CoverageData {
  visitedScenes?: string[];
  visitedActions?: string[];
  actionCounts?: Record<string, number>;
  sceneCounts?: Record<string, number>;
  discoveredContentIds?: string[];
}

export interface ActionPlannerInput {
  sessionId: string;
  gameInstanceId: string;
  botId: string;
  profile: BotProfile;
  state: GameStateSnapshot | null;
  availableActions: AvailableGameActionLike[];
  actionIndex: number;
  now: string;
  seed?: number;
  memory?: ActionPlannerMemory;
  coverageData?: CoverageData;
  recentIssues?: DetectedIssue[];
  uiFlows?: UIFlow[];
  activeDirective?: BotTestDirective;
  directiveProgress?: BotDirectiveProgress;
}

interface RuleSet {
  include: string[];
  avoid: string[];
  weights: {
    goal: number;
    exploration: number;
    risk: number;
    combat: number;
    ui: number;
    economy: number;
    persistence: number;
    performance: number;
    idle: number;
    chaos: number;
  };
  randomWeight: number;
}

interface ScoredAction {
  action: AvailableGameActionLike;
  score: number;
  random: number;
  reason: string;
  repetitionCount: number;
}

interface DirectiveActionScore {
  scored: ScoredAction;
  originalProfilePlannerScore: number;
  matchedKeywords: string[];
  matchKind: 'exact' | 'strong' | 'related' | 'partial' | 'avoided' | 'unrelated';
  directiveReason: string;
}

const defaultRuleSet: RuleSet = {
  include: ['interact', 'move', 'inspect', 'objective'],
  avoid: [],
  weights: {
    goal: 1,
    exploration: 1,
    risk: 1,
    combat: 1,
    ui: 1,
    economy: 1,
    persistence: 1,
    performance: 1,
    idle: 1,
    chaos: 1
  },
  randomWeight: 6
};

const ruleSets: Record<string, RuleSet> = {
  main: {
    include: ['main', 'objective', 'required', 'waypoint', 'travel', 'quest', 'complete', 'interact'],
    avoid: ['optional', 'side', 'random', 'idle', 'shop'],
    weights: { ...defaultRuleSet.weights, goal: 3, exploration: 0.7, risk: 0.5 },
    randomWeight: 4
  },
  completionist: {
    include: ['unexplored', 'side', 'npc', 'collect', 'hidden', 'optional', 'revisit', 'minigame'],
    avoid: ['skip', 'speedrun'],
    weights: { ...defaultRuleSet.weights, exploration: 3, goal: 1.3, economy: 1.2 },
    randomWeight: 8
  },
  explorer: {
    include: ['move', 'travel', 'boundary', 'unusual', 'path', 'inspect', 'environment', 'jump', 'door'],
    avoid: ['idle'],
    weights: { ...defaultRuleSet.weights, exploration: 3, risk: 1.6 },
    randomWeight: 9
  },
  speedrunner: {
    include: ['fast', 'skip', 'sprint', 'objective', 'travel', 'shortcut', 'confirm', 'progress'],
    avoid: ['optional', 'side', 'dialogue', 'inspect', 'idle'],
    weights: { ...defaultRuleSet.weights, goal: 3, risk: 1.8, exploration: 0.4 },
    randomWeight: 5
  },
  chaos: {
    include: ['random', 'spam', 'toggle', 'interrupt', 'menu', 'attack', 'jump', 'cancel', 'rapid'],
    avoid: [],
    weights: { ...defaultRuleSet.weights, chaos: 4, risk: 2.4, ui: 1.6 },
    randomWeight: 42
  },
  ui: {
    include: ['menu', 'settings', 'dialogue', 'inventory', 'pause', 'resume', 'cancel', 'confirm', 'tab'],
    avoid: ['combat-only'],
    weights: { ...defaultRuleSet.weights, ui: 3, idle: 1.2 },
    randomWeight: 7
  },
  economy: {
    include: ['buy', 'sell', 'craft', 'reward', 'shop', 'currency', 'trade', 'loot', 'price'],
    avoid: ['ignore-inventory'],
    weights: { ...defaultRuleSet.weights, economy: 3, goal: 1.2 },
    randomWeight: 6
  },
  combat: {
    include: ['attack', 'block', 'dodge', 'ability', 'heal', 'death', 'respawn', 'enemy', 'target'],
    avoid: ['avoid-combat'],
    weights: { ...defaultRuleSet.weights, combat: 3, risk: 1.8 },
    randomWeight: 7
  },
  quest: {
    include: ['accept', 'quest', 'objective', 'turn-in', 'complete', 'branch', 'out-of-order'],
    avoid: ['ignore-objective'],
    weights: { ...defaultRuleSet.weights, goal: 2.6, exploration: 1.1 },
    randomWeight: 6
  },
  side: {
    include: ['optional', 'side', 'minigame', 'hidden', 'post-game', 'challenge', 'collect'],
    avoid: ['main-only'],
    weights: { ...defaultRuleSet.weights, exploration: 2.5, goal: 1.1 },
    randomWeight: 8
  },
  idle: {
    include: ['idle', 'wait', 'observe', 'timeout', 'resume', 'enemy-behavior'],
    avoid: ['rapid', 'spam'],
    weights: { ...defaultRuleSet.weights, idle: 4, risk: 0.4 },
    randomWeight: 4
  },
  inventory: {
    include: ['item', 'equip', 'unequip', 'stack', 'inventory', 'drop', 'use-item', 'sort', 'loot'],
    avoid: ['ignore-items'],
    weights: { ...defaultRuleSet.weights, economy: 1.4, ui: 1.8, risk: 1.3 },
    randomWeight: 6
  },
  dialogue: {
    include: ['dialogue', 'talk', 'choice', 'branch', 'repeat', 'cancel', 'back', 'npc'],
    avoid: ['combat-only'],
    weights: { ...defaultRuleSet.weights, ui: 2.2, exploration: 1.5 },
    randomWeight: 7
  },
  sequence: {
    include: ['skip', 'early', 'out-of-order', 'trigger', 'shortcut', 'locked', 'enter', 'sequence'],
    avoid: ['linear', 'waypoint-only'],
    weights: { ...defaultRuleSet.weights, risk: 3, goal: 1.4, chaos: 1.5 },
    randomWeight: 10
  },
  performance: {
    include: ['load', 'spawn', 'entity', 'rapid', 'transition', 'busy', 'effects', 'dense'],
    avoid: ['idle-only'],
    weights: { ...defaultRuleSet.weights, performance: 3, risk: 1.7, chaos: 1.3 },
    randomWeight: 8
  },
  save: {
    include: ['save', 'load', 'checkpoint', 'reload', 'death-reload', 'scene-reload', 'profile'],
    avoid: ['no-save'],
    weights: { ...defaultRuleSet.weights, persistence: 3, goal: 1.2 },
    randomWeight: 5
  },
  boundary: {
    include: ['wall', 'corner', 'boundary', 'collision', 'map-exit', 'jump', 'edge', 'clip'],
    avoid: ['stay-on-path'],
    weights: { ...defaultRuleSet.weights, exploration: 2.4, risk: 2.4 },
    randomWeight: 9
  },
  crafting: {
    include: ['craft', 'recipe', 'ingredient', 'output', 'quantity', 'cancel-craft', 'recursive'],
    avoid: ['ignore-recipe', 'discard-output', 'combat-only'],
    weights: { ...defaultRuleSet.weights, economy: 2.6, ui: 1.4, risk: 1.3 },
    randomWeight: 5
  },
  building: {
    include: ['build', 'place', 'placement', 'overlap', 'rotate', 'remove', 'destroy', 'structure', 'limit'],
    avoid: ['ignore-building', 'leave-test-world'],
    weights: { ...defaultRuleSet.weights, exploration: 1.8, risk: 2, persistence: 1.6, performance: 1.4 },
    randomWeight: 6
  },
  physics: {
    include: ['physics', 'push', 'pull', 'fall', 'jump', 'stack', 'slope', 'collision', 'high-speed'],
    avoid: ['stand-still', 'avoid-physics'],
    weights: { ...defaultRuleSet.weights, risk: 2.8, exploration: 2, performance: 1.5 },
    randomWeight: 8
  },
  camera: {
    include: ['camera', 'view', 'rotate', 'zoom', 'first-person', 'third-person', 'clip', 'obstruction', 'field-of-view', 'fov'],
    avoid: ['lock-camera', 'skip-visual'],
    weights: { ...defaultRuleSet.weights, ui: 2.6, exploration: 1.8, risk: 1.2 },
    randomWeight: 6
  },
  loot: {
    include: ['loot', 'drop', 'reward', 'rarity', 'pickup', 'overflow', 'claim'],
    avoid: ['discard-loot', 'skip-reward', 'single-sample'],
    weights: { ...defaultRuleSet.weights, economy: 2.7, persistence: 1.3, risk: 1.2 },
    randomWeight: 7
  },
  death: {
    include: ['death', 'die', 'respawn', 'checkpoint', 'retry', 'retention', 'death-transition'],
    avoid: ['avoid-danger', 'quit-after-death'],
    weights: { ...defaultRuleSet.weights, combat: 2.2, persistence: 2.2, risk: 2.5 },
    randomWeight: 5
  },
  npc: {
    include: ['npc', 'follow', 'flee', 'schedule', 'blocked-path', 'interaction', 'state-reset'],
    avoid: ['ignore-npc', 'leave-npc-area'],
    weights: { ...defaultRuleSet.weights, exploration: 2.3, goal: 1.5, idle: 1.4 },
    randomWeight: 6
  },
  boss: {
    include: ['boss', 'encounter', 'phase', 'arena', 'pattern', 'retry', 'reward', 'skip'],
    avoid: ['avoid-boss', 'leave-encounter', 'skip-reward-check'],
    weights: { ...defaultRuleSet.weights, combat: 3, risk: 2.4, goal: 2.3 },
    randomWeight: 7
  },
  procedural: {
    include: ['generate', 'generation', 'seed', 'terrain', 'required-resource', 'structure', 'world-load'],
    avoid: ['reuse-single-world', 'skip-seed', 'ignore-unreachable'],
    weights: { ...defaultRuleSet.weights, exploration: 2.8, performance: 2, goal: 1.5 },
    randomWeight: 8
  },
  environment: {
    include: ['environment', 'day', 'night', 'weather', 'temperature', 'timed-event', 'lighting', 'advance-time'],
    avoid: ['freeze-time', 'skip-environment'],
    weights: { ...defaultRuleSet.weights, exploration: 1.8, persistence: 1.8, performance: 1.4, idle: 1.5 },
    randomWeight: 6
  },
  'keyboard-input': {
    include: ['keyboard', 'mapped-key', 'key-combination', 'hold-key', 'rapid-key', 'remap-key', 'key-mapping'],
    avoid: ['unmapped-key', 'system-shortcut', 'text-entry-spam'],
    weights: { ...defaultRuleSet.weights, ui: 2.8, performance: 1.3, risk: 1.2 },
    randomWeight: 5
  },
  controller: {
    include: ['controller', 'gamepad', 'stick', 'trigger', 'gamepad-button', 'dead-zone', 'reconnect-controller', 'switch-controller'],
    avoid: ['keyboard-fallback', 'unmapped-controller', 'system-device'],
    weights: { ...defaultRuleSet.weights, ui: 2.5, risk: 1.6, performance: 1.2 },
    randomWeight: 6
  },
  touch: {
    include: ['touch', 'tap', 'long-press', 'swipe', 'multi-touch', 'virtual-stick', 'orientation', 'overlapping-controls'],
    avoid: ['mouse-fallback', 'unsupported-touch', 'system-gesture'],
    weights: { ...defaultRuleSet.weights, ui: 2.8, risk: 1.5, exploration: 1.2 },
    randomWeight: 6
  },
  display: {
    include: ['display', 'resolution', 'aspect-ratio', 'fullscreen', 'windowed', 'resize-window', 'ui-scale', 'safe-area'],
    avoid: ['unsupported-resolution', 'hide-ui', 'skip-screenshot'],
    weights: { ...defaultRuleSet.weights, ui: 2.7, performance: 1.5, risk: 1.2 },
    randomWeight: 5
  },
  localization: {
    include: ['localization', 'language', 'translation', 'long-text', 'special-character', 'rtl', 'text-clipping', 'text-wrapping'],
    avoid: ['skip-text', 'single-language', 'hide-subtitles'],
    weights: { ...defaultRuleSet.weights, ui: 3, exploration: 1.2 },
    randomWeight: 5
  },
  audio: {
    include: ['audio', 'volume', 'mute', 'sound', 'subtitle', 'timing', 'speaker-label'],
    avoid: ['claim-audio-verified', 'disable-evidence', 'skip-subtitles'],
    weights: { ...defaultRuleSet.weights, ui: 2.7, idle: 1.3, performance: 1.2 },
    randomWeight: 5
  },
  accessibility: {
    include: ['accessibility', 'keyboard-only', 'readable-label', 'contrast', 'text-size', 'subtitle', 'input-alternative', 'reduced-motion'],
    avoid: ['accessibility-certification', 'mouse-only', 'skip-readable-label'],
    weights: { ...defaultRuleSet.weights, ui: 3, performance: 1.2 },
    randomWeight: 4
  },
  settings: {
    include: ['settings', 'configuration', 'change-setting', 'apply-setting', 'cancel-setting', 'reset-setting', 'restart-after-setting', 'settings-persistence'],
    avoid: ['unsafe-system-setting', 'unconfirmed-setting', 'delete-user-profile'],
    weights: { ...defaultRuleSet.weights, ui: 3, persistence: 2.4 },
    randomWeight: 4
  },
  transition: {
    include: ['loading', 'transition', 'scene', 'fast-travel', 'cancel-transition', 'retry-transition'],
    avoid: ['skip-loading', 'force-close-during-save', 'unmapped-transition'],
    weights: { ...defaultRuleSet.weights, performance: 2.8, goal: 1.7, persistence: 1.2 },
    randomWeight: 5
  },
  'network-resilience': {
    include: ['latency', 'packet-loss', 'disconnect-test', 'reconnect-test', 'network-timeout', 'restore-test-network'],
    avoid: ['public-matchmaking', 'anti-cheat', 'unapproved-server'],
    weights: { ...defaultRuleSet.weights, performance: 2.4, risk: 2, persistence: 1.4 },
    randomWeight: 4
  },
  multiplayer: {
    include: ['private-session', 'private-lobby', 'lobby-ready', 'test-host', 'reconnect-private', 'synchronized-objective', 'cleanup-test-session'],
    avoid: ['public-matchmaking', 'public-lobby', 'anti-cheat'],
    weights: { ...defaultRuleSet.weights, goal: 2.3, persistence: 1.6, risk: 1.5 },
    randomWeight: 5
  },
  endurance: {
    include: ['endurance', 'repeat-safe-loop', 'sample-memory', 'sample-performance', 'degradation', 'scene-loop'],
    avoid: ['many-visible-windows', 'ignore-resource-limit', 'unbounded'],
    weights: { ...defaultRuleSet.weights, performance: 3.4, idle: 1.7 },
    randomWeight: 3
  },
  'save-migration': {
    include: ['test-save', 'old-save', 'save-migration', 'migrated-state', 'migrated-copy'],
    avoid: ['discover-user-save', 'overwrite-source', 'unapproved-save'],
    weights: { ...defaultRuleSet.weights, persistence: 3.5, goal: 1.8, risk: 0.4 },
    randomWeight: 3
  },
  'world-persistence': {
    include: ['world-state', 'persistent-object', 'save-world', 'reload-world', 'verify-world'],
    avoid: ['untracked-world', 'delete-world-save', 'skip-state-comparison'],
    weights: { ...defaultRuleSet.weights, persistence: 3.2, exploration: 1.5, goal: 1.5 },
    randomWeight: 4
  },
  achievement: {
    include: ['achievement', 'unlock', 'unlock-state', 'sandbox-achievement', 'achievement-condition'],
    avoid: ['production-achievement', 'real-player-account', 'without-condition'],
    weights: { ...defaultRuleSet.weights, goal: 2.7, persistence: 2.1, ui: 1.2 },
    randomWeight: 4
  },
  'file-permission': {
    include: ['approved-test-file', 'read-only-test-folder', 'missing-test-folder', 'test-disk-write', 'file-error-message'],
    avoid: ['unapproved-directory', 'system-file', 'user-file'],
    weights: { ...defaultRuleSet.weights, persistence: 3.2, risk: 0.3, ui: 1.4 },
    randomWeight: 3
  }
};

const categoryKeywords: Record<keyof RuleSet['weights'], string[]> = {
  goal: ['main', 'objective', 'required', 'quest', 'waypoint', 'complete', 'progress'],
  exploration: ['move', 'travel', 'explore', 'hidden', 'side', 'optional', 'npc', 'collect', 'inspect'],
  risk: ['skip', 'early', 'boundary', 'attack', 'jump', 'interrupt', 'death', 'locked', 'corner'],
  combat: ['attack', 'block', 'dodge', 'ability', 'enemy', 'heal', 'respawn', 'target'],
  ui: ['menu', 'settings', 'dialogue', 'inventory', 'pause', 'cancel', 'confirm', 'tab'],
  economy: ['buy', 'sell', 'craft', 'shop', 'currency', 'reward', 'trade', 'loot'],
  persistence: ['save', 'load', 'checkpoint', 'reload', 'profile'],
  performance: ['load', 'spawn', 'entity', 'rapid', 'transition', 'busy', 'effects'],
  idle: ['idle', 'wait', 'observe', 'timeout'],
  chaos: ['random', 'spam', 'toggle', 'interrupt', 'weird', 'rapid']
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function actionText(action: AvailableGameActionLike): string {
  return normalize([action.actionType, action.label, action.description].filter(Boolean).join(' '));
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(normalize(keyword)));
}

function keywordTokens(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function partiallyMatches(text: string, keyword: string): boolean {
  const actionTokens = new Set(keywordTokens(text));
  return keywordTokens(keyword).some((token) => actionTokens.has(token));
}

function matchesPreference(action: AvailableGameActionLike, preference: string): boolean {
  return containsAny(actionText(action), [preference]);
}

function profileKey(profile: BotProfile): string {
  const text = normalize([profile.profileId, profile.botType, profile.playstyle].filter(Boolean).join(' '));

  if (text.includes('main-story')) return 'main';
  if (text.includes('completionist')) return 'completionist';
  if (text.includes('explorer')) return 'explorer';
  if (text.includes('speedrunner')) return 'speedrunner';
  if (text.includes('chaos')) return 'chaos';
  if (text.includes('crafting-recipe') || text.includes('recipe-tester')) return 'crafting';
  if (text.includes('building-destruction')) return 'building';
  if (text.includes('physics-interaction')) return 'physics';
  if (text.includes('camera-view')) return 'camera';
  if (text.includes('loot-random-drop')) return 'loot';
  if (text.includes('death-respawn')) return 'death';
  if (text.includes('npc-behaviour')) return 'npc';
  if (text.includes('boss-encounter')) return 'boss';
  if (text.includes('procedural-generation')) return 'procedural';
  if (text.includes('environment-cycle')) return 'environment';
  if (text.includes('keyboard-input-mapping')) return 'keyboard-input';
  if (text.includes('controller-gamepad')) return 'controller';
  if (text.includes('touch-mobile-controls')) return 'touch';
  if (text.includes('display-resolution')) return 'display';
  if (text.includes('localization-text-overflow')) return 'localization';
  if (text.includes('audio-subtitle')) return 'audio';
  if (text.includes('accessibility-tester')) return 'accessibility';
  if (text.includes('settings-configuration')) return 'settings';
  if (text.includes('loading-transition')) return 'transition';
  if (text.includes('network-resilience')) return 'network-resilience';
  if (text.includes('multiplayer-session')) return 'multiplayer';
  if (text.includes('memory-leak-endurance')) return 'endurance';
  if (text.includes('save-migration')) return 'save-migration';
  if (text.includes('world-persistence')) return 'world-persistence';
  if (text.includes('achievement-unlock')) return 'achievement';
  if (text.includes('file-permission')) return 'file-permission';
  if (text.includes('ui-journey') || text.includes('journey')) return 'ui-journey';
  if (text.includes('ui')) return 'ui';
  if (text.includes('economy')) return 'economy';
  if (text.includes('combat')) return 'combat';
  if (text.includes('quest')) return 'quest';
  if (text.includes('side-content')) return 'side';
  if (text.includes('idle')) return 'idle';
  if (text.includes('inventory')) return 'inventory';
  if (text.includes('dialogue')) return 'dialogue';
  if (text.includes('sequence')) return 'sequence';
  if (text.includes('performance')) return 'performance';
  if (text.includes('save-load') || text.includes('save')) return 'save';
  if (text.includes('boundary')) return 'boundary';
  return 'default';
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function randomUnit(seed: number, salt: string): number {
  let value = hashString(`${seed}:${salt}`) || 1;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;

  return ((value >>> 0) % 1000000) / 1000000;
}

function scoreAction(input: ActionPlannerInput, action: AvailableGameActionLike, index: number): ScoredAction {
  const key = profileKey(input.profile);
  const rules = ruleSets[key] ?? defaultRuleSet;
  const text = actionText(action);
  const seed = input.seed ?? hashString(`${input.sessionId}:${input.botId}`);
  const random = randomUnit(seed, `${input.actionIndex}:${index}:${text}`);
  const reasons: string[] = [];
  let score = 10;

  if (containsAny(text, rules.include)) {
    score += 28;
    reasons.push('rule match');
  }

  if (containsAny(text, rules.avoid)) {
    score -= key === 'chaos' ? 0 : 18;
    reasons.push('profile avoid');
  }

  if (key !== 'chaos' && containsAny(text, ['random-input', 'random-menu', 'spam', 'weird'])) {
    score -= 14;
    reasons.push('non-chaos random penalty');
  }

  for (const [category, keywords] of Object.entries(categoryKeywords) as Array<[keyof RuleSet['weights'], string[]]>) {
    if (containsAny(text, keywords)) {
      score += rules.weights[category] * 5;
    }
  }

  for (const preferred of input.profile.preferredActions ?? []) {
    if (matchesPreference(action, preferred)) {
      score += 20;
      reasons.push('preferred');
    }
  }

  for (const avoided of input.profile.avoidedActions ?? []) {
    if (matchesPreference(action, avoided)) {
      score -= key === 'chaos' ? 3 : 22;
      reasons.push('avoided');
    }
  }

  const memory = input.memory;
  const repetitionCount = memory?.recentActionTypes.filter((actionType) => normalize(actionType) === normalize(action.actionType)).length ?? 0;
  const repetitionTolerance = input.profile.repetitionTolerance ?? 0.5;
  score -= repetitionCount * (1 - repetitionTolerance) * 20;

  const coverage = input.coverageData;
  if (coverage?.visitedActions && !coverage.visitedActions.map(normalize).includes(normalize(action.actionType))) {
    score += (input.profile.curiosity ?? 0.5) * 14;
    reasons.push('unvisited action');
  }

  const stateScene = input.state?.scene;
  if (stateScene && coverage?.sceneCounts?.[stateScene] === 0) {
    score += (input.profile.curiosity ?? 0.5) * 8;
  }

  if (input.recentIssues?.some((issue) => issue.category === 'crash' || issue.category === 'hang')) {
    score += (input.profile.bugHuntingBias ?? 0.5) * (containsAny(text, ['repeat', 'reload', 'resume', 'same']) ? 14 : 4);
  }

  score += random * rules.randomWeight;

  if (key === 'chaos') {
    score += random * 70;
    score += (input.profile.riskTolerance ?? 0.9) * (containsAny(text, ['spam', 'random', 'interrupt', 'attack', 'jump', 'toggle']) ? 18 : 5);
    reasons.push('chaos random');
  }

  return {
    action,
    score,
    random,
    reason: reasons.join(', ') || 'weighted score',
    repetitionCount
  };
}

function currentDirective(input: ActionPlannerInput): BotTestDirective | undefined {
  const directive = input.activeDirective;

  if (!directive || directive.status !== 'active') {
    return undefined;
  }
  if (input.directiveProgress) {
    if (
      input.directiveProgress.directiveId !== directive.directiveId ||
      input.directiveProgress.botId !== input.botId ||
      input.directiveProgress.status !== 'active'
    ) {
      return undefined;
    }
  }

  return directive;
}

function directiveStep(
  directive: BotTestDirective,
  progress: BotDirectiveProgress | undefined
): BotDirectiveStep | undefined {
  if (directive.directiveMode !== 'guided-sequence') {
    return undefined;
  }

  if (progress?.currentStepId) {
    return directive.steps.find((step) => step.stepId === progress.currentStepId);
  }

  return directive.steps[0];
}

function directiveRelatedKeywords(
  directive: BotTestDirective,
  step: BotDirectiveStep | undefined
): string[] {
  return unique(
    [
      directive.targetFeature,
      directive.targetScene,
      directive.targetArea,
      directive.name,
      directive.description,
      step?.name,
      step?.description,
      step?.targetScene,
      step?.targetArea
    ]
      .filter((value): value is string => Boolean(value))
      .flatMap(keywordTokens)
      .filter((keyword) => !['test', 'user', 'game', 'action', 'feature', 'with', 'from'].includes(keyword))
  );
}

function scoreForDirective(
  directive: BotTestDirective,
  step: BotDirectiveStep | undefined,
  selected: ScoredAction
): DirectiveActionScore {
  const text = actionText(selected.action);
  const exactActionType = normalize(selected.action.actionType);
  const requestedKeywords = unique([
    ...directive.actionKeywords,
    ...(step?.actionKeywords ?? []),
    ...(step?.actionType ? [step.actionType] : [])
  ]);
  const exact = requestedKeywords.filter((keyword) => normalize(keyword) === exactActionType);
  const strong = requestedKeywords.filter(
    (keyword) => !exact.includes(keyword) && text.includes(normalize(keyword))
  );
  const partial = requestedKeywords.filter(
    (keyword) => !exact.includes(keyword) && !strong.includes(keyword) && partiallyMatches(text, keyword)
  );
  const related = directiveRelatedKeywords(directive, step).filter((keyword) => text.includes(keyword));
  const avoided = directive.avoidedActionKeywords.filter((keyword) => text.includes(normalize(keyword)));
  let adjustment = 0;
  let matchKind: DirectiveActionScore['matchKind'] = 'unrelated';
  let matchedKeywords: string[] = [];

  if (directive.directiveMode === 'influence') {
    if (exact.length > 0 || strong.length > 0) {
      adjustment += 30;
      matchKind = exact.length > 0 ? 'exact' : 'strong';
      matchedKeywords = [...exact, ...strong];
    } else if (partial.length > 0 || related.length > 0) {
      adjustment += 12;
      matchKind = partial.length > 0 ? 'partial' : 'related';
      matchedKeywords = [...partial, ...related];
    }
  } else {
    if (exact.length > 0) {
      adjustment += 100;
      matchKind = 'exact';
      matchedKeywords = exact;
    } else if (strong.length > 0) {
      adjustment += 65;
      matchKind = 'strong';
      matchedKeywords = strong;
    } else if (partial.length > 0 || related.length > 0) {
      adjustment += 30;
      matchKind = partial.length > 0 ? 'partial' : 'related';
      matchedKeywords = [...partial, ...related];
    } else {
      adjustment -= 30;
    }
  }

  if (avoided.length > 0) {
    adjustment -= 20;
    matchKind = 'avoided';
    matchedKeywords = unique([...matchedKeywords, ...avoided]);
  }

  const reason =
    matchKind === 'unrelated'
      ? `Action was unrelated to the active ${directive.priority}-priority directive.`
      : matchKind === 'avoided'
        ? `Action matched something the directive asked the bot to avoid.`
        : `Action ${matchKind === 'exact' ? 'exactly' : 'closely'} matched the active ${directive.priority}-priority directive.`;

  return {
    scored: {
      ...selected,
      score: selected.score + adjustment,
      reason: `${selected.reason}, user directive ${matchKind}`
    },
    originalProfilePlannerScore: selected.score,
    matchedKeywords: unique(matchedKeywords),
    matchKind,
    directiveReason: reason
  };
}

function directiveExplanation(input: {
  profile: BotProfile;
  actionType: string;
  directive: BotTestDirective;
  directiveReason: string;
  fallbackUsed: boolean;
}): string {
  if (input.fallbackUsed) {
    return `${input.profile.displayName} selected ${input.actionType} as a valid fallback because the action requested by "${input.directive.name}" is not currently available.`;
  }

  return `${input.profile.displayName} selected ${input.actionType} because the user asked it to ${input.directive.name.toLowerCase()}. ${input.directiveReason}`;
}

function buildDirectiveAction(input: {
  plannerInput: ActionPlannerInput;
  selected: ScoredAction;
  directive: BotTestDirective;
  step?: BotDirectiveStep;
  directiveReason: string;
  matchedKeywords: string[];
  originalProfilePlannerScore: number;
  fallbackUsed: boolean;
  unavailable?: boolean;
  quality: Extract<ActionQuality, 'user-directed' | 'directive-sequence' | 'directive-retry'>;
  nextLikelyAction?: string;
}): GameAction {
  const key = profileKey(input.plannerInput.profile);
  const explanation = directiveExplanation({
    profile: input.plannerInput.profile,
    actionType: input.selected.action.actionType,
    directive: input.directive,
    directiveReason: input.directiveReason,
    fallbackUsed: input.fallbackUsed
  });

  return {
    actionId: `${input.plannerInput.botId}-action-${String(input.plannerInput.actionIndex + 1).padStart(4, '0')}`,
    sessionId: input.plannerInput.sessionId,
    gameInstanceId: input.plannerInput.gameInstanceId,
    botId: input.plannerInput.botId,
    type: input.selected.action.actionType,
    payload: {
      planner: 'user-directive',
      label: input.selected.action.label,
      stateScene: input.plannerInput.state?.scene,
      score: Math.round(input.selected.score * 100) / 100,
      random: input.selected.random,
      reason: input.directiveReason,
      profileKey: key,
      seed: input.plannerInput.seed ?? hashString(`${input.plannerInput.sessionId}:${input.plannerInput.botId}`),
      quality: input.quality,
      explanation,
      nextLikelyAction: input.nextLikelyAction,
      directiveId: input.directive.directiveId,
      directiveName: input.directive.name,
      directiveType: input.directive.directiveType,
      directiveMode: input.directive.directiveMode,
      directivePriority: input.directive.priority,
      directiveStepId: input.step?.stepId,
      directiveWaitAfterMs: input.step?.waitAfterMs,
      directiveReason: input.directiveReason,
      matchedKeywords: input.matchedKeywords,
      expectedCondition:
        input.step?.successCondition ?? (input.directive.successConditions.join('; ') || undefined),
      fallbackUsed: input.fallbackUsed,
      directiveUnavailable: input.unavailable === true,
      directiveOutcome: input.unavailable ? 'unavailable' : 'selected',
      originalProfilePlannerScore: Math.round(input.originalProfilePlannerScore * 100) / 100,
      adapterPayload: input.selected.action.payloadSchema
    },
    requestedAt: input.plannerInput.now
  };
}

function actionQuality(selected: ScoredAction, key: string): ActionQuality {
  const text = actionText(selected.action);

  if (key === 'chaos') {
    return 'random';
  }

  if (selected.repetitionCount > 0) {
    return 'repeated';
  }

  if (
    key === 'sequence' ||
    key === 'boundary' ||
    containsAny(text, ['locked', 'out-of-order', 'sequence-break', 'clip', 'map-exit'])
  ) {
    return 'risky';
  }

  if (selected.reason.includes('unvisited action')) {
    return 'exploratory';
  }

  return 'planned';
}

function chooseScored(scored: ScoredAction[], seed: number, actionIndex: number, key: string): ScoredAction {
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.action.actionType.localeCompare(b.action.actionType));

  if (key === 'explorer' || key === 'completionist') {
    const candidates = sorted.slice(0, Math.min(3, sorted.length));
    const selectedIndex = Math.floor(randomUnit(seed, `near-top:${actionIndex}:${key}`) * candidates.length);

    return candidates[Math.min(candidates.length - 1, selectedIndex)];
  }

  const threshold = key === 'chaos' ? 60 : key === 'explorer' || key === 'completionist' ? 18 : 8;
  const topScore = sorted[0].score;
  const candidates = sorted.filter((item) => topScore - item.score <= threshold);
  const selectedIndex = Math.floor(randomUnit(seed, `near-top:${actionIndex}:${key}`) * candidates.length);

  return candidates[Math.min(candidates.length - 1, selectedIndex)];
}

export class ActionPlanner {
  private readonly uiJourneyPlanner = new UIJourneyPlanner();

  chooseAction(input: ActionPlannerInput): GameAction | null {
    const seed = input.seed ?? hashString(`${input.sessionId}:${input.botId}`);
    const key = profileKey(input.profile);

    if (key === 'ui-journey' && input.uiFlows && input.uiFlows.length > 0) {
      const flow = input.uiFlows[0];
      const journeyAction = this.uiJourneyPlanner.chooseAction({
        sessionId: input.sessionId,
        gameInstanceId: input.gameInstanceId,
        botId: input.botId,
        flow,
        state: input.state,
        availableActions: input.availableActions,
        actionIndex: input.actionIndex,
        now: input.now,
        seed,
        memory: input.memory
      });

      if (journeyAction) {
        return journeyAction;
      }
    }

    if (input.availableActions.length === 0) {
      return null;
    }

    const scored = input.availableActions.map((action, index) => scoreAction(input, action, index));
    const directive = currentDirective(input);

    if (directive) {
      const step = directiveStep(directive, input.directiveProgress);
      const profileSelected = chooseScored(scored, seed, input.actionIndex, key);

      if (directive.directiveMode === 'force-next-valid-action') {
        const availability = resolveDirectiveActionAvailability(directive, input.availableActions);

        if (availability.available) {
          const selected = scored.find((item) => item.action.actionType === availability.actionType)!;
          const nextLikelyAction = scored.find((item) => item !== selected)?.action.actionType;
          return buildDirectiveAction({
            plannerInput: input,
            selected: { ...selected, score: selected.score + 100 },
            directive,
            directiveReason: `The exact action requested by the active ${directive.priority}-priority directive is available.`,
            matchedKeywords: [availability.actionType],
            originalProfilePlannerScore: selected.score,
            fallbackUsed: false,
            quality: 'user-directed',
            nextLikelyAction
          });
        }

        return buildDirectiveAction({
          plannerInput: input,
          selected: profileSelected,
          directive,
          directiveReason: availability.reason,
          matchedKeywords: [],
          originalProfilePlannerScore: profileSelected.score,
          fallbackUsed: true,
          unavailable: true,
          quality: 'directive-retry',
          nextLikelyAction: scored.find((item) => item !== profileSelected)?.action.actionType
        });
      }

      if (directive.directiveMode === 'guided-sequence' && step) {
        const exactStepAction = resolveAvailableActionType(step.actionType, input.availableActions);
        const directiveScores = scored.map((item) => scoreForDirective(directive, step, item));
        let selectedScore = exactStepAction.available
          ? directiveScores.find((item) => item.scored.action.actionType === exactStepAction.actionType)
          : directiveScores
              .filter((item) => ['exact', 'strong', 'partial', 'related'].includes(item.matchKind))
              .sort((left, right) => right.scored.score - left.scored.score)[0];
        let fallbackUsed = false;
        let unavailable = false;

        if (!selectedScore && step.fallbackAction) {
          const fallback = resolveAvailableActionType(step.fallbackAction, input.availableActions);
          if (fallback.available) {
            const fallbackScored = scored.find((item) => item.action.actionType === fallback.actionType)!;
            selectedScore = {
              scored: fallbackScored,
              originalProfilePlannerScore: fallbackScored.score,
              matchedKeywords: [step.fallbackAction],
              matchKind: 'related',
              directiveReason: `The current sequence step action is unavailable, so its configured fallback action was selected.`
            };
            fallbackUsed = true;
          }
        }

        if (!selectedScore) {
          selectedScore = {
            scored: profileSelected,
            originalProfilePlannerScore: profileSelected.score,
            matchedKeywords: [],
            matchKind: 'unrelated',
            directiveReason: `No action reported by the adapter matches sequence step "${step.name}". A valid profile action was selected instead.`
          };
          fallbackUsed = true;
          unavailable = true;
        }

        return buildDirectiveAction({
          plannerInput: input,
          selected: selectedScore.scored,
          directive,
          step,
          directiveReason: selectedScore.directiveReason,
          matchedKeywords: selectedScore.matchedKeywords,
          originalProfilePlannerScore: selectedScore.originalProfilePlannerScore,
          fallbackUsed,
          unavailable,
          quality: fallbackUsed ? 'directive-retry' : 'directive-sequence',
          nextLikelyAction: directiveScores
            .map((item) => item.scored)
            .sort((left, right) => right.score - left.score)
            .find((item) => item.action.actionType !== selectedScore.scored.action.actionType)?.action.actionType
        });
      }

      const directiveScores = scored.map((item) => scoreForDirective(directive, step, item));
      const selected = chooseScored(
        directiveScores.map((item) => item.scored),
        seed,
        input.actionIndex,
        'directive'
      );
      const selectedDirectiveScore = directiveScores.find(
        (item) => item.scored.action.actionType === selected.action.actionType
      )!;
      const sortedDirectiveScores = directiveScores
        .map((item) => item.scored)
        .sort((left, right) => right.score - left.score);
      const isRetry =
        directive.directiveMode === 'repeat-until-condition' &&
        (input.directiveProgress?.attempts ?? 0) > 0;

      return buildDirectiveAction({
        plannerInput: input,
        selected,
        directive,
        step,
        directiveReason: selectedDirectiveScore.directiveReason,
        matchedKeywords: selectedDirectiveScore.matchedKeywords,
        originalProfilePlannerScore: selectedDirectiveScore.originalProfilePlannerScore,
        fallbackUsed: false,
        quality: isRetry ? 'directive-retry' : 'user-directed',
        nextLikelyAction: sortedDirectiveScores.find((item) => item !== selected)?.action.actionType
      });
    }

    const selected = chooseScored(scored, seed, input.actionIndex, key);
    const quality = actionQuality(selected, key);
    const explanation = buildPlannerExplanation({
      profile: input.profile,
      actionType: selected.action.actionType,
      profileKey: key,
      plannerReason: selected.reason,
      quality
    });
    const nextLikelyAction = [...scored]
      .sort((a, b) => b.score - a.score || a.action.actionType.localeCompare(b.action.actionType))
      .find((candidate) => candidate !== selected)?.action.actionType;

    return {
      actionId: `${input.botId}-action-${String(input.actionIndex + 1).padStart(4, '0')}`,
      sessionId: input.sessionId,
      gameInstanceId: input.gameInstanceId,
      botId: input.botId,
      type: selected.action.actionType,
      payload: {
        planner: 'rule-based',
        label: selected.action.label,
        stateScene: input.state?.scene,
        score: Math.round(selected.score * 100) / 100,
        random: selected.random,
        reason: selected.reason,
        profileKey: key,
        seed,
        quality,
        explanation,
        nextLikelyAction,
        adapterPayload: selected.action.payloadSchema
      },
      requestedAt: input.now
    };
  }
}
