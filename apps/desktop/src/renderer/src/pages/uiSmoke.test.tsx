import { renderToStaticMarkup } from 'react-dom/server';
import type { DetectedIssue, GameInstanceStatus, SimulationRunConfig } from '@core/types';
import type { LogEntry } from '@core/logging/LogEntry';
import { defaultAdvancedIntelligenceConfig } from '@core/config/advancedIntelligenceConfig';
import { beforeEach, describe, expect, it } from 'vitest';
import { IssuesPage } from './IssuesPage';
import { LiveSessionPage } from './LiveSessionPage';
import { LogsPage } from './LogsPage';
import { NewSessionPage } from './NewSessionPage';
import { ReportsPage } from './ReportsPage';
import { SettingsPage } from './SettingsPage';
import { BrowserGameWizardPanel, GameProfileEditorPage } from './GameProfileEditorPage';
import { HelpFirstTestPage } from './HelpFirstTestPage';
import { useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';

const runConfig: SimulationRunConfig = {
  sessionId: 'ui-session',
  gameProfilePath: 'memory://game-profiles/sample-browser-game',
  adapterType: 'browser',
  runMode: 'parallel',
  runUntilStopped: false,
  maxRuntimeMinutes: 15,
  stopOnCriticalIssue: true,
  saveScreenshots: true,
  saveVideo: false,
  saveActionTimeline: true,
  saveStateSnapshots: true,
  botPools: [
    {
      profileId: 'explorer-bot',
      enabled: true,
      minCount: 1,
      desiredCount: 3,
      maxCount: 10,
      scalingMode: 'auto',
      priority: 10,
      resourceWeight: 'medium'
    }
  ],
  globalBotLimit: 8,
  perGameInstanceBotLimit: 2,
  actionDelayMs: 100,
  maxActionsPerBot: 50,
  resourceLimits: {
    maxCpuPercent: 80,
    maxRamPercent: 75,
    maxGpuPercent: 80,
    reserveRamMb: 1024,
    maxGameInstances: 2,
    allowAutoScaling: true
  }
};

const issue: DetectedIssue = {
  issueId: 'issue-ui-001',
  sessionId: 'ui-session',
  gameInstanceId: 'instance-ui-001',
  botId: 'explorer-bot-001',
  severity: 'critical',
  category: 'world_boundary',
  title: 'Player fell out of the world',
  description: 'Player position escaped playable bounds.',
  scene: 'Start Area',
  lastActions: ['move-forward', 'boundary-jump-corner'],
  stateSummary: '{"position":{"y":-250}}',
  expectedBehavior: 'Collision should keep the player in bounds.',
  actualBehavior: 'The player fell below the map.',
  confidence: 0.95,
  screenshotPath: '/runs/ui-session/bots/explorer-bot-001/screenshots/issue.svg',
  evidencePaths: ['/runs/ui-session/bots/explorer-bot-001/screenshots/issue.svg'],
  actionTimelineIds: ['action-ui-001'],
  firstSeenAt: '2026-07-05T09:00:00.000Z',
  reproducible: true
};

const instanceStatus: GameInstanceStatus = {
  instanceId: 'instance-ui-001',
  gameProfileId: 'sample-browser-game',
  adapterType: 'browser',
  status: 'running',
  assignedBots: ['explorer-bot-001'],
  startTime: '2026-07-05T09:00:00.000Z',
  lastHeartbeat: '2026-07-05T09:00:05.000Z',
  resourceUsage: {
    cpuPercent: 15,
    ramMb: 768
  }
};

const log: LogEntry = {
  id: 'log-ui-001',
  timestamp: '2026-07-05T09:00:05.000Z',
  level: 'info',
  message: 'Action move-forward succeeded.',
  source: 'bot:explorer-bot-001'
};

describe('renderer workflow smoke tests', () => {
  beforeEach(() => {
    useConfigStore.setState({
      currentPage: 'dashboard',
      editingGameId: null,
      runConfigs: [runConfig],
      lastValidatedRunConfig: runConfig,
      advancedIntelligence: defaultAdvancedIntelligenceConfig
    });
    useSessionStore.setState({
      status: 'running',
      statusLabel: 'Running ui-session',
      activeSessionId: 'ui-session',
      lastSnapshot: {
        status: 'running',
        label: 'Running ui-session',
        activeSessionId: 'ui-session',
        sessionId: 'ui-session',
        createdAt: '2026-07-05T09:00:00.000Z',
        startedAt: '2026-07-05T09:00:00.000Z',
        botCount: 1,
        instanceCount: 1
      },
      botStatuses: [
        {
          botId: 'explorer-bot-001',
          profileId: 'explorer-bot',
          displayName: 'Explorer Bot',
          playstyle: 'exploration',
          status: 'running',
          gameInstanceId: 'instance-ui-001',
          currentGoalId: 'coverage',
          currentGoal: 'Explore the map',
          currentAction: 'move-forward',
          actionReason: 'Explorer Bot chose move-forward because it was an unvisited action.',
          actionQuality: 'exploratory',
          lastResult: 'succeeded: moved forward',
          nextLikelyAction: 'inspect-area',
          currentArea: 'Start Area',
          progressState: 'Exploring',
          issueCount: 1,
          message: 'Running smoke test bot.'
        }
      ],
      instanceStatuses: [instanceStatus],
      issues: [issue],
      logs: [log],
      coverage: null,
      reviewedIssueIds: [],
      falsePositiveIssueIds: []
    });
  });

  it('renders the new session flow with bot pools and viability controls', () => {
    const html = renderToStaticMarkup(<NewSessionPage />);

    expect(html).toContain('New Session');
    expect(html).toContain('Start Session');
    expect(html).toContain('First Test Template');
    expect(html).toContain('Browser Smoke Test');
    expect(html).toContain('Template Safety Limits');
    expect(html).toContain('1 bot · 1 game instance · 20 actions');
    expect(html).toContain('Bot Pools');
    expect(html).toContain('Global Bot Limit');
    expect(html).toContain('Bot-count viability');
  });

  it('renders guided game profile setup with profile testing controls', () => {
    const html = renderToStaticMarkup(<GameProfileEditorPage />);

    expect(html).toContain('Guided Setup');
    expect(html).toContain('Setup Wizard');
    expect(html).toContain('Desktop Game Wizard');
    expect(html).toContain('Profile Readiness');
    expect(html).toContain('Test Profile');
  });

  it('renders browser DOM scan mode with field help in the browser wizard', () => {
    const html = renderToStaticMarkup(
      <BrowserGameWizardPanel
        url="http://localhost:5173"
        browserName="chromium"
        browserDomScanMode="fallback"
        controlMappings="Confirm = Enter"
        onUrlChange={() => undefined}
        onBrowserNameChange={() => undefined}
        onDomScanModeChange={() => undefined}
        onControlMappingsChange={() => undefined}
      />
    );

    expect(html).toContain('Browser Game Wizard');
    expect(html).toContain('DOM Scan Mode');
    expect(html).toContain('Fallback when UI hooks are missing');
    expect(html).toContain('DOM UI Clues');
  });

  it('renders live dashboard monitoring and stop/report controls', () => {
    const html = renderToStaticMarkup(<LiveSessionPage />);

    expect(html).toContain('Live Session');
    expect(html).toContain('Running bots');
    expect(html).toContain('Stop selected bot');
    expect(html).toContain('Open logs');
    expect(html).toContain('Open reports');
    expect(html).toContain('Current Bot Goal');
    expect(html).toContain('Current Action');
    expect(html).toContain('Action Reason');
    expect(html).toContain('Action Quality');
    expect(html).toContain('Last Result');
    expect(html).toContain('Next Likely Action');
  });

  it('renders the issue viewer with GitHub export preview controls', () => {
    const html = renderToStaticMarkup(<IssuesPage />);

    expect(html).toContain('Issues');
    expect(html).toContain('No matching issues');
    expect(html).toContain('Issue Markdown');
    expect(html).toContain('Search');
    expect(html).toContain('Preview');
    expect(html).toContain('Export Markdown');
  });

  it('renders report opening and build comparison controls', () => {
    const html = renderToStaticMarkup(<ReportsPage />);

    expect(html).toContain('Reports');
    expect(html).toContain('Compare Sessions');
    expect(html).toContain('Old Session');
    expect(html).toContain('New Session');
    expect(html).toContain('No reports yet');
  });

  it('renders grouped logs with session selection and noise controls', () => {
    const html = renderToStaticMarkup(<LogsPage />);

    expect(html).toContain('Logs');
    expect(html).toContain('Session');
    expect(html).toContain('Overview');
    expect(html).toContain('Bot Actions');
    expect(html).toContain('Console/Page Errors');
    expect(html).toContain('Only important logs');
    expect(html).toContain('Hide noisy state snapshots');
    expect(html).toContain('Export visible logs');
  });

  it('renders gated advanced intelligence settings with hover-help labels', () => {
    const html = renderToStaticMarkup(<SettingsPage />);

    expect(html).toContain('Advanced Intelligence');
    expect(html).toContain('Real Runtime Prerequisite');
    expect(html).toContain('Vision Model');
    expect(html).toContain('Bug Deduplication');
    expect(html).toContain('Help for Vision Model');
  });

  it('renders first-test help for each adapter type with hover-help labels', () => {
    const html = renderToStaticMarkup(<HelpFirstTestPage />);

    expect(html).toContain('Help / First Test');
    expect(html).toContain('Quick Start');
    expect(html).toContain('Browser Game First Test');
    expect(html).toContain('Desktop Game First Test');
    expect(html).toContain('Unity First Test');
    expect(html).toContain('Godot First Test');
    expect(html).toContain('Unreal First Test');
    expect(html).toContain('Custom Engine First Test');
    expect(html).toContain('Safe First Settings');
    expect(html).toContain('Help for Game Profile');
  });
});
