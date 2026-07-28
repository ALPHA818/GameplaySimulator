// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedIssue } from '@core/types';
import { useSessionStore } from '../store/sessionStore';
import { IssuesPage } from './IssuesPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const issue: DetectedIssue = {
  issueId: 'issue-inventory-001',
  id: 'issue-inventory-001',
  sessionId: 'old-session',
  botId: 'inventory-stress-tester-001',
  gameInstanceId: 'instance-001',
  timestamp: '2026-07-22T10:00:00.000Z',
  firstSeenAt: '2026-07-22T10:00:00.000Z',
  severity: 'error',
  category: 'inventory',
  title: 'Item disappeared after sorting',
  description: 'An item vanished after the inventory was sorted.',
  scene: 'Inventory',
  area: 'Backpack',
  lastActions: ['open-inventory', 'sort-items'],
  stateSummary: 'The sword count changed from 1 to 0.',
  expectedBehavior: 'Sorting keeps every item.',
  actualBehavior: 'The sword disappeared.',
  confidence: 0.9,
  screenshotPath: '/runs/old-session/item-missing.png',
  rawEvidence: {},
  evidencePaths: ['/runs/old-session/item-missing.png'],
  actionTimelineIds: [],
  reproducible: false
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  useSessionStore.setState({
    status: 'running',
    statusLabel: 'Running',
    activeSessionId: 'active-session',
    botStatuses: [
      {
        botId: 'inventory-stress-tester-001',
        profileId: 'inventory-stress-tester-bot',
        displayName: 'Inventory Stress Tester',
        playstyle: 'inventory_stress_tester',
        gameInstanceId: 'instance-001',
        status: 'running',
        currentArea: 'Backpack',
        progressState: 'Running',
        issueCount: 0,
        lastActionId: 'action-sort-items',
        message: 'Running'
      }
    ],
    issues: [issue],
    reviewSessionId: 'active-session',
    reviewIssueId: issue.issueId
  });

  const guideBot = vi.fn(async (payload) => ({
    snapshot: { sessionId: payload.sessionId, directives: [payload.directive], progress: [], events: [] },
    message: 'Direction queued.',
    activeDirectiveId: undefined
  }));
  Object.defineProperty(window, 'gameplaySimulator', {
    configurable: true,
    value: {
      simulation: {
        listSessions: vi.fn(async () => []),
        getIssues: vi.fn(async () => [issue]),
        guideBot,
        openEvidence: vi.fn(async () => ({ opened: true }))
      }
    }
  });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe('Issues page directive retest', () => {
  it('queues an issue-reproduction directive with issue context and accessible field help', async () => {
    await act(async () => {
      root?.render(<IssuesPage />);
    });

    const retestButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Ask Bot To Retest'
    );
    expect(retestButton).toBeInstanceOf(HTMLButtonElement);
    expect(container?.querySelector('#issue-retest-bot')).toBeInstanceOf(HTMLSelectElement);
    expect(container?.querySelector('[aria-label="Help for Retest Bot"]')).toBeTruthy();

    await act(async () => {
      (retestButton as HTMLButtonElement).click();
    });

    const guideBot = window.gameplaySimulator.simulation.guideBot as ReturnType<typeof vi.fn>;
    expect(guideBot).toHaveBeenCalledOnce();
    expect(guideBot.mock.calls[0][0]).toMatchObject({
      sessionId: 'active-session',
      botId: 'inventory-stress-tester-001',
      behavior: 'queue',
      directive: {
        directiveType: 'issue-reproduction',
        directiveMode: 'focus',
        priority: 'high',
        targetIssueId: 'issue-inventory-001',
        targetArea: 'Backpack',
        actionKeywords: ['open-inventory', 'sort-items']
      }
    });
    expect(container?.textContent).toContain('Direction queued.');
  });
});
