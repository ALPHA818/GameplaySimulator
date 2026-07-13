import type { LogEntry } from '@core/logging/LogEntry';
import type { ActionResult, ControlBinding, GameAction, GameInstanceConfig, GameStateSnapshot } from '@core/types';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { BaseGameAdapter } from '../base/BaseGameAdapter';
import type {
  AdapterCapabilities,
  AdapterHealth,
  AvailableGameAction,
  GameAdapterInstance,
  ScreenshotCapture
} from '../base/GameAdapter';

type BrowserActionStatus = ActionResult['status'];
type BrowserKind = 'chromium' | 'firefox' | 'webkit';

interface BrowserConsoleLog {
  type: string;
  text: string;
  timestamp: string;
  location?: unknown;
}

interface BrowserPageError {
  name?: string;
  message: string;
  stack?: string;
  timestamp: string;
}

interface BrowserLike {
  newContext(options?: Record<string, unknown>): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface ConsoleMessageLike {
  type(): string;
  text(): string;
  location?(): unknown;
}

interface KeyboardLike {
  press(key: string): Promise<void>;
}

interface MouseLike {
  click(x: number, y: number, options?: { button?: 'left' | 'middle' | 'right' }): Promise<void>;
}

interface PageLike {
  keyboard: KeyboardLike;
  mouse: MouseLike;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  evaluate<T>(pageFunction: string | ((arg: any) => T | Promise<T>), arg?: unknown): Promise<T>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<Buffer>;
  reload(options?: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
  isClosed(): boolean;
  viewportSize?(): { width: number; height: number } | null;
  on(event: 'console', listener: (message: ConsoleMessageLike) => void): void;
  on(event: 'pageerror', listener: (error: Error) => void): void;
  on(event: 'crash' | 'close', listener: () => void): void;
}

interface BrowserLauncherLike {
  launch(options?: Record<string, unknown>): Promise<BrowserLike>;
}

interface BrowserRuntime {
  browser: BrowserLike;
  context: BrowserContextLike;
  page: PageLike;
  consoleLogs: BrowserConsoleLog[];
  pageErrors: BrowserPageError[];
  crashed: boolean;
  closed: boolean;
  lastScreenshotPath?: string;
  lastAction?: {
    actionId: string;
    type: string;
    status: BrowserActionStatus;
    message?: string;
    performedAt: string;
  };
  openedAt: string;
  lastHeartbeatAt?: string;
}

export interface BrowserAdapterOptions {
  id?: string;
  name?: string;
  browserName?: string;
  targetUrl?: string;
  controlBindings?: ControlBinding[];
  screenshotDirectory?: string;
  headless?: boolean;
  contextOptions?: Record<string, unknown>;
  launchOptions?: Record<string, unknown>;
  browserLauncher?: BrowserLauncherLike;
  capabilities?: Partial<AdapterCapabilities>;
}

function now(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function normalizeKeyboardBinding(binding: string): string {
  const normalized = binding.trim().toLowerCase().replace(/\s+/g, '');
  const aliases: Record<string, string> = {
    ' ': 'Space',
    space: 'Space',
    spacebar: 'Space',
    esc: 'Escape',
    escape: 'Escape',
    enter: 'Enter',
    return: 'Enter',
    arrowup: 'ArrowUp',
    up: 'ArrowUp',
    arrowdown: 'ArrowDown',
    down: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    left: 'ArrowLeft',
    arrowright: 'ArrowRight',
    right: 'ArrowRight',
    mouseleft: 'MouseLeft',
    mouseright: 'MouseRight',
    mousemiddle: 'MouseMiddle'
  };

  return aliases[normalized] ?? (binding.length === 1 ? binding.toUpperCase() : binding);
}

function bindingIsMouse(binding: string | undefined): boolean {
  return ['mouseleft', 'mouseright', 'mousemiddle', 'mouse-left', 'mouse-right', 'mouse-middle'].includes(
    binding?.trim().toLowerCase() ?? ''
  );
}

function buttonForBinding(binding: string | undefined): 'left' | 'middle' | 'right' {
  const normalized = binding?.trim().toLowerCase() ?? '';

  if (normalized.includes('right')) {
    return 'right';
  }

  if (normalized.includes('middle')) {
    return 'middle';
  }

  return 'left';
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numericMetricsFrom(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  );
}

function normalizeBrowserKind(value: string | undefined): BrowserKind {
  const normalized = normalize(value);

  if (normalized === 'firefox') {
    return 'firefox';
  }

  if (normalized === 'webkit' || normalized === 'safari') {
    return 'webkit';
  }

  return 'chromium';
}

function defaultLauncher(kind: BrowserKind): BrowserLauncherLike {
  if (kind === 'firefox') {
    return firefox;
  }

  if (kind === 'webkit') {
    return webkit;
  }

  return chromium;
}

function consoleLogLevel(type: string): LogEntry['level'] {
  if (type === 'error') {
    return 'error';
  }

  if (type === 'warning' || type === 'warn') {
    return 'warn';
  }

  if (type === 'debug') {
    return 'debug';
  }

  return 'info';
}

function coerceAvailableAction(value: unknown): AvailableGameAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const actionType = typeof value.actionType === 'string' ? value.actionType : undefined;
  const type = typeof value.type === 'string' ? value.type : undefined;
  const label = typeof value.label === 'string' ? value.label : actionType ?? type;

  if (!actionType && !type) {
    return null;
  }

  return {
    actionType: actionType ?? type!,
    label: label ?? actionType ?? type!,
    description: typeof value.description === 'string' ? value.description : undefined,
    requiresStateRead: Boolean(value.requiresStateRead),
    requiresDirectAction: Boolean(value.requiresDirectAction ?? true),
    requiresInputSimulation: Boolean(value.requiresInputSimulation),
    payloadSchema: isRecord(value.payloadSchema) ? value.payloadSchema : undefined
  };
}

function actionResultFromHook(value: unknown, action: GameAction, botId: string, startedAt: string): ActionResult {
  const completedAt = now();

  if (isRecord(value)) {
    const status =
      value.status === 'succeeded' ||
      value.status === 'failed' ||
      value.status === 'skipped' ||
      value.status === 'timed_out'
        ? value.status
        : 'succeeded';

    return {
      actionId: action.actionId,
      botId,
      status,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      message: typeof value.message === 'string' ? value.message : 'Browser JS action hook completed.',
      stateSnapshotId: typeof value.stateSnapshotId === 'string' ? value.stateSnapshotId : undefined,
      issueIds: Array.isArray(value.issueIds) ? value.issueIds.map(String) : []
    };
  }

  return {
    actionId: action.actionId,
    botId,
    status: 'succeeded',
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    message: 'Browser JS action hook completed.',
    issueIds: []
  };
}

export class BrowserAdapter extends BaseGameAdapter {
  readonly browserName?: string;
  readonly targetUrl?: string;
  private readonly browserKind: BrowserKind;
  private readonly browserLauncher: BrowserLauncherLike;
  private readonly controlBindings: ControlBinding[];
  private readonly screenshotDirectory: string;
  private readonly headless: boolean;
  private readonly contextOptions: Record<string, unknown>;
  private readonly launchOptions: Record<string, unknown>;
  private readonly browserInstances = new Map<string, BrowserRuntime>();

  constructor(options: BrowserAdapterOptions = {}) {
    super({
      id: options.id ?? 'browser',
      name: options.name ?? 'Browser Adapter',
      adapterType: 'browser',
      capabilities: {
        supportsMultipleInstances: true,
        supportsMultipleBotsPerInstance: true,
        supportsStateRead: true,
        supportsDirectActions: true,
        supportsInputSimulation: true,
        supportsScreenshots: true,
        supportsVideo: false,
        supportsGameLogs: true,
        supportsSaveIsolation: true,
        supportsReset: true,
        supportsCheckpointReload: false,
        ...options.capabilities
      }
    });

    this.browserName = options.browserName;
    this.targetUrl = options.targetUrl;
    this.browserKind = normalizeBrowserKind(options.browserName);
    this.browserLauncher = options.browserLauncher ?? defaultLauncher(this.browserKind);
    this.controlBindings = options.controlBindings ?? [];
    this.screenshotDirectory = options.screenshotDirectory ?? join(process.cwd(), 'runs', 'browser-screenshots');
    this.headless = options.headless ?? true;
    this.contextOptions = options.contextOptions ?? {};
    this.launchOptions = options.launchOptions ?? {};
  }

  override async launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance> {
    const targetUrl = config.launch.url ?? this.targetUrl;

    if (!targetUrl) {
      throw new Error('BrowserAdapter requires a URL to launch a browser game instance.');
    }

    const browser = await this.browserLauncher.launch({
      headless: this.headless,
      ...this.launchOptions
    });
    const context = await browser.newContext(this.contextOptions);
    const page = await context.newPage();
    const openedAt = now();
    const runtime: BrowserRuntime = {
      browser,
      context,
      page,
      consoleLogs: [],
      pageErrors: [],
      crashed: false,
      closed: false,
      openedAt,
      lastHeartbeatAt: openedAt
    };

    this.attachPageListeners(runtime);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    const instance: GameAdapterInstance = {
      instanceId: config.instanceId,
      adapterId: this.id,
      gameProfileId: config.gameProfileId,
      launchConfig: config,
      startedAt: openedAt,
      metadata: {
        adapterType: this.adapterType,
        browserSpecific: true,
        browserType: this.browserKind,
        targetUrl,
        contextPerInstance: true
      }
    };

    this.instances.set(config.instanceId, { instance, running: true });
    this.browserInstances.set(config.instanceId, runtime);
    return instance;
  }

  override async stopInstance(instanceId: string): Promise<void> {
    const runtime = this.browserInstances.get(instanceId);

    if (runtime) {
      await runtime.page.close().catch(() => undefined);
      await runtime.context.close().catch(() => undefined);
      await runtime.browser.close().catch(() => undefined);
      runtime.closed = true;
    }

    await super.stopInstance(instanceId);
  }

  override async stopAll(): Promise<void> {
    await Promise.all([...this.browserInstances.keys()].map((instanceId) => this.stopInstance(instanceId)));
  }

  override async isRunning(instanceId: string): Promise<boolean> {
    const runtime = this.browserInstances.get(instanceId);
    const running = Boolean(runtime && !runtime.closed && !runtime.crashed && !runtime.page.isClosed());
    const tracked = this.instances.get(instanceId);

    if (tracked) {
      tracked.running = running;
    }

    return running;
  }

  override async getState(instanceId: string, botId: string): Promise<GameStateSnapshot> {
    const runtime = this.requireRuntime(instanceId);
    const tracked = this.instances.get(instanceId);
    const capturedAt = now();
    runtime.lastHeartbeatAt = capturedAt;

    const instrumentedState = await this.readInstrumentedState(runtime, instanceId, botId).catch(() => null);

    if (instrumentedState) {
      return instrumentedState;
    }

    const [url, title] = await Promise.all([
      Promise.resolve(runtime.page.url()),
      runtime.page.title().catch(() => '')
    ]);

    return {
      snapshotId: `${instanceId}-${botId}-${Date.now()}`,
      sessionId: 'browser-session',
      gameId: tracked?.instance.gameProfileId ?? 'browser-game',
      gameInstanceId: instanceId,
      botId,
      capturedAt,
      scene: title || url,
      state: {
        adapterId: this.id,
        adapterType: this.adapterType,
        browserType: this.browserKind,
        url,
        title,
        pageStatus: runtime.closed || runtime.page.isClosed() ? 'closed' : runtime.crashed ? 'crashed' : 'open',
        consoleErrors: runtime.consoleLogs.filter((log) => log.type === 'error'),
        consoleWarnings: runtime.consoleLogs.filter((log) => log.type === 'warning' || log.type === 'warn'),
        pageErrors: runtime.pageErrors,
        screenshotPath: runtime.lastScreenshotPath,
        lastAction: runtime.lastAction,
        lastHeartbeatAt: runtime.lastHeartbeatAt
      },
      metrics: {},
      screenshotPath: runtime.lastScreenshotPath
    };
  }

  override async getAvailableActions(instanceId: string, botId: string): Promise<AvailableGameAction[]> {
    const runtime = this.requireRuntime(instanceId);
    const instrumentedActions = await this.readInstrumentedActions(runtime, instanceId, botId).catch(() => []);

    if (instrumentedActions.length > 0) {
      return instrumentedActions;
    }

    if (this.controlBindings.length > 0) {
      return this.controlBindings.map((binding) => ({
        actionType: binding.action ?? binding.controlId,
        label: binding.label,
        description: `Mapped to browser ${binding.inputType} control ${binding.binding ?? binding.controlId}.`,
        requiresInputSimulation: true,
        requiresDirectAction: false,
        requiresStateRead: false,
        payloadSchema: binding.metadata
      }));
    }

    return [
      {
        actionType: 'keyboard-press',
        label: 'Keyboard Press',
        description: 'Press a keyboard key in the browser page.',
        requiresInputSimulation: true
      },
      {
        actionType: 'mouse-click',
        label: 'Mouse Click',
        description: 'Click inside the browser page.',
        requiresInputSimulation: true
      },
      {
        actionType: 'wait',
        label: 'Wait',
        description: 'Wait briefly for browser game state to change.'
      },
      {
        actionType: 'reload',
        label: 'Reload Page',
        description: 'Reload the browser game page.',
        requiresInputSimulation: true
      },
      {
        actionType: 'open-menu',
        label: 'Open Menu',
        description: 'Press Escape as a generic open-menu input.',
        requiresInputSimulation: true
      },
      {
        actionType: 'close-menu',
        label: 'Close Menu',
        description: 'Press Escape as a generic close-menu input.',
        requiresInputSimulation: true
      }
    ];
  }

  override async performAction(instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    const runtime = this.requireRuntime(instanceId);
    const startedAt = now();

    if (!(await this.isRunning(instanceId))) {
      return this.recordAction(runtime, action, botId, 'failed', startedAt, 'Browser page is not running.');
    }

    const hookResult = await this.tryDirectActionHook(runtime, action, botId, startedAt);

    if (hookResult) {
      this.recordRuntimeAction(runtime, action, hookResult.status, hookResult.message);
      return hookResult;
    }

    try {
      const binding = this.resolveControlBinding(action);
      const actionType = normalize(action.type);

      if (actionType === 'wait') {
        await runtime.page.waitForTimeout(numericValue(action.payload.durationMs) ?? action.timeoutMs ?? 500);
        return this.recordAction(runtime, action, botId, 'succeeded', startedAt, 'Waited in browser page.');
      }

      if (actionType === 'reload') {
        await runtime.page.reload({ waitUntil: 'domcontentloaded' });
        return this.recordAction(runtime, action, botId, 'succeeded', startedAt, 'Reloaded browser page.');
      }

      if (binding?.binding) {
        await this.performMappedInput(runtime, binding);
        return this.recordAction(
          runtime,
          action,
          botId,
          'succeeded',
          startedAt,
          `Sent browser ${binding.inputType} input "${binding.binding}".`
        );
      }

      if (actionType === 'keyboard-press' || typeof action.payload.key === 'string') {
        const key = String(action.payload.key ?? action.payload.binding ?? 'Space');
        await runtime.page.keyboard.press(normalizeKeyboardBinding(key));
        return this.recordAction(runtime, action, botId, 'succeeded', startedAt, `Pressed ${key}.`);
      }

      if (actionType === 'mouse-click') {
        const point = this.clickPoint(runtime, action);
        await runtime.page.mouse.click(point.x, point.y, { button: buttonForBinding(String(action.payload.button ?? 'left')) });
        return this.recordAction(runtime, action, botId, 'succeeded', startedAt, 'Clicked browser page.');
      }

      if (actionType === 'open-menu' || actionType === 'close-menu') {
        await runtime.page.keyboard.press('Escape');
        return this.recordAction(runtime, action, botId, 'succeeded', startedAt, 'Pressed Escape for menu action.');
      }

      return this.recordAction(
        runtime,
        action,
        botId,
        'skipped',
        startedAt,
        `No browser action hook or input mapping handled "${action.type}".`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Browser action failed.';
      return this.recordAction(runtime, action, botId, 'failed', startedAt, message);
    }
  }

  override async captureScreenshot(instanceId: string, botId: string): Promise<ScreenshotCapture> {
    const runtime = this.requireRuntime(instanceId);
    const outputPath = join(this.screenshotDirectory, `${instanceId}-${botId}-${Date.now()}.png`);
    await mkdir(dirname(outputPath), { recursive: true });
    await runtime.page.screenshot({ path: outputPath, fullPage: true });
    runtime.lastScreenshotPath = outputPath;

    return {
      instanceId,
      botId,
      capturedAt: now(),
      path: outputPath,
      mimeType: 'image/png'
    };
  }

  override async captureLogs(instanceId: string): Promise<LogEntry[]> {
    const runtime = this.requireRuntime(instanceId);
    const consoleLogs = runtime.consoleLogs.map<LogEntry>((log, index) => ({
      id: `${instanceId}-browser-console-${index + 1}`,
      level: consoleLogLevel(log.type),
      message: log.text,
      timestamp: log.timestamp,
      source: `${this.id}:console`
    }));
    const pageErrors = runtime.pageErrors.map<LogEntry>((error, index) => ({
      id: `${instanceId}-browser-page-error-${index + 1}`,
      level: 'error',
      message: error.stack ?? error.message,
      timestamp: error.timestamp,
      source: `${this.id}:pageerror`
    }));

    return [...consoleLogs, ...pageErrors];
  }

  override async getHealth(instanceId: string): Promise<AdapterHealth> {
    const runtime = this.browserInstances.get(instanceId);

    if (!runtime) {
      return super.getHealth(instanceId);
    }

    const running = await this.isRunning(instanceId);

    return {
      instanceId,
      status: runtime.crashed ? 'failed' : running ? 'running' : 'stopped',
      checkedAt: now(),
      message: runtime.crashed
        ? 'Browser page crashed.'
        : running
          ? 'Browser page is open.'
          : 'Browser page is closed.',
      details: {
        adapterId: this.id,
        adapterType: this.adapterType,
        browserType: this.browserKind,
        url: runtime.page.url(),
        closed: runtime.closed || runtime.page.isClosed(),
        crashed: runtime.crashed,
        consoleErrorCount: runtime.consoleLogs.filter((log) => log.type === 'error').length,
        consoleWarningCount: runtime.consoleLogs.filter((log) => log.type === 'warning' || log.type === 'warn').length,
        pageErrorCount: runtime.pageErrors.length,
        lastAction: runtime.lastAction,
        lastHeartbeatAt: runtime.lastHeartbeatAt,
        screenshotPath: runtime.lastScreenshotPath,
        browserSpecific: true
      }
    };
  }

  private attachPageListeners(runtime: BrowserRuntime): void {
    runtime.page.on('console', (message) => {
      runtime.consoleLogs.push({
        type: message.type(),
        text: message.text(),
        timestamp: now(),
        location: message.location?.()
      });
    });
    runtime.page.on('pageerror', (error) => {
      runtime.pageErrors.push({
        name: error.name,
        message: error.message,
        stack: error.stack,
        timestamp: now()
      });
    });
    runtime.page.on('crash', () => {
      runtime.crashed = true;
    });
    runtime.page.on('close', () => {
      runtime.closed = true;
    });
  }

  private requireRuntime(instanceId: string): BrowserRuntime {
    const runtime = this.browserInstances.get(instanceId);

    if (!runtime) {
      throw new Error(`Browser instance "${instanceId}" was not launched by this adapter.`);
    }

    return runtime;
  }

  private async readInstrumentedState(
    runtime: BrowserRuntime,
    instanceId: string,
    botId: string
  ): Promise<GameStateSnapshot | null> {
    const value = await runtime.page.evaluate(
      ({ currentInstanceId, currentBotId }) => {
        const globalState = (window as unknown as { __GAMEPLAY_SIM_STATE__?: unknown }).__GAMEPLAY_SIM_STATE__;

        if (typeof globalState === 'function') {
          return globalState({ instanceId: currentInstanceId, botId: currentBotId });
        }

        return globalState ?? null;
      },
      { currentInstanceId: instanceId, currentBotId: botId }
    );

    if (!isRecord(value)) {
      return null;
    }

    const tracked = this.instances.get(instanceId);
    const rawState = isRecord(value.state) ? value.state : {};
    const performance = isRecord(value.performance) ? value.performance : undefined;
    const metrics = {
      ...numericMetricsFrom(value.metrics),
      ...numericMetricsFrom(performance)
    };
    const tick = numericValue(value.tick);
    const capturedAt = typeof value.capturedAt === 'string'
      ? value.capturedAt
      : typeof value.timestamp === 'string'
        ? value.timestamp
        : now();

    return {
      snapshotId:
        typeof value.snapshotId === 'string'
          ? value.snapshotId
          : `${instanceId}-${botId}-${tick ?? Date.now()}`,
      sessionId: typeof value.sessionId === 'string' ? value.sessionId : 'browser-session',
      gameId: typeof value.gameId === 'string' ? value.gameId : tracked?.instance.gameProfileId ?? 'browser-game',
      gameInstanceId:
        typeof value.gameInstanceId === 'string'
          ? value.gameInstanceId
          : typeof value.instanceId === 'string'
            ? value.instanceId
            : instanceId,
      botId,
      capturedAt,
      tick,
      scene: typeof value.scene === 'string' ? value.scene : undefined,
      state: {
        ...rawState,
        playerPosition: value.playerPosition,
        uiState: value.uiState,
        inventory: value.inventory,
        quests: value.quests,
        performance,
        browser: {
          url: runtime.page.url(),
          title: await runtime.page.title().catch(() => '')
        }
      },
      metrics,
      screenshotPath:
        typeof value.screenshotPath === 'string' ? value.screenshotPath : runtime.lastScreenshotPath
    };
  }

  private async readInstrumentedActions(
    runtime: BrowserRuntime,
    instanceId: string,
    botId: string
  ): Promise<AvailableGameAction[]> {
    const value = await runtime.page.evaluate(
      ({ currentInstanceId, currentBotId }) => {
        const globalActions = (window as unknown as { __GAMEPLAY_SIM_ACTIONS__?: unknown }).__GAMEPLAY_SIM_ACTIONS__;

        if (typeof globalActions === 'function') {
          return globalActions({ instanceId: currentInstanceId, botId: currentBotId });
        }

        return globalActions ?? null;
      },
      { currentInstanceId: instanceId, currentBotId: botId }
    );

    if (!Array.isArray(value)) {
      return [];
    }

    return value.map(coerceAvailableAction).filter((item): item is AvailableGameAction => Boolean(item));
  }

  private async tryDirectActionHook(
    runtime: BrowserRuntime,
    action: GameAction,
    botId: string,
    startedAt: string
  ): Promise<ActionResult | null> {
    const hookExists = await runtime.page
      .evaluate(() => typeof (window as unknown as { __GAMEPLAY_SIM_PERFORM_ACTION__?: unknown }).__GAMEPLAY_SIM_PERFORM_ACTION__ === 'function')
      .catch(() => false);

    if (!hookExists) {
      return null;
    }

    try {
      const value = await runtime.page.evaluate(
        (browserAction) => {
          const hook = (window as unknown as {
            __GAMEPLAY_SIM_PERFORM_ACTION__?: (action: unknown) => unknown | Promise<unknown>;
          }).__GAMEPLAY_SIM_PERFORM_ACTION__;
          return hook?.(browserAction);
        },
        action
      );

      return actionResultFromHook(value, action, botId, startedAt);
    } catch (error) {
      const completedAt = now();
      return {
        actionId: action.actionId,
        botId,
        status: 'failed',
        startedAt,
        completedAt,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        message: error instanceof Error ? error.message : 'Browser JS action hook failed.',
        issueIds: []
      };
    }
  }

  private resolveControlBinding(action: GameAction): ControlBinding | undefined {
    const actionName = normalize(action.type);
    const targetName = normalize(action.target);
    const payloadControlId =
      typeof action.payload.controlId === 'string' ? normalize(action.payload.controlId) : undefined;
    const payloadBinding = typeof action.payload.binding === 'string' ? action.payload.binding : undefined;

    if (payloadBinding) {
      return {
        controlId: action.type,
        label: action.type,
        inputType: bindingIsMouse(payloadBinding) ? 'mouse' : 'keyboard',
        binding: payloadBinding,
        action: action.type,
        metadata: {}
      };
    }

    return this.controlBindings.find((binding) => {
      const bindingAction = normalize(binding.action);
      const bindingControlId = normalize(binding.controlId);
      const bindingLabel = normalize(binding.label);

      return (
        bindingAction === actionName ||
        bindingControlId === actionName ||
        bindingLabel === actionName ||
        (targetName.length > 0 && (bindingAction === targetName || bindingControlId === targetName)) ||
        (payloadControlId !== undefined &&
          (bindingAction === payloadControlId || bindingControlId === payloadControlId))
      );
    });
  }

  private async performMappedInput(runtime: BrowserRuntime, binding: ControlBinding): Promise<void> {
    if (!binding.binding) {
      throw new Error(`Browser control "${binding.controlId}" has no binding.`);
    }

    if (binding.inputType === 'mouse' || bindingIsMouse(binding.binding)) {
      const point = this.clickPoint(runtime);
      await runtime.page.mouse.click(point.x, point.y, { button: buttonForBinding(binding.binding) });
      return;
    }

    await runtime.page.keyboard.press(normalizeKeyboardBinding(binding.binding));
  }

  private clickPoint(runtime: BrowserRuntime, action?: GameAction): { x: number; y: number } {
    const payloadX = numericValue(action?.payload.x);
    const payloadY = numericValue(action?.payload.y);

    if (payloadX !== undefined && payloadY !== undefined) {
      return { x: payloadX, y: payloadY };
    }

    const viewport = runtime.page.viewportSize?.();
    return {
      x: Math.floor((viewport?.width ?? 800) / 2),
      y: Math.floor((viewport?.height ?? 600) / 2)
    };
  }

  private recordAction(
    runtime: BrowserRuntime,
    action: GameAction,
    botId: string,
    status: BrowserActionStatus,
    startedAt: string,
    message: string
  ): ActionResult {
    const completedAt = now();
    this.recordRuntimeAction(runtime, action, status, message);

    return {
      actionId: action.actionId,
      botId,
      status,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      message,
      issueIds: []
    };
  }

  private recordRuntimeAction(
    runtime: BrowserRuntime,
    action: GameAction,
    status: BrowserActionStatus,
    message?: string
  ): void {
    runtime.lastAction = {
      actionId: action.actionId,
      type: action.type,
      status,
      message,
      performedAt: now()
    };
  }
}
