import { describe, expect, it } from 'vitest';
import type { DetectedIssue, GameAction, GameProfile, GameStateSnapshot } from '../types';
import { CoverageTracker } from './CoverageTracker';

const gameProfile: GameProfile = {
  gameId: 'coverage-game',
  gameName: 'Coverage Game',
  version: '1.0.0',
  engine: { type: 'custom' },
  launch: { platform: 'windows', arguments: [] },
  adapter: {
    type: 'custom',
    supportsMultipleInstances: true,
    supportsStateRead: true,
    supportsDirectActions: true,
    supportsScreenshots: true,
    supportsVideo: false,
    supportsSaveIsolation: true
  },
  controls: [],
  testingTargets: [],
  progressSignals: [],
  failureSignals: [],
  knownContent: {
    scenes: ['Town'],
    levels: ['Level 1'],
    locations: [],
    characters: [],
    npcs: ['Guide'],
    items: ['Potion'],
    quests: ['Find the Gate'],
    mainQuests: ['Find the Gate'],
    sideQuests: ['Lost Cat'],
    optionalStories: ['Old Well'],
    shops: ['General Store'],
    bosses: ['Gate Guardian'],
    menus: ['Inventory'],
    dialogueBranches: ['Guide greeting'],
    minigames: ['Fishing'],
    endings: ['Good Ending'],
    hiddenAreas: ['Secret Cave'],
    postGameContent: ['Arena'],
    collectibles: ['Blue Gem'],
    achievements: ['First Steps'],
    mechanics: [],
    notes: []
  }
};

const snapshot: GameStateSnapshot = {
  snapshotId: 'snapshot-001',
  sessionId: 'session-coverage',
  gameId: 'coverage-game',
  gameInstanceId: 'instance-001',
  botId: 'explorer-001',
  capturedAt: '2026-07-04T10:00:00.000Z',
  scene: 'Town',
  state: {
    level: 'Level 1',
    npc: 'Guide',
    sideQuest: 'Lost Cat',
    optionalStory: 'Old Well',
    shop: 'General Store',
    minigame: 'Fishing',
    hiddenArea: 'Secret Cave',
    item: 'Potion',
    collectible: 'Blue Gem',
    menu: 'Inventory'
  },
  metrics: {}
};

const action: GameAction = {
  actionId: 'action-001',
  sessionId: 'session-coverage',
  gameInstanceId: 'instance-001',
  botId: 'explorer-001',
  type: 'follow-main-objective',
  target: 'Find the Gate',
  payload: {},
  requestedAt: '2026-07-04T10:00:01.000Z'
};

const issue: DetectedIssue = {
  issueId: 'issue-001',
  sessionId: 'session-coverage',
  gameInstanceId: 'instance-001',
  botId: 'explorer-001',
  severity: 'warning',
  category: 'navigation',
  title: 'Secret Cave blocks movement',
  scene: 'Secret Cave',
  lastActions: ['inspect-hidden-area'],
  evidencePaths: [],
  actionTimelineIds: [],
  firstSeenAt: '2026-07-04T10:00:02.000Z'
};

describe('CoverageTracker', () => {
  it('tracks main, side, optional, and issue-linked content by bot type', () => {
    const tracker = new CoverageTracker(gameProfile);
    tracker.registerBot('explorer-001', 'explorer-bot');
    tracker.recordSnapshot(snapshot);
    tracker.recordAction(action);
    tracker.recordIssue(issue);

    const summary = tracker.getSummary();

    expect(summary.totalKnown).toBeGreaterThan(10);
    expect(summary.testedKnown).toBeGreaterThan(8);
    expect(summary.percentage).toBeGreaterThan(0);
    expect(summary.testedContent.some((item) => item.category === 'mainQuests' && item.label === 'Find the Gate')).toBe(true);
    expect(summary.testedContent.some((item) => item.category === 'sideQuests' && item.label === 'Lost Cat')).toBe(true);
    expect(summary.testedContent.some((item) => item.category === 'optionalStories' && item.label === 'Old Well')).toBe(true);
    expect(summary.byBotType.find((item) => item.botType === 'explorer-bot')?.testedCount).toBeGreaterThan(0);
    expect(summary.contentWithIssues.some((item) => item.label === 'Secret Cave')).toBe(true);
  });
});
