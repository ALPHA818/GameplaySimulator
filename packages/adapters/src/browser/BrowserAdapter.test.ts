import type { ControlBinding, GameAction, GameInstanceConfig } from '@core/types';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BrowserAdapter } from './BrowserAdapter';

type Listener = (...args: any[]) => void;

class FakeConsoleMessage {
  constructor(private readonly kind: string, private readonly body: string) {}

  type() {
    return this.kind;
  }

  text() {
    return this.body;
  }

  location() {
    return { url: 'http://localhost/game', lineNumber: 1, columnNumber: 2 };
  }
}

class FakePage {
  readonly keyboard = {
    pressed: [] as string[],
    press: async (key: string) => {
      this.keyboard.pressed.push(key);
    }
  };
  readonly mouse = {
    clicked: [] as Array<{ x: number; y: number; button?: string }>,
    click: async (x: number, y: number, options?: { button?: string }) => {
      this.mouse.clicked.push({ x, y, button: options?.button });
    }
  };
  readonly listeners = new Map<string, Listener[]>();
  closed = false;
  crashed = false;
  currentUrl = '';
  titleText = 'Browser Test Game';
  state: Record<string, unknown> | null = null;
  uiState: Record<string, unknown> | null = null;
  domState: Record<string, unknown> | null = null;
  actions: Array<Record<string, unknown>> | null = null;
  performedActions: string[] = [];
  clickedDomTargets: string[] = [];
  directHookEnabled = true;

  async goto(url: string) {
    this.currentUrl = url;
    this.emit('console', new FakeConsoleMessage('warning', 'asset took a long time to load'));
  }

  url() {
    return this.currentUrl;
  }

  async title() {
    return this.titleText;
  }

  async evaluate<T>(_pageFunction: unknown, arg?: unknown): Promise<T> {
    const source = String(_pageFunction);

    if (source.includes('__GAMEPLAY_SIM_STATE__')) {
      return this.state as T;
    }

    if (source.includes('__GAMEPLAY_SIM_UI_STATE__')) {
      return this.uiState as T;
    }

    if (source.includes('__GAMEPLAY_SIM_DOM_SCAN__')) {
      return this.domState as T;
    }

    if (source.includes('__GAMEPLAY_SIM_DOM_CLICK__')) {
      const target = arg as { label?: string };
      this.clickedDomTargets.push(target.label ?? 'unknown');
      return {
        succeeded: Boolean(target.label),
        message: target.label ? `Clicked visible button "${target.label}".` : 'No target.'
      } as T;
    }

    if (source.includes('__GAMEPLAY_SIM_ACTIONS__')) {
      return this.actions as T;
    }

    if (source.includes('__GAMEPLAY_SIM_PERFORM_ACTION__') && source.includes('typeof')) {
      return this.directHookEnabled as T;
    }

    if (source.includes('__GAMEPLAY_SIM_PERFORM_ACTION__')) {
      const action = arg as GameAction;
      this.performedActions.push(action.type);
      if (this.state) {
        this.state = {
          ...this.state,
          tick: Number(this.state.tick ?? 0) + 1,
          state: {
            ...(this.state.state as Record<string, unknown>),
            lastBrowserAction: action.type
          }
        };
      }
      return { status: 'succeeded', message: `Hook handled ${action.type}.` } as T;
    }

    return null as T;
  }

  async screenshot(options: { path: string }) {
    await mkdir(dirname(options.path), { recursive: true });
    await writeFile(options.path, 'fake browser screenshot');
    return Buffer.from('fake browser screenshot');
  }

  async reload() {
    this.emit('console', new FakeConsoleMessage('log', 'page reloaded'));
  }

  async waitForTimeout(_timeoutMs: number) {}

  async close() {
    this.closed = true;
    this.emit('close');
  }

  isClosed() {
    return this.closed;
  }

  viewportSize() {
    return { width: 1000, height: 800 };
  }

  on(event: 'console', listener: (message: FakeConsoleMessage) => void): void;
  on(event: 'pageerror', listener: (error: Error) => void): void;
  on(event: 'crash' | 'close', listener: () => void): void;
  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

class FakeContext {
  constructor(private readonly page: FakePage) {}

  async newPage() {
    return this.page;
  }

  async close() {}
}

class FakeBrowser {
  closed = false;

  constructor(private readonly page: FakePage) {}

  async newContext() {
    return new FakeContext(this.page);
  }

  async close() {
    this.closed = true;
  }
}

class FakeLauncher {
  readonly page = new FakePage();
  launchOptions: Record<string, unknown> | undefined;
  browser = new FakeBrowser(this.page);

  async launch(options?: Record<string, unknown>) {
    this.launchOptions = options;
    return this.browser;
  }
}

const controls: ControlBinding[] = [
  {
    controlId: 'jump',
    label: 'Jump',
    inputType: 'keyboard',
    binding: 'Space',
    action: 'jump',
    metadata: {}
  },
  {
    controlId: 'attack',
    label: 'Attack',
    inputType: 'mouse',
    binding: 'MouseLeft',
    action: 'attack',
    metadata: {}
  }
];

const instanceConfig: GameInstanceConfig = {
  instanceId: 'browser-instance-001',
  gameProfileId: 'browser-test-game',
  launch: {
    platform: 'browser',
    url: 'http://localhost:5173/game',
    arguments: []
  },
  maxBots: 2,
  environment: {}
};

function action(type: string, payload: Record<string, unknown> = {}): GameAction {
  return {
    actionId: `${type}-001`,
    sessionId: 'browser-session',
    gameInstanceId: instanceConfig.instanceId,
    botId: 'browser-bot-001',
    type,
    payload,
    requestedAt: '2026-07-06T12:00:00.000Z'
  };
}

describe('BrowserAdapter', () => {
  it('launches a browser context, captures console/page errors, and returns basic state', async () => {
    const launcher = new FakeLauncher();
    const adapter = new BrowserAdapter({ browserLauncher: launcher, targetUrl: instanceConfig.launch.url });

    const instance = await adapter.launchInstance(instanceConfig);
    launcher.page.emit('pageerror', new Error('boom'));

    const state = await adapter.getState(instanceConfig.instanceId, 'browser-bot-001');
    const logs = await adapter.captureLogs(instanceConfig.instanceId);
    const health = await adapter.getHealth(instanceConfig.instanceId);

    expect(instance.metadata).toMatchObject({
      browserSpecific: true,
      browserType: 'chromium',
      targetUrl: instanceConfig.launch.url
    });
    expect(launcher.launchOptions).toMatchObject({ headless: true });
    expect(state.state).toMatchObject({
      url: instanceConfig.launch.url,
      title: 'Browser Test Game',
      pageStatus: 'open'
    });
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'warn', message: 'asset took a long time to load' }),
        expect.objectContaining({ level: 'error', message: expect.stringContaining('boom') })
      ])
    );
    expect(health.details).toMatchObject({ consoleWarningCount: 1, pageErrorCount: 1 });
  });

  it('reads instrumented browser state/actions and performs a direct JS hook action', async () => {
    const launcher = new FakeLauncher();
    launcher.page.state = {
      gameId: 'browser-test-game',
      sessionId: 'browser-session',
      instanceId: instanceConfig.instanceId,
      scene: 'Arena',
      tick: 3,
      timestamp: '2026-07-06T12:00:00.000Z',
      playerPosition: { x: 4, y: 5 },
      state: { hp: 10 },
      performance: { fps: 59 }
    };
    launcher.page.actions = [{ actionType: 'dash', label: 'Dash', description: 'Dash forward.' }];
    const adapter = new BrowserAdapter({ browserLauncher: launcher });
    await adapter.launchInstance(instanceConfig);

    const state = await adapter.getState(instanceConfig.instanceId, 'browser-bot-001');
    const actions = await adapter.getAvailableActions(instanceConfig.instanceId, 'browser-bot-001');
    const result = await adapter.performAction(instanceConfig.instanceId, 'browser-bot-001', action('dash'));

    expect(state.scene).toBe('Arena');
    expect(state.metrics.fps).toBe(59);
    expect(state.state).toMatchObject({ hp: 10, playerPosition: { x: 4, y: 5 } });
    expect(actions[0]).toMatchObject({ actionType: 'dash', label: 'Dash' });
    expect(result).toMatchObject({ status: 'succeeded', message: 'Hook handled dash.' });
    expect(launcher.page.performedActions).toContain('dash');
  });

  it('merges the dedicated UI hook into browser game snapshots', async () => {
    const launcher = new FakeLauncher();
    launcher.page.state = {
      gameId: 'browser-test-game',
      instanceId: instanceConfig.instanceId,
      scene: 'Browser Shell',
      state: { hp: 10 }
    };
    launcher.page.uiState = {
      currentScreen: 'create-world',
      openMenus: ['world-settings'],
      focusedElement: 'World Name',
      visibleButtons: ['Create World', { label: 'Back', selector: '#back' }],
      modalStack: ['settings-dialog'],
      canStartGame: true,
      isInGameplay: false,
      isPaused: false,
      isLoading: false
    };
    const adapter = new BrowserAdapter({ browserLauncher: launcher, domScanMode: 'fallback' });
    await adapter.launchInstance(instanceConfig);

    const state = await adapter.getState(instanceConfig.instanceId, 'browser-bot-001');

    expect(state.uiState).toMatchObject({
      currentScreen: 'create-world',
      focusedElement: 'World Name',
      canStartGame: true,
      source: 'hook'
    });
    expect(state.uiState?.visibleButtons.map((button) => button.label)).toEqual(['Create World', 'Back']);
    expect(state.state.uiState).toEqual(state.uiState);
  });

  it('uses bounded DOM clues and visible buttons when custom hooks are missing', async () => {
    const launcher = new FakeLauncher();
    launcher.page.directHookEnabled = false;
    launcher.page.domState = {
      currentScreen: 'main-menu',
      openMenus: ['Main Menu'],
      focusedElement: 'Play Game',
      visibleButtons: [
        { label: 'Play Game', selector: '#play-game', x: 100, y: 60 },
        { label: 'Disabled', selector: '#disabled', disabled: true }
      ],
      modalStack: [],
      canStartGame: true,
      isInGameplay: false,
      isPaused: false,
      isLoading: false,
      dom: {
        headings: ['Main Menu'],
        dialogs: [],
        visibleText: ['Play Game'],
        hasCanvas: true,
        canvasCount: 1,
        scannedAt: '2026-07-21T10:00:00.000Z'
      }
    };
    const adapter = new BrowserAdapter({ browserLauncher: launcher, domScanMode: 'fallback' });
    await adapter.launchInstance(instanceConfig);

    const state = await adapter.getState(instanceConfig.instanceId, 'browser-bot-001');
    const available = await adapter.getAvailableActions(instanceConfig.instanceId, 'browser-bot-001');
    const playAction = available.find((item) => item.label === 'Play Game');
    const result = await adapter.performAction(
      instanceConfig.instanceId,
      'browser-bot-001',
      action(playAction?.actionType ?? 'click-play-game', { adapterPayload: playAction?.payloadSchema })
    );

    expect(state.scene).toBe('main-menu');
    expect(state.uiState).toMatchObject({ source: 'dom', canStartGame: true });
    expect(available.map((item) => item.label)).toContain('Play Game');
    expect(available.map((item) => item.label)).not.toContain('Disabled');
    expect(result).toMatchObject({ status: 'succeeded', message: 'Clicked visible button "Play Game".' });
    expect(launcher.page.clickedDomTargets).toEqual(['Play Game']);
  });

  it('falls back to mapped keyboard/mouse input, reload, wait, screenshot, and clean stop', async () => {
    const launcher = new FakeLauncher();
    const adapter = new BrowserAdapter({
      browserLauncher: launcher,
      controlBindings: controls,
      screenshotDirectory: '/tmp/gameplay-simulator-browser-test'
    });
    await adapter.launchInstance(instanceConfig);
    launcher.page.evaluate = async <T,>() => null as T;

    const available = await adapter.getAvailableActions(instanceConfig.instanceId, 'browser-bot-001');
    const jumpResult = await adapter.performAction(instanceConfig.instanceId, 'browser-bot-001', action('jump'));
    const attackResult = await adapter.performAction(instanceConfig.instanceId, 'browser-bot-001', action('attack'));
    const reloadResult = await adapter.performAction(instanceConfig.instanceId, 'browser-bot-001', action('reload'));
    const waitResult = await adapter.performAction(
      instanceConfig.instanceId,
      'browser-bot-001',
      action('wait', { durationMs: 1 })
    );
    const screenshot = await adapter.captureScreenshot(instanceConfig.instanceId, 'browser-bot-001');

    expect(available.map((item) => item.actionType)).toEqual(['jump', 'attack']);
    expect(jumpResult.status).toBe('succeeded');
    expect(attackResult.status).toBe('succeeded');
    expect(reloadResult.status).toBe('succeeded');
    expect(waitResult.status).toBe('succeeded');
    expect(launcher.page.keyboard.pressed).toContain('Space');
    expect(launcher.page.mouse.clicked[0]).toMatchObject({ x: 500, y: 400, button: 'left' });
    expect(screenshot.path).toContain('/tmp/gameplay-simulator-browser-test');

    await adapter.stopInstance(instanceConfig.instanceId);

    expect(await adapter.isRunning(instanceConfig.instanceId)).toBe(false);
    expect(launcher.page.closed).toBe(true);
    expect(launcher.browser.closed).toBe(true);
  });
});
