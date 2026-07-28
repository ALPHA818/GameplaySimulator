import { createServer, type Server } from 'node:http';
import type {
  BotProfile,
  BotTestDirective,
  GameAction,
  GameProfile,
  SimulationRunConfig
} from '@core/types';
import {
  BotProfileSchema,
  GameProfileSchema,
  SimulationRunConfigSchema
} from '@core/types';
import type { SystemResourceSnapshot } from '@core/resources/ResourceManager';

export const releaseSystemSnapshot: SystemResourceSnapshot = {
  cpuCoreCount: 8,
  totalRamMb: 32_000,
  freeRamMb: 24_000,
  currentCpuLoadPercent: 8,
  currentRamUsagePercent: 20,
  platform: process.platform,
  osRelease: 'release-e2e'
};

export const releaseBotProfile: BotProfile = BotProfileSchema.parse({
  profileId: 'release-e2e-bot',
  displayName: 'Release E2E Bot',
  botType: 'explorer',
  profileGroup: 'custom',
  specializationCategory: 'gameplay-systems',
  playstyle: 'explorer',
  description: 'Exercises reported actions in the controlled release test target.',
  preferredActions: ['move-forward', 'open-menu'],
  avoidedActions: ['trigger-crash'],
  requiredCapabilities: ['state-read', 'direct-actions'],
  recommendedGameTypes: ['custom'],
  goals: [],
  recommendedMinCount: 1,
  recommendedMaxCount: 1,
  defaultResourceWeight: 'light',
  defaultEnabled: false,
  tags: ['release-e2e'],
  config: {}
});

export function createInstrumentedGameProfile(
  endpoint: string,
  gameId = 'release-instrumented-game'
): GameProfile {
  return GameProfileSchema.parse({
    gameId,
    gameName: 'Release Instrumented Game',
    version: '1.0.0',
    buildId: 'release-e2e-build',
    engine: {
      type: 'custom',
      version: 'test-server'
    },
    launch: {
      platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux',
      arguments: []
    },
    adapter: {
      type: 'instrumented',
      supportsMultipleInstances: true,
      supportsStateRead: true,
      supportsDirectActions: true,
      supportsScreenshots: true,
      supportsVideo: false,
      supportsSaveIsolation: true,
      instrumentationEndpoint: endpoint,
      instrumentationTransport: 'local-http'
    },
    controls: [],
    testingTargets: [],
    progressSignals: [],
    failureSignals: [],
    uiFlows: [],
    knownContent: {
      scenes: ['Start Area', 'Hidden Grotto'],
      items: ['health-potion'],
      quests: ['qa-intro'],
      hiddenAreas: ['Hidden Grotto']
    }
  });
}

export function createReleaseRunConfig(
  sessionId: string,
  options: {
    directives?: BotTestDirective[];
    maxActionsPerBot?: number;
    saveScreenshots?: boolean;
  } = {}
): SimulationRunConfig {
  return SimulationRunConfigSchema.parse({
    sessionId,
    sessionLabel: 'Smoke Test',
    gameProfilePath: 'memory://game-profiles/release-instrumented-game',
    adapterType: 'instrumented',
    runMode: 'parallel',
    runUntilStopped: false,
    maxRuntimeMinutes: 1,
    stopOnCriticalIssue: false,
    saveScreenshots: options.saveScreenshots ?? false,
    saveVideo: false,
    saveActionTimeline: true,
    saveStateSnapshots: true,
    useMockRuntime: false,
    directives: options.directives,
    botPools: [
      {
        profileId: releaseBotProfile.profileId,
        enabled: true,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1,
        scalingMode: 'fixed',
        priority: 10,
        resourceWeight: 'light'
      }
    ],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: 5,
    maxActionsPerBot: options.maxActionsPerBot ?? 1,
    resourceLimits: {
      maxCpuPercent: 90,
      maxRamPercent: 90,
      reserveRamMb: 256,
      maxGameInstances: 1,
      allowAutoScaling: false
    }
  });
}

export function createGameAction(
  type: string,
  instanceId: string,
  payload: Record<string, unknown> = {}
): GameAction {
  return {
    actionId: `${type}-${Date.now()}`,
    sessionId: 'release-e2e-session',
    gameInstanceId: instanceId,
    botId: 'release-e2e-bot-001',
    type,
    payload,
    requestedAt: new Date().toISOString()
  };
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 8_000
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out waiting for ${message}.`);
}

export interface RunningBrowserTestPage {
  url: string;
  server: Server;
  stop: () => Promise<void>;
}

export async function startBrowserTestPage(): Promise<RunningBrowserTestPage> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      connection: 'close'
    });
    response.end(`<!doctype html>
<html>
  <head>
    <title>GameplaySimulator Release Input Test</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      #target { position: absolute; left: 40px; top: 40px; width: 160px; height: 60px; }
    </style>
  </head>
  <body>
    <button id="target">Release Click Target</button>
    <script>
      window.releaseInputState = { keyPresses: 0, clicks: 0, lastKey: '' };
      document.addEventListener('keydown', (event) => {
        window.releaseInputState.keyPresses += 1;
        window.releaseInputState.lastKey = event.key;
      });
      document.querySelector('#target').addEventListener('click', () => {
        window.releaseInputState.clicks += 1;
      });
      window.__GAMEPLAY_SIM_STATE__ = ({ instanceId, botId }) => ({
        gameId: 'release-browser-game',
        sessionId: 'release-browser-session',
        instanceId,
        scene: 'Input Test',
        tick: window.releaseInputState.keyPresses + window.releaseInputState.clicks,
        timestamp: new Date().toISOString(),
        state: {
          ...window.releaseInputState,
          lastBotId: botId
        },
        performance: { fps: 60, memoryMb: 64 }
      });
      window.__GAMEPLAY_SIM_ACTIONS__ = () => [
        { actionType: 'keyboard-press', label: 'Keyboard Press' },
        { actionType: 'mouse-click', label: 'Mouse Click' }
      ];
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

  if (!address || typeof address === 'string') {
    throw new Error('Browser release test server did not bind to a TCP port.');
  }

  return {
    url: `http://127.0.0.1:${address.port}/release-game.html`,
    server,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
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

export function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
