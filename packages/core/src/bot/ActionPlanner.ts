import type { ActionQuality, BotProfile, DetectedIssue, GameAction, GameStateSnapshot, UIFlow } from '../types';
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

  if (key !== 'chaos' && containsAny(text, ['random', 'spam', 'weird'])) {
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
