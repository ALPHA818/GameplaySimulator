import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ControlBinding, GameAction, GameInstanceConfig } from '@core/types';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopAdapterDependencyChecker } from './DesktopAdapterDependencyChecker';
import {
  DesktopWindowAdapter,
  type DesktopInputDriver,
  type DesktopProcessInfo,
  type DesktopScreenshotDriver,
  type DesktopWindowInfo,
  type KeyboardInputRequest,
  type MouseInputRequest
} from './DesktopWindowAdapter';

const dependencyChecker = new DesktopAdapterDependencyChecker({
  platform: 'linux',
  commandExists: async (command) => ['xdotool', 'scrot'].includes(command)
});

class RecordingInputDriver implements DesktopInputDriver {
  readonly keyboard: KeyboardInputRequest[] = [];
  readonly mouse: MouseInputRequest[] = [];
  focused = false;
  focusCount = 0;

  async focusWindow(processInfo: DesktopProcessInfo): Promise<DesktopWindowInfo> {
    this.focused = true;
    this.focusCount += 1;
    return {
      windowId: `window-${processInfo.pid}`,
      title: 'Test Game',
      focused: true,
      focusMethod: 'test-driver'
    };
  }

  async sendKeyboardInput(request: KeyboardInputRequest): Promise<void> {
    this.keyboard.push(request);
  }

  async sendMouseInput(request: MouseInputRequest): Promise<void> {
    this.mouse.push(request);
  }
}

class FileScreenshotDriver implements DesktopScreenshotDriver {
  async captureWindow(request: { outputPath: string }): Promise<{ path: string; mimeType: string }> {
    await mkdir(dirname(request.outputPath), { recursive: true });
    await writeFile(request.outputPath, 'fake screenshot');
    return {
      path: request.outputPath,
      mimeType: 'image/png'
    };
  }
}

const controls: ControlBinding[] = [
  {
    controlId: 'move-up',
    label: 'Move Up',
    inputType: 'keyboard',
    binding: 'W',
    action: 'move-up',
    metadata: {}
  },
  {
    controlId: 'interact',
    label: 'Interact',
    inputType: 'keyboard',
    binding: 'E',
    action: 'interact',
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
  instanceId: 'desktop-instance-001',
  gameProfileId: 'desktop-test-game',
  launch: {
    executablePath: process.execPath,
    arguments: ['-e', 'setInterval(() => {}, 1000)'],
    platform: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
  },
  maxBots: 1,
  environment: {}
};

function action(type: string): GameAction {
  return {
    actionId: `${type}-001`,
    sessionId: 'session',
    gameInstanceId: instanceConfig.instanceId,
    botId: 'explorer-001',
    type,
    payload: {},
    requestedAt: '2026-07-02T20:00:00.000Z'
  };
}

describe('DesktopWindowAdapter', () => {
  const adapters: DesktopWindowAdapter[] = [];

  afterEach(async () => {
    await Promise.all(adapters.map((adapter) => adapter.stopAll()));
    adapters.length = 0;
  });

  it('launches a local executable and detects whether the process is alive', async () => {
    const adapter = new DesktopWindowAdapter({
      controlBindings: controls,
      dependencyChecker,
      processStopTimeoutMs: 300
    });
    adapters.push(adapter);

    const instance = await adapter.launchInstance(instanceConfig);
    const processInfo = await adapter.getProcessInfo(instance.instanceId);

    expect(instance.metadata.browserSpecific).toBe(false);
    expect(instance.metadata).toMatchObject({
      visible: true,
      observationCapability: 'visible-window'
    });
    expect(adapter.capabilities).toMatchObject({
      supportsLiveObservation: true,
      supportsWindowFocus: true
    });
    expect(instance.metadata.dependencyReport).toMatchObject({
      canSendKeyboardInput: true,
      canCaptureScreenshots: true
    });
    expect(processInfo?.pid).toBeGreaterThan(0);
    expect(await adapter.isRunning(instance.instanceId)).toBe(true);

    const health = await adapter.getHealth(instance.instanceId);
    expect(health.details.processInfo).toMatchObject({ alive: true });
    expect(health.details.lastHeartbeatAt).toBeDefined();

    await adapter.stopInstance(instance.instanceId);

    expect(await adapter.isRunning(instance.instanceId)).toBe(false);
    const logs = await adapter.captureLogs(instance.instanceId);
    expect(logs.some((log) => log.message.includes('graceful stop signal'))).toBe(true);
  });

  it('maps GameAction objects to keyboard and mouse controls', async () => {
    const inputDriver = new RecordingInputDriver();
    const adapter = new DesktopWindowAdapter({
      controlBindings: controls,
      inputDriver,
      processStopTimeoutMs: 300
    });
    adapters.push(adapter);

    await adapter.launchInstance(instanceConfig);

    const moveResult = await adapter.performAction(
      instanceConfig.instanceId,
      'explorer-001',
      action('move-up')
    );
    const attackResult = await adapter.performAction(
      instanceConfig.instanceId,
      'explorer-001',
      action('attack')
    );

    expect(moveResult.status).toBe('succeeded');
    expect(attackResult.status).toBe('succeeded');
    expect(inputDriver.focused).toBe(false);
    expect(inputDriver.focusCount).toBe(0);
    expect(inputDriver.keyboard[0].binding).toBe('W');
    expect(inputDriver.mouse[0].binding).toBe('MouseLeft');
  });

  it('focuses the visible game before an action only when observation requests it', async () => {
    const inputDriver = new RecordingInputDriver();
    const adapter = new DesktopWindowAdapter({
      controlBindings: controls,
      inputDriver,
      runtimeObservation: {
        showBotGameplay: true,
        observationMode: 'follow-first-bot',
        bringGameToFrontOnAction: true,
        visibleActionDelayMs: 250,
        showActionInformation: true,
        maxVisibleGameWindows: 1
      },
      processStopTimeoutMs: 300
    });
    adapters.push(adapter);

    await adapter.launchInstance(instanceConfig);
    const result = await adapter.performAction(
      instanceConfig.instanceId,
      'explorer-001',
      action('move-up')
    );
    const focusResult = await adapter.openOrFocusGameWindow(instanceConfig.instanceId);

    expect(result.status).toBe('succeeded');
    expect(result.message).toContain('after focusing the game window');
    expect(inputDriver.focusCount).toBe(2);
    expect(focusResult).toMatchObject({
      supported: true,
      visible: true,
      focused: true
    });
  });

  it('returns limited desktop state when structured state is unavailable', async () => {
    const inputDriver = new RecordingInputDriver();
    const adapter = new DesktopWindowAdapter({
      controlBindings: controls,
      inputDriver,
      processStopTimeoutMs: 300
    });
    adapters.push(adapter);

    await adapter.launchInstance(instanceConfig);
    await adapter.performAction(instanceConfig.instanceId, 'explorer-001', action('interact'));

    const state = await adapter.getState(instanceConfig.instanceId, 'explorer-001');

    expect(state.state.structuredStateAvailable).toBe(false);
    expect(state.state.processStatus).toBe('running');
    expect(state.state.lastKnownAction).toMatchObject({ type: 'interact', binding: 'E' });
  });

  it('captures screenshots through the configured screenshot driver', async () => {
    const inputDriver = new RecordingInputDriver();
    const screenshotDirectory = join(tmpdir(), `gameplay-simulator-screenshots-${Date.now()}`);
    const adapter = new DesktopWindowAdapter({
      controlBindings: controls,
      inputDriver,
      screenshotDirectory,
      screenshotDriver: new FileScreenshotDriver(),
      processStopTimeoutMs: 300
    });
    adapters.push(adapter);

    await adapter.launchInstance(instanceConfig);

    const screenshot = await adapter.captureScreenshot(instanceConfig.instanceId, 'explorer-001');
    const state = await adapter.getState(instanceConfig.instanceId, 'explorer-001');

    expect(screenshot.path).toContain(screenshotDirectory);
    expect(screenshot.mimeType).toBe('image/png');
    expect(state.screenshotPath).toBe(screenshot.path);
  });
});
