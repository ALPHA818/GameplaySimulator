import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { InstrumentedAdapter } from './InstrumentedAdapter';

function sendJson(response: ServerResponse, payload: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function withInstrumentationServer<T>(test: (endpoint: string) => Promise<T>): Promise<T> {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (request.method === 'GET' && url.pathname === '/gsi/v1/health') {
      sendJson(response, {
        ok: true,
        gameId: 'instrumented-game',
        gameName: 'Instrumented Game',
        instanceId: 'game-instance-001',
        protocolVersion: '0.1.0',
        engine: { type: 'custom' },
        capabilities: {
          stateRead: true,
          directActions: true,
          events: true,
          logs: true
        }
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/gsi/v1/state') {
      sendJson(response, {
        gameId: 'instrumented-game',
        instanceId: url.searchParams.get('instanceId') ?? 'game-instance-001',
        sessionId: 'sdk-test-session',
        scene: 'TestScene',
        tick: 42,
        timestamp: '2026-07-02T20:00:00.000Z',
        playerPosition: {
          playerId: url.searchParams.get('botId') ?? 'bot',
          sceneId: 'TestScene',
          x: 10,
          y: 20,
          z: 0
        },
        uiState: {
          screenId: 'hud',
          openMenus: [],
          modalStack: [],
          metadata: {}
        },
        performance: {
          fps: 60,
          frameTimeMs: 16.6,
          metadata: {}
        },
        inventory: [{ itemId: 'potion', quantity: 2, metadata: {} }],
        quests: [{ questId: 'intro', status: 'active', objectives: ['Start'], metadata: {} }],
        state: { hp: 100 },
        logs: ['state read']
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/gsi/v1/actions') {
      sendJson(response, [
        {
          actionType: 'move-to',
          label: 'Move To',
          description: 'Move to a point.',
          metadata: {}
        }
      ]);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/gsi/v1/actions') {
      const body = (await readBody(request)) as { requestId: string };

      sendJson(response, {
        requestId: body.requestId,
        status: 'succeeded',
        message: 'Action accepted.',
        metadata: {}
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/gsi/v1/events') {
      await readBody(request);
      sendJson(response, { ok: true });
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'Not found' }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    return await test(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

describe('InstrumentedAdapter', () => {
  it('connects to a local endpoint and reads structured state', async () => {
    await withInstrumentationServer(async (endpoint) => {
      const adapter = new InstrumentedAdapter({ instrumentationEndpoint: endpoint });
      const instance = await adapter.launchInstance({
        instanceId: 'game-instance-001',
        gameProfileId: 'instrumented-game',
        launch: { platform: 'linux', arguments: [] },
        maxBots: 2,
        environment: {}
      });

      expect(instance.metadata.instrumentationHealth).toMatchObject({ ok: true });

      const state = await adapter.getState('game-instance-001', 'explorer-001');
      const actions = await adapter.getAvailableActions('game-instance-001', 'explorer-001');
      const result = await adapter.performAction('game-instance-001', 'explorer-001', {
        actionId: 'action-001',
        sessionId: 'sdk-test-session',
        gameInstanceId: 'game-instance-001',
        botId: 'explorer-001',
        type: 'move-to',
        payload: { x: 10, y: 20 },
        requestedAt: '2026-07-02T20:00:00.000Z'
      });

      expect(state?.scene).toBe('TestScene');
      expect(state?.state).toMatchObject({
        hp: 100,
        playerPosition: {
          x: 10,
          y: 20
        }
      });
      expect(state?.metrics.fps).toBe(60);
      expect(actions[0].actionType).toBe('move-to');
      expect(result.status).toBe('succeeded');
    });
  });
});
