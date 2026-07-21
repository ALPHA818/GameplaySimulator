// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PersistedSessionMetadata } from '../../../main/services/simulationService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';
import { LogsPage } from './LogsPage';

// React 19 checks this flag before trusting act() in custom render helpers.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type StructuredLogItem = Awaited<
  ReturnType<Window['gameplaySimulator']['simulation']['getStructuredLogs']>
>['logs'][number];

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

const testSession: PersistedSessionMetadata = {
  sessionId: 'session-filter-test',
  gameName: 'Filter Test Game',
  gameId: 'filter-test-game',
  version: '1.0.0',
  buildId: 'build-45',
  engineType: 'browser',
  adapterType: 'browser',
  runMode: 'parallel',
  createdAt: '2026-07-13T10:00:00.000Z',
  startedAt: '2026-07-13T10:01:00.000Z',
  status: 'running',
  issueCounts: {
    total: 1,
    bySeverity: { critical: 1 },
    byCategory: { crash: 1 }
  },
  botCounts: {
    requested: 2,
    actual: 2,
    running: 2,
    stopped: 0,
    stuck: 0
  },
  reportPaths: {
    sessionDirectory: '/runs/session-filter-test'
  }
};

const structuredLogs: StructuredLogItem[] = [
  {
    source: 'session',
    eventType: 'session_start',
    timestamp: '2026-07-13T10:01:00.000Z',
    summary: 'Session started.',
    raw: { eventId: 'session-start', eventType: 'session_start', level: 'info' }
  },
  {
    source: 'bot-actions',
    botId: 'ui-tester-bot-001',
    eventType: 'action_performed',
    timestamp: '2026-07-13T10:01:02.000Z',
    summary: 'Action one succeeded.',
    raw: {
      eventId: 'action-one',
      actionId: 'open-menu',
      level: 'info',
      eventType: 'action_performed',
      payload: {
        actionType: 'open-menu',
        status: 'succeeded',
        resultMessage: 'Menu opened.',
        actionQuality: 'planned',
        explanation: 'UI Tester chose open-menu because it matched UI profile rules.',
        nextLikelyAction: 'close-menu',
        plannerMetadata: {
          planner: 'rule-based',
          score: 84.2,
          randomValue: 0.24,
          reason: 'rule match',
          profileKey: 'ui',
          seed: 123
        }
      }
    }
  },
  {
    source: 'bot-actions',
    botId: 'ui-tester-bot-001',
    eventType: 'action_performed',
    timestamp: '2026-07-13T10:01:03.000Z',
    summary: 'Action two succeeded.',
    raw: { eventId: 'action-two', actionId: 'close-menu', level: 'info' }
  },
  {
    source: 'bot-issues',
    botId: 'ui-tester-bot-001',
    eventType: 'issue_detected',
    timestamp: '2026-07-13T10:01:04.000Z',
    summary: 'Crash issue detected.',
    raw: {
      eventId: 'issue-crash',
      eventType: 'issue_detected',
      payload: {
        issueId: 'issue-crash',
        title: 'Crash issue detected',
        severity: 'critical',
        category: 'crash',
        confidence: 0.92,
        botId: 'ui-tester-bot-001',
        gameInstanceId: 'game-instance-001',
        sceneArea: 'Main Menu',
        lastAction: 'open-menu',
        last10Actions: ['open-menu', 'confirm'],
        currentStateSummary: '{"scene":"Main Menu","status":"crashed"}',
        expectedBehavior: 'The menu should stay open.',
        actualBehavior: 'The page crashed after opening the menu.',
        screenshotPath: '/runs/session-filter-test/bots/ui-tester-bot-001/screenshots/issue.png',
        evidencePaths: ['/runs/session-filter-test/bots/ui-tester-bot-001/screenshots/issue.png'],
        likelyCause: 'The browser page reported a crash after the menu action.',
        reproductionSteps: ['1. Replay action: open-menu', '2. Replay action: confirm'],
        recoveryAttempts: [{ attemptId: 'recovery-001', recovered: false }],
        occurrence: 'new',
        summary: 'CRITICAL crash: Crash issue detected in Main Menu after open-menu. 92% confidence.',
        timeline: [
          { step: 'action_before_issue', label: 'Action before issue', summary: 'open-menu' },
          { step: 'issue_detected', label: 'Issue detected', summary: 'Crash issue detected' }
        ],
        whyFlagged: {
          detectorName: 'CrashDetector',
          detectorRule: 'The page or process reported a crash.',
          triggeredData: { status: 'crashed' }
        },
        whatToCheckNext: [
          'Open screenshot: /runs/session-filter-test/bots/ui-tester-bot-001/screenshots/issue.png',
          'Inspect raw state in this log entry.',
          'Export a GitHub issue when the evidence looks good.'
        ]
      }
    }
  },
  {
    source: 'instance',
    instanceId: 'game-instance-001',
    eventType: 'instance_start',
    timestamp: '2026-07-13T10:01:05.000Z',
    summary: 'Adapter launch started.',
    raw: { eventId: 'instance-start', level: 'info' }
  },
  {
    source: 'bot-states',
    botId: 'ui-tester-bot-001',
    eventType: 'state_snapshot',
    timestamp: '2026-07-13T10:01:06.000Z',
    summary: 'State snapshot captured.',
    raw: { eventId: 'state-snapshot', scene: 'Main Menu', level: 'info' }
  }
];

function render(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  mountedRoots.push(root);
  mountedContainers.push(container);

  return container;
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }
  }

  throw lastError;
}

function installGameplaySimulatorApi(
  sessions: PersistedSessionMetadata[] = [testSession],
  logsBySession: Record<string, StructuredLogItem[]> = {
    [testSession.sessionId]: structuredLogs
  }
) {
  Object.defineProperty(window, 'gameplaySimulator', {
    configurable: true,
    value: {
      simulation: {
        listSessions: vi.fn(async () => sessions),
        reloadSessions: vi.fn(async () => sessions),
        getStructuredLogs: vi.fn(async (sessionId: string) => ({
          sessionId,
          logs: logsBySession[sessionId] ?? []
        }))
      }
    } as unknown as Window['gameplaySimulator']
  });
}

function selectValue(container: HTMLElement, selector: string, value: string) {
  const select = container.querySelector(selector);

  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Missing select ${selector}`);
  }

  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function setSearch(container: HTMLElement, value: string) {
  const input = container.querySelector('#log-search');

  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Missing log search input.');
  }

  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  act(() => {
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function clickButtonWithText(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text)
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button ${text}`);
  }

  act(() => {
    button.click();
  });
}

function clickLogRowWithText(container: HTMLElement, text: string) {
  const row = Array.from(container.querySelectorAll('.log-list-row')).find((item) =>
    item.textContent?.includes(text)
  );

  if (!(row instanceof HTMLButtonElement)) {
    throw new Error(`Missing log row ${text}`);
  }

  act(() => {
    row.click();
  });
}

function rowTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.log-list-row')).map((row) => row.textContent ?? '');
}

function detailText(container: HTMLElement): string {
  return container.querySelector('.detail-surface')?.textContent ?? '';
}

async function renderLogsPage() {
  const container = render(<LogsPage />);

  await waitFor(() => {
    expect(container.textContent).toContain('Session started.');
  });

  return container;
}

beforeEach(() => {
  installGameplaySimulatorApi();
  useSessionStore.setState({
    activeSessionId: testSession.sessionId,
    status: 'running',
    statusLabel: 'Running session-filter-test',
    lastSnapshot: null,
    botStatuses: [],
    instanceStatuses: [],
    issues: [],
    logs: [],
    coverage: null,
    reviewedIssueIds: [],
    falsePositiveIssueIds: []
  });
  useConfigStore.setState({
    currentPage: 'logs'
  });
});

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => {
      root.unmount();
    });
  }

  mountedRoots.length = 0;
  mountedContainers.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('LogsPage filters', () => {
  it('uses the source filter for the list and detail pane', async () => {
    const container = await renderLogsPage();

    selectValue(container, '#log-source-filter', 'bot-actions');

    await waitFor(() => {
      const rows = rowTexts(container);

      expect(rows).toHaveLength(2);
      expect(rows.join(' ')).toContain('Action one succeeded.');
      expect(rows.join(' ')).toContain('Action two succeeded.');
      expect(rows.join(' ')).not.toContain('Crash issue detected.');
      expect(detailText(container)).toContain('Action one succeeded.');
      expect(detailText(container)).toContain('Action Decision');
      expect(detailText(container)).toContain('UI Tester chose open-menu because it matched UI profile rules.');
      expect(detailText(container)).toContain('planned');
      expect(detailText(container)).toContain('84.2');
      expect(detailText(container)).toContain('close-menu');
      expect(container.textContent).toContain('Source: Bot actions');
      expect(container.textContent).toContain('2 matching');
    });
  });

  it('uses the event type filter for the list and detail pane', async () => {
    const container = await renderLogsPage();

    selectValue(container, '#log-event-type-filter', 'issue_detected');

    await waitFor(() => {
      const rows = rowTexts(container);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('Crash issue detected.');
      expect(detailText(container)).toContain('Crash issue detected.');
      expect(detailText(container)).not.toContain('Session started.');
      expect(detailText(container)).toContain('Issue Diagnosis');
      expect(detailText(container)).toContain('Why This Was Flagged');
      expect(detailText(container)).toContain('CrashDetector');
      expect(detailText(container)).toContain('What To Check Next');
      expect(container.textContent).toContain('Event: issue_detected');
      expect(container.textContent).toContain('1 matching');
    });
  });

  it('links issue logs to the Issues page detail selection', async () => {
    const container = await renderLogsPage();

    selectValue(container, '#log-event-type-filter', 'issue_detected');

    await waitFor(() => {
      expect(detailText(container)).toContain('Issue Diagnosis');
    });

    clickButtonWithText(container, 'Open in Issues');

    expect(useConfigStore.getState().currentPage).toBe('issues');
    expect(useSessionStore.getState().reviewSessionId).toBe(testSession.sessionId);
    expect(useSessionStore.getState().reviewIssueId).toBe('issue-crash');
  });

  it('replaces a selected hidden detail with the first matching log', async () => {
    const container = await renderLogsPage();

    clickButtonWithText(container, 'Clear Filters');
    await waitFor(() => {
      expect(rowTexts(container)).toHaveLength(structuredLogs.length);
    });
    clickLogRowWithText(container, 'Action two succeeded.');
    expect(detailText(container)).toContain('Action two succeeded.');

    selectValue(container, '#log-event-type-filter', 'issue_detected');

    await waitFor(() => {
      expect(rowTexts(container)).toHaveLength(1);
      expect(detailText(container)).toContain('Crash issue detected.');
      expect(detailText(container)).not.toContain('Action two succeeded.');
    });
  });

  it('shows an empty state when filters match nothing', async () => {
    const container = await renderLogsPage();

    setSearch(container, 'not-present-in-any-log');

    await waitFor(() => {
      expect(rowTexts(container)).toHaveLength(0);
      expect(container.textContent).toContain('No matching log entries');
      expect(container.textContent).toContain('No log selected');
      expect(container.textContent).toContain('Search: not-present-in-any-log');
      expect(container.textContent).toContain('0 matching');
    });
  });

  it('clearing filters restores the full raw log list', async () => {
    const container = await renderLogsPage();

    setSearch(container, 'crash');
    await waitFor(() => {
      expect(rowTexts(container)).toHaveLength(1);
    });

    clickButtonWithText(container, 'Clear Filters');

    await waitFor(() => {
      expect(rowTexts(container)).toHaveLength(structuredLogs.length);
      expect(container.textContent).toContain('No filters');
      expect(container.textContent).toContain(`${structuredLogs.length} matching`);
      expect(detailText(container)).toContain('Session started.');
    });
  });

  it('keeps multiple persisted sessions separate and selects the newest by default', async () => {
    const oldSession: PersistedSessionMetadata = {
      ...testSession,
      sessionId: 'session-hexcraft-old',
      gameName: 'Hexcraft',
      buildId: 'build-44',
      createdAt: '2026-07-12T10:00:00.000Z',
      startedAt: '2026-07-12T10:01:00.000Z',
      stoppedAt: '2026-07-12T10:05:00.000Z',
      status: 'stopped',
      reportPaths: { sessionDirectory: '/runs/session-hexcraft-old' }
    };
    const latestSession: PersistedSessionMetadata = {
      ...testSession,
      sessionId: 'session-hexcraft-latest',
      gameName: 'Hexcraft',
      buildId: 'build-45',
      createdAt: '2026-07-13T10:00:00.000Z',
      reportPaths: { sessionDirectory: '/runs/session-hexcraft-latest' }
    };
    const oldLogs: StructuredLogItem[] = [
      {
        source: 'session',
        eventType: 'session_stop',
        timestamp: '2026-07-12T10:05:00.000Z',
        summary: 'Old Hexcraft session stopped.',
        raw: { eventId: 'old-session-stop', eventType: 'session_stop', level: 'info' }
      }
    ];
    const latestLogs: StructuredLogItem[] = [
      {
        source: 'session',
        eventType: 'session_start',
        timestamp: '2026-07-13T10:01:00.000Z',
        summary: 'Latest Hexcraft session started.',
        raw: { eventId: 'latest-session-start', eventType: 'session_start', level: 'info' }
      }
    ];

    installGameplaySimulatorApi(
      [latestSession, oldSession],
      {
        [latestSession.sessionId]: latestLogs,
        [oldSession.sessionId]: oldLogs
      }
    );
    useSessionStore.setState({ activeSessionId: null, status: 'idle', statusLabel: 'No session running' });

    const container = render(<LogsPage />);

    await waitFor(() => {
      expect(container.textContent).toContain('Latest Hexcraft session started.');
    });

    const selector = container.querySelector('#log-session-filter');

    if (!(selector instanceof HTMLSelectElement)) {
      throw new Error('Missing session selector.');
    }

    expect(Array.from(selector.options).map((option) => option.value)).toEqual([
      latestSession.sessionId,
      oldSession.sessionId
    ]);
    expect(selector.value).toBe(latestSession.sessionId);
    expect(container.textContent).not.toContain('Old Hexcraft session stopped.');

    selectValue(container, '#log-session-filter', oldSession.sessionId);

    await waitFor(() => {
      expect(rowTexts(container)).toHaveLength(1);
      expect(container.textContent).toContain('Old Hexcraft session stopped.');
      expect(container.textContent).not.toContain('Latest Hexcraft session started.');
    });
  });

  it('reports a visible count that matches the filtered rows', async () => {
    const container = await renderLogsPage();

    selectValue(container, '#log-source-filter', 'bot-actions');
    selectValue(container, '#log-event-type-filter', 'action_performed');

    await waitFor(() => {
      const rows = rowTexts(container);

      expect(rows).toHaveLength(2);
      expect(container.textContent).toContain(`${rows.length} matching`);
      expect(container.textContent).toContain(`${structuredLogs.length} saved before filters`);
    });
  });
});
