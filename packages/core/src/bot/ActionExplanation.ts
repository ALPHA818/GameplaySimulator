import type { ActionQuality, ActionResult, BotProfile, GameAction } from '../types';

export interface ActionInsight {
  planner: string;
  score?: number;
  randomValue?: number;
  plannerReason?: string;
  profileKey?: string;
  seed?: number;
  quality: ActionQuality;
  explanation: string;
  nextLikelyAction?: string;
}

export interface PlannerExplanationInput {
  profile: BotProfile;
  actionType: string;
  profileKey: string;
  plannerReason: string;
  quality: ActionQuality;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function actionQualityValue(value: unknown): ActionQuality | undefined {
  return [
    'planned',
    'exploratory',
    'recovery',
    'repeated',
    'risky',
    'random',
    'startup-flow'
  ].includes(String(value))
    ? value as ActionQuality
    : undefined;
}

function profileName(profile: BotProfile): string {
  return profile.displayName.trim() || profile.profileId;
}

function readableProfileKey(profileKey: string): string {
  const names: Record<string, string> = {
    main: 'main story',
    completionist: 'completionist',
    explorer: 'explorer',
    speedrunner: 'speedrunner',
    chaos: 'chaos',
    ui: 'UI',
    economy: 'economy',
    combat: 'combat',
    quest: 'quest',
    side: 'side content',
    idle: 'idle player',
    inventory: 'inventory',
    dialogue: 'dialogue',
    sequence: 'sequence breaker',
    performance: 'performance stress',
    save: 'save/load',
    boundary: 'boundary testing'
  };

  return names[profileKey] ?? profileKey.replace(/-/g, ' ');
}

export function buildPlannerExplanation(input: PlannerExplanationInput): string {
  const subject = profileName(input.profile);
  const reason = input.plannerReason.toLowerCase();

  if (input.profileKey === 'chaos' || input.quality === 'random') {
    return `${subject} chose ${input.actionType} because the chaos profile favors unpredictable, risky stress actions.`;
  }

  if (input.profileKey === 'explorer' && reason.includes('unvisited action')) {
    return `${subject} chose ${input.actionType} because it was an unvisited action that could reveal new game behavior.`;
  }

  if (input.quality === 'repeated') {
    return `${subject} chose ${input.actionType} again because it still ranked highly for this profile.`;
  }

  if (input.quality === 'risky') {
    return `${subject} chose ${input.actionType} because this profile is meant to test risky paths and edge cases.`;
  }

  if (reason.includes('preferred')) {
    return `${subject} chose ${input.actionType} because it matched this bot profile's preferred actions.`;
  }

  if (reason.includes('rule match')) {
    return `${subject} chose ${input.actionType} because it matched ${readableProfileKey(input.profileKey)} profile rules.`;
  }

  return `${subject} chose ${input.actionType} because it had the strongest weighted plan for the current state.`;
}

export function actionInsightFromAction(action: GameAction | null | undefined): ActionInsight | null {
  if (!action) {
    return null;
  }

  const payload = action.payload;
  const recovery = payload.recovery === true;
  const planner = stringValue(payload.planner) ?? (recovery ? 'recovery' : 'unknown');
  const plannerReason = stringValue(payload.reason) ?? stringValue(payload.stuckReason);
  const quality = actionQualityValue(payload.quality) ?? (recovery ? 'recovery' : planner === 'ui-journey' ? 'startup-flow' : 'planned');
  const explanation =
    stringValue(payload.explanation) ??
    (recovery
      ? `The bot chose ${action.type} as a recovery action because it was stuck: ${plannerReason ?? 'progress had stopped'}.`
      : planner === 'ui-journey'
        ? `UI Journey Bot chose ${action.type} because it was the next configured startup-flow step.`
        : `The bot chose ${action.type} because it was the strongest available action for its profile.`);

  return {
    planner,
    score: numberValue(payload.score),
    randomValue: numberValue(payload.random),
    plannerReason,
    profileKey: stringValue(payload.profileKey),
    seed: numberValue(payload.seed),
    quality,
    explanation,
    nextLikelyAction: stringValue(payload.nextLikelyAction)
  };
}

export function plannerMetadataForLog(action: GameAction): Record<string, unknown> {
  const insight = actionInsightFromAction(action);

  return {
    planner: insight?.planner,
    score: insight?.score,
    randomValue: insight?.randomValue,
    reason: insight?.plannerReason,
    profileKey: insight?.profileKey,
    seed: insight?.seed
  };
}

export function actionResultSummary(result: ActionResult | null | undefined): string | undefined {
  if (!result) {
    return undefined;
  }

  return result.message ? `${result.status}: ${result.message}` : result.status;
}
