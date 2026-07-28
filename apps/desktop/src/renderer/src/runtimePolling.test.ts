import { describe, expect, it, vi } from 'vitest';
import { useSessionStore } from './store/sessionStore';
import { pollRuntimeDetails } from './runtimePolling';

describe('runtime polling', () => {
  it('keeps the last valid section when one polling request fails', async () => {
    useSessionStore.setState({
      status: 'running',
      activeSessionId: 'session-poll',
      botStatuses: [{
        botId: 'bot-last-valid',
        profileId: 'ui-tester-bot',
        displayName: 'UI Tester',
        playstyle: 'ui-testing',
        status: 'running',
        currentArea: 'Main menu',
        progressState: 'Testing',
        issueCount: 0
      }],
      issues: [],
      runtimeWarnings: []
    });
    const result = await pollRuntimeDetails({
      getBotStatuses: vi.fn().mockRejectedValue(
        new Error("Error invoking remote method 'simulation:getBotStatuses': Error: adapter busy")
      ),
      getInstanceStatuses: vi.fn().mockResolvedValue([]),
      getIssues: vi.fn().mockResolvedValue([{
        issueId: 'issue-new',
        sessionId: 'session-poll',
        gameInstanceId: 'instance-001',
        botId: 'bot-last-valid',
        severity: 'warning',
        category: 'ui',
        title: 'Menu warning',
        description: 'The menu changed unexpectedly.',
        lastActions: [],
        stateSummary: '{}',
        confidence: 0.7,
        evidencePaths: [],
        actionTimelineIds: [],
        firstSeenAt: '2026-07-29T10:00:00.000Z',
        reproducible: false
      }]),
      getLogs: vi.fn().mockResolvedValue([]),
      getCoverage: vi.fn().mockResolvedValue({
        totalKnown: 0,
        totalTested: 0,
        totalObserved: 0,
        percentage: 0,
        testedContent: [],
        untestedContent: [],
        contentWithIssues: [],
        byBotType: []
      }),
      getLiveObservationState: vi.fn().mockResolvedValue({
        sessionId: 'session-poll',
        badge: 'Running in background',
        observationMode: 'background',
        windowStatus: 'Background',
        message: 'Running',
        canFocusWindow: false
      })
    }, 'session-poll');

    useSessionStore.getState().applyRuntimeDetails(result.details);
    useSessionStore.getState().setRuntimeWarnings(result.warnings);

    expect(useSessionStore.getState().botStatuses[0].botId).toBe('bot-last-valid');
    expect(useSessionStore.getState().issues[0].issueId).toBe('issue-new');
    expect(useSessionStore.getState().status).toBe('running');
    expect(useSessionStore.getState().runtimeWarnings).toEqual(['Bot statuses: adapter busy']);
  });
});
