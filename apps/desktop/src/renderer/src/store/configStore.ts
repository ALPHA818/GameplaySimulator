import type { BotPoolConfig, BotProfile, GameProfile, SimulationRunConfig } from '@core/types';
import { defaultBotProfiles } from '@core/bot/defaultBotProfiles';
import {
  AdvancedIntelligenceConfigSchema,
  defaultAdvancedIntelligenceConfig,
  type AdvancedIntelligenceConfig
} from '@core/config/advancedIntelligenceConfig';
import {
  defaultRuntimeObservationConfig,
  RuntimeObservationConfigSchema,
  type RuntimeObservationConfig
} from '@core/config/runtimeObservationConfig';
import { create } from 'zustand';
import type { PageId } from '../routes';

interface ConfigState {
  currentPage: PageId;
  editingGameId: string | null;
  gameProfiles: GameProfile[];
  botProfiles: BotProfile[];
  runConfigs: SimulationRunConfig[];
  lastValidatedRunConfig: SimulationRunConfig | null;
  advancedIntelligence: AdvancedIntelligenceConfig;
  runtimeObservation: RuntimeObservationConfig;
  navigate: (page: PageId) => void;
  openGameProfileEditor: (gameId?: string) => void;
  saveGameProfile: (profile: GameProfile) => void;
  saveRunConfig: (config: SimulationRunConfig) => void;
  updateAdvancedIntelligence: (patch: Partial<AdvancedIntelligenceConfig>) => void;
  updateRuntimeObservation: (patch: Partial<RuntimeObservationConfig>) => void;
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const RUNTIME_OBSERVATION_STORAGE_KEY = 'gameplay-simulator.runtime-observation.v1';

function browserPreferenceStorage(): PreferenceStorage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadRuntimeObservationPreference(
  storage: PreferenceStorage | undefined = browserPreferenceStorage()
): RuntimeObservationConfig {
  if (!storage) {
    return defaultRuntimeObservationConfig;
  }

  try {
    const saved = storage.getItem(RUNTIME_OBSERVATION_STORAGE_KEY);

    if (!saved) {
      return defaultRuntimeObservationConfig;
    }

    const result = RuntimeObservationConfigSchema.safeParse(JSON.parse(saved));
    return result.success ? result.data : defaultRuntimeObservationConfig;
  } catch {
    return defaultRuntimeObservationConfig;
  }
}

export function saveRuntimeObservationPreference(
  config: RuntimeObservationConfig,
  storage: PreferenceStorage | undefined = browserPreferenceStorage()
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(RUNTIME_OBSERVATION_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Settings remain usable when browser storage is unavailable or full.
  }
}

const seededGameProfiles: GameProfile[] = [
  {
    gameId: 'sample-browser-game',
    gameName: 'Sample Browser Game',
    version: '0.1.0',
    buildId: 'local-dev',
    engine: { type: 'browser' },
    launch: {
      platform: 'browser',
      url: 'https://example.local/game',
      arguments: []
    },
    adapter: {
      type: 'browser',
      supportsMultipleInstances: true,
      supportsStateRead: false,
      supportsDirectActions: false,
      supportsScreenshots: true,
      supportsVideo: false,
      supportsSaveIsolation: true,
      browserDomScanMode: 'fallback'
    },
    controls: [],
    testingTargets: [],
    progressSignals: [],
    failureSignals: [],
    uiFlows: [
      {
        flowId: 'create-world',
        name: 'Create World',
        description: 'Navigate from the browser game menu into a playable world.',
        startState: 'main-menu',
        endState: 'world-loaded',
        steps: [
          {
            stepId: 'choose-play-game',
            expectedScreen: 'main-menu',
            actionType: 'choose-play-game',
            targetLabel: 'Play Game',
            keyBinding: 'Enter',
            waitAfterMs: 500,
            successCondition: 'Play menu is visible',
            fallbackAction: 'wait',
            maxRetries: 2
          },
          {
            stepId: 'choose-create-game',
            expectedScreen: 'play-menu',
            actionType: 'choose-create-game',
            targetLabel: 'Create Game',
            keyBinding: 'Enter',
            waitAfterMs: 500,
            successCondition: 'Game settings screen is visible',
            fallbackAction: 'wait',
            maxRetries: 2
          },
          {
            stepId: 'start-world',
            expectedScreen: 'game-settings',
            actionType: 'start-world',
            targetLabel: 'Start World',
            keyBinding: 'Enter',
            waitAfterMs: 1500,
            successCondition: 'World loaded',
            fallbackAction: 'wait',
            maxRetries: 3
          }
        ]
      }
    ],
    saveIsolation: {
      mode: 'temp-directory',
      workingSaveRoot: 'runs/sample-browser-game/saves',
      cleanupTempSaves: false,
      preserveBotSaves: true
    },
    knownContent: {
      scenes: ['Boot', 'Main Menu', 'Start Area', 'Traversal Loop', 'Interaction Check', 'Results Review'],
      levels: ['Level 1', 'Level 2'],
      locations: ['Start area'],
      characters: ['Guide NPC'],
      npcs: ['Guide NPC', 'Shopkeeper'],
      items: ['Practice Sword', 'Health Potion'],
      quests: ['Main objective', 'Side quest'],
      mainQuests: ['Main objective'],
      sideQuests: ['Side quest'],
      optionalStories: ['Ambient optional story'],
      shops: ['General shop'],
      bosses: ['Enemy encounter'],
      menus: ['Settings menu', 'Inventory menu'],
      dialogueBranches: ['Dialogue branch'],
      minigames: ['Minigame'],
      endings: ['Demo ending'],
      hiddenAreas: ['Hidden area'],
      postGameContent: ['Post-game checkpoint'],
      collectibles: ['Collectible'],
      achievements: ['First run'],
      mechanics: ['movement', 'menu confirmation'],
      notes: ['Placeholder profile for local or permitted QA testing.']
    }
  }
];

const seededBotProfiles: BotProfile[] = defaultBotProfiles;

export function createBotPoolFromProfile(profile: BotProfile, index: number, enabled = true): BotPoolConfig {
  return {
    profileId: profile.profileId,
    enabled,
    minCount: profile.recommendedMinCount,
    desiredCount: profile.recommendedMinCount,
    maxCount: profile.recommendedMaxCount,
    scalingMode: 'auto',
    priority: Math.max(1, 20 - index),
    resourceWeight: profile.defaultResourceWeight,
    notes: ''
  };
}

export function createDefaultBotPools(botProfiles: BotProfile[]): BotPoolConfig[] {
  const defaultProfileIds = new Set(['main-story-bot', 'explorer-bot', 'combat-tester-bot']);

  return botProfiles
    .filter((profile) => defaultProfileIds.has(profile.profileId))
    .map((profile, index) => createBotPoolFromProfile(profile, index, true));
}

export const useConfigStore = create<ConfigState>((set) => ({
  currentPage: 'dashboard',
  editingGameId: null,
  gameProfiles: seededGameProfiles,
  botProfiles: seededBotProfiles,
  runConfigs: [],
  lastValidatedRunConfig: null,
  advancedIntelligence: defaultAdvancedIntelligenceConfig,
  runtimeObservation: loadRuntimeObservationPreference(),
  navigate: (currentPage) => set({ currentPage }),
  openGameProfileEditor: (gameId) =>
    set({ currentPage: 'gameProfileEditor', editingGameId: gameId ?? null }),
  saveGameProfile: (profile) =>
    set((state) => {
      const existingIndex = state.gameProfiles.findIndex((item) => item.gameId === profile.gameId);
      const gameProfiles =
        existingIndex === -1
          ? [...state.gameProfiles, profile]
          : state.gameProfiles.map((item) => (item.gameId === profile.gameId ? profile : item));

      return {
        gameProfiles,
        currentPage: 'gameProfiles',
        editingGameId: null
      };
    }),
  saveRunConfig: (config) =>
    set((state) => ({
      runConfigs: [config, ...state.runConfigs],
      lastValidatedRunConfig: config
    })),
  updateAdvancedIntelligence: (patch) =>
    set((state) => ({
      advancedIntelligence: AdvancedIntelligenceConfigSchema.parse({
        ...state.advancedIntelligence,
        ...patch
      })
    })),
  updateRuntimeObservation: (patch) =>
    set((state) => {
      const runtimeObservation = RuntimeObservationConfigSchema.parse({
        ...state.runtimeObservation,
        ...patch
      });

      saveRuntimeObservationPreference(runtimeObservation);
      return { runtimeObservation };
    })
}));
