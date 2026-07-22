// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderBrowserActionIndicator,
  setBrowserActionIndicatorsHidden
} from './BrowserActionIndicator';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('browser action indicator', () => {
  it('renders marked, non-interactive action details and a click marker', () => {
    renderBrowserActionIndicator({
      actionId: 'choose-create-game-001',
      actionName: 'choose-create-game',
      botId: 'ui-tester-bot-001',
      botName: 'UI Tester Bot',
      reason: 'Startup flow step 2',
      input: 'Mouse click',
      clickPosition: { x: 120, y: 240 }
    });

    const root = document.querySelector<HTMLElement>('#gameplay-simulator-action-indicator');
    const overlayElements = [...document.querySelectorAll<HTMLElement>('[data-gameplay-simulator-overlay]')];

    expect(root?.textContent).toContain('UI Tester Bot');
    expect(root?.textContent).toContain('Action: choose-create-game');
    expect(root?.textContent).toContain('Input: Mouse click');
    expect(root?.textContent).toContain('Reason: Startup flow step 2');
    expect(overlayElements.length).toBeGreaterThan(4);
    expect(overlayElements.every((element) => element.style.pointerEvents === 'none')).toBe(true);
    expect(overlayElements.some((element) => element.style.left === '120px' && element.style.top === '240px')).toBe(true);
  });

  it('can be hidden for evidence and restores its previous visibility', () => {
    renderBrowserActionIndicator({
      actionId: 'jump-001',
      actionName: 'jump',
      botId: 'explorer-001',
      botName: 'Explorer Bot',
      reason: 'The action may reveal a new path.',
      input: 'Keyboard input',
      key: 'Space'
    });

    setBrowserActionIndicatorsHidden(true);
    const overlays = [...document.querySelectorAll<HTMLElement>('[data-gameplay-simulator-overlay]')];
    expect(overlays.every((element) => element.style.visibility === 'hidden')).toBe(true);

    setBrowserActionIndicatorsHidden(false);
    expect(overlays.every((element) => element.style.visibility === '')).toBe(true);
  });

  it('removes the indicator after a short bounded duration', () => {
    vi.useFakeTimers();
    renderBrowserActionIndicator({
      actionId: 'wait-001',
      actionName: 'wait',
      botId: 'idle-player-bot-001',
      botName: 'Idle Player Bot',
      reason: 'The bot is checking timer behavior.',
      durationMs: 600
    });

    vi.advanceTimersByTime(599);
    expect(document.querySelector('#gameplay-simulator-action-indicator')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.querySelector('#gameplay-simulator-action-indicator')).toBeNull();
  });
});
