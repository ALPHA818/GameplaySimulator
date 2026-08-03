import type { GameAction } from '@core/types';
import { IssueDetectionRunner } from '@core/detection/IssueDetectors';
import { describe, expect, it, vi } from 'vitest';
import type {
  InstrumentationClient,
  InstrumentationHealth
} from '@instrumentation-sdk';
import { startInstrumentedTestServer } from '../../../../examples/instrumented-test-server/src/server';
import { InstrumentedAdapter } from './InstrumentedAdapter';

const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const VALID_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';

function action(type: string, actionId = `${type}-001`): GameAction {
  return {
    actionId,
    sessionId: 'sdk-test-session',
    gameInstanceId: 'game-instance-001',
    botId: 'explorer-001',
    type,
    payload: {},
    requestedAt: '2026-07-02T20:00:00.000Z'
  };
}

function screenshotClient(state: Record<string, unknown>): InstrumentationClient {
  return {
    transport: 'local-http',
    getHealth: async () => ({
      ok: true,
      gameId: 'fake-instrumented-game',
      protocolVersion: '0.1.0',
      capabilities: {
        stateRead: true,
        directActions: true,
        events: true,
        logs: true
      }
    }),
    getState: async (instanceId) => ({
      gameId: 'fake-instrumented-game',
      instanceId,
      timestamp: '2026-07-02T20:00:00.000Z',
      inventory: [],
      quests: [],
      logs: [],
      state
    }),
    getAvailableActions: async () => [],
    performAction: async (request) => ({
      requestId: request.requestId,
      status: 'succeeded',
      metadata: {}
    }),
    emitEvent: async () => undefined
  };
}

async function launchScreenshotAdapter(
  state: Record<string, unknown>,
  screenshotBytes = 16 * 1024 * 1024
): Promise<InstrumentedAdapter> {
  const adapter = new InstrumentedAdapter({
    instrumentationClient: screenshotClient(state),
    requestPolicy: {
      responseSizeLimits: {
        screenshotBytes
      }
    }
  });
  await adapter.launchInstance({
    instanceId: 'evidence-instance',
    gameProfileId: 'fake-instrumented-game',
    launch: { platform: 'linux', arguments: [] },
    maxBots: 1,
    environment: {}
  });
  return adapter;
}

describe('InstrumentedAdapter', () => {
  it('describes headless and external-window observation honestly', async () => {
    const headless = new InstrumentedAdapter();
    const external = new InstrumentedAdapter({ observationCapability: 'external-window' });

    expect(headless.capabilities.supportsLiveObservation).toBe(false);
    expect((await headless.focusWindow('headless-instance')).message).toBe(
      'This instrumented target has no visible game window.'
    );
    expect(external.capabilities).toMatchObject({
      supportsLiveObservation: true,
      supportsWindowFocus: false,
      observationCapability: 'external-window'
    });
    expect((await external.getHealth('external-instance')).details.observationMessage).toContain(
      'Window focus is not supported'
    );
  });

  it('rejects an unreachable endpoint without reporting an instance as running', async () => {
    const server = await startInstrumentedTestServer({ port: 0 });
    const endpoint = server.endpoint;
    await server.stop();
    const adapter = new InstrumentedAdapter({
      instrumentationEndpoint: endpoint,
      healthTimeoutMs: 250
    });

    await expect(adapter.launchInstance({
      instanceId: 'unreachable-instance',
      gameProfileId: 'fake-instrumented-game',
      launch: { platform: 'linux', arguments: [] },
      maxBots: 1,
      environment: {}
    })).rejects.toThrow(/Unable to connect instrumented game/i);

    expect(await adapter.isRunning('unreachable-instance')).toBe(false);
    expect(await adapter.getHealth('unreachable-instance')).toMatchObject({
      status: 'failed',
      details: {
        connectionState: 'failed'
      }
    });
  });

  it('rejects malformed and incompatible health responses', async () => {
    const malformedClient = {
      transport: 'local-http',
      getHealth: async () => ({ ok: true } as InstrumentationHealth)
    } as InstrumentationClient;
    const adapter = new InstrumentedAdapter({
      instrumentationClient: malformedClient
    });

    await expect(adapter.launchInstance({
      instanceId: 'malformed-instance',
      gameProfileId: 'fake-instrumented-game',
      launch: { platform: 'linux', arguments: [] },
      maxBots: 1,
      environment: {}
    })).rejects.toThrow(/health response is invalid.*protocolVersion/i);
  });

  it.each(['/etc/passwd', '../outside/session.png'])(
    'rejects instrumented screenshot path evidence: %s',
    async (screenshotPath) => {
      const adapter = await launchScreenshotAdapter({
        screenshotPath,
        screenshotMimeType: 'image/png'
      });
      const state = await adapter.getState('evidence-instance', 'explorer-001');

      expect(state?.state).not.toHaveProperty('screenshotPath');
      await expect(
        adapter.captureScreenshot('evidence-instance', 'explorer-001')
      ).rejects.toThrow(/instrumented evidence rejected.*filesystem path/i);
      expect(await adapter.captureLogs('evidence-instance')).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('adapter_evidence_rejected:')
        })
      );
    }
  );

  it('rejects oversized encoded instrumented screenshots before decoding', async () => {
    const adapter = await launchScreenshotAdapter({
      screenshotBase64: VALID_PNG_BASE64,
      screenshotMimeType: 'image/png'
    }, 16);

    await expect(
      adapter.captureScreenshot('evidence-instance', 'explorer-001')
    ).rejects.toThrow(/exceed the 16-byte limit/i);
  });

  it('rejects malformed base64 and MIME-signature mismatches', async () => {
    const malformed = await launchScreenshotAdapter({
      screenshotBase64: 'not-valid-base64!',
      screenshotMimeType: 'image/png'
    });
    const mismatched = await launchScreenshotAdapter({
      screenshotBase64: VALID_PNG_BASE64,
      screenshotMimeType: 'image/jpeg'
    });

    await expect(
      malformed.captureScreenshot('evidence-instance', 'explorer-001')
    ).rejects.toThrow(/valid canonical base64/i);
    await expect(
      mismatched.captureScreenshot('evidence-instance', 'explorer-001')
    ).rejects.toThrow(/MIME type does not match PNG/i);
  });

  it.each([
    ['PNG', VALID_PNG_BASE64, 'image/png'],
    ['JPEG', VALID_JPEG_BASE64, 'image/jpeg']
  ] as const)('accepts valid bounded %s evidence', async (_label, screenshotBase64, mimeType) => {
    const adapter = await launchScreenshotAdapter({
      screenshotBase64,
      screenshotMimeType: mimeType
    });

    const capture = await adapter.captureScreenshot('evidence-instance', 'explorer-001');

    expect(capture.path).toBeUndefined();
    expect(capture.mimeType).toBe(mimeType);
    expect(capture.data?.byteLength).toBeGreaterThan(0);
  });

  it('marks a previously healthy connection disconnected when its server disappears', async () => {
    const server = await startInstrumentedTestServer({ port: 0 });
    const adapter = new InstrumentedAdapter({
      instrumentationEndpoint: server.endpoint,
      healthTimeoutMs: 250
    });

    await adapter.launchInstance({
      instanceId: 'disconnect-instance',
      gameProfileId: 'fake-instrumented-game',
      launch: { platform: 'linux', arguments: [] },
      maxBots: 1,
      environment: {}
    });
    expect(await adapter.getHealth('disconnect-instance')).toMatchObject({
      status: 'running',
      details: {
        connectionState: 'connected'
      }
    });

    await server.stop();
    expect(await adapter.getHealth('disconnect-instance')).toMatchObject({
      status: 'failed',
      details: {
        connectionState: 'disconnected'
      }
    });
    await expect(
      adapter.performAction('disconnect-instance', 'explorer-001', action('move-forward'))
    ).rejects.toThrow(/instrumented game/i);
  });

  it('aborts an active state request when the instrumented instance stops', async () => {
    const abortInstance = vi.fn();
    const client = {
      transport: 'local-http',
      getHealth: async () => ({
        ok: true,
        gameId: 'fake-instrumented-game',
        protocolVersion: '0.1.0',
        capabilities: {
          stateRead: true,
          directActions: true,
          events: true,
          logs: true
        }
      }),
      getState: async () => await new Promise<never>(() => undefined),
      getAvailableActions: async () => [],
      performAction: async () => ({
        requestId: 'unused',
        status: 'succeeded',
        metadata: {}
      }),
      emitEvent: async () => undefined,
      abortInstance
    } as InstrumentationClient;
    const adapter = new InstrumentedAdapter({
      instrumentationClient: client,
      requestPolicy: {
        timeouts: {
          stateReadMs: 5_000,
          shutdownMs: 100
        }
      }
    });
    const instanceId = 'abort-active-request';
    await adapter.launchInstance({
      instanceId,
      gameProfileId: 'fake-instrumented-game',
      launch: { platform: 'linux', arguments: [] },
      maxBots: 1,
      environment: {}
    });
    const pendingState = adapter.getState(instanceId, 'explorer-001');

    await new Promise((resolve) => setTimeout(resolve, 5));
    await adapter.stopInstance(instanceId);

    await expect(pendingState).rejects.toMatchObject({
      eventType: 'adapter_request_aborted'
    });
    expect(abortInstance).toHaveBeenCalledWith(instanceId);
    expect(await adapter.captureLogs(instanceId)).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('adapter_request_aborted:')
      })
    );
  });

  it('connects to the example fake game server and reads structured state', async () => {
    const server = await startInstrumentedTestServer({ port: 0 });

    try {
      const adapter = new InstrumentedAdapter({ instrumentationEndpoint: server.endpoint });
      const instance = await adapter.launchInstance({
        instanceId: 'game-instance-001',
        gameProfileId: 'fake-instrumented-game',
        launch: { platform: 'linux', arguments: [] },
        maxBots: 2,
        environment: {}
      });

      expect(instance.metadata.instrumentationHealth).toMatchObject({
        ok: true,
        gameId: 'fake-instrumented-game'
      });

      const state = await adapter.getState('game-instance-001', 'explorer-001');
      const actions = await adapter.getAvailableActions('game-instance-001', 'explorer-001');

      expect(state?.scene).toBe('Start Area');
      expect(state?.state).toMatchObject({
        currency: 25,
        playerPosition: {
          x: 0,
          y: 0
        }
      });
      expect(state?.metrics.fps).toBe(60);
      expect(actions.map((item) => item.actionType)).toEqual(
        expect.arrayContaining(['move-forward', 'buy-item', 'trigger-crash'])
      );
    } finally {
      await server.stop();
    }
  });

  it('mutates fake game state through direct HTTP actions', async () => {
    const server = await startInstrumentedTestServer({ port: 0 });

    try {
      const adapter = new InstrumentedAdapter({ instrumentationEndpoint: server.endpoint });
      await adapter.launchInstance({
        instanceId: 'game-instance-001',
        gameProfileId: 'fake-instrumented-game',
        launch: { platform: 'linux', arguments: [] },
        maxBots: 2,
        environment: {}
      });

      const firstState = await adapter.getState('game-instance-001', 'explorer-001');
      const moveResult = await adapter.performAction('game-instance-001', 'explorer-001', action('move-forward'));
      const buyResult = await adapter.performAction('game-instance-001', 'explorer-001', action('buy-item'));
      const hiddenResult = await adapter.performAction(
        'game-instance-001',
        'explorer-001',
        action('enter-hidden-area')
      );
      const nextState = await adapter.getState('game-instance-001', 'explorer-001');

      expect(moveResult.status).toBe('succeeded');
      expect(buyResult.status).toBe('succeeded');
      expect(hiddenResult.status).toBe('succeeded');
      expect(nextState?.state.playerPosition).toMatchObject({ y: 12 });
      expect(nextState?.state.currency).toBe(20);
      expect(nextState?.scene).toBe('Hidden Grotto');
      expect(nextState?.state.inventory).toEqual(
        expect.arrayContaining([expect.objectContaining({ itemId: 'health-potion', quantity: 1 })])
      );
      expect(nextState?.tick).toBeGreaterThan(firstState?.tick ?? 0);
    } finally {
      await server.stop();
    }
  });

  it('exposes fake issue states that the detector pipeline can report', async () => {
    const server = await startInstrumentedTestServer({ port: 0 });

    try {
      const adapter = new InstrumentedAdapter({ instrumentationEndpoint: server.endpoint });
      const detector = new IssueDetectionRunner();
      await adapter.launchInstance({
        instanceId: 'game-instance-001',
        gameProfileId: 'fake-instrumented-game',
        launch: { platform: 'linux', arguments: [] },
        maxBots: 2,
        environment: {}
      });

      const beforeCrash = await adapter.getState('game-instance-001', 'explorer-001');
      const crashAction = action('trigger-crash');
      const crashResult = await adapter.performAction('game-instance-001', 'explorer-001', crashAction);
      const crashedState = await adapter.getState('game-instance-001', 'explorer-001');
      const issues = detector.detect({
        sessionId: 'sdk-test-session',
        botId: 'explorer-001',
        instanceId: 'game-instance-001',
        timestamp: '2026-07-02T20:00:01.000Z',
        memory: {
          previousState: beforeCrash,
          lastState: crashedState,
          lastAction: crashAction,
          lastResult: crashResult,
          recentActionTypes: ['trigger-crash']
        }
      });

      expect(crashResult.status).toBe('succeeded');
      expect(crashedState?.state.processStatus).toBe('crashed');
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'crash',
            severity: 'critical',
            title: 'Game process crashed'
          })
        ])
      );
    } finally {
      await server.stop();
    }
  });
});
