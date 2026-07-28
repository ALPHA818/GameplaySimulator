import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import type { GameInstanceConfig } from '@core/types';
import { startInstrumentedTestServer } from '../../examples/instrumented-test-server/src/server';
import {
  BrowserAdapter,
  type BrowserAdapterOptions,
  DesktopAdapterDependencyChecker,
  DesktopWindowAdapter,
  InstrumentedAdapter
} from '../../packages/adapters/src';
import {
  createGameAction,
  processIsAlive,
  startBrowserTestPage,
  waitFor
} from './releaseFixtures';

describe('release E2E: real adapters', () => {
  it('drives a real Chromium page with keyboard and mouse input, captures state and evidence, then closes it', async () => {
    const pageServer = await startBrowserTestPage();
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'gameplay-simulator-e2e-browser-'));
    let browser: Browser | undefined;
    const browserLauncher: BrowserAdapterOptions['browserLauncher'] = {
      async launch(options) {
        browser = await chromium.launch(options);
        return browser;
      }
    };
    const adapter = new BrowserAdapter({
      targetUrl: pageServer.url,
      browserName: 'chromium',
      browserLauncher,
      screenshotDirectory,
      headless: true
    });
    const instanceId = 'release-browser-instance-001';
    const botId = 'release-browser-bot-001';
    const config: GameInstanceConfig = {
      instanceId,
      gameProfileId: 'release-browser-game',
      launch: {
        platform: 'browser',
        url: pageServer.url,
        arguments: []
      },
      maxBots: 1,
      environment: {}
    };

    try {
      await adapter.launchInstance(config);
      expect(browser?.isConnected()).toBe(true);

      const availableActions = await adapter.getAvailableActions(instanceId, botId);
      const keyboardResult = await adapter.performAction(
        instanceId,
        botId,
        createGameAction('keyboard-press', instanceId, { key: 'K' })
      );
      const mouseResult = await adapter.performAction(
        instanceId,
        botId,
        createGameAction('mouse-click', instanceId, { x: 80, y: 70 })
      );
      const state = await adapter.getState(instanceId, botId);
      const screenshot = await adapter.captureScreenshot(instanceId, botId);

      expect(availableActions.map((action) => action.actionType)).toEqual([
        'keyboard-press',
        'mouse-click'
      ]);
      expect(keyboardResult.status).toBe('succeeded');
      expect(mouseResult.status).toBe('succeeded');
      expect(state.state).toMatchObject({
        keyPresses: 1,
        clicks: 1,
        lastKey: 'K'
      });
      expect(screenshot.path).toBeDefined();
      expect(existsSync(screenshot.path!)).toBe(true);
      expect((await readFile(screenshot.path!)).byteLength).toBeGreaterThan(0);

      await adapter.stopAll();
      await waitFor(
        () => browser?.isConnected() === false,
        'the Playwright Chromium process to disconnect'
      );
      expect(await adapter.isRunning(instanceId)).toBe(false);
    } finally {
      await adapter.forceStopAll().catch(() => undefined);
      await pageServer.stop().catch(() => undefined);
      await rm(screenshotDirectory, { recursive: true, force: true });
    }

    expect(pageServer.server.listening).toBe(false);
    expect(browser?.isConnected()).toBe(false);
  });

  it('uses the real InstrumentedAdapter against the existing local test server', async () => {
    const server = await startInstrumentedTestServer({
      port: 0,
      sessionId: 'release-instrumented-adapter'
    });
    const adapter = new InstrumentedAdapter({
      instrumentationEndpoint: server.endpoint,
      instrumentationTransport: 'local-http'
    });
    const instanceId = 'release-instrumented-instance-001';

    try {
      await adapter.launchInstance({
        instanceId,
        gameProfileId: 'release-instrumented-game',
        launch: {
          platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux',
          arguments: []
        },
        maxBots: 1,
        environment: {}
      });

      const initialState = await adapter.getState(instanceId, 'release-e2e-bot-001');
      const availableActions = await adapter.getAvailableActions(instanceId, 'release-e2e-bot-001');
      const result = await adapter.performAction(
        instanceId,
        'release-e2e-bot-001',
        createGameAction('move-forward', instanceId)
      );
      const changedState = await adapter.getState(instanceId, 'release-e2e-bot-001');

      expect(initialState?.state.playerPosition).toMatchObject({ y: 0 });
      expect(availableActions.map((action) => action.actionType)).toContain('move-forward');
      expect(result.status).toBe('succeeded');
      expect(changedState?.state.playerPosition).toMatchObject({ y: 1 });
      expect(changedState?.tick).toBeGreaterThan(initialState?.tick ?? -1);

      await adapter.stopAll();
      expect(await adapter.isRunning(instanceId)).toBe(false);
    } finally {
      await adapter.stopAll().catch(() => undefined);
      await server.stop().catch(() => undefined);
    }

    expect(server.server.listening).toBe(false);
  });

  it('launches, health-checks, and stops a controlled desktop Node process', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'gameplay-simulator-e2e-desktop-'));
    const readyPath = join(tempDirectory, 'ready.txt');
    const stoppedPath = join(tempDirectory, 'stopped.txt');
    const processScript = join(tempDirectory, 'controlled-game.js');
    await writeFile(
      processScript,
      [
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.env.RELEASE_READY_PATH, String(process.pid));",
        "process.on('SIGTERM', () => {",
        "  fs.writeFileSync(process.env.RELEASE_STOPPED_PATH, 'stopped');",
        '  process.exit(0);',
        '});',
        'setInterval(() => {}, 1000);'
      ].join('\n'),
      'utf8'
    );
    const adapter = new DesktopWindowAdapter({
      dependencyChecker: new DesktopAdapterDependencyChecker({
        platform: process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
        commandExists: async () => false
      }),
      processStopTimeoutMs: 1_000
    });
    const instanceId = 'release-desktop-instance-001';
    let processId = 0;

    try {
      await adapter.launchInstance({
        instanceId,
        gameProfileId: 'release-desktop-game',
        launch: {
          executablePath: process.execPath,
          workingDirectory: tempDirectory,
          arguments: [processScript],
          platform: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
        },
        maxBots: 1,
        environment: {
          RELEASE_READY_PATH: readyPath,
          RELEASE_STOPPED_PATH: stoppedPath
        }
      });
      await waitFor(() => existsSync(readyPath), 'the controlled desktop process to start');
      processId = Number(await readFile(readyPath, 'utf8'));

      const health = await adapter.getHealth(instanceId);
      const processInfo = await adapter.getProcessInfo(instanceId);

      expect(processId).toBeGreaterThan(0);
      expect(processIsAlive(processId)).toBe(true);
      expect(await adapter.isRunning(instanceId)).toBe(true);
      expect(health.status).toBe('running');
      expect(processInfo?.pid).toBe(processId);

      await adapter.stopInstance(instanceId);
      await waitFor(() => !processIsAlive(processId), 'the controlled desktop process to exit');

      expect(await adapter.isRunning(instanceId)).toBe(false);
      expect(existsSync(stoppedPath)).toBe(true);
    } finally {
      await adapter.stopAll().catch(() => undefined);
      if (processId > 0 && processIsAlive(processId)) {
        process.kill(processId, 'SIGKILL');
      }
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});
