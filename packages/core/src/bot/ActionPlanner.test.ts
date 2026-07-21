import type { GameStateSnapshot, UIFlow } from '../types';
import { describe, expect, it } from 'vitest';
import { defaultBotProfiles } from './defaultBotProfiles';
import { ActionPlanner, type AvailableGameActionLike } from './ActionPlanner';

const actions: AvailableGameActionLike[] = [
  { actionType: 'follow-main-objective', label: 'Follow Main Objective' },
  { actionType: 'attack-enemy', label: 'Attack Enemy' },
  { actionType: 'open-settings-menu', label: 'Open Settings Menu' },
  { actionType: 'buy-shop-item', label: 'Buy Shop Item' },
  { actionType: 'save-game', label: 'Save Game' },
  { actionType: 'boundary-jump-corner', label: 'Boundary Jump Corner' },
  { actionType: 'random-menu-spam', label: 'Random Menu Spam' },
  { actionType: 'idle-wait', label: 'Idle Wait' }
];

const state: GameStateSnapshot = {
  snapshotId: 'snapshot',
  sessionId: 'session',
  gameId: 'game',
  gameInstanceId: 'game-instance-001',
  botId: 'bot',
  capturedAt: '2026-07-04T10:00:00.000Z',
  scene: 'Start Area',
  state: {},
  metrics: {}
};

function profile(id: string) {
  const found = defaultBotProfiles.find((item) => item.profileId === id);

  if (!found) {
    throw new Error(`Missing test profile ${id}`);
  }

  return found;
}

function chooseAction(
  profileId: string,
  seed: number,
  actionIndex = 0,
  overrides: Partial<Parameters<ActionPlanner['chooseAction']>[0]> = {}
) {
  return new ActionPlanner().chooseAction({
    sessionId: 'session',
    gameInstanceId: 'game-instance-001',
    botId: `${profileId}-001`,
    profile: profile(profileId),
    state,
    availableActions: actions,
    actionIndex,
    now: '2026-07-04T10:00:00.000Z',
    seed,
    memory: {
      actionCount: actionIndex,
      stateCount: 1,
      errorCount: 0,
      recentActionTypes: []
    },
    coverageData: {
      visitedActions: [],
      visitedScenes: ['Start Area'],
      actionCounts: {},
      sceneCounts: { 'Start Area': 1 }
    },
    recentIssues: [],
    ...overrides
  });
}

function choose(profileId: string, seed: number, actionIndex = 0): string | null {
  return chooseAction(profileId, seed, actionIndex)?.type ?? null;
}

describe('ActionPlanner', () => {
  it('makes noticeably different choices for different profile types', () => {
    expect(choose('main-story-bot', 100)).toBe('follow-main-objective');
    expect(choose('combat-tester-bot', 100)).toBe('attack-enemy');
    expect(choose('ui-tester-bot', 100)).toBe('open-settings-menu');
    expect(choose('economy-tester-bot', 100)).toBe('buy-shop-item');
    expect(choose('save-load-tester-bot', 100)).toBe('save-game');
    expect(choose('boundary-breaker-bot', 100)).toBe('boundary-jump-corner');
  });

  it('is deterministic when given the same seed', () => {
    const first = [0, 1, 2, 3].map((index) => choose('explorer-bot', 4242, index));
    const second = [0, 1, 2, 3].map((index) => choose('explorer-bot', 4242, index));

    expect(second).toEqual(first);
  });

  it('lets same-type bots diverge when their seeds differ', () => {
    const choices = new Set([1, 2, 3, 4, 5, 6].map((seed) => choose('explorer-bot', seed)));

    expect(choices.size).toBeGreaterThan(1);
  });

  it('makes chaos bots highly seed-sensitive while still reproducible per seed', () => {
    const chaosChoices = new Set(Array.from({ length: 12 }, (_item, index) => choose('chaos-monkey-bot', index + 1)));

    expect(choose('chaos-monkey-bot', 999)).toBe(choose('chaos-monkey-bot', 999));
    expect(chaosChoices.size).toBeGreaterThan(2);
  });

  it('explains profile decisions and assigns action quality labels', () => {
    const uiAction = chooseAction('ui-tester-bot', 100);
    const explorerAction = chooseAction('explorer-bot', 100);
    const chaosAction = chooseAction('chaos-monkey-bot', 7);

    expect(uiAction?.payload.explanation).toContain('matched UI profile rules');
    expect(explorerAction?.payload.quality).toBe('exploratory');
    expect(explorerAction?.payload.explanation).toContain('unvisited action');
    expect(chaosAction?.payload.quality).toBe('random');
    expect(chaosAction?.payload.explanation).toContain('chaos profile favors unpredictable, risky stress actions');
    expect(chaosAction?.payload.nextLikelyAction).toEqual(expect.any(String));
  });

  it('labels repeated and risky decisions', () => {
    const repeated = chooseAction('explorer-bot', 100, 2, {
      availableActions: [{ actionType: 'move-forward', label: 'Move Forward' }],
      memory: {
        actionCount: 2,
        stateCount: 2,
        errorCount: 0,
        recentActionTypes: ['move-forward']
      },
      coverageData: {
        visitedActions: ['move-forward']
      }
    });
    const risky = chooseAction('boundary-breaker-bot', 100, 0, {
      availableActions: [{ actionType: 'boundary-jump-corner', label: 'Boundary Jump Corner' }],
      coverageData: {
        visitedActions: ['boundary-jump-corner']
      }
    });

    expect(repeated?.payload.quality).toBe('repeated');
    expect(risky?.payload.quality).toBe('risky');
  });

  it('uses configured UI flows for the UI Journey Bot', () => {
    const uiFlow: UIFlow = {
      flowId: 'create-world',
      name: 'Create World',
      startState: 'main-menu',
      endState: 'world-loaded',
      steps: [
        {
          stepId: 'choose-play-game',
          expectedScreen: 'main-menu',
          actionType: 'choose-play-game',
          targetLabel: 'Play Game',
          keyBinding: 'Enter',
          waitAfterMs: 500
        }
      ]
    };
    const action = chooseAction('ui-journey-bot', 123, 0, {
      state: {
        ...state,
        scene: 'main-menu',
        state: {
          uiState: {
            screen: 'main-menu'
          }
        }
      },
      availableActions: [{ actionType: 'choose-play-game', label: 'Play Game' }],
      uiFlows: [uiFlow]
    });

    expect(action?.type).toBe('choose-play-game');
    expect(action?.payload.planner).toBe('ui-journey');
    expect(action?.payload.flowId).toBe('create-world');
    expect(action?.payload.binding).toBe('Enter');
    expect(action?.payload.quality).toBe('startup-flow');
    expect(action?.payload.explanation).toContain('next configured step');
  });

  it('can create a UI Journey action from configured fallback data when no actions are exposed', () => {
    const uiFlow: UIFlow = {
      flowId: 'desktop-create-world',
      name: 'Desktop Create World',
      steps: [
        {
          stepId: 'press-play',
          expectedScreen: 'main-menu',
          actionType: 'choose-play-game',
          targetLabel: 'Play Game',
          keyBinding: 'Enter',
          waitAfterMs: 750
        }
      ]
    };
    const action = chooseAction('ui-journey-bot', 456, 0, {
      availableActions: [],
      uiFlows: [uiFlow]
    });

    expect(action?.type).toBe('choose-play-game');
    expect(action?.payload.binding).toBe('Enter');
    expect(action?.payload.durationMs).toBe(750);
  });

  it('uses browser UI state and a visible button before a misleading page scene', () => {
    const uiFlow: UIFlow = {
      flowId: 'hexcraft-start',
      name: 'Start Hexcraft World',
      steps: [
        {
          stepId: 'create-world',
          expectedScreen: 'main-menu',
          actionType: 'choose-create-world',
          targetLabel: 'Create World'
        }
      ]
    };
    const action = chooseAction('ui-journey-bot', 912, 0, {
      state: {
        ...state,
        scene: 'Hexcraft Browser Window',
        uiState: {
          currentScreen: 'main-menu',
          openMenus: ['main-menu'],
          visibleButtons: [
            { label: 'Create World', selector: '#create-world', disabled: false }
          ],
          modalStack: [],
          canStartGame: true,
          isInGameplay: false,
          isPaused: false,
          isLoading: false,
          source: 'hook'
        }
      },
      availableActions: [],
      uiFlows: [uiFlow]
    });

    expect(action?.type).toBe('choose-create-world');
    expect(action?.payload.currentScreen).toBe('main-menu');
    expect(action?.payload.domTarget).toBe(true);
    expect(action?.payload.domTargetLabel).toBe('Create World');
    expect(action?.payload.domSelector).toBe('#create-world');
    expect(action?.payload.reason).toContain('visible UI button Create World');
  });
});
