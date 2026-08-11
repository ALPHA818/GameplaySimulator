import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  GameInstanceConfig,
  SimulationRunConfig
} from '@core/types';
import type {
  GameAdapterInstance,
  ScreenshotCapture
} from '../../packages/adapters/src';
import {
  BaseGameAdapter,
  InstrumentedAdapter
} from '../../packages/adapters/src';
import { startInstrumentedTestServer } from '../../examples/instrumented-test-server/src/server';
import { SimulationService } from '../../apps/desktop/src/main/services/simulationService';
import {
  createInstrumentedGameProfile,
  createReleaseRunConfig,
  processIsAlive,
  removeTemporaryDirectory,
  releaseBotProfile,
  releaseSystemSnapshot,
  waitFor
} from './releaseFixtures';

class FailingOwnedProcessAdapter extends BaseGameAdapter {
  child?: ChildProcess;
  processId?: number;
  stopAllCalled = false;

  constructor() {
    super({
      id: 'release-failing-adapter',
      name: 'Release Failing Adapter',
      adapterType: 'instrumented',
      capabilities: {
        supportsMultipleInstances: false,
        supportsMultipleBotsPerInstance: false,
        supportsStateRead: true,
        supportsDirectActions: true,
        supportsInputSimulation: false,
        supportsScreenshots: true,
        supportsVideo: false,
        supportsGameLogs: true,
        supportsSaveIsolation: false,
        supportsReset: false,
        supportsCheckpointReload: false,
        supportsLiveObservation: false,
        supportsWindowFocus: false,
        supportsMultipleVisibleWindows: false,
        observationCapability: 'unavailable'
      }
    });
  }

  override async launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance> {
    await super.launchInstance(config);
    this.child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore'
    });
    await new Promise<void>((resolve, reject) => {
      this.child!.once('spawn', resolve);
      this.child!.once('error', reject);
    });
    this.processId = this.child.pid;
    throw new Error('Forced release adapter launch failure.');
  }

  override async captureScreenshot(instanceId: string, botId: string): Promise<ScreenshotCapture> {
    return {
      instanceId,
      botId,
      capturedAt: new Date().toISOString(),
      data: Buffer.from('controlled adapter failure evidence'),
      mimeType: 'image/png'
    };
  }

  override async stopAll(): Promise<void> {
    this.stopAllCalled = true;
    const child = this.child;

    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2_000);
        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    await super.stopAll();
  }

  async forceStopAll(): Promise<void> {
    const child = this.child;

    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }

    await this.stopAll();
  }
}

function parseJson(path: string): Promise<Record<string, unknown>> {
  return readFile(path, 'utf8').then((contents) => JSON.parse(contents) as Record<string, unknown>);
}

describe('release E2E: sessions and cleanup', () => {
  it('runs a real session, writes logs, stops, and reopens persisted report metadata', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-e2e-session-'));
    const server = await startInstrumentedTestServer({
      port: 0,
      gameId: 'release-instrumented-game',
      sessionId: 'release-full-session'
    });
    const openedPaths: string[] = [];
    const profile = createInstrumentedGameProfile(server.endpoint);
    const runConfig = createReleaseRunConfig('release-full-session');
    const service = new SimulationService({
      reportRoot,
      systemSnapshot: releaseSystemSnapshot,
      openPath: async (path) => {
        openedPaths.push(path);
        return '';
      }
    });

    try {
      const validation = service.validateSessionConfig({
        runConfig,
        gameProfile: profile,
        botProfiles: [releaseBotProfile]
      });
      const created = service.createSession({
        runConfig,
        gameProfile: profile,
        botProfiles: [releaseBotProfile]
      });
      const runtimeSessionId = created.sessionId;
      const started = await service.startSession(runtimeSessionId);

      expect(validation.valid).toBe(true);
      expect(created.status.status).toBe('created');
      expect(started.status).toBe('running');

      await waitFor(
        () => service.getSessionStatus(runtimeSessionId).status === 'stopped',
        'the real session to finish'
      );

      const metadata = service.listSessions().find((session) => session.sessionId === runtimeSessionId);
      expect(metadata).toBeDefined();
      expect(existsSync(metadata!.reportPaths.fullStructuredLogs!)).toBe(true);
      expect((await readFile(metadata!.reportPaths.fullStructuredLogs!, 'utf8')).trim()).not.toBe('');

      await service.shutdownAllSessions('release_e2e_restart');
      const reopenedService = new SimulationService({
        reportRoot,
        systemSnapshot: releaseSystemSnapshot,
        openPath: async (path) => {
          openedPaths.push(path);
          return '';
        }
      });
      const reopenedMetadata = reopenedService
        .listSessions()
        .find((session) => session.sessionId === runtimeSessionId);
      const reportResult = await reopenedService.openReport(runtimeSessionId);
      const sessionMetadata = await parseJson(
        join(reopenedMetadata!.reportPaths.sessionDirectory, 'session.json')
      );

      expect(reopenedMetadata).toMatchObject({
        sessionId: runtimeSessionId,
        status: 'stopped',
        gameName: profile.gameName
      });
      expect(reportResult.opened).toBe(true);
      expect(openedPaths).toContain(reportResult.reportPath);
      expect(sessionMetadata).toMatchObject({
        sessionId: runtimeSessionId,
        status: 'stopped'
      });
      await reopenedService.shutdownAllSessions('release_e2e_complete');
    } finally {
      await service.shutdownAllSessions('release_e2e_cleanup').catch(() => []);
      await server.stop().catch(() => undefined);
      await removeTemporaryDirectory(reportRoot);
    }
  });

  it('shares simultaneous quit requests and persists an interrupted terminal session', async () => {
    const sessionId = 'release-shared-shutdown-session';
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-e2e-shutdown-'));
    const server = await startInstrumentedTestServer({
      port: 0,
      gameId: 'release-instrumented-game',
      sessionId
    });
    const profile = createInstrumentedGameProfile(server.endpoint);
    const runConfig = createReleaseRunConfig(sessionId, {
      maxActionsPerBot: 10_000
    });
    const service = new SimulationService({
      reportRoot,
      systemSnapshot: releaseSystemSnapshot
    });

    try {
      const created = service.createSession({
        runConfig,
        gameProfile: profile,
        botProfiles: [releaseBotProfile]
      });
      const runtimeSessionId = created.sessionId;
      await service.startSession(runtimeSessionId);

      const firstShutdown = service.shutdownAllSessions('release_e2e_simultaneous_quit');
      const secondShutdown = service.shutdownAllSessions('release_e2e_simultaneous_quit');

      expect(secondShutdown).toBe(firstShutdown);

      const snapshots = await firstShutdown;
      const stoppedSession = snapshots.find(
        (snapshot) => snapshot.sessionId === runtimeSessionId
      );
      const metadata = service.listSessions().find(
        (session) => session.sessionId === runtimeSessionId
      );
      const sessionMetadata = await parseJson(
        join(metadata!.reportPaths.sessionDirectory, 'session.json')
      );

      expect(stoppedSession).toMatchObject({
        sessionId: runtimeSessionId,
        status: 'failed',
        stoppedAt: expect.any(String)
      });
      expect(sessionMetadata).toMatchObject({
        sessionId: runtimeSessionId,
        status: 'failed',
        stoppedAt: expect.any(String),
        shutdownReason: 'release_e2e_simultaneous_quit'
      });
      expect(
        service.getBotStatuses(runtimeSessionId).every(
          (bot) => !['starting', 'running', 'paused', 'recovering'].includes(bot.status)
        )
      ).toBe(true);
      expect(
        (await service.getInstanceStatuses(runtimeSessionId)).every(
          (instance) => instance.status === 'stopped'
        )
      ).toBe(true);
    } finally {
      await service.forceCleanupOwnedProcesses('release_e2e_cleanup').catch(() => undefined);
      await server.stop().catch(() => undefined);
      await removeTemporaryDirectory(reportRoot);
    }
  });

  it('applies an existing forced directive and writes its result to the session summary', async () => {
    const sessionId = 'release-directive-session';
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-e2e-directive-'));
    const server = await startInstrumentedTestServer({
      port: 0,
      gameId: 'release-instrumented-game',
      sessionId
    });
    const directive = {
      directiveId: 'release-move-forward',
      sessionId,
      name: 'Move forward once',
      description: 'Use the currently reported move-forward action.',
      directiveType: 'action' as const,
      directiveMode: 'force-next-valid-action' as const,
      priority: 'urgent' as const,
      status: 'queued' as const,
      target: {
        allBots: false,
        botIds: [],
        profileIds: [releaseBotProfile.profileId],
        gameInstanceIds: []
      },
      actionKeywords: ['move-forward'],
      avoidedActionKeywords: [],
      successConditions: ['The move-forward action succeeds.'],
      failureConditions: [],
      steps: [],
      repeatUntilSuccess: false,
      createdAt: new Date().toISOString(),
      createdBy: 'release-e2e'
    };
    const runConfig = createReleaseRunConfig(sessionId, {
      directives: [directive],
      maxActionsPerBot: 1
    });
    const profile = createInstrumentedGameProfile(server.endpoint);
    const service = new SimulationService({
      reportRoot,
      systemSnapshot: releaseSystemSnapshot
    });

    try {
      const created = service.createSession({
        runConfig,
        gameProfile: profile,
        botProfiles: [releaseBotProfile]
      });
      const runtimeSessionId = created.sessionId;
      await service.startSession(runtimeSessionId);
      await waitFor(
        () => service.getSessionStatus(runtimeSessionId).status === 'stopped',
        'the directed session to finish'
      );

      const directiveState = service.getDirectiveState(runtimeSessionId);
      const metadata = service.listSessions().find((session) => session.sessionId === runtimeSessionId);
      const summary = await parseJson(
        join(metadata!.reportPaths.sessionDirectory, 'session-summary.json')
      );
      const directedTests = summary.userDirectedTests as Array<Record<string, unknown>>;

      expect(server.getState('game-instance-001').playerPosition.y).toBe(1);
      expect(directiveState.directives[0].status).toBe('succeeded');
      expect(directiveState.progress[0]).toMatchObject({
        lastAction: 'move-forward',
        successfulActions: 1,
        status: 'succeeded'
      });
      expect(directedTests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assignedBot: 'release-e2e-bot-001',
            finalResult: 'succeeded',
            matchingActions: ['move-forward']
          })
        ])
      );
      expect((await readdir(metadata!.reportPaths.sessionDirectory)).filter((name) => name.includes('.tmp-'))).toEqual([]);
    } finally {
      await service.shutdownAllSessions('release_e2e_cleanup').catch(() => []);
      await server.stop().catch(() => undefined);
      await removeTemporaryDirectory(reportRoot);
    }
  });

  it('preserves failure evidence and logs while closing adapter-owned resources', async () => {
    const sessionId = 'release-adapter-failure';
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-e2e-failure-'));
    const adapter = new FailingOwnedProcessAdapter();
    const profile = createInstrumentedGameProfile('http://127.0.0.1:1');
    const runConfig: SimulationRunConfig = createReleaseRunConfig(sessionId, {
      saveScreenshots: true
    });
    const service = new SimulationService({
      reportRoot,
      systemSnapshot: releaseSystemSnapshot,
      adapterFactory: {
        createAdapter: () => adapter
      }
    });

    try {
      const created = service.createSession({
        runConfig,
        gameProfile: profile,
        botProfiles: [releaseBotProfile]
      });
      const runtimeSessionId = created.sessionId;
      const status = await service.startSession(runtimeSessionId);
      const issue = service.getIssues(runtimeSessionId)[0];
      const metadata = service.listSessions().find((session) => session.sessionId === runtimeSessionId);
      const sessionMetadata = await parseJson(
        join(metadata!.reportPaths.sessionDirectory, 'session.json')
      );

      expect(status.status).toBe('failed');
      expect(adapter.stopAllCalled).toBe(true);
      expect(adapter.processId).toBeDefined();
      await waitFor(
        () => !processIsAlive(adapter.processId!),
        'the failing adapter owned process to exit'
      );
      expect(issue).toMatchObject({
        severity: 'critical',
        category: 'crash',
        title: 'Game adapter failed to launch',
        rawEvidence: expect.objectContaining({
          adapterType: 'instrumented',
          error: 'Forced release adapter launch failure.'
        })
      });
      expect(existsSync(metadata!.reportPaths.issuesJson!)).toBe(true);
      expect(await readFile(metadata!.reportPaths.issuesJson!, 'utf8')).toContain(
        'Forced release adapter launch failure.'
      );
      expect(existsSync(metadata!.reportPaths.fullStructuredLogs!)).toBe(true);
      expect(await readFile(metadata!.reportPaths.fullStructuredLogs!, 'utf8')).toContain(
        'adapter_startup_failed'
      );
      expect(sessionMetadata).toMatchObject({
        sessionId: runtimeSessionId,
        status: 'failed'
      });
    } finally {
      await service.forceCleanupOwnedProcesses('release_e2e_cleanup').catch(() => undefined);
      if (adapter.processId && processIsAlive(adapter.processId)) {
        process.kill(adapter.processId, 'SIGKILL');
      }
      await removeTemporaryDirectory(reportRoot);
    }
  });
});
