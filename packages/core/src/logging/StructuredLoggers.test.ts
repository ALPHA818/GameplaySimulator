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
  showBotGameplay: true,
  observationMode: 'follow-first-bot',
  bringGameToFrontOnAction: false,
  visibleActionDelayMs: 650,
  showActionInformation: true,
  maxVisibleGameWindows: 1,
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
  observation: {
    enabled: false,
    totalBotCount: 0,
    totalRunningGameInstances: 0,
    requestedVisibleGameInstances: 0,
    recommendedVisibleGameInstances: 0,
    backgroundGameInstances: 0,
    recommendedVisibleWindowLimit: 1,
    estimatedCpuPercent: 0,
    estimatedRamMb: 0,
    breakdown: {
      headedBrowserWindow: { cpuPercent: 0, ramMb: 0 },
      additionalVisibleWindows: { cpuPercent: 0, ramMb: 0 },
      actionOverlays: { cpuPercent: 0, ramMb: 0 },
      focusTracking: { cpuPercent: 0, ramMb: 0 }
    }
  },
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
  it('appends a large event set incrementally and flushes every queued record', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-large-jsonl-'));
    const logger = new StructuredRunLogger({
      rootDir,
      sessionId: 'large-session',
      createdAt: '2026-07-29T10:00:00.000Z'
    });

    for (let index = 0; index < 5_000; index += 1) {
      logger.logSession('resource_warning', {
        warning: `Generated warning ${index}`
      });
    }
    await logger.flush();

    const sessionLines = (await readFile(logger.sessionLogPath, 'utf8')).trim().split('\n');
    const fullLines = (await readFile(logger.sessionLogger.fullStructuredLogsPath, 'utf8')).trim().split('\n');
    const importantLines = (await readFile(logger.sessionLogger.importantEventsPath, 'utf8')).trim().split('\n');

    expect(sessionLines).toHaveLength(5_000);
    expect(fullLines).toHaveLength(5_000);
    expect(importantLines).toHaveLength(5_000);
    expect(JSON.parse(fullLines[4_999])).toEqual(expect.objectContaining({
      eventType: 'resource_warning',
      payload: { warning: 'Generated warning 4999' }
    }));
  });

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
	      directives: [
	        {
	          directiveId: 'directive-001',
	          sessionId: 'session-test',
	          name: 'Explore the forest',
	          description: 'Look for new paths in the forest.',
	          directiveType: 'area',
	          directiveMode: 'focus',
	          priority: 'high',
	          status: 'succeeded',
	          target: {
	            allBots: false,
	            botIds: ['explorer-001'],
	            profileIds: [],
	            gameInstanceIds: []
	          },
	          actionKeywords: ['explore'],
	          avoidedActionKeywords: [],
	          targetArea: 'Forest',
	          successConditions: ['A new path is found.'],
	          failureConditions: [],
	          steps: [],
	          repeatUntilSuccess: false,
	          createdAt: '2026-07-04T10:11:12.000Z',
	          activatedAt: '2026-07-04T10:11:12.000Z',
	          completedAt: '2026-07-04T10:11:14.000Z',
	          createdBy: 'user'
	        },
	        {
	          directiveId: 'directive-reproduce-001',
	          sessionId: 'session-test',
	          name: 'Reproduce inventory loss',
	          description: 'Repeat the actions that previously caused an item to disappear.',
	          directiveType: 'issue-reproduction',
	          directiveMode: 'focus',
	          priority: 'high',
	          status: 'failed',
	          target: {
	            allBots: false,
	            botIds: ['explorer-001'],
	            profileIds: [],
	            gameInstanceIds: []
	          },
	          actionKeywords: ['open-inventory', 'move-item'],
	          avoidedActionKeywords: [],
	          targetIssueId: 'issue-001',
	          successConditions: ['The inventory loss is detected again.'],
	          failureConditions: [],
	          steps: [],
	          repeatUntilSuccess: false,
	          createdAt: '2026-07-04T10:11:12.000Z',
	          activatedAt: '2026-07-04T10:11:13.000Z',
	          completedAt: '2026-07-04T10:11:15.000Z',
	          createdBy: 'user'
	        }
	      ],
	      directiveProgress: [
	        {
	          directiveId: 'directive-001',
	          botId: 'explorer-001',
	          instanceId: 'instance-001',
	          status: 'succeeded',
	          actionsAttempted: 1,
	          attempts: 1,
	          matchedActions: ['move-forward'],
	          unrelatedActions: ['wait'],
	          successfulActions: 1,
	          failedActions: 0,
	          reachedScenes: ['Forest'],
	          reachedAreas: ['Forest path'],
	          observedStateChanges: ['Scene changed from Start to Forest.'],
	          conditionsMet: ['A new path is found.'],
	          issueIds: ['issue-001'],
	          screenshotPaths: ['/runs/forest.png'],
	          videoPaths: [],
	          progressMessage: 'Exploring the forest.',
	          startedAt: '2026-07-04T10:11:12.000Z',
	          updatedAt: '2026-07-04T10:11:14.000Z',
	          completedAt: '2026-07-04T10:11:14.000Z'
	        },
	        {
	          directiveId: 'directive-reproduce-001',
	          botId: 'explorer-001',
	          instanceId: 'instance-001',
	          status: 'failed',
	          actionsAttempted: 2,
	          attempts: 2,
	          matchedActions: ['open-inventory', 'move-item'],
	          unrelatedActions: [],
	          successfulActions: 1,
	          failedActions: 1,
	          reachedScenes: ['Forest'],
	          reachedAreas: ['Forest path'],
	          observedStateChanges: ['Inventory stayed unchanged.'],
	          conditionsMet: [],
	          issueIds: [],
	          screenshotPaths: ['/runs/reproduction-failed.png'],
	          videoPaths: [],
	          failureReason: 'The issue did not happen again within the attempt limit.',
	          progressMessage: 'Reproduction attempt ended without a match.',
	          startedAt: '2026-07-04T10:11:13.000Z',
	          updatedAt: '2026-07-04T10:11:15.000Z',
	          completedAt: '2026-07-04T10:11:15.000Z'
	        }
	      ],
	      directiveEvents: [
	        {
	          eventId: 'directive-event-001',
	          eventType: 'directive_created',
	          sessionId: 'session-test',
	          directiveId: 'directive-001',
	          timestamp: '2026-07-04T10:11:12.000Z',
	          payload: { message: 'User created directive.' }
	        },
	        {
	          eventId: 'directive-event-002',
	          eventType: 'directive_state_changed',
	          sessionId: 'session-test',
	          directiveId: 'directive-001',
	          botId: 'explorer-001',
	          instanceId: 'instance-001',
	          timestamp: '2026-07-04T10:11:13.000Z',
	          payload: { summary: 'Scene changed from Start to Forest.' }
	        },
	        {
	          eventId: 'directive-event-003',
	          eventType: 'directive_succeeded',
	          sessionId: 'session-test',
	          directiveId: 'directive-001',
	          botId: 'explorer-001',
	          instanceId: 'instance-001',
	          timestamp: '2026-07-04T10:11:14.000Z',
	          payload: { message: 'The requested path was found.' }
	        },
	        {
	          eventId: 'directive-event-004',
	          eventType: 'directive_failed',
	          sessionId: 'session-test',
	          directiveId: 'directive-reproduce-001',
	          botId: 'explorer-001',
	          instanceId: 'instance-001',
	          timestamp: '2026-07-04T10:11:15.000Z',
	          payload: { message: 'The issue did not happen again.' }
	        }
	      ],
	      createdAt: '2026-07-04T10:11:12.000Z',
	      startedAt: '2026-07-04T10:11:12.000Z'
	    });

    expect(basename(logger.sessionDir)).toBe('session-session-test');
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
	    const directedTests = JSON.parse(
	      await readFile(join(logger.sessionDir, 'user-directed-tests.json'), 'utf8')
	    ) as Array<Record<string, unknown>>;
	    const directiveTimeline = JSON.parse(
	      await readFile(join(logger.sessionDir, 'directive-timeline.json'), 'utf8')
	    ) as Array<{ eventType: string; directiveId: string }>;
    const botReport = await readFile(join(logger.sessionDir, 'bots', 'explorer-001', 'bot-report.md'), 'utf8');
    const issueReport = await readFile(join(logger.sessionDir, 'issues', 'issue-001.md'), 'utf8');

    expect(sessionEvents).toHaveLength(5);
	    expect(summary).toContain('## User-Directed Tests');
	    expect(summary).toContain('Actions Used');
	    expect(summary).toContain('Scene changed from Start to Forest.');
	    expect(summary).toContain('Explore the forest');
	    expect(summary).toContain('Exploring the forest.');
	    expect(summary).toContain('Reproduce inventory loss');
	    expect(summary).toContain('The issue did not happen again within the attempt limit.');
	    expect(summary).toContain('/runs/forest.png');
	    expect(summary).toContain('issue-001');
	    expect(existsSync(join(logger.sessionDir, 'user-directed-tests.json'))).toBe(true);
	    expect(existsSync(join(logger.sessionDir, 'directive-timeline.json'))).toBe(true);
	    expect(directedTests).toEqual(expect.arrayContaining([
	      expect.objectContaining({
	        finalResult: 'succeeded',
	        issuesDiscovered: ['issue-001'],
	        screenshots: ['/runs/forest.png']
	      }),
	      expect.objectContaining({
	        directive: expect.objectContaining({
	          directiveType: 'issue-reproduction',
	          targetIssueId: 'issue-001'
	        }),
	        finalResult: 'failed',
	        screenshots: ['/runs/reproduction-failed.png']
	      })
	    ]));
	    expect(directiveTimeline).toEqual(expect.arrayContaining([
	      expect.objectContaining({ eventType: 'directive_succeeded', directiveId: 'directive-001' }),
	      expect.objectContaining({
	        eventType: 'directive_failed',
	        directiveId: 'directive-reproduce-001'
	      })
	    ]));
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
    expect(summary).toContain('## Live Observation');
    expect(summary).toContain('Observation mode: follow-first-bot');
    expect(summary).toContain('Visible action delay: 650 ms');
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

  it('reports unsupported and incomplete technical tests explicitly', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-technical-report-'));
    const logger = new StructuredRunLogger({
      rootDir,
      sessionId: 'technical-report',
      createdAt: '2026-07-22T10:00:00.000Z'
    });
    const technicalRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'technical-report',
      botPools: [{
        profileId: 'network-resilience-tester-bot',
        enabled: true,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1,
        scalingMode: 'fixed',
        priority: 10,
        resourceWeight: 'heavy'
      }],
      technicalTesting: {
        controlledNetworkTestConfirmed: false,
        saveMigrationTestPaths: [],
        approvedFileTestDirectories: []
      }
    };

    logger.writeSummary({
      status: 'failed',
      runConfig: technicalRunConfig,
      gameProfile,
      viabilityReport,
      bots: [],
      instances: [],
      issues: [],
      contentCoveragePercent: 0,
      testedContent: [],
      untestedContent: [],
      contentWithIssues: [],
      contentByBotType: []
    });

    const markdown = await readFile(logger.summaryPath, 'utf8');
    const summaryJson = JSON.parse(
      await readFile(join(logger.sessionDir, 'session-summary.json'), 'utf8')
    ) as { technicalTesting: { readiness: Array<{ status: string; details: string[] }> } };

    expect(markdown).toContain('## Technical Test Readiness');
    expect(markdown).toContain('Network Resilience Tester Bot');
    expect(markdown).toContain('Unsupported');
    expect(markdown).toContain('Controlled network test confirmation is required');
    expect(summaryJson.technicalTesting.readiness[0].status).toBe('Unsupported');
    expect(summaryJson.technicalTesting.readiness[0].details.join(' ')).toContain('No bot from this technical profile launched');
  });

  it('does not create or advertise disabled action and state artifacts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-disabled-artifacts-'));
    const disabledRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'disabled-artifacts',
      saveActionTimeline: false,
      saveStateSnapshots: false
    };
    const logger = new StructuredRunLogger({
      rootDir,
      sessionId: disabledRunConfig.sessionId,
      createdAt: '2026-07-04T10:11:12.000Z',
      saveActionTimeline: false,
      saveStateSnapshots: false
    });

    logger.ensureBot('explorer-001');
    const actionEvent = logger.logSession('action_performed', { actionId: action.actionId });
    const stateEvent = logger.logSession('state_snapshot', { snapshotId: state.snapshotId });
    logger.logAction(actionEvent, action, result);
    logger.logState(stateEvent, state);
    logger.writeBotReports([{
      botId: 'explorer-001',
      displayName: 'Explorer',
      profileId: 'explorer',
      status: 'completed',
      actionCount: 1,
      issueCount: 0,
      areasVisited: ['Start'],
      issues: [],
      lastActions: [action.type],
      recoveryAttempts: []
    }]);
    logger.writeSummary({
      status: 'stopped',
      runConfig: disabledRunConfig,
      gameProfile,
      viabilityReport,
      bots: [],
      instances: [],
      issues: [],
      contentCoveragePercent: 0,
      testedContent: [],
      untestedContent: [],
      contentWithIssues: [],
      contentByBotType: []
    });

    const botDirectory = join(logger.sessionDir, 'bots', 'explorer-001');
    const markdown = await readFile(logger.summaryPath, 'utf8');
    const botMarkdown = await readFile(join(botDirectory, 'bot-report.md'), 'utf8');
    const summaryJson = JSON.parse(
      await readFile(join(logger.sessionDir, 'session-summary.json'), 'utf8')
    ) as {
      bundlePaths: { replayDirectory?: string };
      effectiveSettings: {
        saveActionTimeline: boolean;
        saveStateSnapshots: boolean;
      };
    };

    expect(existsSync(join(botDirectory, 'actions.jsonl'))).toBe(false);
    expect(existsSync(join(botDirectory, 'states.jsonl'))).toBe(false);
    expect(existsSync(join(logger.sessionDir, 'replay'))).toBe(false);
    expect(summaryJson.bundlePaths.replayDirectory).toBeUndefined();
    expect(summaryJson.effectiveSettings).toMatchObject({
      saveActionTimeline: false,
      saveStateSnapshots: false
    });
    expect(markdown).toContain('Action timeline artifacts: disabled');
    expect(markdown).toContain('State snapshot artifacts: disabled');
    expect(botMarkdown).toContain('Actions log: Disabled by session setting');
    expect(botMarkdown).toContain('States log: Disabled by session setting');
    expect(botMarkdown).not.toContain(join(botDirectory, 'actions.jsonl'));
    expect(botMarkdown).not.toContain(join(botDirectory, 'states.jsonl'));
  });
});
