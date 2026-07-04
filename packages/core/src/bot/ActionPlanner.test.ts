import type { GameStateSnapshot } from '../types';
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

function choose(profileId: string, seed: number, actionIndex = 0): string | null {
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
    recentIssues: []
  })?.type ?? null;
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
});
