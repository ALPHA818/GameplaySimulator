import type { BotProfile, ResourceWeight } from '../types';

type ProfileMetadata = Required<Pick<
  BotProfile,
  | 'profileGroup'
  | 'specializationCategory'
  | 'requiredCapabilities'
  | 'recommendedGameTypes'
  | 'incompatibleGameTypes'
  | 'bestUsedFor'
  | 'limitations'
  | 'beginnerRecommended'
  | 'defaultEnabled'
  | 'estimatedComplexity'
>> & Pick<BotProfile, 'beginnerExplanation'>;

const broadGameTypes = ['desktop', 'browser', 'unity', 'godot', 'unreal', 'custom'];
const structuredGameTypes = ['instrumented', 'unity', 'godot', 'unreal', 'browser'];

const profileMetadata: Record<string, ProfileMetadata> = {
  'main-story-bot': {
    profileGroup: 'general',
    specializationCategory: 'content-progression',
    requiredCapabilities: ['game actions'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['critical-path smoke tests', 'main objective blockers'],
    limitations: ['Needs progression actions or control mappings to follow objectives.'],
    beginnerRecommended: true,
    defaultEnabled: true,
    estimatedComplexity: 'low'
  },
  'completionist-bot': {
    profileGroup: 'general',
    specializationCategory: 'content-progression',
    requiredCapabilities: ['game actions', 'content signals'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['optional content coverage', 'collectibles and side objectives'],
    limitations: ['Works best when the game reports content and progression state.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'explorer-bot': {
    profileGroup: 'general',
    specializationCategory: 'world-simulation',
    requiredCapabilities: ['movement actions'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['map coverage', 'navigation and traversal checks'],
    limitations: ['Black-box adapters may only infer areas from screenshots or weak state.'],
    beginnerRecommended: true,
    defaultEnabled: true,
    estimatedComplexity: 'low'
  },
  'speedrunner-bot': {
    profileGroup: 'general',
    specializationCategory: 'content-progression',
    requiredCapabilities: ['game actions', 'progress signals'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['fast critical-path runs', 'timing-sensitive transitions'],
    limitations: ['Needs useful objective signals to choose a fast route reliably.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'chaos-monkey-bot': {
    profileGroup: 'general',
    specializationCategory: 'performance-stability',
    requiredCapabilities: ['multiple safe actions'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: ['public multiplayer'],
    bestUsedFor: ['crash discovery', 'unexpected input combinations'],
    limitations: ['Noisy behavior can make reproduction harder and may use more resources.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'new-player-bot': {
    profileGroup: 'general',
    specializationCategory: 'accessibility',
    requiredCapabilities: ['game actions'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['onboarding', 'tutorial clarity and obvious controls'],
    limitations: ['Cannot judge wording clarity well without structured UI state or vision.'],
    beginnerRecommended: true,
    defaultEnabled: false,
    estimatedComplexity: 'low'
  },
  'ui-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'ui-input',
    requiredCapabilities: ['UI or input actions'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['menus', 'settings, dialogs, and input focus'],
    limitations: ['Visual-only UI testing has weaker screen awareness.'],
    beginnerRecommended: true,
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'ui-journey-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'ui-input',
    requiredCapabilities: ['configured UI flow', 'UI or input actions'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['layered startup menus', 'repeatable UI journeys'],
    limitations: ['Requires a configured UI flow and reliable screen or wait conditions.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'economy-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'gameplay-systems',
    requiredCapabilities: ['economy actions', 'inventory or currency state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['shops and crafting', 'currency and reward loops'],
    limitations: ['Exploit checks are weaker without structured inventory and currency state.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'combat-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'gameplay-systems',
    requiredCapabilities: ['combat actions'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['combat loops', 'damage, targeting, death, and recovery'],
    limitations: ['Needs mapped combat controls and benefits from health/enemy state.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'quest-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'content-progression',
    requiredCapabilities: ['quest actions', 'quest state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['quest transitions', 'objective and reward state'],
    limitations: ['Requires quest signals for reliable automatic success checks.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'side-content-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'content-progression',
    requiredCapabilities: ['content actions'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['side quests', 'minigames and optional areas'],
    limitations: ['Known-content configuration greatly improves coverage results.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'idle-player-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'performance-stability',
    requiredCapabilities: ['wait action', 'process health'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['timeouts', 'idle stability and background behavior'],
    limitations: ['Long waits increase test duration and may produce little coverage.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'low'
  },
  'inventory-stress-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'gameplay-systems',
    requiredCapabilities: ['inventory actions', 'inventory state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['stacking and sorting', 'item loss and inventory limits'],
    limitations: ['Needs inventory controls and structured state for strong validation.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'dialogue-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'accessibility',
    requiredCapabilities: ['dialogue actions', 'UI state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['dialogue branches', 'subtitles and repeated conversations'],
    limitations: ['Text and branch validation is weaker without dialogue state.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'sequence-breaker-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'content-progression',
    requiredCapabilities: ['progression actions', 'progress state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['public multiplayer'],
    bestUsedFor: ['out-of-order progression', 'early area access'],
    limitations: ['Use only on controlled builds with safe saves or reset support.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'performance-stress-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'performance-stability',
    requiredCapabilities: ['performance telemetry', 'load-producing actions'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['low-spec first tests', 'public multiplayer'],
    bestUsedFor: ['busy scenes', 'frame-time and memory pressure'],
    limitations: ['Intentionally increases CPU, RAM, or GPU use.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'save-load-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'persistence',
    requiredCapabilities: ['save and load actions'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['games without saves'],
    bestUsedFor: ['save integrity', 'checkpoint and profile resume'],
    limitations: ['Use save isolation when multiple instances can write saves.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'boundary-breaker-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'world-simulation',
    requiredCapabilities: ['movement actions'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['collision edges', 'world bounds and forbidden transitions'],
    limitations: ['Position state or visual evidence is needed to confirm many boundary issues.'],
    beginnerRecommended: false,
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'crafting-recipe-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'gameplay-systems',
    requiredCapabilities: ['crafting actions', 'inventory and recipe state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['games without crafting'],
    bestUsedFor: ['recipes and ingredient validation', 'crafting output integrity'],
    limitations: ['Structured recipe and inventory state is needed to confirm duplication or loss.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use this after one normal crafting recipe works. Start with one bot and a small recipe list.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'building-destruction-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'gameplay-systems',
    requiredCapabilities: ['building controls', 'object placement state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['games without building'],
    bestUsedFor: ['placement and destruction rules', 'building limits and persistence'],
    limitations: ['Needs placement controls and benefits from world-object state or screenshots.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use a disposable test world. Map place, rotate, remove, and destroy before running this bot.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'physics-interaction-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'world-simulation',
    requiredCapabilities: ['movement and physics interaction actions'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: ['static games without physics interactions'],
    bestUsedFor: ['collision response and slopes', 'pushing, stacking, and high-speed movement'],
    limitations: ['Position or physics state makes results much more reliable than screenshots alone.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Start in a small room with movable objects and one bot so unusual movement is easy to inspect.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'camera-view-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'ui-input',
    requiredCapabilities: ['camera controls', 'screenshots'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: ['games without a controllable camera'],
    bestUsedFor: ['camera modes and field of view', 'clipping, obstruction, and extreme angles'],
    limitations: ['Many camera defects require screenshot review until visual understanding is enabled.'],
    beginnerRecommended: true,
    beginnerExplanation: 'Map rotate and zoom controls, keep screenshots on, and begin with one visible game window.',
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'loot-random-drop-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'gameplay-systems',
    requiredCapabilities: ['loot actions', 'inventory and reward state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['games without random rewards'],
    bestUsedFor: ['loot tables and rarity samples', 'duplicate, missing, and overflow rewards'],
    limitations: ['Rarity distribution needs many samples and does not prove a probability bug by itself.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use a repeatable loot source and a separate save. Begin with a short sample before a long drop test.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'death-respawn-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'gameplay-systems',
    requiredCapabilities: ['death trigger or combat actions', 'respawn state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['games without death or respawn'],
    bestUsedFor: ['death and checkpoint loops', 'item retention and respawn location'],
    limitations: ['Repeated deaths can alter saves, inventory, or progression. Use isolation where possible.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use a test save near a safe checkpoint and verify the normal respawn once before automation.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'npc-behaviour-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'world-simulation',
    requiredCapabilities: ['NPC interactions', 'NPC or navigation state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['games without interactive NPCs'],
    bestUsedFor: ['NPC navigation and schedules', 'following, fleeing, and state resets'],
    limitations: ['Black-box testing may not distinguish intended NPC waiting from broken pathfinding.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Choose one known NPC and short route first. Add schedule and blocked-path tests after that works.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'boss-encounter-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'gameplay-systems',
    requiredCapabilities: ['combat actions', 'boss phase and encounter state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['games without boss encounters'],
    bestUsedFor: ['boss phases and arena rules', 'retry, rewards, and completion'],
    limitations: ['Requires a repeatable encounter setup and may consume significant test time.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use a save directly before the encounter, one bot, and a clear restart or checkpoint action.',
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'procedural-generation-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'world-simulation',
    requiredCapabilities: ['world generation or reset action', 'seed and world state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['fixed-world games'],
    bestUsedFor: ['generated world validity', 'seed consistency and required resources'],
    limitations: ['Meaningful coverage requires many generations and can use substantial CPU, RAM, and disk.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Start with three known seeds and one bot. Increase samples only after generation and cleanup work.',
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'environment-cycle-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'world-simulation',
    requiredCapabilities: ['time or environment actions', 'environment state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['games without changing environments'],
    bestUsedFor: ['day, night, weather, and temperature cycles', 'timed events and save/load persistence'],
    limitations: ['Real-time cycles can make tests long unless the development build can advance time safely.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use a development build with a safe time-advance action and test one full cycle before longer runs.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'keyboard-input-mapping-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'ui-input',
    requiredCapabilities: ['keyboard input mappings'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: ['touch-only games'],
    bestUsedFor: ['mapped keys and combinations', 'held, rapid, and remapped inputs'],
    limitations: ['Only configured or instrumented keys can be tested safely.'],
    beginnerRecommended: true,
    beginnerExplanation: 'Map a harmless menu key first, test it once, and then add the remaining keyboard controls.',
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'controller-gamepad-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'platform',
    requiredCapabilities: ['gamepad input mappings', 'gamepad-capable direct action adapter'],
    recommendedGameTypes: ['instrumented', 'unity', 'godot', 'unreal', 'custom'],
    incompatibleGameTypes: ['keyboard-only games', 'public multiplayer'],
    bestUsedFor: ['sticks, triggers, buttons, and dead zones', 'reconnect and controller switching'],
    limitations: ['Desktop controller input has no production driver yet and must not be reported as supported.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use an instrumented development build that exposes gamepad actions, then begin with one controller and one bot.',
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'touch-mobile-controls-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'platform',
    requiredCapabilities: ['touch input mappings', 'touch-capable direct action adapter'],
    recommendedGameTypes: ['instrumented', 'browser', 'unity', 'godot', 'unreal', 'custom'],
    incompatibleGameTypes: ['desktop-only games without touch simulation'],
    bestUsedFor: ['tap, long press, swipe, and multi-touch', 'virtual sticks, orientation, and overlapping controls'],
    limitations: ['Browser and desktop adapters do not currently provide general touch simulation.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use an instrumented mobile build with explicit touch actions. Start with tap and swipe before multi-touch.',
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'display-resolution-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'platform',
    requiredCapabilities: ['display setting actions', 'screenshots'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['resolution and aspect-ratio changes', 'fullscreen, resizing, UI scale, and safe areas'],
    limitations: ['Visual defects still need screenshot review when no vision model is enabled.'],
    beginnerRecommended: true,
    beginnerExplanation: 'Keep screenshots on and test a short list of common resolutions before unusual aspect ratios.',
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'localization-text-overflow-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'accessibility',
    requiredCapabilities: ['language or text test actions', 'screenshots or UI state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['long and missing translations', 'RTL layout, clipping, wrapping, and special characters'],
    limitations: ['It can flag layout clues but cannot guarantee translation quality or linguistic correctness.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Provide a test language or long-text mode and keep screenshots on. Review every flagged string with a person.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'audio-subtitle-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'accessibility',
    requiredCapabilities: ['audio setting actions', 'audio signals for automatic verification'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['volume and mute behavior', 'subtitle timing, labels, and repeated sounds'],
    limitations: ['Without audio telemetry, sound presence and quality cannot be verified automatically.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Map volume, mute, and subtitle actions. Add an audio signal hook if you need automatic sound verification.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'accessibility-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'accessibility',
    requiredCapabilities: ['UI navigation actions', 'screenshots or accessibility metadata'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['keyboard-only navigation and readable labels', 'text size, subtitles, alternatives, and reduced motion'],
    limitations: ['Results are automated indications only and are not accessibility certification.'],
    beginnerRecommended: true,
    beginnerExplanation: 'Use one bot, enable screenshots, and treat findings as prompts for review by people and accessibility experts.',
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'settings-configuration-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'ui-input',
    requiredCapabilities: ['settings actions', 'state read or screenshots'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['apply, cancel, and reset settings', 'restart and settings persistence'],
    limitations: ['Persistence checks need state read, readable settings UI, or a restart action.'],
    beginnerRecommended: true,
    beginnerExplanation: 'Start with one reversible setting and confirm apply, cancel, reset, and restart behavior in that order.',
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'loading-transition-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'performance-stability',
    requiredCapabilities: ['transition actions', 'scene, loading, or screenshot state'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['loading screens and scene changes', 'fast travel, repeated transitions, cancellation, and failures'],
    limitations: ['Black-box adapters may only infer a transition from screenshots and process responsiveness.'],
    beginnerRecommended: true,
    beginnerExplanation: 'Start with one short scene transition and screenshots on, then add fast travel and repeated loops.',
    defaultEnabled: false,
    estimatedComplexity: 'medium'
  },
  'network-resilience-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'network-multiplayer',
    requiredCapabilities: ['controlled-test confirmation', 'instrumented latency and connection actions', 'network state'],
    recommendedGameTypes: ['instrumented', 'unity', 'godot', 'unreal', 'custom'],
    incompatibleGameTypes: ['public matchmaking', 'anti-cheat-protected public servers'],
    bestUsedFor: ['permitted latency and packet-loss simulation', 'disconnect, reconnect, and timeout recovery'],
    limitations: ['Only development environments you own, control, or have permission to test are supported.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use a private development server, confirm controlled testing, and begin with one mild latency action.',
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'multiplayer-session-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'network-multiplayer',
    requiredCapabilities: ['controlled-test confirmation', 'private-session actions', 'synchronized multiplayer state'],
    recommendedGameTypes: ['instrumented', 'unity', 'godot', 'unreal', 'custom'],
    incompatibleGameTypes: ['public matchmaking', 'anti-cheat-protected public servers'],
    bestUsedFor: ['private lobby join, leave, readiness, and host changes', 'reconnect, synchronized objectives, and cleanup'],
    limitations: ['Public matchmaking automation and anti-cheat bypasses are not supported.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use a private developer-controlled lobby with test accounts and confirm controlled testing before adding bots.',
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'memory-leak-endurance-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'performance-stability',
    requiredCapabilities: ['memory and performance measurements', 'repeatable safe actions'],
    recommendedGameTypes: broadGameTypes,
    incompatibleGameTypes: [],
    bestUsedFor: ['long repeated loops', 'memory growth, slowdown, and degradation'],
    limitations: ['Long runs can consume substantial CPU, RAM, disk, and time and should start with conservative limits.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Start with a short 15-minute loop, one bot, background observation, and strict CPU and RAM limits.',
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'save-migration-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'persistence',
    requiredCapabilities: ['user-provided permitted old test saves', 'load and migration state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['games without save migration'],
    bestUsedFor: ['loading old test saves into a newer build', 'migration correctness and preserved progress'],
    limitations: ['The simulator does not discover or copy private player saves automatically. Test saves must be supplied by the user.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use a copy of one known old test save, preserve the original, and verify its expected version before running.',
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  },
  'world-persistence-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'persistence',
    requiredCapabilities: ['world-changing actions', 'save and reload actions', 'readable world state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['games without persistent world state'],
    bestUsedFor: ['saved world changes', 'reload correctness and unwanted state resets'],
    limitations: ['Reliable comparison needs structured world state or explicit persistence signals.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Change one harmless world object, save, reload, and confirm that single change before testing larger worlds.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'achievement-unlock-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'content-progression',
    requiredCapabilities: ['achievement test actions', 'unlock and persistence state'],
    recommendedGameTypes: structuredGameTypes,
    incompatibleGameTypes: ['builds without testable achievements'],
    bestUsedFor: ['achievement conditions and missing unlocks', 'duplicate unlocks and persistence'],
    limitations: ['Platform-owned achievements may require a permitted sandbox or development account.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Use a sandbox achievement and one known condition before testing duplicate or restart behavior.',
    defaultEnabled: false,
    estimatedComplexity: 'high'
  },
  'file-permission-tester-bot': {
    profileGroup: 'specialized',
    specializationCategory: 'platform',
    requiredCapabilities: ['explicitly approved test directories', 'controlled file or save actions'],
    recommendedGameTypes: ['instrumented', 'unity', 'godot', 'unreal', 'custom'],
    incompatibleGameTypes: ['unapproved user or system directories'],
    bestUsedFor: ['read-only and missing test folders', 'disk-write failure messages and recovery'],
    limitations: ['File tests are restricted to directories explicitly approved for the current test session.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Create a disposable folder inside your test workspace, approve only that folder, and never use personal or system folders.',
    defaultEnabled: false,
    estimatedComplexity: 'advanced'
  }
};

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
  const metadata = profileMetadata[input.id];
  if (!metadata) {
    throw new Error(`Missing profile metadata for ${input.id}.`);
  }

  return {
    profileId: input.id,
    displayName: input.name,
    botType: input.type,
    ...metadata,
    requiredCapabilities: [...metadata.requiredCapabilities],
    recommendedGameTypes: [...metadata.recommendedGameTypes],
    incompatibleGameTypes: [...metadata.incompatibleGameTypes],
    bestUsedFor: [...metadata.bestUsedFor],
    limitations: [...metadata.limitations],
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
    id: 'ui-journey-bot',
    name: 'UI Journey Bot',
    type: 'ui-journey',
    playstyle: 'configured-menu-journeys',
    description: 'Follows configured layered UI flows such as Play Game, Create Game, Game Settings, and Start World.',
    aggression: 0.18,
    curiosity: 0.52,
    riskTolerance: 0.28,
    repetitionTolerance: 0.72,
    bugHuntingBias: 0.74,
    preferredActions: ['ui-flow-step', 'open-main-menu', 'choose-play-game', 'choose-create-game', 'confirm-game-settings', 'start-world'],
    avoidedActions: ['random-input', 'combat-only', 'skip-ui-flow'],
    goals: [
      {
        goalId: 'configured-ui-flow',
        name: 'Configured UI Flow',
        description: 'Follow the game profile UI flow before normal exploration begins.',
        priority: 10,
        successCriteria: ['Reach the configured end state', 'Report blocked or failed UI journey steps'],
        targetIssueCategories: ['ui', 'input', 'progression']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 4,
    tags: ['ui', 'journey', 'menus', 'first-run']
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
  }),
  profile({
    id: 'crafting-recipe-tester-bot',
    name: 'Crafting And Recipe Tester Bot',
    type: 'crafting-recipe',
    playstyle: 'recipe-and-output-validation',
    description: 'Tests recipes, ingredient rules, quantities, cancellation, recursive crafting, and output integrity.',
    aggression: 0.18,
    curiosity: 0.72,
    riskTolerance: 0.62,
    repetitionTolerance: 0.9,
    bugHuntingBias: 0.9,
    preferredActions: ['open-crafting', 'select-recipe', 'add-ingredient', 'remove-ingredient', 'craft', 'craft-multiple', 'cancel-craft'],
    avoidedActions: ['ignore-recipes', 'discard-crafted-output', 'combat-only'],
    goals: [
      {
        goalId: 'crafting-integrity',
        name: 'Crafting And Recipe Integrity',
        description: 'Exercise valid and invalid recipes while checking ingredient and output changes.',
        priority: 9,
        successCriteria: ['Test valid and missing ingredients', 'Report duplicated or lost crafting output'],
        targetIssueCategories: ['inventory', 'economy', 'exploit', 'gameplay']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 6,
    tags: ['crafting', 'recipes', 'inventory', 'economy']
  }),
  profile({
    id: 'building-destruction-tester-bot',
    name: 'Building And Destruction Tester Bot',
    type: 'building-destruction',
    playstyle: 'placement-and-world-editing',
    description: 'Tests valid and invalid placement, overlap, rotation, removal, destruction, limits, and world persistence.',
    aggression: 0.54,
    curiosity: 0.76,
    riskTolerance: 0.72,
    repetitionTolerance: 0.82,
    bugHuntingBias: 0.88,
    preferredActions: ['open-building', 'place-object', 'place-invalid-object', 'place-overlap', 'rotate-object', 'remove-object', 'destroy-object', 'test-building-limit'],
    avoidedActions: ['ignore-building', 'leave-test-world', 'combat-only'],
    goals: [
      {
        goalId: 'building-world-integrity',
        name: 'Building And Destruction Integrity',
        priority: 9,
        successCriteria: ['Validate placement rules and limits', 'Confirm world edits survive save/load when supported'],
        targetIssueCategories: ['gameplay', 'world_boundary', 'save_load', 'performance']
      }
    ],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 5,
    tags: ['building', 'placement', 'destruction', 'persistence']
  }),
  profile({
    id: 'physics-interaction-tester-bot',
    name: 'Physics Interaction Tester Bot',
    type: 'physics-interaction',
    playstyle: 'physics-and-collision-stress',
    description: 'Tests movable objects, falling, jumping, pushing, stacking, slopes, collision response, and high-speed contact.',
    aggression: 0.58,
    curiosity: 0.9,
    riskTolerance: 0.84,
    repetitionTolerance: 0.72,
    bugHuntingBias: 0.9,
    preferredActions: ['push-object', 'pull-object', 'stack-object', 'jump-on-object', 'drop-object', 'move-down-slope', 'high-speed-collision'],
    avoidedActions: ['stand-still', 'menu-only', 'avoid-physics-objects'],
    goals: [
      {
        goalId: 'physics-response-validation',
        name: 'Physics Response Validation',
        priority: 9,
        successCriteria: ['Exercise object and player collision responses', 'Report unstable, trapped, or escaped physics states'],
        targetIssueCategories: ['gameplay', 'navigation', 'world_boundary', 'performance']
      }
    ],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 5,
    tags: ['physics', 'collision', 'objects', 'movement']
  }),
  profile({
    id: 'camera-view-tester-bot',
    name: 'Camera And View Tester Bot',
    type: 'camera-view',
    playstyle: 'camera-control-and-visibility',
    description: 'Tests rotation, zoom, view modes, clipping, obstructions, extreme angles, and field-of-view settings.',
    aggression: 0.12,
    curiosity: 0.84,
    riskTolerance: 0.46,
    repetitionTolerance: 0.78,
    bugHuntingBias: 0.8,
    preferredActions: ['rotate-camera', 'zoom-in', 'zoom-out', 'switch-view-mode', 'camera-extreme-angle', 'test-camera-obstruction', 'change-field-of-view'],
    avoidedActions: ['lock-camera', 'skip-visual-check', 'combat-only'],
    goals: [
      {
        goalId: 'camera-view-validation',
        name: 'Camera And View Validation',
        priority: 8,
        successCriteria: ['Exercise every camera control and mode', 'Capture clipping or obstruction failures'],
        targetIssueCategories: ['visual', 'input', 'accessibility', 'navigation']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 6,
    tags: ['camera', 'view', 'visual', 'fov']
  }),
  profile({
    id: 'loot-random-drop-tester-bot',
    name: 'Loot And Random Drop Tester Bot',
    type: 'loot-random-drop',
    playstyle: 'loot-table-sampling',
    description: 'Tests repeated drops, duplicate or missing rewards, rarity distribution, inventory overflow, and pickup failures.',
    aggression: 0.42,
    curiosity: 0.7,
    riskTolerance: 0.58,
    repetitionTolerance: 0.96,
    bugHuntingBias: 0.88,
    preferredActions: ['trigger-loot-drop', 'open-loot', 'pickup-loot', 'repeat-drop', 'fill-inventory', 'claim-reward', 'record-rarity'],
    avoidedActions: ['discard-loot', 'skip-reward', 'single-sample-only'],
    goals: [
      {
        goalId: 'loot-drop-integrity',
        name: 'Loot And Random Drop Integrity',
        priority: 8,
        successCriteria: ['Sample repeated loot results', 'Report duplicate, missing, overflow, or pickup errors'],
        targetIssueCategories: ['inventory', 'economy', 'exploit', 'content']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 8,
    tags: ['loot', 'drops', 'rarity', 'rewards']
  }),
  profile({
    id: 'death-respawn-tester-bot',
    name: 'Death And Respawn Tester Bot',
    type: 'death-respawn',
    playstyle: 'death-checkpoint-and-retry',
    description: 'Tests death, respawn, checkpoint return, item retention, repeated deaths, transitions, and respawn locations.',
    aggression: 0.72,
    curiosity: 0.58,
    riskTolerance: 0.9,
    repetitionTolerance: 0.9,
    bugHuntingBias: 0.9,
    preferredActions: ['trigger-death', 'respawn', 'reload-checkpoint', 'die-in-menu', 'die-during-transition', 'repeat-death', 'inspect-respawn-location'],
    avoidedActions: ['avoid-danger', 'quit-after-death', 'overwrite-clean-save'],
    goals: [
      {
        goalId: 'death-respawn-integrity',
        name: 'Death And Respawn Integrity',
        priority: 10,
        successCriteria: ['Return to a valid checkpoint after death', 'Validate retained items and repeated death behavior'],
        targetIssueCategories: ['combat', 'progression', 'save_load', 'softlock']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 5,
    tags: ['death', 'respawn', 'checkpoint', 'retry']
  }),
  profile({
    id: 'npc-behaviour-tester-bot',
    name: 'NPC Behaviour Tester Bot',
    type: 'npc-behaviour',
    playstyle: 'npc-navigation-and-state',
    description: 'Tests NPC navigation, schedules, following, fleeing, interactions, blocked paths, repetition, and state resets.',
    aggression: 0.34,
    curiosity: 0.86,
    riskTolerance: 0.54,
    repetitionTolerance: 0.84,
    bugHuntingBias: 0.86,
    preferredActions: ['follow-npc', 'block-npc-path', 'interact-npc', 'repeat-npc-interaction', 'trigger-npc-flee', 'wait-for-schedule', 'reset-npc-state'],
    avoidedActions: ['ignore-npc', 'leave-npc-area', 'combat-only'],
    goals: [
      {
        goalId: 'npc-behaviour-integrity',
        name: 'NPC Behaviour Integrity',
        priority: 8,
        successCriteria: ['Exercise NPC navigation and state transitions', 'Report unavailable interactions or broken resets'],
        targetIssueCategories: ['navigation', 'gameplay', 'content', 'softlock']
      }
    ],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 5,
    tags: ['npc', 'navigation', 'schedule', 'behaviour']
  }),
  profile({
    id: 'boss-encounter-tester-bot',
    name: 'Boss Encounter Tester Bot',
    type: 'boss-encounter',
    playstyle: 'boss-phase-and-reward-validation',
    description: 'Tests encounter start, phases, attack patterns, arena limits, death/retry, rewards, skips, and completion.',
    aggression: 0.9,
    curiosity: 0.62,
    riskTolerance: 0.86,
    repetitionTolerance: 0.84,
    bugHuntingBias: 0.92,
    preferredActions: ['start-boss-encounter', 'attack-boss', 'trigger-next-phase', 'test-arena-boundary', 'retry-boss', 'claim-boss-reward', 'attempt-boss-skip'],
    avoidedActions: ['leave-encounter', 'avoid-boss', 'skip-reward-check'],
    goals: [
      {
        goalId: 'boss-encounter-integrity',
        name: 'Boss Encounter Integrity',
        priority: 10,
        successCriteria: ['Exercise every reported boss phase', 'Validate retry, completion, and rewards'],
        targetIssueCategories: ['combat', 'progression', 'world_boundary', 'exploit']
      }
    ],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 4,
    tags: ['boss', 'combat', 'phases', 'rewards']
  }),
  profile({
    id: 'procedural-generation-tester-bot',
    name: 'Procedural Generation Tester Bot',
    type: 'procedural-generation',
    playstyle: 'generated-world-validation',
    description: 'Tests repeated generated worlds, terrain validity, reachability, required resources, structures, seeds, and reload consistency.',
    aggression: 0.2,
    curiosity: 0.94,
    riskTolerance: 0.68,
    repetitionTolerance: 0.96,
    bugHuntingBias: 0.92,
    preferredActions: ['generate-world', 'set-generation-seed', 'inspect-generated-terrain', 'find-required-resource', 'check-structure-duplicates', 'reload-generated-world', 'generate-next-seed'],
    avoidedActions: ['reuse-single-world', 'skip-seed-recording', 'ignore-unreachable-area'],
    goals: [
      {
        goalId: 'procedural-world-integrity',
        name: 'Procedural World Integrity',
        priority: 9,
        successCriteria: ['Validate generated worlds across recorded seeds', 'Report invalid terrain, missing resources, or inconsistent reloads'],
        targetIssueCategories: ['navigation', 'content', 'world_boundary', 'performance']
      }
    ],
    defaultResourceWeight: 'very_heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 4,
    tags: ['procedural', 'generation', 'seeds', 'world']
  }),
  profile({
    id: 'environment-cycle-tester-bot',
    name: 'Environment Cycle Tester Bot',
    type: 'environment-cycle',
    playstyle: 'time-weather-and-environment',
    description: 'Tests day/night, weather, temperature, timed events, lighting transitions, and save/load persistence.',
    aggression: 0.12,
    curiosity: 0.78,
    riskTolerance: 0.46,
    repetitionTolerance: 0.9,
    bugHuntingBias: 0.84,
    preferredActions: ['advance-time', 'change-weather', 'change-temperature', 'wait-for-timed-event', 'observe-lighting-transition', 'save-environment-state', 'load-environment-state'],
    avoidedActions: ['freeze-time', 'skip-environment-check', 'combat-only'],
    goals: [
      {
        goalId: 'environment-cycle-integrity',
        name: 'Environment Cycle Integrity',
        priority: 8,
        successCriteria: ['Observe complete environment transitions', 'Confirm environment state survives save/load'],
        targetIssueCategories: ['visual', 'gameplay', 'save_load', 'performance']
      }
    ],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 5,
    tags: ['environment', 'weather', 'time', 'lighting']
  }),
  profile({
    id: 'keyboard-input-mapping-tester-bot',
    name: 'Keyboard And Input Mapping Tester Bot',
    type: 'keyboard-input-mapping',
    playstyle: 'keyboard-mapping-and-combinations',
    description: 'Tests mapped keys, combinations, held and rapid inputs, remapping, and restored mappings.',
    aggression: 0.22,
    curiosity: 0.7,
    riskTolerance: 0.5,
    repetitionTolerance: 0.88,
    bugHuntingBias: 0.84,
    preferredActions: ['test-mapped-key', 'press-key-combination', 'hold-key', 'rapid-key-input', 'remap-key', 'verify-remapped-key', 'reset-key-mapping'],
    avoidedActions: ['unmapped-key', 'system-shortcut', 'text-entry-spam'],
    goals: [
      {
        goalId: 'keyboard-input-integrity',
        name: 'Keyboard And Input Mapping Integrity',
        priority: 9,
        successCriteria: ['Exercise every mapped keyboard action', 'Validate remapped and restored controls'],
        targetIssueCategories: ['input', 'ui', 'accessibility', 'gameplay']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 6,
    tags: ['keyboard', 'input', 'mapping', 'controls']
  }),
  profile({
    id: 'controller-gamepad-tester-bot',
    name: 'Controller And Gamepad Tester Bot',
    type: 'controller-gamepad',
    playstyle: 'gamepad-controls-and-reconnects',
    description: 'Tests sticks, triggers, buttons, dead zones, reconnecting, controller switching, and menu navigation.',
    aggression: 0.28,
    curiosity: 0.72,
    riskTolerance: 0.58,
    repetitionTolerance: 0.86,
    bugHuntingBias: 0.86,
    preferredActions: ['move-gamepad-stick', 'press-gamepad-trigger', 'press-gamepad-button', 'test-gamepad-dead-zone', 'disconnect-controller', 'reconnect-controller', 'switch-controller', 'navigate-with-controller'],
    avoidedActions: ['keyboard-fallback', 'unmapped-controller-button', 'disconnect-system-device'],
    goals: [
      {
        goalId: 'gamepad-input-integrity',
        name: 'Controller And Gamepad Integrity',
        priority: 9,
        successCriteria: ['Exercise mapped gamepad controls', 'Validate reconnect, switching, and navigation'],
        targetIssueCategories: ['input', 'ui', 'accessibility', 'gameplay']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 4,
    tags: ['controller', 'gamepad', 'input', 'platform']
  }),
  profile({
    id: 'touch-mobile-controls-tester-bot',
    name: 'Touch And Mobile Controls Tester Bot',
    type: 'touch-mobile-controls',
    playstyle: 'touch-gestures-and-orientation',
    description: 'Tests taps, long presses, swipes, multi-touch, virtual sticks, orientation changes, and overlapping controls.',
    aggression: 0.2,
    curiosity: 0.82,
    riskTolerance: 0.56,
    repetitionTolerance: 0.84,
    bugHuntingBias: 0.86,
    preferredActions: ['tap-control', 'long-press-control', 'swipe-control', 'multi-touch-control', 'move-virtual-stick', 'change-orientation', 'test-overlapping-controls'],
    avoidedActions: ['mouse-fallback', 'unsupported-touch-gesture', 'system-gesture'],
    goals: [
      {
        goalId: 'touch-control-integrity',
        name: 'Touch And Mobile Control Integrity',
        priority: 9,
        successCriteria: ['Exercise mapped gestures and virtual controls', 'Validate orientation and overlapping-control behavior'],
        targetIssueCategories: ['input', 'ui', 'accessibility', 'visual']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 4,
    tags: ['touch', 'mobile', 'gesture', 'orientation']
  }),
  profile({
    id: 'display-resolution-tester-bot',
    name: 'Display And Resolution Tester Bot',
    type: 'display-resolution',
    playstyle: 'window-display-and-safe-area',
    description: 'Tests resolution, aspect ratio, fullscreen, windowed mode, resizing, UI scaling, and safe areas.',
    aggression: 0.1,
    curiosity: 0.76,
    riskTolerance: 0.4,
    repetitionTolerance: 0.82,
    bugHuntingBias: 0.82,
    preferredActions: ['change-resolution', 'change-aspect-ratio', 'toggle-fullscreen', 'switch-windowed-mode', 'resize-window', 'change-ui-scale', 'test-safe-area'],
    avoidedActions: ['unsupported-resolution', 'hide-ui', 'skip-screenshot'],
    goals: [
      {
        goalId: 'display-layout-integrity',
        name: 'Display And Resolution Integrity',
        priority: 8,
        successCriteria: ['Exercise configured display modes', 'Capture clipped, scaled, or unsafe UI layouts'],
        targetIssueCategories: ['visual', 'ui', 'accessibility', 'input']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 5,
    tags: ['display', 'resolution', 'aspect-ratio', 'safe-area']
  }),
  profile({
    id: 'localization-text-overflow-tester-bot',
    name: 'Localization And Text Overflow Tester Bot',
    type: 'localization-text-overflow',
    playstyle: 'language-layout-and-overflow',
    description: 'Tests long text, missing translations, special characters, right-to-left layouts, clipping, and wrapping.',
    aggression: 0.06,
    curiosity: 0.86,
    riskTolerance: 0.34,
    repetitionTolerance: 0.8,
    bugHuntingBias: 0.86,
    preferredActions: ['switch-language', 'enable-long-text', 'show-special-characters', 'switch-rtl-layout', 'inspect-text-clipping', 'inspect-text-wrapping', 'find-missing-translation'],
    avoidedActions: ['skip-text', 'hide-subtitles', 'single-language-only'],
    goals: [
      {
        goalId: 'localized-text-layout',
        name: 'Localized Text Layout',
        priority: 8,
        successCriteria: ['Exercise configured languages and text stress modes', 'Flag missing, clipped, or incorrectly wrapped text'],
        targetIssueCategories: ['visual', 'ui', 'accessibility', 'content']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 6,
    tags: ['localization', 'text', 'rtl', 'overflow']
  }),
  profile({
    id: 'audio-subtitle-tester-bot',
    name: 'Audio And Subtitle Tester Bot',
    type: 'audio-subtitle',
    playstyle: 'audio-settings-and-caption-signals',
    description: 'Tests volume, mute, repeated sound actions, subtitles, timing, and speaker labels using available signals.',
    aggression: 0.08,
    curiosity: 0.7,
    riskTolerance: 0.32,
    repetitionTolerance: 0.86,
    bugHuntingBias: 0.82,
    preferredActions: ['change-master-volume', 'mute-audio', 'unmute-audio', 'trigger-repeated-sound', 'toggle-subtitles', 'inspect-subtitle-timing', 'inspect-speaker-label'],
    avoidedActions: ['claim-audio-verified-without-signal', 'disable-all-evidence', 'skip-subtitles'],
    goals: [
      {
        goalId: 'audio-subtitle-indications',
        name: 'Audio And Subtitle Indications',
        priority: 8,
        successCriteria: ['Exercise audio and subtitle settings', 'Flag observable signal, timing, label, or mute mismatches'],
        targetIssueCategories: ['audio', 'accessibility', 'ui', 'content']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 5,
    tags: ['audio', 'subtitles', 'mute', 'accessibility']
  }),
  profile({
    id: 'accessibility-tester-bot',
    name: 'Accessibility Tester Bot',
    type: 'accessibility',
    playstyle: 'automated-accessibility-indications',
    description: 'Produces automated indications for keyboard navigation, labels, contrast metadata, text size, subtitles, alternatives, and reduced motion.',
    aggression: 0.04,
    curiosity: 0.78,
    riskTolerance: 0.22,
    repetitionTolerance: 0.8,
    bugHuntingBias: 0.88,
    preferredActions: ['navigate-keyboard-only', 'inspect-readable-label', 'inspect-contrast-metadata', 'increase-text-size', 'toggle-subtitles', 'switch-input-alternative', 'enable-reduced-motion'],
    avoidedActions: ['claim-accessibility-certification', 'mouse-only-navigation', 'skip-readable-labels'],
    goals: [
      {
        goalId: 'accessibility-indications',
        name: 'Automated Accessibility Indications',
        priority: 9,
        successCriteria: ['Exercise configured accessibility options', 'Clearly label findings as indications requiring human review'],
        targetIssueCategories: ['accessibility', 'ui', 'input', 'visual']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 5,
    tags: ['accessibility', 'keyboard', 'labels', 'reduced-motion']
  }),
  profile({
    id: 'settings-configuration-tester-bot',
    name: 'Settings And Configuration Tester Bot',
    type: 'settings-configuration',
    playstyle: 'settings-apply-reset-and-persistence',
    description: 'Tests changing, applying, cancelling, resetting, restarting, and persisting game settings.',
    aggression: 0.08,
    curiosity: 0.68,
    riskTolerance: 0.38,
    repetitionTolerance: 0.9,
    bugHuntingBias: 0.84,
    preferredActions: ['open-settings', 'change-setting', 'apply-settings', 'cancel-settings', 'reset-settings-defaults', 'restart-after-settings', 'verify-settings-persistence'],
    avoidedActions: ['change-unsafe-system-setting', 'leave-settings-unconfirmed', 'delete-user-profile'],
    goals: [
      {
        goalId: 'settings-configuration-integrity',
        name: 'Settings And Configuration Integrity',
        priority: 9,
        successCriteria: ['Validate apply, cancel, and reset behavior', 'Confirm settings persistence after restart'],
        targetIssueCategories: ['ui', 'input', 'save_load', 'accessibility']
      }
    ],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 6,
    tags: ['settings', 'configuration', 'persistence', 'ui']
  }),
  profile({
    id: 'loading-transition-tester-bot',
    name: 'Loading And Transition Tester Bot',
    type: 'loading-transition',
    playstyle: 'loading-and-scene-transition-stress',
    description: 'Tests loading screens, scene changes, fast travel, repeated transitions, cancellation, and transition failures.',
    aggression: 0.18,
    curiosity: 0.72,
    riskTolerance: 0.5,
    repetitionTolerance: 0.92,
    bugHuntingBias: 0.88,
    preferredActions: ['change-scene', 'fast-travel', 'repeat-transition', 'cancel-transition', 'wait-for-loading', 'retry-failed-transition'],
    avoidedActions: ['skip-loading-check', 'force-close-during-save', 'unmapped-transition'],
    goals: [{
      goalId: 'transition-reliability',
      name: 'Loading And Transition Reliability',
      priority: 9,
      successCriteria: ['Complete configured transitions', 'Flag prolonged, failed, or inconsistent loading states'],
      targetIssueCategories: ['hang', 'performance', 'progression', 'softlock']
    }],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 5,
    tags: ['loading', 'transition', 'scene', 'fast-travel']
  }),
  profile({
    id: 'network-resilience-tester-bot',
    name: 'Network Resilience Tester Bot',
    type: 'network-resilience',
    playstyle: 'controlled-network-failure-recovery',
    description: 'Tests permitted development environments under latency, disconnect, reconnect, timeout, and packet-loss simulations.',
    aggression: 0.1,
    curiosity: 0.58,
    riskTolerance: 0.72,
    repetitionTolerance: 0.88,
    bugHuntingBias: 0.9,
    preferredActions: ['simulate-latency', 'simulate-packet-loss', 'disconnect-test-client', 'reconnect-test-client', 'trigger-network-timeout', 'restore-test-network'],
    avoidedActions: ['public-matchmaking', 'anti-cheat-bypass', 'target-unapproved-server'],
    goals: [{
      goalId: 'controlled-network-resilience',
      name: 'Controlled Network Resilience',
      priority: 10,
      successCriteria: ['Exercise permitted network conditions', 'Confirm recovery and clear timeout behavior'],
      targetIssueCategories: ['network', 'hang', 'softlock', 'progression']
    }],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 4,
    tags: ['network', 'latency', 'disconnect', 'controlled-test']
  }),
  profile({
    id: 'multiplayer-session-tester-bot',
    name: 'Multiplayer Session Tester Bot',
    type: 'multiplayer-session',
    playstyle: 'private-session-lifecycle',
    description: 'Tests joining, leaving, lobby readiness, host changes, reconnecting, synchronized objectives, and cleanup in private test builds.',
    aggression: 0.12,
    curiosity: 0.62,
    riskTolerance: 0.64,
    repetitionTolerance: 0.86,
    bugHuntingBias: 0.88,
    preferredActions: ['join-private-session', 'leave-private-session', 'set-lobby-ready', 'change-test-host', 'reconnect-private-session', 'verify-synchronized-objective', 'cleanup-test-session'],
    avoidedActions: ['public-matchmaking', 'join-public-lobby', 'anti-cheat-bypass'],
    goals: [{
      goalId: 'private-session-lifecycle',
      name: 'Private Multiplayer Session Lifecycle',
      priority: 10,
      successCriteria: ['Complete private lobby lifecycle actions', 'Verify synchronized state and cleanup'],
      targetIssueCategories: ['network', 'progression', 'softlock', 'gameplay']
    }],
    defaultResourceWeight: 'very_heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 6,
    tags: ['multiplayer', 'private-session', 'lobby', 'synchronization']
  }),
  profile({
    id: 'memory-leak-endurance-tester-bot',
    name: 'Memory Leak And Endurance Tester Bot',
    type: 'memory-leak-endurance',
    playstyle: 'long-running-performance-loop',
    description: 'Runs repeated loops while tracking memory, performance, and degradation over time.',
    aggression: 0.08,
    curiosity: 0.48,
    riskTolerance: 0.42,
    repetitionTolerance: 1,
    bugHuntingBias: 0.92,
    preferredActions: ['start-endurance-loop', 'repeat-safe-loop', 'sample-memory', 'sample-performance', 'change-scene-loop', 'record-degradation'],
    avoidedActions: ['open-many-visible-windows', 'ignore-resource-limit', 'unbounded-action-spam'],
    goals: [{
      goalId: 'endurance-resource-stability',
      name: 'Endurance Resource Stability',
      priority: 10,
      successCriteria: ['Run bounded repeated loops', 'Track memory and performance trends without exceeding limits'],
      targetIssueCategories: ['performance', 'hang', 'crash']
    }],
    defaultResourceWeight: 'very_heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 3,
    tags: ['memory', 'endurance', 'performance', 'degradation']
  }),
  profile({
    id: 'save-migration-tester-bot',
    name: 'Save Migration Tester Bot',
    type: 'save-migration',
    playstyle: 'old-save-upgrade-verification',
    description: 'Loads user-provided permitted test saves from older builds and verifies migration results.',
    aggression: 0.02,
    curiosity: 0.48,
    riskTolerance: 0.18,
    repetitionTolerance: 0.84,
    bugHuntingBias: 0.94,
    preferredActions: ['copy-test-save', 'load-old-test-save', 'run-save-migration', 'verify-migrated-state', 'save-migrated-copy', 'reload-migrated-save'],
    avoidedActions: ['discover-user-saves', 'overwrite-source-save', 'load-unapproved-save'],
    goals: [{
      goalId: 'save-migration-integrity',
      name: 'Save Migration Integrity',
      priority: 10,
      successCriteria: ['Load an approved copied test save', 'Verify expected migrated progress and persistence'],
      targetIssueCategories: ['save_load', 'progression', 'inventory', 'content']
    }],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 3,
    tags: ['save', 'migration', 'build-upgrade', 'persistence']
  }),
  profile({
    id: 'world-persistence-tester-bot',
    name: 'World Persistence Tester Bot',
    type: 'world-persistence',
    playstyle: 'world-change-save-reload-compare',
    description: 'Changes controlled world state, saves, reloads, and checks whether changes remain correct.',
    aggression: 0.12,
    curiosity: 0.7,
    riskTolerance: 0.38,
    repetitionTolerance: 0.9,
    bugHuntingBias: 0.9,
    preferredActions: ['change-world-state', 'place-persistent-object', 'remove-persistent-object', 'save-world', 'reload-world', 'verify-world-state'],
    avoidedActions: ['change-untracked-world-state', 'delete-world-save', 'skip-state-comparison'],
    goals: [{
      goalId: 'world-state-persistence',
      name: 'World State Persistence',
      priority: 9,
      successCriteria: ['Record controlled world changes', 'Verify the same state after save and reload'],
      targetIssueCategories: ['save_load', 'gameplay', 'content', 'progression']
    }],
    defaultResourceWeight: 'heavy',
    recommendedMinCount: 1,
    recommendedMaxCount: 4,
    tags: ['world', 'persistence', 'save', 'reload']
  }),
  profile({
    id: 'achievement-unlock-tester-bot',
    name: 'Achievement And Unlock Tester Bot',
    type: 'achievement-unlock',
    playstyle: 'achievement-condition-and-persistence',
    description: 'Tests achievement conditions, duplicate unlocks, missing unlocks, and persistence.',
    aggression: 0.08,
    curiosity: 0.66,
    riskTolerance: 0.32,
    repetitionTolerance: 0.88,
    bugHuntingBias: 0.9,
    preferredActions: ['meet-achievement-condition', 'trigger-achievement-unlock', 'repeat-achievement-condition', 'verify-unlock-state', 'reload-achievement-state', 'reset-sandbox-achievement'],
    avoidedActions: ['modify-production-achievement', 'unlock-without-condition', 'use-real-player-account'],
    goals: [{
      goalId: 'achievement-unlock-integrity',
      name: 'Achievement And Unlock Integrity',
      priority: 9,
      successCriteria: ['Validate configured unlock conditions', 'Detect missing, duplicate, or lost unlock state'],
      targetIssueCategories: ['progression', 'content', 'save_load', 'ui']
    }],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 4,
    tags: ['achievement', 'unlock', 'progression', 'persistence']
  }),
  profile({
    id: 'file-permission-tester-bot',
    name: 'File And Permission Tester Bot',
    type: 'file-permission',
    playstyle: 'approved-directory-failure-recovery',
    description: 'Tests controlled save paths, read-only or missing test folders, disk-write failures, and recovery messages.',
    aggression: 0.02,
    curiosity: 0.46,
    riskTolerance: 0.12,
    repetitionTolerance: 0.8,
    bugHuntingBias: 0.94,
    preferredActions: ['write-approved-test-file', 'use-read-only-test-folder', 'use-missing-test-folder', 'simulate-test-disk-write-failure', 'restore-approved-test-folder', 'verify-file-error-message'],
    avoidedActions: ['access-unapproved-directory', 'modify-system-file', 'delete-user-file'],
    goals: [{
      goalId: 'approved-file-failure-handling',
      name: 'Approved File And Permission Handling',
      priority: 10,
      successCriteria: ['Operate only in approved test directories', 'Verify useful failure messages and safe recovery'],
      targetIssueCategories: ['save_load', 'ui', 'crash', 'content']
    }],
    defaultResourceWeight: 'medium',
    recommendedMinCount: 1,
    recommendedMaxCount: 3,
    tags: ['file', 'permission', 'save-path', 'approved-directory']
  })
];

export const TECHNICAL_BOT_PROFILE_IDS = [
  'loading-transition-tester-bot',
  'network-resilience-tester-bot',
  'multiplayer-session-tester-bot',
  'memory-leak-endurance-tester-bot',
  'save-migration-tester-bot',
  'world-persistence-tester-bot',
  'achievement-unlock-tester-bot',
  'file-permission-tester-bot'
] as const;

export const DEFAULT_BOT_PROFILE_IDS = defaultBotProfiles.map((botProfile) => botProfile.profileId);
