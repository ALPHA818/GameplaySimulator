import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  ActionResult,
  DetectedIssue,
  GameAction,
  GameInstanceStatus,
  GameProfile,
  GameStateSnapshot,
  RuntimeViabilityReport,
  SimulationRunConfig
} from '../types';
import { StructuredRunLogger } from './StructuredLoggers';

const runConfig: SimulationRunConfig = {
  sessionId: 'session-test',
  gameProfilePath: 'memory://game',
  adapterType: 'browser',
  runMode: 'parallel',
  runUntilStopped: false,
  stopOnCriticalIssue: true,
  saveScreenshots: true,
  saveVideo: false,
  saveActionTimeline: true,
  saveStateSnapshots: true,
  botPools: [],
  globalBotLimit: 2,
  perGameInstanceBotLimit: 1,
  actionDelayMs: 0,
  resourceLimits: {
    maxCpuPercent: 80,
    maxRamPercent: 80,
    reserveRamMb: 512,
    maxGameInstances: 1,
    allowAutoScaling: true
  }
};

const gameProfile: GameProfile = {
  gameId: 'game',
  gameName: 'Game',
  version: '1.0.0',
  engine: { type: 'browser' },
  launch: { platform: 'browser', url: 'https://example.local', arguments: [] },
  adapter: {
    type: 'browser',
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
  uiFlows: [],
  knownContent: {
    scenes: [],
    levels: [],
    locations: [],
    characters: [],
    npcs: [],
    items: [],
    quests: [],
    mainQuests: [],
    sideQuests: [],
    optionalStories: [],
    shops: [],
    bosses: [],
    menus: [],
    dialogueBranches: [],
    minigames: [],
    endings: [],
    hiddenAreas: [],
    postGameContent: [],
    collectibles: [],
    achievements: [],
    mechanics: [],
    notes: []
  }
};

const viabilityReport: RuntimeViabilityReport = {
  canRun: true,
  recommendedTotalBots: 1,
  recommendedGameInstances: 1,
  warnings: ['CPU is moderately loaded.'],
  blockers: [],
  estimatedCpuPercent: 20,
  estimatedRamMb: 1024,
  botAllocation: []
};

const state: GameStateSnapshot = {
  snapshotId: 'state-001',
  sessionId: 'session-test',
  gameId: 'game',
  gameInstanceId: 'instance-001',
  botId: 'explorer-001',
  capturedAt: '2026-07-04T10:00:01.000Z',
  scene: 'Start',
  state: { position: { x: 1, y: 2 } },
  metrics: {}
};

const action: GameAction = {
  actionId: 'action-001',
  sessionId: 'session-test',
  gameInstanceId: 'instance-001',
  botId: 'explorer-001',
  type: 'move-forward',
  payload: {
    planner: 'rule-based',
    score: 82.5,
    random: 0.42,
    reason: 'rule match, unvisited action',
    profileKey: 'explorer',
    seed: 42,
    quality: 'exploratory',
    explanation: 'Explorer chose move-forward because it was an unvisited action.',
    nextLikelyAction: 'inspect-area'
  },
  requestedAt: '2026-07-04T10:00:02.000Z'
};

const result: ActionResult = {
  actionId: 'action-001',
  botId: 'explorer-001',
  status: 'succeeded',
  completedAt: '2026-07-04T10:00:03.000Z',
  durationMs: 1,
  issueIds: []
};

const issue: DetectedIssue = {
  issueId: 'issue-001',
  sessionId: 'session-test',
  gameInstanceId: 'instance-001',
  botId: 'explorer-001',
  severity: 'warning',
  category: 'navigation',
  title: 'Bot blocked',
  description: 'No movement.',
  lastActions: ['open-menu', 'confirm', 'action-001'],
  screenshotPath: '/runs/session-test/bots/explorer-001/screenshots/issue-001.png',
  evidencePaths: [
    '/runs/session-test/bots/explorer-001/screenshots/issue-001.png',
    '/runs/session-test/bots/explorer-001/states/state-before-issue.json'
  ],
  actionTimelineIds: ['action-001'],
  firstSeenAt: '2026-07-04T10:00:04.000Z',
  reproducible: false
};

const instanceStatus: GameInstanceStatus = {
  instanceId: 'instance-001',
  gameProfileId: 'game',
  adapterType: 'browser',
  status: 'running',
  assignedBots: ['explorer-001'],
  startTime: '2026-07-04T10:00:00.000Z',
  lastHeartbeat: '2026-07-04T10:00:01.000Z'
};

async function readJsonl(path: string): Promise<unknown[]> {
  const contents = await readFile(path, 'utf8');
  return contents
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

describe('StructuredRunLogger', () => {
  it('creates the session folder structure and valid JSONL logs', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-structured-'));
    const logger = new StructuredRunLogger({
      rootDir,
      sessionId: 'session-test',
      createdAt: '2026-07-04T10:11:12.000Z',
      now: () => '2026-07-04T10:11:12.000Z'
    });

    logger.writeConfig({ runConfig, gameProfile });
    logger.writeViabilityReport(viabilityReport);
    logger.writeSummary({
      status: 'running',
      runConfig,
      gameProfile,
      viabilityReport,
      bots: [],
      instances: [instanceStatus],
      issues: [issue],
      contentCoveragePercent: 50,
      testedContent: ['Start'],
      untestedContent: ['No known content catalog configured'],
      contentWithIssues: ['scenes: Start (1 issue)'],
      contentByBotType: ['explorer: 1 content item'],
      createdAt: '2026-07-04T10:11:12.000Z',
      startedAt: '2026-07-04T10:11:12.000Z'
    });

    logger.ensureBot('explorer-001');
    logger.ensureInstance('instance-001');

    const sessionStart = logger.logSession('session_start', { status: 'running' });
    const instanceStart = logger.logSession('instance_start', { status: 'running' }, { gameInstanceId: 'instance-001' });
    const stateEvent = logger.logSession('state_snapshot', { snapshotId: state.snapshotId }, {
      botId: 'explorer-001',
      gameInstanceId: 'instance-001'
    });
    const actionEvent = logger.logSession('action_performed', { actionId: action.actionId }, {
      botId: 'explorer-001',
      gameInstanceId: 'instance-001'
    });
    const issueEvent = logger.logSession('issue_detected', { issueId: issue.issueId }, {
      botId: 'explorer-001',
      gameInstanceId: 'instance-001'
    });

    logger.logInstance(instanceStart, instanceStatus);
    logger.logState(stateEvent, state);
    logger.logAction(actionEvent, action, result);
    logger.logIssue(issueEvent, issue, 1);
	    logger.writeBotReports([
	      {
	        botId: 'explorer-001',
        displayName: 'Explorer',
        profileId: 'explorer',
        status: 'blocked',
        actionCount: 1,
        issueCount: 1,
        lastActionId: action.actionId,
        progressState: 'Blocked',
        currentArea: 'Start',
        stopReason: 'Blocked',
        areasVisited: ['Start'],
        issues: [issue],
        lastActions: [action.type],
        recoveryAttempts: [],
	        finalState: state.state
	      }
	    ]);
	    logger.writeSummary({
	      status: 'running',
	      runConfig,
	      gameProfile,
	      viabilityReport,
	      bots: [
	        {
	          botId: 'explorer-001',
	          displayName: 'Explorer',
	          profileId: 'explorer',
	          status: 'blocked',
	          actionCount: 1,
	          issueCount: 1,
	          lastActionId: action.actionId,
	          progressState: 'Blocked',
	          currentArea: 'Start',
	          stopReason: 'Blocked',
	          areasVisited: ['Start'],
	          issues: [issue],
	          lastActions: [action.type],
	          recoveryAttempts: [],
	          finalState: state.state
	        }
	      ],
	      instances: [instanceStatus],
	      issues: [issue],
	      contentCoveragePercent: 50,
	      testedContent: ['Start'],
	      untestedContent: ['No known content catalog configured'],
	      contentWithIssues: ['scenes: Start (1 issue)'],
	      contentByBotType: ['explorer: 1 content item'],
	      createdAt: '2026-07-04T10:11:12.000Z',
	      startedAt: '2026-07-04T10:11:12.000Z'
	    });

    expect(basename(logger.sessionDir)).toBe('session-2026-07-04-10-11-12');
    expect(existsSync(logger.sessionLogger.configPath)).toBe(true);
    expect(existsSync(logger.sessionLogger.viabilityReportPath)).toBe(true);
	    expect(existsSync(logger.sessionLogger.summaryPath)).toBe(true);
	    expect(existsSync(logger.sessionLogger.htmlReportPath)).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'session-summary.json'))).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'important-events.jsonl'))).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'full-structured-logs.jsonl'))).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'issues.json'))).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'issue-timeline.json'))).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'metadata.json'))).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'screenshots'))).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'reports'))).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'exports'))).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'replay'))).toBe(true);
    expect(existsSync(join(logger.sessionDir, 'bots', 'explorer-001', 'screenshots'))).toBe(true);
    expect(existsSync(join(logger.sessionDir, 'bots', 'explorer-001', 'video'))).toBe(true);
    expect(existsSync(join(logger.sessionDir, 'issues', 'issue-001.md'))).toBe(true);

    const sessionEvents = await readJsonl(logger.sessionLogPath);
    const stateEvents = await readJsonl(join(logger.sessionDir, 'bots', 'explorer-001', 'states.jsonl'));
    const actionEvents = await readJsonl(join(logger.sessionDir, 'bots', 'explorer-001', 'actions.jsonl'));
    const issueEvents = await readJsonl(join(logger.sessionDir, 'bots', 'explorer-001', 'issues.jsonl'));
	    const instanceEvents = await readJsonl(join(logger.sessionDir, 'instances', 'instance-001', 'instance-log.jsonl'));
	    const fullLogs = await readJsonl(join(logger.sessionDir, 'full-structured-logs.jsonl'));
	    const importantEvents = await readJsonl(join(logger.sessionDir, 'important-events.jsonl'));
	    const summary = await readFile(logger.summaryPath, 'utf8');
    const botReport = await readFile(join(logger.sessionDir, 'bots', 'explorer-001', 'bot-report.md'), 'utf8');
    const issueReport = await readFile(join(logger.sessionDir, 'issues', 'issue-001.md'), 'utf8');

    expect(sessionEvents).toHaveLength(5);
    expect(sessionEvents).toContainEqual(sessionStart);
    expect(stateEvents).toHaveLength(1);
    expect(actionEvents).toHaveLength(1);
    expect(actionEvents[0]).toMatchObject({
      payload: {
        actionQuality: 'exploratory',
        explanation: 'Explorer chose move-forward because it was an unvisited action.',
        nextLikelyAction: 'inspect-area',
        plannerMetadata: {
          planner: 'rule-based',
          score: 82.5,
          randomValue: 0.42,
          reason: 'rule match, unvisited action',
          profileKey: 'explorer',
          seed: 42
        }
      }
    });
    expect(issueEvents).toHaveLength(1);
	    expect(instanceEvents).toHaveLength(1);
	    expect(fullLogs.length).toBeGreaterThan(sessionEvents.length);
	    expect(importantEvents.some((event) => (event as { eventType?: string }).eventType === 'issue_detected')).toBe(true);
    expect(issueEvents[0]).toMatchObject({
      eventType: 'issue_detected',
      payload: {
        issueId: issue.issueId,
        title: issue.title,
        severity: issue.severity,
        category: issue.category,
        last10Actions: issue.lastActions,
        screenshotPath: issue.screenshotPath,
        evidencePaths: issue.evidencePaths,
        sceneArea: 'Unknown',
        occurrence: 'new',
        whyFlagged: {
          detectorName: 'navigation detector'
        }
      }
    });
    expect((issueEvents[0] as { payload: { timeline: unknown[] } }).payload.timeline).toHaveLength(6);
    expect((issueEvents[0] as { payload: { whatToCheckNext: string[] } }).payload.whatToCheckNext).toContain(
      'Inspect raw state in this log entry.'
    );
    expect(summary).toContain('## Resource Viability');
    expect(summary).toContain('## Content Coverage');
    expect(summary).toContain('Coverage: 50%');
    expect(summary).toContain('### Content Tested By Bot Type');
    expect(summary).toContain('### Content With Issues');
    expect(summary).toContain('## Action Outcomes');
    expect(summary).toContain('Explorer chose move-forward because it was an unvisited action.');
    expect(botReport).toContain('## Action Timeline With Explanations');
    expect(botReport).toContain('## Top Repeated Actions');
    expect(botReport).toContain('## Failed Actions');
    expect(botReport).toContain('## Skipped Actions');
    expect(botReport).toContain('Explorer chose move-forward because it was an unvisited action.');
    expect(botReport).toContain('## Areas Visited');
    expect(botReport).toContain('Actions performed: 1');
    expect(issueReport).toContain('## Steps To Reproduce');
    expect(issueReport).toContain('## Expected Behavior');
    expect(issueReport).toContain('## Why This Was Flagged');
    expect(issueReport).toContain('## Issue Timeline');
    expect(issueReport).toContain('## What To Check Next');
  });
});
