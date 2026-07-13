import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

type QuestStatus = 'unknown' | 'not_started' | 'active' | 'completed' | 'failed';
type ActionStatus = 'succeeded' | 'failed' | 'skipped' | 'timed_out';

interface InventoryItem {
  itemId: string;
  name?: string;
  quantity: number;
  metadata: Record<string, unknown>;
}

interface QuestState {
  questId: string;
  name?: string;
  status: QuestStatus;
  stepId?: string;
  objectives: string[];
  metadata: Record<string, unknown>;
}

interface FakeGameState {
  gameId: string;
  gameName: string;
  instanceId: string;
  sessionId: string;
  scene: string;
  tick: number;
  playerPosition: {
    playerId: string;
    sceneId: string;
    x: number;
    y: number;
    z: number;
    rotation: number;
  };
  uiState: {
    screenId: string;
    focusedElementId?: string;
    openMenus: string[];
    modalStack: string[];
    metadata: Record<string, unknown>;
  };
  performance: {
    fps: number;
    frameTimeMs: number;
    cpuMs: number;
    gpuMs: number;
    memoryMb: number;
    drawCalls: number;
    metadata: Record<string, unknown>;
  };
  inventory: InventoryItem[];
  quests: QuestState[];
  currency: number;
  crashed: boolean;
  stuck: boolean;
  hiddenAreaEntered: boolean;
  logs: string[];
  events: unknown[];
}

interface PerformActionRequest {
  requestId: string;
  instanceId: string;
  botId: string;
  actionType: string;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface InstrumentedTestServerOptions {
  host?: string;
  port?: number;
  gameId?: string;
  gameName?: string;
  sessionId?: string;
}

export interface RunningInstrumentedTestServer {
  server: Server;
  endpoint: string;
  stop: () => Promise<void>;
  getState: (instanceId?: string) => FakeGameState;
}

const defaultActions = [
  {
    actionType: 'move-forward',
    label: 'Move Forward',
    description: 'Move the player forward in the current scene.',
    metadata: { tags: ['movement', 'progress'] }
  },
  {
    actionType: 'open-menu',
    label: 'Open Menu',
    description: 'Open the pause menu.',
    metadata: { tags: ['ui'] }
  },
  {
    actionType: 'close-menu',
    label: 'Close Menu',
    description: 'Close the current menu.',
    metadata: { tags: ['ui'] }
  },
  {
    actionType: 'accept-quest',
    label: 'Accept Quest',
    description: 'Accept the sample QA quest.',
    metadata: { tags: ['quest'] }
  },
  {
    actionType: 'turn-in-quest',
    label: 'Turn In Quest',
    description: 'Complete the sample QA quest.',
    metadata: { tags: ['quest'] }
  },
  {
    actionType: 'buy-item',
    label: 'Buy Item',
    description: 'Buy a potion from the fake shop.',
    metadata: { tags: ['economy', 'inventory'] }
  },
  {
    actionType: 'trigger-crash',
    label: 'Trigger Crash',
    description: 'Set the fake game to a crashed state for detector testing.',
    metadata: { tags: ['issue', 'crash'] }
  },
  {
    actionType: 'trigger-stuck',
    label: 'Trigger Stuck',
    description: 'Set the fake game to a no-progress state for stuck testing.',
    metadata: { tags: ['issue', 'stuck'] }
  },
  {
    actionType: 'enter-hidden-area',
    label: 'Enter Hidden Area',
    description: 'Move to hidden content for coverage testing.',
    metadata: { tags: ['coverage', 'hidden-area'] }
  }
];

function timestamp(): string {
  return new Date().toISOString();
}

function createInitialState(options: Required<InstrumentedTestServerOptions>, instanceId: string): FakeGameState {
  return {
    gameId: options.gameId,
    gameName: options.gameName,
    instanceId,
    sessionId: options.sessionId,
    scene: 'Start Area',
    tick: 0,
    playerPosition: {
      playerId: 'player',
      sceneId: 'Start Area',
      x: 0,
      y: 0,
      z: 0,
      rotation: 0
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
      cpuMs: 4,
      gpuMs: 6,
      memoryMb: 512,
      drawCalls: 1200,
      metadata: {}
    },
    inventory: [
      {
        itemId: 'starter-sword',
        name: 'Starter Sword',
        quantity: 1,
        metadata: {}
      }
    ],
    quests: [
      {
        questId: 'qa-intro',
        name: 'QA Intro Quest',
        status: 'not_started',
        stepId: 'talk-to-guide',
        objectives: ['Talk to the guide'],
        metadata: {}
      }
    ],
    currency: 25,
    crashed: false,
    stuck: false,
    hiddenAreaEntered: false,
    logs: ['Fake instrumented game booted.'],
    events: []
  };
}

function stateForResponse(state: FakeGameState, botId: string) {
  return {
    gameId: state.gameId,
    instanceId: state.instanceId,
    sessionId: state.sessionId,
    scene: state.scene,
    tick: state.tick,
    timestamp: timestamp(),
    playerPosition: {
      ...state.playerPosition,
      playerId: botId,
      sceneId: state.scene
    },
    uiState: state.uiState,
    performance: state.performance,
    inventory: state.inventory,
    quests: state.quests,
    state: {
      scene: state.scene,
      currency: state.currency,
      processAlive: !state.crashed,
      processStatus: state.crashed ? 'crashed' : 'running',
      processResponsive: !state.stuck,
      noProgress: state.stuck,
      enteredHiddenArea: state.hiddenAreaEntered,
      contentCoverage: {
        visitedScenes: state.hiddenAreaEntered ? ['Start Area', 'Hidden Grotto'] : ['Start Area'],
        hiddenAreas: state.hiddenAreaEntered ? ['Hidden Grotto'] : []
      },
      error: state.crashed ? 'Fatal crash triggered by fake instrumentation action.' : undefined,
      stuckReason: state.stuck ? 'Fake no-progress state triggered by test action.' : undefined
    },
    logs: state.logs
  };
}

function actionsForState(state: FakeGameState) {
  if (state.crashed) {
    return [];
  }

  return defaultActions;
}

function upsertInventoryItem(state: FakeGameState, itemId: string, name: string, quantityDelta: number): void {
  const item = state.inventory.find((entry) => entry.itemId === itemId);

  if (item) {
    item.quantity += quantityDelta;
    return;
  }

  state.inventory.push({
    itemId,
    name,
    quantity: Math.max(0, quantityDelta),
    metadata: {}
  });
}

function applyAction(state: FakeGameState, request: PerformActionRequest): { status: ActionStatus; message: string } {
  state.tick += 1;
  state.logs.push(`Action ${request.actionType} requested by ${request.botId}.`);

  if (state.crashed && request.actionType !== 'reset') {
    return {
      status: 'failed',
      message: 'The fake game is crashed. No actions are available until the server is restarted.'
    };
  }

  switch (request.actionType) {
    case 'move-forward':
      if (!state.stuck) {
        state.playerPosition.y += 1;
        state.playerPosition.rotation = 0;
      }
      state.logs.push(`Player moved to y=${state.playerPosition.y}.`);
      return { status: 'succeeded', message: 'Moved forward.' };
    case 'open-menu':
      state.uiState.screenId = 'pause-menu';
      state.uiState.openMenus = ['pause-menu'];
      state.uiState.focusedElementId = 'resume-button';
      return { status: 'succeeded', message: 'Menu opened.' };
    case 'close-menu':
      state.uiState.screenId = 'hud';
      state.uiState.openMenus = [];
      state.uiState.modalStack = [];
      state.uiState.focusedElementId = undefined;
      return { status: 'succeeded', message: 'Menu closed.' };
    case 'accept-quest': {
      const quest = state.quests.find((entry) => entry.questId === 'qa-intro');
      if (quest) {
        quest.status = 'active';
        quest.stepId = 'collect-proof';
        quest.objectives = ['Collect test proof', 'Return to guide'];
      }
      return { status: 'succeeded', message: 'Quest accepted.' };
    }
    case 'turn-in-quest': {
      const quest = state.quests.find((entry) => entry.questId === 'qa-intro');
      if (quest?.status !== 'active') {
        return { status: 'skipped', message: 'Quest is not active yet.' };
      }
      quest.status = 'completed';
      quest.stepId = 'complete';
      quest.objectives = ['Quest complete'];
      state.currency += 10;
      upsertInventoryItem(state, 'quest-token', 'Quest Token', 1);
      return { status: 'succeeded', message: 'Quest completed.' };
    }
    case 'buy-item':
      if (state.currency < 5) {
        return { status: 'failed', message: 'Not enough currency to buy a potion.' };
      }
      state.currency -= 5;
      upsertInventoryItem(state, 'health-potion', 'Health Potion', 1);
      return { status: 'succeeded', message: 'Bought one health potion.' };
    case 'trigger-crash':
      state.crashed = true;
      state.logs.push('Fatal crash triggered for QA detector testing.');
      return { status: 'succeeded', message: 'Fake crash state enabled.' };
    case 'trigger-stuck':
      state.stuck = true;
      state.logs.push('No-progress stuck state triggered for QA detector testing.');
      return { status: 'succeeded', message: 'Fake stuck state enabled.' };
    case 'enter-hidden-area':
      state.scene = 'Hidden Grotto';
      state.playerPosition.sceneId = 'Hidden Grotto';
      state.playerPosition.x = 99;
      state.playerPosition.y = 12;
      state.hiddenAreaEntered = true;
      state.logs.push('Hidden area entered for content coverage testing.');
      return { status: 'succeeded', message: 'Entered Hidden Grotto.' };
    default:
      return { status: 'skipped', message: `Unknown fake action: ${request.actionType}.` };
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString('utf8');
  return text.length > 0 ? JSON.parse(text) : {};
}

function normalizeOptions(options: InstrumentedTestServerOptions): Required<InstrumentedTestServerOptions> {
  return {
    host: options.host ?? process.env.GSI_EXAMPLE_HOST ?? '127.0.0.1',
    port: options.port ?? Number(process.env.GSI_EXAMPLE_PORT ?? 4317),
    gameId: options.gameId ?? 'fake-instrumented-game',
    gameName: options.gameName ?? 'Fake Instrumented Game',
    sessionId: options.sessionId ?? 'fake-instrumented-session'
  };
}

export function createInstrumentedTestServer(options: InstrumentedTestServerOptions = {}): Server {
  const normalized = normalizeOptions(options);
  const states = new Map<string, FakeGameState>();

  function getState(instanceId: string): FakeGameState {
    const existing = states.get(instanceId);

    if (existing) {
      return existing;
    }

    const state = createInitialState(normalized, instanceId);
    states.set(instanceId, state);
    return state;
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${normalized.host}`);

    if (request.method === 'OPTIONS') {
      sendJson(response, 200, { ok: true });
      return;
    }

    try {
      if (request.method === 'GET' && url.pathname === '/gsi/v1/health') {
        sendJson(response, 200, {
          ok: true,
          gameId: normalized.gameId,
          gameName: normalized.gameName,
          instanceId: 'game-instance-001',
          protocolVersion: '0.1.0',
          engine: { type: 'custom', version: 'example-server' },
          capabilities: {
            stateRead: true,
            directActions: true,
            events: true,
            logs: true
          },
          message: 'Fake instrumented game server is ready.'
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/gsi/v1/state') {
        const instanceId = url.searchParams.get('instanceId') ?? 'game-instance-001';
        const botId = url.searchParams.get('botId') ?? 'system';
        const state = getState(instanceId);
        state.tick += 1;
        sendJson(response, 200, stateForResponse(state, botId));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/gsi/v1/actions') {
        const instanceId = url.searchParams.get('instanceId') ?? 'game-instance-001';
        sendJson(response, 200, actionsForState(getState(instanceId)));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/gsi/v1/actions') {
        const body = (await readJsonBody(request)) as PerformActionRequest;
        const instanceId = body.instanceId ?? 'game-instance-001';
        const botId = body.botId ?? 'system';
        const state = getState(instanceId);
        const result = applyAction(state, body);
        sendJson(response, 200, {
          requestId: body.requestId,
          status: result.status,
          message: result.message,
          state: stateForResponse(state, botId),
          metadata: {
            fakeServer: true,
            actionType: body.actionType
          }
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/gsi/v1/events') {
        const body = await readJsonBody(request);
        const record = body as { instanceId?: string; name?: string; kind?: string };
        const instanceId = record.instanceId ?? 'game-instance-001';
        const state = getState(instanceId);
        state.events.push(body);
        state.logs.push(`Event received: ${record.kind ?? 'event'} ${record.name ?? ''}`.trim());
        sendJson(response, 200, { ok: true, received: true });
        return;
      }

      sendJson(response, 404, { message: `No fake instrumentation route for ${request.method} ${url.pathname}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown fake server error.';
      sendJson(response, 500, { message });
    }
  });

  Object.assign(server, {
    getFakeState: getState
  });

  return server;
}

export async function startInstrumentedTestServer(
  options: InstrumentedTestServerOptions = {}
): Promise<RunningInstrumentedTestServer> {
  const normalized = normalizeOptions(options);
  const server = createInstrumentedTestServer(normalized);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(normalized.port, normalized.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : normalized.port;
  const endpoint = `http://${normalized.host}:${port}`;

  return {
    server,
    endpoint,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    getState: (instanceId = 'game-instance-001') => {
      const withState = server as Server & { getFakeState?: (id: string) => FakeGameState };
      if (!withState.getFakeState) {
        throw new Error('Fake state accessor is unavailable.');
      }
      return withState.getFakeState(instanceId);
    }
  };
}

async function main(): Promise<void> {
  const portArg = process.argv.find((arg) => arg.startsWith('--port='));
  const hostArg = process.argv.find((arg) => arg.startsWith('--host='));
  const port = portArg ? Number(portArg.slice('--port='.length)) : undefined;
  const host = hostArg ? hostArg.slice('--host='.length) : undefined;
  const running = await startInstrumentedTestServer({ host, port });

  console.log(`Fake instrumented game server running at ${running.endpoint}`);
  console.log('Routes:');
  console.log('  GET  /gsi/v1/health');
  console.log('  GET  /gsi/v1/state?instanceId=game-instance-001&botId=explorer-001');
  console.log('  GET  /gsi/v1/actions?instanceId=game-instance-001&botId=explorer-001');
  console.log('  POST /gsi/v1/actions');
  console.log('  POST /gsi/v1/events');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
