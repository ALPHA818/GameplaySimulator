import type { BotPoolConfig, BotProfile, GameProfile, SimulationRunConfig } from '@core/types';
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
      locations: ['Start area'],
      characters: [],
      items: [],
      quests: [],
      mechanics: ['movement', 'menu confirmation'],
      notes: ['Placeholder profile for local or permitted QA testing.']
    }
  }
];

const seededBotProfiles: BotProfile[] = [
  {
    profileId: 'explorer',
    displayName: 'Explorer Bot',
    botType: 'explorer',
    description: 'Navigation, menu, and interaction coverage.',
    goals: [
      {
        goalId: 'map-coverage',
        name: 'Map Coverage',
        priority: 10,
        successCriteria: ['Discover reachable screens'],
        targetIssueCategories: ['navigation', 'progression', 'gameplay']
      }
    ],
    recommendedMinCount: 1,
    recommendedMaxCount: 20,
    defaultResourceWeight: 'medium',
    tags: ['navigation', 'smoke'],
    config: {}
  },
  {
    profileId: 'combat-tester',
    displayName: 'Combat Tester Bot',
    botType: 'combat',
    description: 'Exercises attack, defense, targeting, and recovery loops.',
    goals: [],
    recommendedMinCount: 1,
    recommendedMaxCount: 10,
    defaultResourceWeight: 'heavy',
    tags: ['combat'],
    config: {}
  },
  {
    profileId: 'chaos-monkey',
    displayName: 'Chaos Monkey Bot',
    botType: 'chaos',
    description: 'High-noise random input profile for permitted offline builds.',
    goals: [],
    recommendedMinCount: 0,
    recommendedMaxCount: 5,
    defaultResourceWeight: 'very_heavy',
    tags: ['stress'],
    config: {}
  },
  {
    profileId: 'ui-tester',
    displayName: 'UI Tester Bot',
    botType: 'ui',
    description: 'Exercises menus, dialogs, HUD flows, and settings screens.',
    goals: [],
    recommendedMinCount: 1,
    recommendedMaxCount: 8,
    defaultResourceWeight: 'medium',
    tags: ['ui', 'menus'],
    config: { playstyle: 'ui-tester' }
  },
  {
    profileId: 'completionist',
    displayName: 'Completionist Bot',
    botType: 'completionist',
    description: 'Follows broad progression goals and tries to cover optional content.',
    goals: [],
    recommendedMinCount: 1,
    recommendedMaxCount: 3,
    defaultResourceWeight: 'heavy',
    tags: ['progression', 'coverage'],
    config: { playstyle: 'completionist' }
  }
];

export function createDefaultBotPools(botProfiles: BotProfile[]): BotPoolConfig[] {
  return botProfiles.map((profile, index) => ({
    profileId: profile.profileId,
    enabled: index < 2,
    minCount: profile.recommendedMinCount,
    desiredCount: profile.recommendedMinCount,
    maxCount: profile.recommendedMaxCount,
    scalingMode: 'auto',
    priority: 10 - index,
    resourceWeight: profile.defaultResourceWeight,
    notes: ''
  }));
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
