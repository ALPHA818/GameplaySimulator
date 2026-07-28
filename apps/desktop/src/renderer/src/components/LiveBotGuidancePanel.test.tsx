// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotTestDirective } from '@core/types';
import type { SimulationBotStatus } from '../../../main/services/simulationService';
import { LiveBotGuidancePanel } from './LiveBotGuidancePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot: SimulationBotStatus = {
  botId: 'explorer-001',
  profileId: 'explorer-bot',
  displayName: 'Explorer Bot',
  playstyle: 'exploration',
  status: 'running',
  gameInstanceId: 'instance-001',
  currentGoal: 'Explore the map',
  currentAction: 'move-forward',
  currentArea: 'Forest',
  progressState: 'Exploring',
  issueCount: 0
};

const activeDirective: BotTestDirective = {
  directiveId: 'active-direction',
  sessionId: 'session-001',
  name: 'Test movement',
  description: 'Test movement in the forest.',
  directiveType: 'feature',
  directiveMode: 'focus',
  priority: 'normal',
  status: 'active',
  target: { allBots: false, botIds: ['explorer-001'], profileIds: [], gameInstanceIds: [] },
  actionKeywords: ['move'],
  avoidedActionKeywords: [],
  targetFeature: 'movement',
  successConditions: ['Movement succeeds.'],
  failureConditions: [],
  steps: [],
  maxActions: 20,
  maxAttempts: 3,
  repeatUntilSuccess: false,
  createdAt: '2026-07-22T10:00:00.000Z',
  activatedAt: '2026-07-22T10:00:01.000Z',
  createdBy: 'user-live-session'
};

let container: HTMLDivElement;
let root: Root;

function setControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('LiveBotGuidancePanel', () => {
  it('opens a responsive beginner panel with all live direction fields and quick actions', () => {
    act(() => {
      root.render(
        <LiveBotGuidancePanel
          sessionId="session-001"
          selectedBot={bot}
          currentGoal="Explore the map"
          currentDirective={activeDirective}
          currentProgress={{
            directiveId: activeDirective.directiveId,
            botId: bot.botId,
            instanceId: 'instance-001',
            status: 'active',
            actionsAttempted: 4,
            attempts: 1,
            matchedActions: ['move-forward'],
            updatedAt: '2026-07-22T10:00:02.000Z'
          }}
          queuedDirectives={[
            {
              directive: {
                ...activeDirective,
                directiveId: 'queued-direction',
                name: 'Test inventory later',
                status: 'queued'
              },
              progress: {
                directiveId: 'queued-direction',
                botId: bot.botId,
                instanceId: 'instance-001',
                status: 'queued',
                actionsAttempted: 0,
                attempts: 0,
                matchedActions: [],
                updatedAt: '2026-07-22T10:00:02.000Z'
              }
            }
          ]}
          availableActions={[
            { actionType: 'move-forward', label: 'Move Forward' },
            { actionType: 'open-menu', label: 'Open Menu' }
          ]}
          currentArea="Forest"
          onMutation={() => undefined}
        />
      );
    });

    const guideButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Guide This Bot')
    );
    act(() => guideButton?.click());

    for (const text of [
      'Selected Bot',
      'Current Bot Goal',
      'Current Action',
      'Current Directive',
      'New Test Direction',
      'Direction Mode',
      'Priority',
      'Exact Available Action',
      'Feature Or Area',
      'Success Condition',
      'Attempt Limit',
      'Apply Direction',
      'Queue For Later',
      'Replace Current Direction',
      'Cancel Current Direction',
      'Test current menu',
      'Test inventory',
      'Repeat last action',
      'Return to normal behavior',
      'Directive Queue'
    ]) {
      expect(container.textContent).toContain(text);
    }
    expect(container.textContent).toContain('Test inventory later');
    expect(container.textContent).toContain('20 remaining');
    for (const label of [
      'Selected Bot',
      'Current Bot Goal',
      'Current Action',
      'Current Directive',
      'New Test Direction',
      'Direction Mode',
      'Priority',
      'Exact Available Action',
      'Feature Or Area',
      'Success Condition',
      'Attempt Limit',
      'Directive Queue'
    ]) {
      expect(document.querySelector(`[aria-label="Help for ${label}"]`)).not.toBeNull();
    }
  });

  it('submits force mode using only an action from the adapter-provided dropdown', async () => {
    const guideBot = vi.fn(async (request: { directive: BotTestDirective }) => ({
      snapshot: {
        sessionId: 'session-001',
        directives: [{ ...request.directive, status: 'active' as const }],
        progress: [],
        events: []
      },
      message: 'explorer-001 changed direction.',
      activeDirectiveId: request.directive.directiveId
    }));
    Object.defineProperty(window, 'gameplaySimulator', {
      configurable: true,
      value: { simulation: { guideBot } }
    });
    const onMutation = vi.fn();

    act(() => {
      root.render(
        <LiveBotGuidancePanel
          sessionId="session-001"
          selectedBot={bot}
          currentGoal="Explore the map"
          queuedDirectives={[]}
          availableActions={[
            { actionType: 'move-forward', label: 'Move Forward' },
            { actionType: 'open-menu', label: 'Open Menu' }
          ]}
          onMutation={onMutation}
        />
      );
    });
    act(() => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Guide This Bot')
      )?.click();
    });

    const mode = container.querySelector('select[name="liveDirectionMode"]') as HTMLSelectElement;
    const action = container.querySelector('select[name="liveExactAction"]') as HTMLSelectElement;
    const direction = container.querySelector('textarea[name="liveTestDirection"]') as HTMLTextAreaElement;
    const success = container.querySelector('textarea[name="liveSuccessCondition"]') as HTMLTextAreaElement;

    act(() => {
      mode.value = 'force-next-valid-action';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(Array.from(action.options).map((option) => option.value)).toEqual([
      '',
      'move-forward',
      'open-menu'
    ]);
    expect(Array.from(action.options).some((option) => option.value === 'imaginary-action')).toBe(false);

    act(() => {
      action.value = 'open-menu';
      action.dispatchEvent(new Event('change', { bubbles: true }));
      setControlValue(direction, 'Open the menu now.');
      setControlValue(success, 'The menu opens.');
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Apply Direction')
      )?.click();
      await Promise.resolve();
    });

    expect(guideBot).toHaveBeenCalledOnce();
    expect(guideBot.mock.calls[0][0]).toMatchObject({
      sessionId: 'session-001',
      botId: 'explorer-001',
      behavior: 'apply',
      directive: {
        directiveMode: 'force-next-valid-action',
        directiveType: 'action',
        actionKeywords: ['open-menu']
      }
    });
    expect(onMutation).toHaveBeenCalledOnce();
  });

  it('creates, queues, and replaces directives without restarting the bot', async () => {
    const guideBot = vi.fn(async (request: {
      behavior: 'apply' | 'queue' | 'replace';
      directive: BotTestDirective;
    }) => ({
      snapshot: {
        sessionId: 'session-001',
        directives: [request.directive],
        progress: [],
        events: []
      },
      message: `${request.behavior} completed.`,
      activeDirectiveId: request.directive.directiveId
    }));
    Object.defineProperty(window, 'gameplaySimulator', {
      configurable: true,
      value: { simulation: { guideBot } }
    });
    const onMutation = vi.fn();

    act(() => {
      root.render(
        <LiveBotGuidancePanel
          sessionId="session-001"
          selectedBot={bot}
          currentGoal="Explore the map"
          currentDirective={activeDirective}
          queuedDirectives={[]}
          availableActions={[{ actionType: 'move-forward', label: 'Move Forward' }]}
          currentArea="Forest"
          onMutation={onMutation}
        />
      );
    });
    act(() => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Guide This Bot')
      )?.click();
    });

    for (const behavior of [
      { quick: 'Test movement', command: 'Apply Direction', expected: 'apply' },
      { quick: 'Test inventory', command: 'Queue For Later', expected: 'queue' },
      { quick: 'Test current menu', command: 'Replace Current Direction', expected: 'replace' }
    ]) {
      act(() => {
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent?.trim() === behavior.quick
        )?.click();
      });
      await act(async () => {
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent?.trim() === behavior.command
        )?.click();
        await Promise.resolve();
      });
    }

    expect(guideBot.mock.calls.map(([request]) => request.behavior)).toEqual([
      'apply',
      'queue',
      'replace'
    ]);
    expect(onMutation).toHaveBeenCalledTimes(3);
  });

  it('cancels the current directive and returns the bot to normal behavior', async () => {
    const cancelBotDirective = vi.fn(async () => ({
      snapshot: {
        sessionId: 'session-001',
        directives: [{ ...activeDirective, status: 'cancelled' as const }],
        progress: [],
        events: []
      },
      message: 'Normal profile behavior restored.'
    }));
    Object.defineProperty(window, 'gameplaySimulator', {
      configurable: true,
      value: { simulation: { cancelBotDirective } }
    });
    const onMutation = vi.fn();

    act(() => {
      root.render(
        <LiveBotGuidancePanel
          sessionId="session-001"
          selectedBot={bot}
          currentGoal="Explore the map"
          currentDirective={activeDirective}
          queuedDirectives={[]}
          availableActions={[]}
          onMutation={onMutation}
        />
      );
    });
    act(() => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Guide This Bot')
      )?.click();
    });

    for (const command of ['Cancel Current Direction', 'Return to normal behavior']) {
      await act(async () => {
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent?.trim() === command
        )?.click();
        await Promise.resolve();
      });
    }

    expect(cancelBotDirective).toHaveBeenCalledTimes(2);
    expect(cancelBotDirective).toHaveBeenNthCalledWith(
      1,
      'session-001',
      'explorer-001',
      'active-direction'
    );
    expect(onMutation).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Normal profile behavior restored.');
  });

  it('lets the user confirm an active directive that requires manual review', async () => {
    const manualDirective = {
      ...activeDirective,
      manualSuccessConfirmation: true
    };
    const confirmBotDirectiveSuccess = vi.fn(async () => ({
      snapshot: {
        sessionId: 'session-001',
        directives: [{ ...manualDirective, status: 'succeeded' as const }],
        progress: [],
        events: []
      },
      message: 'Test movement was confirmed.'
    }));
    Object.defineProperty(window, 'gameplaySimulator', {
      configurable: true,
      value: { simulation: { confirmBotDirectiveSuccess } }
    });
    const onMutation = vi.fn();

    act(() => {
      root.render(
        <LiveBotGuidancePanel
          sessionId="session-001"
          selectedBot={bot}
          currentGoal="Explore the map"
          currentDirective={manualDirective}
          currentProgress={{
            directiveId: manualDirective.directiveId,
            botId: bot.botId,
            instanceId: 'instance-001',
            status: 'active',
            actionsAttempted: 2,
            attempts: 1,
            matchedActions: ['move-forward'],
            updatedAt: '2026-07-22T10:00:02.000Z'
          }}
          queuedDirectives={[]}
          availableActions={[]}
          onMutation={onMutation}
        />
      );
    });
    act(() => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Guide This Bot')
      )?.click();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Confirm Direction Succeeded'
      )?.click();
      await Promise.resolve();
    });

    expect(confirmBotDirectiveSuccess).toHaveBeenCalledWith(
      'session-001',
      'explorer-001',
      'active-direction'
    );
    expect(onMutation).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Test movement was confirmed.');
  });

  it('updates directive progress displayed in the live queue', () => {
    const renderProgress = (actionsAttempted: number, progressMessage: string) => {
      act(() => {
        root.render(
          <LiveBotGuidancePanel
            sessionId="session-001"
            selectedBot={bot}
            currentGoal="Explore the map"
            currentDirective={activeDirective}
            currentProgress={{
              directiveId: activeDirective.directiveId,
              botId: bot.botId,
              instanceId: 'instance-001',
              status: 'active',
              actionsAttempted,
              attempts: 1,
              matchedActions: ['move-forward'],
              progressMessage,
              updatedAt: '2026-07-22T10:00:02.000Z'
            }}
            queuedDirectives={[]}
            availableActions={[]}
            onMutation={() => undefined}
          />
        );
      });
    };

    renderProgress(4, 'Reached the first path.');
    act(() => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Guide This Bot')
      )?.click();
    });
    expect(container.textContent).toContain('20% progress');
    expect(container.textContent).toContain('16 remaining');

    renderProgress(10, 'Reached the second path.');
    expect(container.textContent).toContain('50% progress');
    expect(container.textContent).toContain('10 remaining');
  });
});
