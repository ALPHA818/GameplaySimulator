import type { BotPoolConfig, BotProfile, GameProfile, SimulationRunConfig } from '@core/types';
import { defaultBotProfiles } from '@core/bot/defaultBotProfiles';
import { create } from 'zustand';
import type { PageId } from '../routes';

interface ConfigState {
  currentPage: PageId;
  editingGameId: string | null;
  gameProfiles: GameProfile[];
  botProfiles: BotProfile[];
  runConfigs: SimulationRunConfig[];
  lastValidatedRunConfig: SimulationRunConfig | null;
  navigate: (page: PageId) => void;
  openGameProfileEditor: (gameId?: string) => void;
  saveGameProfile: (profile: GameProfile) => void;
  saveRunConfig: (config: SimulationRunConfig) => void;
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
      supportsSaveIsolation: true
    },
    controls: [],
    testingTargets: [],
    progressSignals: [],
    failureSignals: [],
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
    }))
}));
