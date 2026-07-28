import type { BotProfile, GameProfile } from '../types';
import { evaluateBotProfileCompatibility } from './BotProfileCompatibility';

export type BotCompatibilityStatus = 'recommended' | 'compatible' | 'limited' | 'unsupported';

export interface BotCompatibilityResult {
  profileId: string;
  status: BotCompatibilityStatus;
  compatibleWithSelectedGame: boolean;
  whyRecommended: string[];
  missingRequirements: string[];
  expectedLimitations: string[];
  matchedFeatures: string[];
}

type CapabilityKey =
  | 'stateRead'
  | 'screenshots'
  | 'directActions'
  | 'uiFlows'
  | 'saveIsolation'
  | 'performanceMetrics'
  | 'networkInstrumentation'
  | 'multiplayerFeature'
  | 'gamepadSupport'
  | 'touchSupport';

interface CompatibilityRule {
  featureLabel: string;
  keywords: string[];
  required?: Array<{ capability: CapabilityKey; label: string; strict?: boolean }>;
  universal?: boolean;
  recommendation: string;
}

const rules: Record<string, CompatibilityRule> = {
  'ui-tester-bot': {
    featureLabel: 'menus or UI controls',
    keywords: ['menu', 'settings', 'inventory', 'dialogue', 'ui'],
    universal: true,
    recommendation: 'The game profile exposes menus, UI controls, or interface content this bot can exercise.'
  },
  'ui-journey-bot': {
    featureLabel: 'configured UI flows',
    keywords: ['ui-flow', 'main-menu', 'start-world', 'create-world'],
    required: [{ capability: 'uiFlows', label: 'at least one configured UI flow' }],
    recommendation: 'The profile includes a multi-step UI flow the Journey Bot can follow.'
  },
  'economy-tester-bot': {
    featureLabel: 'shops, trading, or currency',
    keywords: ['shop', 'currency', 'economy', 'buy', 'sell', 'trade'],
    recommendation: 'The profile contains economy content such as shops, currency, buying, or selling.'
  },
  'combat-tester-bot': {
    featureLabel: 'combat actions or encounters',
    keywords: ['combat', 'attack', 'enemy', 'boss', 'dodge', 'block'],
    recommendation: 'The profile contains combat actions, enemies, or boss encounters.'
  },
  'quest-tester-bot': {
    featureLabel: 'quests or objectives',
    keywords: ['quest', 'objective', 'mission'],
    recommendation: 'The known-content catalog includes quests or objectives.'
  },
  'side-content-tester-bot': {
    featureLabel: 'optional content',
    keywords: ['side-quest', 'optional-story', 'minigame', 'hidden-area', 'post-game'],
    recommendation: 'The profile lists side quests, minigames, hidden areas, or other optional content.'
  },
  'inventory-stress-tester-bot': {
    featureLabel: 'items or inventory controls',
    keywords: ['inventory', 'item', 'equip', 'loot'],
    recommendation: 'The profile exposes items, inventory menus, equipment, or loot.'
  },
  'dialogue-tester-bot': {
    featureLabel: 'dialogue or NPC interactions',
    keywords: ['dialogue', 'npc', 'conversation'],
    recommendation: 'The profile lists dialogue branches or NPC interactions.'
  },
  'performance-stress-bot': {
    featureLabel: 'performance telemetry',
    keywords: ['performance', 'fps', 'frame-time', 'cpu', 'memory'],
    required: [{ capability: 'performanceMetrics', label: 'performance or telemetry signals' }],
    recommendation: 'The game exposes performance measurements that make stress results measurable.'
  },
  'save-load-tester-bot': {
    featureLabel: 'save and load support',
    keywords: ['save', 'load', 'checkpoint'],
    required: [{ capability: 'saveIsolation', label: 'save isolation or an adapter-managed test profile' }],
    recommendation: 'The profile exposes save behavior and isolated test data.'
  },
  'crafting-recipe-tester-bot': {
    featureLabel: 'crafting or recipes',
    keywords: ['crafting', 'craft', 'recipe', 'ingredient'],
    recommendation: 'Crafting, recipes, or ingredients appear in the profile.'
  },
  'building-destruction-tester-bot': {
    featureLabel: 'building or destruction',
    keywords: ['building', 'build', 'construction', 'place-block', 'destruction'],
    recommendation: 'Building, placement, or destruction mechanics appear in the profile.'
  },
  'physics-interaction-tester-bot': {
    featureLabel: 'physics interactions',
    keywords: ['physics', 'collision', 'push', 'stack', 'slope'],
    recommendation: 'The profile identifies physics, collision, or movable-object interactions.'
  },
  'camera-view-tester-bot': {
    featureLabel: 'camera or view controls',
    keywords: ['camera', 'zoom', 'field-of-view', 'first-person', 'third-person'],
    recommendation: 'The game exposes camera, zoom, or view-mode controls.'
  },
  'loot-random-drop-tester-bot': {
    featureLabel: 'loot or random drops',
    keywords: ['loot', 'drop', 'rarity', 'pickup'],
    recommendation: 'Loot, random drops, rarity, or pickups appear in the profile.'
  },
  'death-respawn-tester-bot': {
    featureLabel: 'death or respawn behavior',
    keywords: ['death', 'respawn', 'checkpoint', 'revive'],
    recommendation: 'The profile exposes death, respawn, revive, or checkpoint behavior.'
  },
  'npc-behaviour-tester-bot': {
    featureLabel: 'NPC content',
    keywords: ['npc', 'non-player', 'schedule', 'follower'],
    recommendation: 'Known NPCs or NPC behavior targets appear in the profile.'
  },
  'boss-encounter-tester-bot': {
    featureLabel: 'boss encounters',
    keywords: ['boss', 'arena', 'encounter-phase'],
    recommendation: 'The known-content catalog includes boss encounters.'
  },
  'procedural-generation-tester-bot': {
    featureLabel: 'procedural generation',
    keywords: ['procedural', 'generation', 'generated-world', 'world-seed', 'seed'],
    recommendation: 'Procedural generation, generated worlds, or seed controls appear in the profile.'
  },
  'environment-cycle-tester-bot': {
    featureLabel: 'environment cycles',
    keywords: ['day-night', 'weather', 'temperature', 'environment-cycle', 'timed-event'],
    recommendation: 'The profile identifies weather, day/night, temperature, or timed environment systems.'
  },
  'keyboard-input-mapping-tester-bot': {
    featureLabel: 'keyboard mappings',
    keywords: ['input-keyboard'],
    recommendation: 'The game profile includes mapped keyboard controls.'
  },
  'controller-gamepad-tester-bot': {
    featureLabel: 'gamepad mappings',
    keywords: ['input-gamepad'],
    required: [{ capability: 'gamepadSupport', label: 'mapped gamepad controls' }],
    recommendation: 'The profile includes gamepad mappings and a direct-action path.'
  },
  'touch-mobile-controls-tester-bot': {
    featureLabel: 'touch mappings',
    keywords: ['input-touch'],
    required: [{ capability: 'touchSupport', label: 'mapped touch controls' }],
    recommendation: 'The profile includes touch mappings and a direct-action path.'
  },
  'display-resolution-tester-bot': {
    featureLabel: 'display settings',
    keywords: ['resolution', 'fullscreen', 'windowed', 'ui-scale', 'safe-area'],
    required: [{ capability: 'screenshots', label: 'screenshot capture' }],
    universal: true,
    recommendation: 'Screenshot support and display controls make visual layout testing useful.'
  },
  'localization-text-overflow-tester-bot': {
    featureLabel: 'language or text-stress controls',
    keywords: ['language', 'localization', 'translation', 'right-to-left', 'rtl'],
    required: [{ capability: 'screenshots', label: 'screenshots or readable UI state' }],
    recommendation: 'The profile exposes languages, translations, or text-layout test controls.'
  },
  'audio-subtitle-tester-bot': {
    featureLabel: 'audio or subtitle controls',
    keywords: ['audio', 'volume', 'subtitle', 'speaker-label'],
    recommendation: 'The game profile exposes audio, mute, or subtitle behavior.'
  },
  'accessibility-tester-bot': {
    featureLabel: 'accessibility settings or metadata',
    keywords: ['accessibility', 'reduced-motion', 'contrast', 'text-size', 'subtitle'],
    universal: true,
    recommendation: 'The profile exposes UI state, screenshots, or accessibility-related settings for automated indications.'
  },
  'settings-configuration-tester-bot': {
    featureLabel: 'settings menus',
    keywords: ['settings', 'configuration', 'preferences', 'options'],
    universal: true,
    recommendation: 'The profile contains settings menus or configurable options.'
  },
  'loading-transition-tester-bot': {
    featureLabel: 'scenes or transitions',
    keywords: ['scene', 'level', 'fast-travel', 'loading', 'transition'],
    recommendation: 'The profile contains scenes, levels, loading signals, or transition actions.'
  },
  'network-resilience-tester-bot': {
    featureLabel: 'controlled network instrumentation',
    keywords: ['network', 'latency', 'packet-loss', 'disconnect', 'reconnect'],
    required: [{
      capability: 'networkInstrumentation',
      label: 'explicit controlled network instrumentation',
      strict: true
    }],
    recommendation: 'The instrumented profile exposes permitted latency, disconnect, or recovery controls.'
  },
  'multiplayer-session-tester-bot': {
    featureLabel: 'private multiplayer sessions',
    keywords: ['multiplayer', 'private-lobby', 'co-op', 'lobby', 'host-change'],
    required: [
      { capability: 'networkInstrumentation', label: 'controlled network instrumentation', strict: true },
      { capability: 'multiplayerFeature', label: 'private multiplayer or lobby features', strict: true }
    ],
    recommendation: 'The profile explicitly identifies private multiplayer or lobby behavior with controlled instrumentation.'
  },
  'memory-leak-endurance-tester-bot': {
    featureLabel: 'performance telemetry',
    keywords: ['performance', 'memory', 'telemetry', 'frame-time'],
    required: [{ capability: 'performanceMetrics', label: 'memory or performance measurements' }],
    recommendation: 'Performance telemetry makes long-running memory and degradation trends measurable.'
  },
  'save-migration-tester-bot': {
    featureLabel: 'save migration',
    keywords: ['save-migration', 'old-save', 'migration'],
    required: [
      { capability: 'stateRead', label: 'readable migrated state' },
      { capability: 'directActions', label: 'direct migration and load actions' }
    ],
    recommendation: 'The profile explicitly identifies save migration or older test-save support.'
  },
  'world-persistence-tester-bot': {
    featureLabel: 'persistent world state',
    keywords: ['world-persistence', 'persistent-world', 'save-world', 'world-state'],
    required: [
      { capability: 'stateRead', label: 'readable world state' },
      { capability: 'saveIsolation', label: 'isolated save data' }
    ],
    recommendation: 'The profile identifies persistent world state with isolated save support.'
  },
  'achievement-unlock-tester-bot': {
    featureLabel: 'achievements or unlocks',
    keywords: ['achievement', 'unlock'],
    required: [{ capability: 'stateRead', label: 'readable achievement state' }],
    recommendation: 'The known-content catalog or controls include achievements and unlock conditions.'
  },
  'file-permission-tester-bot': {
    featureLabel: 'controlled file testing',
    keywords: ['file-permission', 'read-only', 'disk-write', 'save-path'],
    required: [{ capability: 'directActions', label: 'restricted direct file-test actions' }],
    recommendation: 'The instrumented profile explicitly exposes controlled file or permission test actions.'
  }
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s_/]+/g, '-');
}

function profileEvidence(gameProfile: GameProfile): string {
  const knownContent = Object.entries(gameProfile.knownContent)
    .flatMap(([key, values]) => values.length > 0 ? [key, ...values] : []);
  const controls = gameProfile.controls.flatMap((control) => [
    `input-${control.inputType}`,
    control.controlId,
    control.label,
    control.action ?? '',
    control.binding ?? ''
  ]);
  const signals = [...gameProfile.progressSignals, ...gameProfile.failureSignals]
    .flatMap((signal) => [signal.source, signal.signalId, signal.name, signal.description ?? '', signal.pattern ?? '']);
  const targets = gameProfile.testingTargets
    .flatMap((target) => [target.targetId, target.name, target.description ?? '', ...target.tags]);
  const flows = gameProfile.uiFlows.flatMap((flow) => [
    'ui-flow',
    flow.flowId,
    flow.name,
    flow.description ?? '',
    flow.startState ?? '',
    flow.endState ?? '',
    ...flow.steps.flatMap((step) => [
      step.actionType,
      step.expectedScreen ?? '',
      step.targetLabel ?? '',
      step.successCondition ?? ''
    ])
  ]);

  return normalize([
    gameProfile.gameName,
    gameProfile.engine.type,
    gameProfile.adapter.type,
    ...knownContent,
    ...controls,
    ...signals,
    ...targets,
    ...flows
  ].join(' '));
}

function capabilityFacts(gameProfile: GameProfile, evidence: string): Record<CapabilityKey, boolean> {
  const signalText = normalize(
    [...gameProfile.progressSignals, ...gameProfile.failureSignals]
      .flatMap((signal) => [signal.source, signal.name, signal.description ?? '', signal.pattern ?? ''])
      .join(' ')
  );
  const instrumentedRuntime = ['instrumented', 'custom', 'unity', 'godot', 'unreal']
    .includes(gameProfile.adapter.type);

  return {
    stateRead: gameProfile.adapter.supportsStateRead,
    screenshots: gameProfile.adapter.supportsScreenshots || gameProfile.adapter.supportsStateRead,
    directActions: gameProfile.adapter.supportsDirectActions,
    uiFlows: gameProfile.uiFlows.length > 0,
    saveIsolation: Boolean(gameProfile.saveIsolation && gameProfile.saveIsolation.mode !== 'none') ||
      gameProfile.adapter.supportsSaveIsolation,
    performanceMetrics: gameProfile.progressSignals.some((signal) => signal.source === 'telemetry') ||
      /performance|frame-time|fps|cpu|ram|memory/.test(signalText),
    networkInstrumentation: instrumentedRuntime &&
      gameProfile.adapter.supportsDirectActions &&
      gameProfile.adapter.supportsStateRead &&
      /network|latency|packet-loss|disconnect|reconnect/.test(evidence),
    multiplayerFeature: /multiplayer|private-lobby|co-op|lobby|host-change/.test(evidence),
    gamepadSupport: gameProfile.controls.some((control) => control.inputType === 'gamepad') &&
      gameProfile.adapter.supportsDirectActions,
    touchSupport: gameProfile.controls.some((control) => control.inputType === 'touch') &&
      gameProfile.adapter.supportsDirectActions
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function customCapabilityAvailable(
  capability: string,
  gameProfile: GameProfile,
  facts: Record<CapabilityKey, boolean>,
  evidence: string
): boolean {
  const hasInput = (inputType: GameProfile['controls'][number]['inputType']) =>
    gameProfile.controls.some((control) => control.inputType === inputType);

  switch (capability) {
    case 'state-read': return facts.stateRead;
    case 'direct-actions': return facts.directActions;
    case 'input-simulation':
      return facts.directActions || gameProfile.controls.some(
        (control) => ['keyboard', 'mouse', 'gamepad', 'touch'].includes(control.inputType)
      );
    case 'screenshots': return facts.screenshots;
    case 'video': return gameProfile.adapter.supportsVideo;
    case 'game-logs':
      return [...gameProfile.progressSignals, ...gameProfile.failureSignals]
        .some((signal) => signal.source === 'log');
    case 'save-isolation': return facts.saveIsolation;
    case 'reset': return facts.directActions && /reset|restart-level/.test(evidence);
    case 'checkpoint-reload': return facts.directActions && /checkpoint|reload/.test(evidence);
    case 'multiple-instances': return gameProfile.adapter.supportsMultipleInstances;
    case 'live-observation':
      return facts.screenshots || ['browser', 'desktop', 'unity', 'godot', 'unreal']
        .includes(gameProfile.adapter.type);
    case 'window-focus':
      return ['desktop', 'unity', 'godot', 'unreal'].includes(gameProfile.adapter.type);
    case 'keyboard-input': return hasInput('keyboard');
    case 'mouse-input': return hasInput('mouse');
    case 'gamepad-input': return facts.gamepadSupport;
    case 'touch-input': return facts.touchSupport;
    case 'ui-flows': return facts.uiFlows;
    case 'performance-metrics': return facts.performanceMetrics;
    case 'network-instrumentation': return facts.networkInstrumentation;
    case 'audio-signals':
      return [...gameProfile.progressSignals, ...gameProfile.failureSignals]
        .some((signal) => signal.source === 'audio');
    case 'file-test-sandbox':
      return facts.directActions && /file-test|file-permission|save-path/.test(evidence);
    default: return true;
  }
}

export class BotCompatibilityEvaluator {
  evaluate(profile: BotProfile, gameProfile: GameProfile): BotCompatibilityResult {
    const evidence = profileEvidence(gameProfile);
    const facts = capabilityFacts(gameProfile, evidence);
    const base = evaluateBotProfileCompatibility(profile, gameProfile);
    const rule = rules[profile.profileId];
    const selectedGameTypes = [
      gameProfile.engine.type,
      gameProfile.adapter.type,
      gameProfile.launch.platform
    ].map(normalize);
    const recommendedGameTypes = (profile.recommendedGameTypes ?? []).map(normalize);
    const incompatibleGameTypes = (profile.incompatibleGameTypes ?? []).map(normalize);
    const recommendedTypeMismatch = recommendedGameTypes.length > 0 &&
      !recommendedGameTypes.some((gameType) => selectedGameTypes.includes(gameType));
    const incompatibleTypeMatch = incompatibleGameTypes.find((gameType) =>
      selectedGameTypes.includes(gameType)
    );
    const matchedFeatures = rule
      ? rule.keywords.filter((keyword) => evidence.includes(normalize(keyword)))
      : [];
    const missingCapabilities = (rule?.required ?? [])
      .filter((requirement) => !facts[requirement.capability]);
    const strictMissing = missingCapabilities.filter((requirement) => requirement.strict);
    const softenedBaseBlockers = profile.profileId === 'touch-mobile-controls-tester-bot';
    const missingCustomCapabilities = profile.profileGroup === 'custom'
      ? (profile.requiredCapabilities ?? []).filter(
          (capability) => !customCapabilityAvailable(capability, gameProfile, facts, evidence)
        )
      : [];
    const hardBlockers = [
      ...(softenedBaseBlockers ? [] : base.blockers),
      ...missingCustomCapabilities.map(
        (capability) => `Missing required capability: ${capability}.`
      ),
      ...(incompatibleTypeMatch
        ? [`The selected ${incompatibleTypeMatch} game type is listed as incompatible with this bot.`]
        : [])
    ];
    const missingRequirements = [
      ...hardBlockers,
      ...missingCapabilities.map((requirement) => `Missing ${requirement.label}.`),
      ...(rule && !rule.universal && matchedFeatures.length === 0
        ? [`No ${rule.featureLabel} was found in the selected game profile.`]
        : [])
    ];
    const expectedLimitations = unique([
      ...base.warnings,
      ...(softenedBaseBlockers ? base.blockers : []),
      ...(recommendedTypeMismatch
        ? [`This bot is usually recommended for ${recommendedGameTypes.join(', ')}, not the selected ${selectedGameTypes.join('/')} runtime.`]
        : []),
      ...(profile.limitations ?? [])
    ]);
    const whyRecommended = matchedFeatures.length > 0 || rule?.universal
      ? [rule?.recommendation ?? 'The selected game profile exposes features this bot can test.']
      : [];

    let status: BotCompatibilityStatus;
    if (hardBlockers.length > 0 || strictMissing.length > 0) {
      status = 'unsupported';
    } else if (
      missingCapabilities.length > 0 ||
      base.warnings.length > 0 ||
      recommendedTypeMismatch ||
      (rule && !rule.universal && matchedFeatures.length === 0)
    ) {
      status = 'limited';
    } else if (rule && (matchedFeatures.length > 0 || rule.universal)) {
      status = 'recommended';
    } else {
      status = 'compatible';
    }

    return {
      profileId: profile.profileId,
      status,
      compatibleWithSelectedGame: status !== 'unsupported',
      whyRecommended,
      missingRequirements: unique(missingRequirements),
      expectedLimitations,
      matchedFeatures: unique(matchedFeatures)
    };
  }

  evaluateAll(profiles: BotProfile[], gameProfile: GameProfile): BotCompatibilityResult[] {
    return profiles.map((profile) => this.evaluate(profile, gameProfile));
  }
}

export const botCompatibilityEvaluator = new BotCompatibilityEvaluator();
