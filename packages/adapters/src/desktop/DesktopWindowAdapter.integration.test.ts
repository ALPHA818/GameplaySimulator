import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameInstanceConfig } from '@core/types';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopAdapterDependencyChecker } from './DesktopAdapterDependencyChecker';
import { DesktopWindowAdapter } from './DesktopWindowAdapter';

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error('Timed out waiting for fake desktop process.');
}

describe('DesktopWindowAdapter integration', () => {
  const adapters: DesktopWindowAdapter[] = [];

  afterEach(async () => {
    await Promise.all(adapters.map((adapter) => adapter.stopAll()));
    adapters.length = 0;
  });

  it('launches and stops a tiny Node fake game process', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-fake-game-'));
    const readyPath = join(tempDir, 'ready.txt');
    const stoppedPath = join(tempDir, 'stopped.txt');
    const fakeGamePath = join(tempDir, 'fake-game.js');
    await writeFile(
      fakeGamePath,
      [
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.env.FAKE_GAME_READY_PATH, String(process.pid));",
        "process.on('SIGTERM', () => {",
        "  fs.writeFileSync(process.env.FAKE_GAME_STOPPED_PATH, 'stopped');",
        "  setTimeout(() => process.exit(0), 10);",
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
      processStopTimeoutMs: 500
    });
    adapters.push(adapter);

    const instanceConfig: GameInstanceConfig = {
      instanceId: 'fake-desktop-instance-001',
      gameProfileId: 'fake-desktop-game',
      launch: {
        executablePath: process.execPath,
        workingDirectory: tempDir,
        arguments: [fakeGamePath],
        platform: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
      },
      maxBots: 1,
      environment: {
        FAKE_GAME_READY_PATH: readyPath,
        FAKE_GAME_STOPPED_PATH: stoppedPath
      }
    };

    const instance = await adapter.launchInstance(instanceConfig);
    await waitFor(() => existsSync(readyPath));

    const processId = Number(await readFile(readyPath, 'utf8'));
    const processInfo = await adapter.getProcessInfo(instance.instanceId);

    expect(instance.metadata).toEqual(
      expect.objectContaining({
        browserSpecific: false,
        processId: expect.any(Number)
      })
    );
    expect(processId).toBeGreaterThan(0);
    expect(processInfo?.pid).toBe(processId);
    expect(await adapter.isRunning(instance.instanceId)).toBe(true);

    await adapter.stopInstance(instance.instanceId);
    await waitFor(async () => !(await adapter.isRunning(instance.instanceId)));

    const health = await adapter.getHealth(instance.instanceId);
    const logs = await adapter.captureLogs(instance.instanceId);

    expect(existsSync(stoppedPath)).toBe(true);
    expect(health.status).toBe('stopped');
    expect(logs.some((log) => log.message.includes('graceful stop signal'))).toBe(true);
  });

  it('keeps ownership after a launcher hands off to a child and leaves unrelated processes alone', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-launcher-handoff-'));
    const childPidPath = join(tempDir, 'child-pid.txt');
    const childStoppedPath = join(tempDir, 'child-stopped.txt');
    const childPath = join(tempDir, 'owned-child.js');
    const launcherPath = join(tempDir, 'launcher.js');
    await writeFile(
      childPath,
      [
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.env.OWNED_CHILD_PID_PATH, String(process.pid));",
        "process.on('SIGTERM', () => {",
        "  fs.writeFileSync(process.env.OWNED_CHILD_STOPPED_PATH, 'stopped');",
        '  process.exit(0);',
        '});',
        'setInterval(() => {}, 1000);'
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      launcherPath,
      [
        "const { spawn } = require('node:child_process');",
        "spawn(process.execPath, [process.env.OWNED_CHILD_PATH], {",
        '  env: process.env,',
        "  stdio: 'ignore'",
        '});',
        'setTimeout(() => process.exit(0), 50);'
      ].join('\n'),
      'utf8'
    );
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore'
    });
    const adapter = new DesktopWindowAdapter({
      dependencyChecker: new DesktopAdapterDependencyChecker({
        platform: process.platform === 'darwin' ? 'darwin' : 'linux',
        commandExists: async () => false
      }),
      processStopTimeoutMs: 750
    });
    adapters.push(adapter);

    try {
      const instance = await adapter.launchInstance({
        instanceId: 'launcher-handoff-instance',
        gameProfileId: 'launcher-handoff-game',
        launch: {
          executablePath: process.execPath,
          workingDirectory: tempDir,
          arguments: [launcherPath],
          platform: process.platform === 'darwin' ? 'mac' : 'linux'
        },
        maxBots: 1,
        environment: {
          OWNED_CHILD_PATH: childPath,
          OWNED_CHILD_PID_PATH: childPidPath,
          OWNED_CHILD_STOPPED_PATH: childStoppedPath
        }
      });
      await waitFor(() => existsSync(childPidPath));
      await waitFor(async () => await adapter.isRunning(instance.instanceId));
      await new Promise((resolve) => setTimeout(resolve, 150));

      const childPid = Number(await readFile(childPidPath, 'utf8'));
      expect(childPid).toBeGreaterThan(0);
      expect(await adapter.isRunning(instance.instanceId)).toBe(true);

      await adapter.stopInstance(instance.instanceId);
      await waitFor(() => existsSync(childStoppedPath));

      expect(() => process.kill(childPid, 0)).toThrow();
      expect(unrelated.pid).toBeGreaterThan(0);
      expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    } finally {
      unrelated.kill('SIGKILL');
    }
  });
});
