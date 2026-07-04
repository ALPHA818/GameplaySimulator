import type { BotProfile, ResourceWeight } from '../types';

type ProfileInput = {
  id: string;
  name: string;
  type: string;
  playstyle: string;
  description: string;
  aggression: number;
  curiosity: number;
  riskTolerance: number;
  repetitionTolerance: number;
  bugHuntingBias: number;
  preferredActions: string[];
  avoidedActions: string[];
  goals: Array<{
    goalId: string;
    name: string;
    description?: string;
    priority: number;
    successCriteria: string[];
    targetIssueCategories: BotProfile['goals'][number]['targetIssueCategories'];
  }>;
  defaultResourceWeight: ResourceWeight;
  recommendedMinCount: number;
  recommendedMaxCount: number;
  tags: string[];
};

function profile(input: ProfileInput): BotProfile {
  return {
    profileId: input.id,
    displayName: input.name,
    botType: input.type,
    playstyle: input.playstyle,
    description: input.description,
    aggression: input.aggression,
    curiosity: input.curiosity,
    riskTolerance: input.riskTolerance,
    repetitionTolerance: input.repetitionTolerance,
    bugHuntingBias: input.bugHuntingBias,
    preferredActions: input.preferredActions,
    avoidedActions: input.avoidedActions,
    goals: input.goals,
    recommendedMinCount: input.recommendedMinCount,
    recommendedMaxCount: input.recommendedMaxCount,
    defaultResourceWeight: input.defaultResourceWeight,
    tags: input.tags,
    config: {
      playstyle: input.playstyle,
      aggression: input.aggression,
      curiosity: input.curiosity,
      riskTolerance: input.riskTolerance,
      repetitionTolerance: input.repetitionTolerance,
      bugHuntingBias: input.bugHuntingBias,
      preferredActions: input.preferredActions,
      avoidedActions: input.avoidedActions
    }
  };
}

export const defaultBotProfiles: BotProfile[] = [
  profile({
    id: 'main-story-bot',
    name: 'Main Story Bot',
    type: 'main-story',
    playstyle: 'story-critical-path',
    description: 'Prioritizes the primary campaign path, required objectives, and progression blockers.',
    aggression: 0.45,
    curiosity: 0.48,
    riskTolerance: 0.35,
    repetitionTolerance: 0.55,
    bugHuntingBias: 0.62,
    preferredActions: ['accept-main-quest', 'follow-waypoint', 'interact', 'complete-objective'],
    avoidedActions: ['optional-grind', 'sequence-break', 'random-input'],
    goals: [
      {
        goalId: 'main-path-progression',
        name: 'Main Path Progression',
        description: 'Move through required objectives and detect blockers on the critical path.',
        priority: 10,
        successCriteria: ['Reach the next main objective', 'Report hard progression blockers'],
        targetIssueCategories: ['progression', 'gameplay', 'crash']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 6,
    tags: ['story', 'progression', 'smoke']
  }),
  profile({
    id: 'completionist-bot',
    name: 'Completionist Bot',
    type: 'completionist',
    playstyle: 'exhaustive-coverage',
    description: 'Attempts broad content completion, including optional objectives and collection loops.',
    aggression: 0.42,
    curiosity: 0.92,
    riskTolerance: 0.54,
    repetitionTolerance: 0.88,
    bugHuntingBias: 0.72,
    preferredActions: ['collect-item', 'complete-side-objective', 'talk-to-npc', 'revisit-area'],
    avoidedActions: ['skip-dialogue', 'speedrun-shortcut'],
    goals: [
      {
        goalId: 'optional-content-coverage',
        name: 'Optional Content Coverage',
        priority: 9,
        successCriteria: ['Touch optional systems', 'Exercise collection and completion loops'],
        targetIssueCategories: ['content', 'progression', 'save_load']
      }
    ],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 4,
    tags: ['completion', 'coverage', 'optional']
  }),
  profile({
    id: 'explorer-bot',
    name: 'Explorer Bot',
    type: 'explorer',
    playstyle: 'map-and-navigation-coverage',
    description: 'Explores reachable spaces, transitions, doors, menus, and traversal boundaries.',
    aggression: 0.25,
    curiosity: 0.96,
    riskTolerance: 0.58,
    repetitionTolerance: 0.62,
    bugHuntingBias: 0.76,
    preferredActions: ['move', 'inspect', 'open-door', 'jump', 'use-transition'],
    avoidedActions: ['fast-travel-only', 'idle'],
    goals: [
      {
        goalId: 'map-coverage',
        name: 'Map Coverage',
        priority: 10,
        successCriteria: ['Discover reachable screens', 'Report stuck or unreachable navigation states'],
        targetIssueCategories: ['navigation', 'visual', 'progression']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 20,
    tags: ['navigation', 'map', 'coverage']
  }),
  profile({
    id: 'speedrunner-bot',
    name: 'Speedrunner Bot',
    type: 'speedrunner',
    playstyle: 'fast-critical-path',
    description: 'Moves quickly through known objectives and stresses timing, transitions, and skip-prone flows.',
    aggression: 0.62,
    curiosity: 0.36,
    riskTolerance: 0.82,
    repetitionTolerance: 0.5,
    bugHuntingBias: 0.68,
    preferredActions: ['sprint', 'skip-cutscene', 'fast-travel', 'rapid-confirm'],
    avoidedActions: ['optional-dialogue', 'slow-inspection'],
    goals: [
      {
        goalId: 'fast-path-stability',
        name: 'Fast Path Stability',
        priority: 8,
        successCriteria: ['Complete fast objective loops', 'Detect timing or transition instability'],
        targetIssueCategories: ['progression', 'performance', 'gameplay']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 8,
    tags: ['speed', 'timing', 'critical-path']
  }),
  profile({
    id: 'chaos-monkey-bot',
    name: 'Chaos Monkey Bot',
    type: 'chaos',
    playstyle: 'high-noise-randomized',
    description: 'Performs high-variance permitted inputs to uncover crash, hang, and state handling defects.',
    aggression: 0.9,
    curiosity: 0.82,
    riskTolerance: 0.95,
    repetitionTolerance: 0.44,
    bugHuntingBias: 0.94,
    preferredActions: ['random-input', 'rapid-toggle', 'interrupt-flow', 'stress-menu'],
    avoidedActions: ['long-idle', 'linear-objective-only'],
    goals: [
      {
        goalId: 'chaos-stability',
        name: 'Chaos Stability',
        priority: 8,
        successCriteria: ['Survive random inputs', 'Report crashes and soft locks'],
        targetIssueCategories: ['crash', 'hang', 'input']
      }
    ],
    defaultResourceWeight: 'very_heavy',
    recommendedMinCount: 0,
    recommendedMaxCount: 5,
    tags: ['stress', 'random', 'stability']
  }),
  profile({
    id: 'ui-tester-bot',
    name: 'UI Tester Bot',
    type: 'ui',
    playstyle: 'menus-and-hud',
    description: 'Exercises menus, dialogs, HUD flows, settings screens, and input focus changes.',
    aggression: 0.22,
    curiosity: 0.78,
    riskTolerance: 0.32,
    repetitionTolerance: 0.8,
    bugHuntingBias: 0.82,
    preferredActions: ['open-menu', 'change-setting', 'confirm-dialog', 'navigate-tabs'],
    avoidedActions: ['combat-only', 'skip-ui'],
    goals: [
      {
        goalId: 'ui-flow-coverage',
        name: 'UI Flow Coverage',
        priority: 9,
        successCriteria: ['Exercise UI flows', 'Report input focus and display issues'],
        targetIssueCategories: ['input', 'visual', 'accessibility']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 8,
    tags: ['ui', 'menus', 'hud']
  }),
  profile({
    id: 'economy-tester-bot',
    name: 'Economy Tester Bot',
    type: 'economy',
    playstyle: 'shops-crafting-currency',
    description: 'Exercises shops, trades, crafting costs, rewards, currencies, and economy edge cases.',
    aggression: 0.28,
    curiosity: 0.72,
    riskTolerance: 0.48,
    repetitionTolerance: 0.86,
    bugHuntingBias: 0.8,
    preferredActions: ['buy', 'sell', 'craft', 'loot', 'compare-price'],
    avoidedActions: ['ignore-inventory', 'combat-grind-only'],
    goals: [
      {
        goalId: 'economy-loop-validation',
        name: 'Economy Loop Validation',
        priority: 7,
        successCriteria: ['Exercise transactions', 'Report negative currency or pricing issues'],
        targetIssueCategories: ['gameplay', 'content', 'save_load']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 6,
    tags: ['economy', 'shops', 'crafting']
  }),
  profile({
    id: 'combat-tester-bot',
    name: 'Combat Tester Bot',
    type: 'combat',
    playstyle: 'combat-systems',
    description: 'Exercises attacks, defense, targeting, enemy behavior, recovery, and combat rewards.',
    aggression: 0.86,
    curiosity: 0.52,
    riskTolerance: 0.72,
    repetitionTolerance: 0.72,
    bugHuntingBias: 0.78,
    preferredActions: ['attack', 'dodge', 'block', 'use-ability', 'target-enemy'],
    avoidedActions: ['avoid-combat', 'long-dialogue'],
    goals: [
      {
        goalId: 'combat-loop-stability',
        name: 'Combat Loop Stability',
        priority: 9,
        successCriteria: ['Complete combat loops', 'Report targeting and damage issues'],
        targetIssueCategories: ['gameplay', 'performance', 'crash']
      }
    ],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 10,
    tags: ['combat', 'ai', 'abilities']
  }),
  profile({
    id: 'quest-tester-bot',
    name: 'Quest Tester Bot',
    type: 'quest',
    playstyle: 'quest-state-machine',
    description: 'Exercises quest accept, update, completion, branching, and failure states.',
    aggression: 0.38,
    curiosity: 0.78,
    riskTolerance: 0.44,
    repetitionTolerance: 0.78,
    bugHuntingBias: 0.86,
    preferredActions: ['accept-quest', 'track-quest', 'turn-in-quest', 'branch-dialogue'],
    avoidedActions: ['ignore-objectives', 'random-input-only'],
    goals: [
      {
        goalId: 'quest-state-validation',
        name: 'Quest State Validation',
        priority: 9,
        successCriteria: ['Exercise quest transitions', 'Report incorrect objective states'],
        targetIssueCategories: ['progression', 'content', 'save_load']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 8,
    tags: ['quests', 'state', 'progression']
  }),
  profile({
    id: 'side-content-tester-bot',
    name: 'Side Content Tester Bot',
    type: 'side-content',
    playstyle: 'optional-activities',
    description: 'Targets optional areas, minigames, challenges, collectibles, and side systems.',
    aggression: 0.4,
    curiosity: 0.88,
    riskTolerance: 0.55,
    repetitionTolerance: 0.68,
    bugHuntingBias: 0.74,
    preferredActions: ['start-minigame', 'collect-optional', 'enter-side-area', 'retry-challenge'],
    avoidedActions: ['main-path-only', 'speedrun-skip'],
    goals: [
      {
        goalId: 'side-content-coverage',
        name: 'Side Content Coverage',
        priority: 7,
        successCriteria: ['Exercise optional activities', 'Report side-content blockers'],
        targetIssueCategories: ['content', 'gameplay', 'visual']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 0,
    recommendedMaxCount: 8,
    tags: ['optional', 'minigame', 'content']
  }),
  profile({
    id: 'idle-player-bot',
    name: 'Idle Player Bot',
    type: 'idle',
    playstyle: 'idle-and-timeout',
    description: 'Waits in key states to test idle behavior, timers, background systems, and recovery.',
    aggression: 0.04,
    curiosity: 0.18,
    riskTolerance: 0.16,
    repetitionTolerance: 0.95,
    bugHuntingBias: 0.58,
    preferredActions: ['idle', 'wait', 'observe', 'resume-after-timeout'],
    avoidedActions: ['rapid-input', 'combat-initiation'],
    goals: [
      {
        goalId: 'idle-stability',
        name: 'Idle Stability',
        priority: 6,
        successCriteria: ['Remain stable while idle', 'Report timeout and suspend/resume issues'],
        targetIssueCategories: ['hang', 'performance', 'network']
      }
    ],
    defaultResourceWeight: 'light',
    recommendedMinCount: 0,
    recommendedMaxCount: 10,
    tags: ['idle', 'timers', 'stability']
  }),
  profile({
    id: 'inventory-stress-tester-bot',
    name: 'Inventory Stress Tester Bot',
    type: 'inventory-stress',
    playstyle: 'inventory-edge-cases',
    description: 'Exercises large inventories, sorting, stack splits, equip changes, and item edge cases.',
    aggression: 0.26,
    curiosity: 0.7,
    riskTolerance: 0.66,
    repetitionTolerance: 0.9,
    bugHuntingBias: 0.86,
    preferredActions: ['loot', 'sort-inventory', 'split-stack', 'equip-item', 'drop-item'],
    avoidedActions: ['ignore-items', 'main-path-only'],
    goals: [
      {
        goalId: 'inventory-stress',
        name: 'Inventory Stress',
        priority: 8,
        successCriteria: ['Stress inventory operations', 'Report item loss or invalid state'],
        targetIssueCategories: ['gameplay', 'save_load', 'performance']
      }
    ],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 0,
    recommendedMaxCount: 6,
    tags: ['inventory', 'items', 'stress']
  }),
  profile({
    id: 'dialogue-tester-bot',
    name: 'Dialogue Tester Bot',
    type: 'dialogue',
    playstyle: 'npc-conversation-coverage',
    description: 'Exercises NPC dialogue, branching choices, subtitles, localization length, and repeated talks.',
    aggression: 0.12,
    curiosity: 0.84,
    riskTolerance: 0.34,
    repetitionTolerance: 0.82,
    bugHuntingBias: 0.76,
    preferredActions: ['talk-to-npc', 'choose-dialogue-option', 'repeat-dialogue', 'skip-dialogue'],
    avoidedActions: ['combat-only', 'ignore-npc'],
    goals: [
      {
        goalId: 'dialogue-coverage',
        name: 'Dialogue Coverage',
        priority: 7,
        successCriteria: ['Exercise dialogue branches', 'Report missing or broken dialogue states'],
        targetIssueCategories: ['content', 'visual', 'accessibility']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 8,
    tags: ['dialogue', 'npc', 'localization']
  }),
  profile({
    id: 'sequence-breaker-bot',
    name: 'Sequence Breaker Bot',
    type: 'sequence-breaker',
    playstyle: 'out-of-order-progression',
    description: 'Attempts permitted out-of-order interactions to find progression and state assumptions.',
    aggression: 0.68,
    curiosity: 0.86,
    riskTolerance: 0.9,
    repetitionTolerance: 0.52,
    bugHuntingBias: 0.92,
    preferredActions: ['skip-objective', 'enter-late-area', 'interrupt-script', 'use-shortcut'],
    avoidedActions: ['strict-waypoint-following', 'linear-only'],
    goals: [
      {
        goalId: 'sequence-break-validation',
        name: 'Sequence Break Validation',
        priority: 8,
        successCriteria: ['Attempt out-of-order flows', 'Report invalid state or progression locks'],
        targetIssueCategories: ['progression', 'gameplay', 'crash']
      }
    ],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 0,
    recommendedMaxCount: 5,
    tags: ['sequence', 'progression', 'edge-case']
  }),
  profile({
    id: 'new-player-bot',
    name: 'New Player Bot',
    type: 'new-player',
    playstyle: 'hesitant-first-time-player',
    description: 'Simulates a cautious first-time player who reads prompts, hesitates, and tries obvious affordances.',
    aggression: 0.18,
    curiosity: 0.66,
    riskTolerance: 0.22,
    repetitionTolerance: 0.7,
    bugHuntingBias: 0.54,
    preferredActions: ['read-prompt', 'try-obvious-action', 'open-help', 'follow-tutorial'],
    avoidedActions: ['expert-shortcut', 'skip-tutorial'],
    goals: [
      {
        goalId: 'onboarding-validation',
        name: 'Onboarding Validation',
        priority: 8,
        successCriteria: ['Complete onboarding flows', 'Report unclear tutorial or prompt states'],
        targetIssueCategories: ['accessibility', 'input', 'progression']
      }
    ],
    defaultResourceWeight: 'light',
    recommendedMinCount: 1,
    recommendedMaxCount: 10,
    tags: ['onboarding', 'tutorial', 'accessibility']
  }),
  profile({
    id: 'performance-stress-bot',
    name: 'Performance Stress Bot',
    type: 'performance-stress',
    playstyle: 'load-and-throughput',
    description: 'Stresses high-load scenes, repeated actions, effects-heavy loops, and population-heavy areas.',
    aggression: 0.72,
    curiosity: 0.58,
    riskTolerance: 0.76,
    repetitionTolerance: 0.86,
    bugHuntingBias: 0.84,
    preferredActions: ['trigger-effects', 'spawn-load', 'repeat-action', 'enter-dense-area'],
    avoidedActions: ['idle-only', 'slow-walk-only'],
    goals: [
      {
        goalId: 'performance-pressure',
        name: 'Performance Pressure',
        priority: 9,
        successCriteria: ['Stress load-heavy gameplay', 'Report stalls or performance degradation'],
        targetIssueCategories: ['performance', 'hang', 'crash']
      }
    ],
    defaultResourceWeight: 'very_heavy',
    recommendedMinCount: 0,
    recommendedMaxCount: 5,
    tags: ['performance', 'stress', 'load']
  }),
  profile({
    id: 'save-load-tester-bot',
    name: 'Save Load Tester Bot',
    type: 'save-load',
    playstyle: 'persistence-validation',
    description: 'Exercises save, load, checkpoint, profile isolation, and resume flows.',
    aggression: 0.2,
    curiosity: 0.58,
    riskTolerance: 0.5,
    repetitionTolerance: 0.92,
    bugHuntingBias: 0.9,
    preferredActions: ['save-game', 'load-game', 'reload-checkpoint', 'switch-profile'],
    avoidedActions: ['no-save-long-run', 'skip-checkpoint'],
    goals: [
      {
        goalId: 'save-load-integrity',
        name: 'Save Load Integrity',
        priority: 10,
        successCriteria: ['Round-trip save/load flows', 'Report lost progress or corrupted state'],
        targetIssueCategories: ['save_load', 'progression', 'crash']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 6,
    tags: ['save', 'load', 'checkpoint']
  }),
  profile({
    id: 'boundary-breaker-bot',
    name: 'Boundary Breaker Bot',
    type: 'boundary-breaker',
    playstyle: 'collision-and-map-limits',
    description: 'Pushes collision, world bounds, camera edges, forbidden transitions, and geometry limits.',
    aggression: 0.54,
    curiosity: 0.92,
    riskTolerance: 0.88,
    repetitionTolerance: 0.66,
    bugHuntingBias: 0.9,
    preferredActions: ['push-boundary', 'jump-at-edge', 'clip-test', 'camera-edge-test'],
    avoidedActions: ['stay-on-path', 'menu-only'],
    goals: [
      {
        goalId: 'boundary-validation',
        name: 'Boundary Validation',
        priority: 8,
        successCriteria: ['Probe map and collision boundaries', 'Report escapes and stuck states'],
        targetIssueCategories: ['navigation', 'visual', 'gameplay']
      }
    ],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 0,
    recommendedMaxCount: 8,
    tags: ['collision', 'bounds', 'navigation']
  })
];

export const DEFAULT_BOT_PROFILE_IDS = defaultBotProfiles.map((botProfile) => botProfile.profileId);
