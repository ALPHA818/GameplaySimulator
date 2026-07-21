// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  clickBrowserDomTarget,
  mergeBrowserUIStates,
  normalizeBrowserUIState,
  scanBrowserDom
} from './BrowserUIAwareness';

afterEach(() => {
  document.body.innerHTML = '';
});

function installDom(html: string): void {
  document.body.innerHTML = html;
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: 60,
      height: 40,
      left: 20,
      right: 140,
      top: 20,
      width: 120,
      x: 20,
      y: 20,
      toJSON: () => ({})
    })
  });
}

describe('browser UI awareness', () => {
  it('normalizes simple hook values and merges optional DOM clues', () => {
    const hook = normalizeBrowserUIState({
      screenId: 'main-menu',
      focusedElementId: 'play-button',
      visibleButtons: ['Play Game']
    }, 'hook');
    const dom = normalizeBrowserUIState({
      currentScreen: 'guessed-menu',
      visibleButtons: [{ label: 'Settings', selector: '#settings' }],
      canStartGame: true
    }, 'dom');
    const merged = mergeBrowserUIStates(hook, dom, 'merged');

    expect(merged).toMatchObject({
      currentScreen: 'main-menu',
      focusedElement: 'play-button',
      canStartGame: true,
      source: 'merged'
    });
    expect(merged?.visibleButtons.map((button) => button.label)).toEqual(['Play Game', 'Settings']);
  });

  it('detects a main menu, visible controls, dialogs, and canvas from the DOM', () => {
    installDom(`
      <h1>Main Menu</h1>
      <button id="play-game">Play Game</button>
      <button aria-label="Settings"></button>
      <dialog open aria-label="Welcome dialog">Welcome</dialog>
      <canvas id="game"></canvas>
    `);

    const state = normalizeBrowserUIState(scanBrowserDom(), 'dom');

    expect(state).toMatchObject({
      currentScreen: 'main-menu',
      canStartGame: true,
      isInGameplay: false,
      source: 'dom'
    });
    expect(state?.visibleButtons.map((button) => button.label)).toEqual(['Play Game', 'Settings']);
    expect(state?.modalStack).toContain('Welcome dialog');
    expect(state?.dom).toMatchObject({ headings: ['Main Menu'], hasCanvas: true, canvasCount: 1 });
  });

  it('clicks a visible control by its hook or DOM label', () => {
    installDom('<button id="create-world">Create World</button>');
    let clicks = 0;
    document.querySelector('#create-world')?.addEventListener('click', () => {
      clicks += 1;
    });

    const result = clickBrowserDomTarget({ label: 'Create World' });

    expect(result.succeeded).toBe(true);
    expect(result.message).toContain('Create World');
    expect(clicks).toBe(1);
  });
});
