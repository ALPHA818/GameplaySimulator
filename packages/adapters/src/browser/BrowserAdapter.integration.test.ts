import { createServer, type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameAction, GameInstanceConfig } from '@core/types';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserAdapter } from './BrowserAdapter';

interface RunningHtmlServer {
  url: string;
  stop: () => Promise<void>;
}

async function startHtmlGameServer(): Promise<RunningHtmlServer> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8'
    });
    response.end(`<!doctype html>
<html>
  <head><title>GameplaySimulator Browser Integration</title></head>
  <body>
    <canvas id="game" width="320" height="180"></canvas>
    <script>
      window.__gameplayTick = 0;
      window.__gameplayScene = 'Browser Start';
      window.__gameplayMoves = 0;
      window.__GAMEPLAY_SIM_STATE__ = ({ instanceId, botId }) => ({
        gameId: 'browser-integration-game',
        sessionId: 'browser-integration-session',
        instanceId,
        scene: window.__gameplayScene,
        tick: window.__gameplayTick,
        timestamp: new Date().toISOString(),
        playerPosition: { x: window.__gameplayMoves, y: 0, z: 0 },
        state: {
          moves: window.__gameplayMoves,
          lastBotId: botId
        },
        performance: { fps: 60, memoryMb: 128 }
      });
      window.__GAMEPLAY_SIM_ACTIONS__ = ({ botId }) => [
        { actionType: 'move-forward', label: 'Move Forward', description: 'Move for ' + botId },
        { actionType: 'open-menu', label: 'Open Menu' }
      ];
      window.__GAMEPLAY_SIM_PERFORM_ACTION__ = (action) => {
        window.__gameplayTick += 1;
        if (action.type === 'move-forward') {
          window.__gameplayMoves += 1;
          window.__gameplayScene = 'Browser Field';
        }
        if (action.type === 'open-menu') {
          window.__gameplayScene = 'Browser Menu';
        }
        return { status: 'succeeded', message: 'Handled ' + action.type };
      };
      console.warn('browser integration warning');
    </script>
  </body>
</html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/game.html`,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
  };
}

function action(type: string, instanceId: string): GameAction {
  return {
    actionId: `${type}-001`,
    sessionId: 'browser-integration-session',
    gameInstanceId: instanceId,
    botId: 'browser-bot-001',
    type,
    payload: {},
    requestedAt: new Date().toISOString()
  };
}

describe('BrowserAdapter integration', () => {
  const adapters: BrowserAdapter[] = [];

  afterEach(async () => {
    await Promise.all(adapters.map((adapter) => adapter.stopAll()));
    adapters.length = 0;
  });

  it('launches a real Playwright browser page and reads instrumented state/actions', async () => {
    const server = await startHtmlGameServer();
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'gameplay-simulator-browser-real-'));
    const adapter = new BrowserAdapter({
      targetUrl: server.url,
      browserName: 'chromium',
      screenshotDirectory,
      headless: true
    });
    adapters.push(adapter);

    const instanceConfig: GameInstanceConfig = {
      instanceId: 'browser-instance-001',
      gameProfileId: 'browser-integration-game',
      launch: {
        platform: 'browser',
        url: server.url,
        arguments: []
      },
      maxBots: 1,
      environment: {}
    };

    try {
      await adapter.launchInstance(instanceConfig);

      const firstState = await adapter.getState(instanceConfig.instanceId, 'browser-bot-001');
      const actions = await adapter.getAvailableActions(instanceConfig.instanceId, 'browser-bot-001');
      const result = await adapter.performAction(
        instanceConfig.instanceId,
        'browser-bot-001',
        action('move-forward', instanceConfig.instanceId)
      );
      const nextState = await adapter.getState(instanceConfig.instanceId, 'browser-bot-001');
      const screenshot = await adapter.captureScreenshot(instanceConfig.instanceId, 'browser-bot-001');
      const logs = await adapter.captureLogs(instanceConfig.instanceId);

      expect(firstState.scene).toBe('Browser Start');
      expect(actions.map((available) => available.actionType)).toEqual(['move-forward', 'open-menu']);
      expect(result).toEqual(expect.objectContaining({ status: 'succeeded', message: 'Handled move-forward' }));
      expect(nextState.scene).toBe('Browser Field');
      expect(nextState.tick).toBeGreaterThan(firstState.tick ?? -1);
      expect(nextState.state).toEqual(expect.objectContaining({ moves: 1 }));
      expect(screenshot.path).toContain(screenshotDirectory);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ level: 'warn', message: 'browser integration warning' })
        ])
      );
    } finally {
      await adapter.stopAll();
      await server.stop();
    }
  });
});
