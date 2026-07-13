import type { ActionResult, GameAction, GameInstanceConfig, GameStateSnapshot } from '@core/types';
import {
  createInstrumentationClient,
  type InstrumentationClient,
  type InstrumentationHealth,
  type InstrumentationTransport,
  type InstrumentedGameState
} from '@instrumentation-sdk';
import { BaseGameAdapter } from '../base/BaseGameAdapter';
import type {
  AdapterCapabilities,
  AvailableGameAction,
  GameAdapterInstance,
  ScreenshotCapture
} from '../base/GameAdapter';

export interface InstrumentedAdapterOptions {
  id?: string;
  name?: string;
  instrumentationEndpoint?: string;
  instrumentationTransport?: InstrumentationTransport;
  instrumentationClient?: InstrumentationClient;
  capabilities?: Partial<AdapterCapabilities>;
}

export class InstrumentedAdapter extends BaseGameAdapter {
  readonly instrumentationEndpoint?: string;
  readonly instrumentationTransport: InstrumentationTransport;
  private readonly instrumentationClient?: InstrumentationClient;
  private health?: InstrumentationHealth;

  constructor(options: InstrumentedAdapterOptions = {}) {
    super({
      id: options.id ?? 'instrumented',
      name: options.name ?? 'Instrumented Adapter',
      adapterType: 'instrumented',
      capabilities: {
        supportsMultipleInstances: true,
        supportsMultipleBotsPerInstance: true,
        supportsStateRead: true,
        supportsDirectActions: true,
        supportsInputSimulation: false,
        supportsScreenshots: true,
        supportsVideo: true,
        supportsGameLogs: true,
        supportsSaveIsolation: true,
        supportsReset: true,
        supportsCheckpointReload: true,
        ...options.capabilities
      }
    });

    this.instrumentationEndpoint = options.instrumentationEndpoint;
    this.instrumentationTransport = options.instrumentationTransport ?? 'local-http';
    this.instrumentationClient =
      options.instrumentationClient ??
      (options.instrumentationEndpoint
        ? createInstrumentationClient({
            transport: this.instrumentationTransport,
            endpoint: options.instrumentationEndpoint
          })
        : undefined);
  }

  async connect(): Promise<InstrumentationHealth | null> {
    if (!this.instrumentationClient) {
      return null;
    }

    this.health = await this.instrumentationClient.getHealth();
    return this.health;
  }

  override async launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance> {
    const instance = await super.launchInstance(config);
    const health = await this.connect().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown instrumentation connection failure.';
      instance.metadata.instrumentationConnectionError = message;
      return null;
    });

    return {
      ...instance,
      metadata: {
        ...instance.metadata,
        instrumentationEndpoint: this.instrumentationEndpoint,
        instrumentationTransport: this.instrumentationTransport,
        instrumentationHealth: health
      }
    };
  }

  override async getState(instanceId: string, botId: string): Promise<GameStateSnapshot | null> {
    if (!this.instrumentationClient) {
      return super.getState(instanceId, botId);
    }

    const state = await this.instrumentationClient.getState(instanceId, botId);
    return this.toGameStateSnapshot(state, botId);
  }

  override async getAvailableActions(instanceId: string, botId: string): Promise<AvailableGameAction[]> {
    if (!this.instrumentationClient) {
      return super.getAvailableActions(instanceId, botId);
    }

    const actions = await this.instrumentationClient.getAvailableActions(instanceId, botId);

    return actions.map((action) => ({
      actionType: action.actionType,
      label: action.label,
      description: action.description,
      requiresStateRead: true,
      requiresDirectAction: true,
      requiresInputSimulation: false,
      payloadSchema: action.payloadSchema
    }));
  }

  override async performAction(instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    if (!this.instrumentationClient) {
      return super.performAction(instanceId, botId, action);
    }

    const response = await this.instrumentationClient.performAction({
      requestId: action.actionId,
      instanceId,
      botId,
      actionType: action.type,
      payload: action.payload,
      timeoutMs: action.timeoutMs
    });

    return {
      actionId: action.actionId,
      botId,
      status: response.status,
      startedAt: action.requestedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
      message: response.message,
      stateSnapshotId: response.state
        ? `${response.state.instanceId}-${botId}-${response.state.tick ?? Date.now()}`
        : undefined,
      issueIds: []
    };
  }

  override async captureLogs(instanceId: string) {
    if (!this.instrumentationClient) {
      return super.captureLogs(instanceId);
    }

    const state = await this.instrumentationClient.getState(instanceId, 'system');

    return state.logs.map((message, index) => ({
      id: `${instanceId}-instrumented-log-${index + 1}`,
      level: 'info' as const,
      message,
      timestamp: state.timestamp,
      source: this.id
    }));
  }

  override async captureScreenshot(instanceId: string, botId: string): Promise<ScreenshotCapture> {
    if (!this.instrumentationClient) {
      return super.captureScreenshot(instanceId, botId);
    }

    const state = await this.instrumentationClient.getState(instanceId, botId);
    const screenshotPath = typeof state.state.screenshotPath === 'string' ? state.state.screenshotPath : undefined;
    const screenshotBase64 = typeof state.state.screenshotBase64 === 'string' ? state.state.screenshotBase64 : undefined;
    const mimeType = typeof state.state.screenshotMimeType === 'string'
      ? state.state.screenshotMimeType
      : screenshotBase64
        ? 'image/png'
        : undefined;

    if (screenshotPath) {
      return {
        instanceId,
        botId,
        capturedAt: state.timestamp,
        path: screenshotPath,
        mimeType
      };
    }

    if (screenshotBase64) {
      return {
        instanceId,
        botId,
        capturedAt: state.timestamp,
        data: Buffer.from(screenshotBase64, 'base64'),
        mimeType
      };
    }

    return super.captureScreenshot(instanceId, botId);
  }

  private toGameStateSnapshot(state: InstrumentedGameState, botId: string): GameStateSnapshot {
    return {
      snapshotId: `${state.instanceId}-${botId}-${state.tick ?? Date.now()}`,
      sessionId: state.sessionId ?? 'instrumented-session',
      gameId: state.gameId,
      gameInstanceId: state.instanceId,
      botId,
      capturedAt: state.timestamp,
      tick: state.tick,
      scene: state.scene,
      state: {
        ...state.state,
        playerPosition: state.playerPosition,
        uiState: state.uiState,
        inventory: state.inventory,
        quests: state.quests,
        performance: state.performance
      },
      metrics: state.performance
        ? Object.fromEntries(
            Object.entries(state.performance).filter((entry): entry is [string, number] => {
              const value = entry[1];
              return typeof value === 'number';
            })
          )
        : {}
    };
  }
}
