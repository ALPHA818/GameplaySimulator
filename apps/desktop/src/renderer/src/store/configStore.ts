import type { BotPoolConfig, BotProfile, GameProfile, SimulationRunConfig } from '@core/types';
import { defaultBotProfiles } from '@core/bot/defaultBotProfiles';
import {
  defaultRuntimeObservationConfig,
  RuntimeObservationConfigSchema,
  type RuntimeObservationConfig
} from '@core/config/runtimeObservationConfig';
import type { WorkspaceData } from '@core/config/workspaceData';
import { create } from 'zustand';
import type { PageId } from '../routes';
import {
  mergeBotProfiles,
  mergeGameProfiles,
  RUNTIME_OBSERVATION_STORAGE_KEY,
  requestWorkspacePersistence
} from './workspacePersistence';

interface ConfigState {
  currentPage: PageId;
  editingGameId: string | null;
  editingBotProfileId: string | null;
  cloningBotProfileId: string | null;
  gameProfiles: GameProfile[];
  botProfiles: BotProfile[];
  runConfigs: SimulationRunConfig[];
  lastValidatedRunConfig: SimulationRunConfig | null;
  runtimeObservation: RuntimeObservationConfig;
  pendingSessionBotProfileId: string | null;
  pendingSessionBotProfileIds: string[];
  workspaceHydrated: boolean;
  workspaceWarning: string | null;
  navigate: (page: PageId) => void;
  openGameProfileEditor: (gameId?: string) => void;
  openBotProfileEditor: (profileId?: string) => void;
  cloneBotProfile: (profileId: string) => void;
  saveGameProfile: (profile: GameProfile) => void;
  saveBotProfile: (profile: BotProfile) => void;
  saveRunConfig: (config: SimulationRunConfig) => void;
  addBotProfileToSession: (profileId: string) => void;
  addBotProfilesToSession: (profileIds: string[]) => void;
  clearPendingSessionBotProfile: () => void;
  clearPendingSessionBotProfiles: () => void;
  updateRuntimeObservation: (patch: Partial<RuntimeObservationConfig>) => void;
  hydrateWorkspace: (data: WorkspaceData, warning?: string) => void;
  setWorkspaceWarning: (warning: string | null) => void;
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export { RUNTIME_OBSERVATION_STORAGE_KEY };

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

export const builtInGameProfiles: GameProfile[] = [
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
      notes: ['Sample profile for local or permitted QA testing.']
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
  return botProfiles
    .filter((profile) => profile.defaultEnabled)
    .map((profile, index) => createBotPoolFromProfile(profile, index, true));
}

export const useConfigStore = create<ConfigState>((set) => ({
  currentPage: 'dashboard',
  editingGameId: null,
  editingBotProfileId: null,
  cloningBotProfileId: null,
  gameProfiles: builtInGameProfiles,
  botProfiles: seededBotProfiles,
  runConfigs: [],
  lastValidatedRunConfig: null,
  runtimeObservation: defaultRuntimeObservationConfig,
  pendingSessionBotProfileId: null,
  pendingSessionBotProfileIds: [],
  workspaceHydrated: false,
  workspaceWarning: null,
  navigate: (currentPage) => set({ currentPage }),
  openGameProfileEditor: (gameId) =>
    set({ currentPage: 'gameProfileEditor', editingGameId: gameId ?? null }),
  openBotProfileEditor: (profileId) =>
    set({
      currentPage: 'botProfileEditor',
      editingBotProfileId: profileId ?? null,
      cloningBotProfileId: null
    }),
  cloneBotProfile: (profileId) =>
    set({
      currentPage: 'botProfileEditor',
      editingBotProfileId: null,
      cloningBotProfileId: profileId
    }),
  saveGameProfile: (profile) => {
    set((state) => {
      const existingId = state.editingGameId ?? profile.gameId;
      const existingIndex = state.gameProfiles.findIndex((item) => item.gameId === existingId);
      const gameProfiles =
        existingIndex === -1
          ? [...state.gameProfiles, profile]
          : state.gameProfiles.map((item, index) => (index === existingIndex ? profile : item));

      return {
        gameProfiles,
        currentPage: 'gameProfiles',
        editingGameId: null
      };
    });
    requestWorkspacePersistence();
  },
  saveBotProfile: (profile) => {
    set((state) => {
      const existingIndex = state.botProfiles.findIndex(
        (item) => item.profileId === state.editingBotProfileId
      );
      const botProfiles = existingIndex === -1
        ? [...state.botProfiles, profile]
        : state.botProfiles.map((item, index) => index === existingIndex ? profile : item);

      return {
        botProfiles,
        currentPage: 'botProfiles',
        editingBotProfileId: null,
        cloningBotProfileId: null
      };
    });
    requestWorkspacePersistence();
  },
  saveRunConfig: (config) => {
    set((state) => {
      const runConfigs = [
        config,
        ...state.runConfigs.filter((existing) => existing.sessionId !== config.sessionId)
      ];

      return {
        runConfigs,
        lastValidatedRunConfig: config
      };
    });
    requestWorkspacePersistence();
  },
  addBotProfileToSession: (profileId) =>
    set({
      currentPage: 'newSession',
      pendingSessionBotProfileId: profileId,
      pendingSessionBotProfileIds: []
    }),
  addBotProfilesToSession: (profileIds) =>
    set({
      currentPage: 'newSession',
      pendingSessionBotProfileId: null,
      pendingSessionBotProfileIds: [...new Set(profileIds)]
    }),
  clearPendingSessionBotProfile: () => set({ pendingSessionBotProfileId: null }),
  clearPendingSessionBotProfiles: () => set({ pendingSessionBotProfileIds: [] }),
  updateRuntimeObservation: (patch) =>
    set((state) => {
      const runtimeObservation = RuntimeObservationConfigSchema.parse({
        ...state.runtimeObservation,
        ...patch
      });

      saveRuntimeObservationPreference(runtimeObservation);
      requestWorkspacePersistence();
      return { runtimeObservation };
    }),
  hydrateWorkspace: (data, warning) =>
    set({
      gameProfiles: mergeGameProfiles(builtInGameProfiles, data),
      botProfiles: mergeBotProfiles(data),
      runConfigs: data.runConfigs,
      lastValidatedRunConfig: data.lastValidatedRunConfig,
      runtimeObservation: data.runtimeObservation,
      workspaceHydrated: true,
      workspaceWarning: warning ?? null
    }),
  setWorkspaceWarning: (workspaceWarning) => set({ workspaceWarning })
}));
