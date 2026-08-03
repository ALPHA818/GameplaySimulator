import type { ActionResult, GameAction, GameInstanceConfig, GameStateSnapshot } from '@core/types';
import {
  createInstrumentationClient,
  InstrumentationHealthSchema,
  InstrumentationProtocolVersion,
  parseLoopbackInstrumentationEndpoint,
  type InstrumentationClient,
  type InstrumentationHealth,
  type InstrumentationTransport,
  type InstrumentedGameState
} from '@instrumentation-sdk';
import type { LogEntry } from '@core/logging/LogEntry';
import {
  AdapterRequestBoundaryError,
  adapterRequestEventType,
  assertAdapterResponseSize,
  resolveAdapterRequestPolicy,
  runBoundedAdapterRequest,
  type AdapterRequestPolicy,
  type AdapterRequestPolicyInput
} from '../base/AdapterRequestPolicy';
import {
  decodeAndValidateBase64EvidenceImage,
  EvidenceImageValidationError
} from '../base/ImageEvidence';
import { BaseGameAdapter } from '../base/BaseGameAdapter';
import type {
  AdapterCapabilities,
  AdapterHealth,
  AvailableGameAction,
  GameAdapterInstance,
  ObservationCapability,
  ScreenshotCapture,
  WindowFocusResult
} from '../base/GameAdapter';

export interface InstrumentedAdapterOptions {
  id?: string;
  name?: string;
  instrumentationEndpoint?: string;
  instrumentationTransport?: InstrumentationTransport;
  instrumentationClient?: InstrumentationClient;
  capabilities?: Partial<AdapterCapabilities>;
  observationCapability?: ObservationCapability;
  windowFocusHandler?: (instanceId: string) => Promise<WindowFocusResult>;
  healthTimeoutMs?: number;
  requestPolicy?: AdapterRequestPolicyInput;
}

export type InstrumentationConnectionState =
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'disconnected'
  | 'stopping'
  | 'stopped';

export class InstrumentedAdapter extends BaseGameAdapter {
  readonly instrumentationEndpoint?: string;
  readonly instrumentationTransport: InstrumentationTransport;
  private readonly instrumentationClient?: InstrumentationClient;
  private health?: InstrumentationHealth;
  private readonly requestPolicy: AdapterRequestPolicy;
  private readonly connectionStates = new Map<string, InstrumentationConnectionState>();
  private readonly connectionErrors = new Map<string, string>();
  private readonly activeRequestControllers = new Map<string, Set<AbortController>>();
  private readonly requestLogs = new Map<string, LogEntry[]>();
  private readonly windowFocusHandler?: (instanceId: string) => Promise<WindowFocusResult>;

  constructor(options: InstrumentedAdapterOptions = {}) {
    const observationCapability =
      options.observationCapability ?? options.capabilities?.observationCapability ?? 'unavailable';
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
        supportsGameLogs: true,
        supportsSaveIsolation: true,
        supportsReset: true,
        supportsCheckpointReload: true,
        supportsLiveObservation: observationCapability !== 'unavailable',
        supportsWindowFocus: Boolean(options.windowFocusHandler),
        supportsMultipleVisibleWindows: false,
        observationCapability,
        ...options.capabilities,
        supportsVideo: false
      }
    });

    this.instrumentationEndpoint = options.instrumentationEndpoint;
    this.instrumentationTransport = options.instrumentationTransport ?? 'local-http';
    this.requestPolicy = resolveAdapterRequestPolicy({
      ...options.requestPolicy,
      timeouts: {
        ...options.requestPolicy?.timeouts,
        ...(options.healthTimeoutMs === undefined
          ? {}
          : { healthMs: options.healthTimeoutMs })
      }
    });
    this.windowFocusHandler = options.windowFocusHandler;
    this.instrumentationClient =
      options.instrumentationClient ??
      (options.instrumentationEndpoint
        ? createInstrumentationClient({
            transport: this.instrumentationTransport,
            endpoint: options.instrumentationEndpoint,
            requestTimeouts: {
              healthMs: this.requestPolicy.timeouts.healthMs,
              stateReadMs: this.requestPolicy.timeouts.stateReadMs,
              availableActionsMs: this.requestPolicy.timeouts.availableActionsMs,
              performActionMs: this.requestPolicy.timeouts.performActionMs
            },
            responseSizeLimits: {
              healthBytes: this.requestPolicy.responseSizeLimits.healthBytes,
              stateBytes: this.requestPolicy.responseSizeLimits.stateBytes,
              availableActionsBytes: this.requestPolicy.responseSizeLimits.availableActionsBytes,
              actionResultBytes: this.requestPolicy.responseSizeLimits.actionResultBytes,
              gameLogsBytes: this.requestPolicy.responseSizeLimits.gameLogsBytes,
              screenshotBytes: this.requestPolicy.responseSizeLimits.screenshotBytes
            }
          })
        : undefined);
  }

  async connect(): Promise<InstrumentationHealth | null> {
    if (!this.instrumentationClient) {
      return null;
    }

    this.health = await this.readHealthWithTimeout(
      '__connect__',
      this.requestPolicy.timeouts.connectMs
    );
    return this.health;
  }

  override async launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance> {
    this.connectionStates.set(config.instanceId, 'connecting');
    this.connectionErrors.delete(config.instanceId);

    let health: InstrumentationHealth;
    try {
      this.validateEndpoint();
      health = this.validateHealth(
        await this.readHealthWithTimeout(
          config.instanceId,
          this.requestPolicy.timeouts.connectMs
        ),
        config
      );
    } catch (error) {
      const message = this.connectionFailureMessage(error);
      this.connectionStates.set(config.instanceId, 'failed');
      this.connectionErrors.set(config.instanceId, message);
      throw new Error(message, { cause: error });
    }

    const instance = await super.launchInstance(config);
    this.health = health;
    this.connectionStates.set(config.instanceId, 'connected');

    return {
      ...instance,
      metadata: {
        ...instance.metadata,
        instrumentationEndpoint: this.instrumentationEndpoint,
        instrumentationTransport: this.instrumentationTransport,
        instrumentationHealth: health,
        connectionState: 'connected',
        protocolVersion: health.protocolVersion,
        detectedGameId: health.gameId,
        detectedGameName: health.gameName,
        detectedGameVersion: health.gameVersion,
        detectedBuildId: health.buildId,
        observationCapability: this.capabilities.observationCapability,
        visible: this.capabilities.supportsLiveObservation,
        observationMessage: this.observationMessage()
      }
    };
  }

  override async getState(instanceId: string, botId: string): Promise<GameStateSnapshot | null> {
    if (!this.instrumentationClient) {
      return super.getState(instanceId, botId);
    }

    const state = await this.withConnectedClient(
      instanceId,
      'read game state',
      'state-read',
      this.requestPolicy.timeouts.stateReadMs,
      this.requestPolicy.responseSizeLimits.stateBytes,
      () => this.instrumentationClient!.getState(instanceId, botId)
    );
    return this.toGameStateSnapshot(state, botId);
  }

  override async getAvailableActions(instanceId: string, botId: string): Promise<AvailableGameAction[]> {
    if (!this.instrumentationClient) {
      return super.getAvailableActions(instanceId, botId);
    }

    const actions = await this.withConnectedClient(
      instanceId,
      'read available actions',
      'available-actions',
      this.requestPolicy.timeouts.availableActionsMs,
      this.requestPolicy.responseSizeLimits.availableActionsBytes,
      () => this.instrumentationClient!.getAvailableActions(instanceId, botId)
    );

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

    const startedAt = action.requestedAt;
    let response;
    try {
      response = await this.withConnectedClient(
        instanceId,
        `perform action "${action.type}"`,
        'perform-action',
        Math.min(
          action.timeoutMs ?? this.requestPolicy.timeouts.performActionMs,
          this.requestPolicy.timeouts.performActionMs
        ),
        this.requestPolicy.responseSizeLimits.actionResultBytes,
        () => this.instrumentationClient!.performAction({
          requestId: action.actionId,
          instanceId,
          botId,
          actionType: action.type,
          payload: action.payload,
          timeoutMs: action.timeoutMs
        })
      );
    } catch (error) {
      const completedAt = new Date().toISOString();
      const eventType = adapterRequestEventType(error);

      if (eventType) {
        return {
          actionId: action.actionId,
          botId,
          status: eventType === 'adapter_request_timeout' ? 'timed_out' : 'failed',
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          message: error instanceof Error ? error.message : 'Instrumented action request failed.',
          issueIds: []
        };
      }
      throw error;
    }

    const completedAt = new Date().toISOString();
    return {
      actionId: action.actionId,
      botId,
      status: response.status,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
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

    const adapterLogs = [...(this.requestLogs.get(instanceId) ?? [])];
    if (this.connectionStates.get(instanceId) !== 'connected') {
      return adapterLogs;
    }

    try {
      const state = await this.withConnectedClient(
        instanceId,
        'capture game logs',
        'game-logs',
        this.requestPolicy.timeouts.stateReadMs,
        this.requestPolicy.responseSizeLimits.stateBytes,
        () => this.instrumentationClient!.getState(instanceId, 'system')
      );
      assertAdapterResponseSize(
        state.logs,
        this.requestPolicy.responseSizeLimits.gameLogsBytes,
        'Instrumentation game logs'
      );

      return [
        ...adapterLogs,
        ...state.logs.map((message, index) => ({
          id: `${instanceId}-instrumented-log-${index + 1}`,
          level: 'info' as const,
          message,
          timestamp: state.timestamp,
          source: this.id
        }))
      ];
    } catch {
      return [...(this.requestLogs.get(instanceId) ?? [])];
    }
  }

  override async captureScreenshot(instanceId: string, botId: string): Promise<ScreenshotCapture> {
    if (!this.instrumentationClient) {
      return super.captureScreenshot(instanceId, botId);
    }

    const state = await this.withConnectedClient(
      instanceId,
      'capture screenshot state',
      'evidence',
      this.requestPolicy.timeouts.evidenceMs,
      this.requestPolicy.responseSizeLimits.stateBytes,
      () => this.instrumentationClient!.getState(instanceId, botId)
    );
    const screenshotPathSupplied = Object.hasOwn(state.state, 'screenshotPath');
    const screenshotBase64 = typeof state.state.screenshotBase64 === 'string' ? state.state.screenshotBase64 : undefined;

    if (screenshotPathSupplied) {
      this.rejectEvidence(
        instanceId,
        'instrumented games may not return screenshotPath or any other host filesystem path.'
      );
    }

    if (screenshotBase64) {
      try {
        const image = decodeAndValidateBase64EvidenceImage({
          encoded: screenshotBase64,
          claimedMimeType:
            typeof state.state.screenshotMimeType === 'string'
              ? state.state.screenshotMimeType
              : undefined,
          maximumBytes: this.requestPolicy.responseSizeLimits.screenshotBytes
        });
        return {
          instanceId,
          botId,
          capturedAt: state.timestamp,
          scope: 'game-window',
          data: image.data,
          mimeType: image.mimeType
        };
      } catch (error) {
        if (error instanceof EvidenceImageValidationError) {
          this.rejectEvidence(instanceId, error.message);
        }
        throw error;
      }
    }

    this.rejectEvidence(
      instanceId,
      'instrumented screenshot state did not include bounded PNG or JPEG base64 data.'
    );
  }

  async focusWindow(instanceId: string): Promise<WindowFocusResult> {
    if (this.windowFocusHandler) {
      return this.runInstrumentedRequest(
        instanceId,
        'focus instrumented game window',
        this.requestPolicy.timeouts.performActionMs,
        this.requestPolicy.responseSizeLimits.actionResultBytes,
        () => this.windowFocusHandler!(instanceId)
      );
    }

    return {
      instanceId,
      supported: false,
      visible: this.capabilities.supportsLiveObservation,
      focused: false,
      message: this.capabilities.supportsLiveObservation
        ? 'This instrumented target uses an external game window. Window focus is not supported by this adapter.'
        : 'This instrumented target has no visible game window.'
    };
  }

  openOrFocusGameWindow(instanceId: string): Promise<WindowFocusResult> {
    return this.focusWindow(instanceId);
  }

  override async getHealth(instanceId: string): Promise<AdapterHealth> {
    const baseHealth = await super.getHealth(instanceId);
    const currentState = this.connectionStates.get(instanceId);

    if (currentState === 'failed' && !this.instances.has(instanceId)) {
      return this.failedHealth(
        instanceId,
        'failed',
        this.connectionErrors.get(instanceId) ?? 'Instrumented game connection failed.',
        baseHealth
      );
    }

    if (currentState === 'stopping' || currentState === 'stopped') {
      return {
        ...baseHealth,
        status: currentState === 'stopped' ? 'stopped' : baseHealth.status,
        details: {
          ...baseHealth.details,
          connectionState: currentState,
          observationCapability: this.capabilities.observationCapability,
          supportsWindowFocus: this.capabilities.supportsWindowFocus,
          observationMessage: this.observationMessage()
        }
      };
    }

    if (!this.instrumentationClient) {
      const message = 'Instrumented adapter has no local HTTP client or endpoint.';
      this.connectionStates.set(instanceId, 'failed');
      this.connectionErrors.set(instanceId, message);
      return this.failedHealth(instanceId, 'failed', message, baseHealth);
    }

    try {
      const tracked = this.instances.get(instanceId);
      const health = this.validateHealth(
        await this.readHealthWithTimeout(instanceId),
        tracked?.instance.launchConfig
      );
      this.health = health;
      this.connectionStates.set(instanceId, 'connected');
      this.connectionErrors.delete(instanceId);

      return {
        ...baseHealth,
        status: baseHealth.status === 'stopped' ? 'stopped' : 'running',
        checkedAt: new Date().toISOString(),
        message: health.message ?? 'Instrumented game connection is healthy.',
        details: {
          ...baseHealth.details,
          connectionState: 'connected',
          instrumentationHealth: health,
          protocolVersion: health.protocolVersion,
          gameId: health.gameId,
          gameName: health.gameName,
          gameVersion: health.gameVersion,
          buildId: health.buildId,
          observationCapability: this.capabilities.observationCapability,
          supportsWindowFocus: this.capabilities.supportsWindowFocus,
          observationMessage: this.observationMessage()
        }
      };
    } catch (error) {
      const message = this.connectionFailureMessage(error);
      this.connectionStates.set(instanceId, currentState === 'connecting' ? 'failed' : 'disconnected');
      this.connectionErrors.set(instanceId, message);
      return this.failedHealth(
        instanceId,
        this.connectionStates.get(instanceId) ?? 'disconnected',
        message,
        baseHealth
      );
    }
  }

  override async isRunning(instanceId: string): Promise<boolean> {
    return (await super.isRunning(instanceId)) &&
      this.connectionStates.get(instanceId) === 'connected';
  }

  override async stopInstance(instanceId: string): Promise<void> {
    this.connectionStates.set(instanceId, 'stopping');
    this.abortRequestsForInstance(instanceId);
    this.instrumentationClient?.abortInstance?.(instanceId);
    await super.stopInstance(instanceId);
    this.connectionStates.set(instanceId, 'stopped');
  }

  override async stopAll(): Promise<void> {
    this.abortAllRequests();
    this.instrumentationClient?.abortAll?.('the instrumented adapter is stopping');
    await Promise.all([...this.instances.keys()].map((instanceId) => this.stopInstance(instanceId)));
  }

  abortActiveRequests(): void {
    this.abortAllRequests();
    this.instrumentationClient?.abortAll?.('the instrumented adapter is stopping');
  }

  private validateEndpoint(): void {
    if (this.instrumentationTransport !== 'local-http') {
      throw new Error(
        `${this.instrumentationTransport} instrumentation transport is unavailable. Use Local HTTP for production sessions.`
      );
    }

    if (!this.instrumentationClient) {
      throw new Error('Instrumentation endpoint is required before an instrumented game can launch.');
    }

    if (!this.instrumentationEndpoint) {
      return;
    }

    parseLoopbackInstrumentationEndpoint(this.instrumentationEndpoint);
  }

  private async readHealthWithTimeout(
    instanceId = '__health__',
    timeoutMs = this.requestPolicy.timeouts.healthMs
  ): Promise<InstrumentationHealth> {
    if (!this.instrumentationClient) {
      throw new Error('Instrumentation endpoint is not configured.');
    }

    return this.runInstrumentedRequest(
      instanceId,
      'read instrumentation health',
      timeoutMs,
      this.requestPolicy.responseSizeLimits.healthBytes,
      () => this.instrumentationClient!.getHealth(instanceId, timeoutMs)
    );
  }

  private validateHealth(
    health: InstrumentationHealth,
    config?: GameInstanceConfig
  ): InstrumentationHealth {
    const parsed = InstrumentationHealthSchema.safeParse(health);

    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'health'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Instrumentation health response is invalid: ${details}`);
    }

    const validatedHealth = parsed.data;

    if (validatedHealth.ok !== true) {
      throw new Error(validatedHealth.message ?? 'Instrumented game reported that it is not ready.');
    }

    if (validatedHealth.protocolVersion !== InstrumentationProtocolVersion) {
      throw new Error(
        `Instrumentation protocol ${validatedHealth.protocolVersion} is incompatible with required version ${InstrumentationProtocolVersion}.`
      );
    }

    if (config && validatedHealth.gameId && validatedHealth.gameId !== config.gameProfileId) {
      throw new Error(
        `Instrumentation endpoint belongs to game "${validatedHealth.gameId}", not selected game "${config.gameProfileId}".`
      );
    }

    const expectedVersion = config?.environment.GAMEPLAY_SIMULATOR_GAME_VERSION;
    if (
      expectedVersion &&
      validatedHealth.gameVersion &&
      validatedHealth.gameVersion !== expectedVersion
    ) {
      throw new Error(
        `Instrumented game version "${validatedHealth.gameVersion}" does not match selected version "${expectedVersion}".`
      );
    }

    const expectedBuildId = config?.environment.GAMEPLAY_SIMULATOR_BUILD_ID;
    if (
      expectedBuildId &&
      validatedHealth.buildId &&
      validatedHealth.buildId !== expectedBuildId
    ) {
      throw new Error(
        `Instrumented build "${validatedHealth.buildId}" does not match selected build "${expectedBuildId}".`
      );
    }

    if (this.capabilities.supportsStateRead && !validatedHealth.capabilities.stateRead) {
      throw new Error('Instrumented game health response does not support required state reads.');
    }

    if (
      this.capabilities.supportsDirectActions &&
      !validatedHealth.capabilities.directActions
    ) {
      throw new Error('Instrumented game health response does not support required direct actions.');
    }

    return validatedHealth;
  }

  private async withConnectedClient<T>(
    instanceId: string,
    operation: string,
    requestKind: string,
    timeoutMs: number,
    maximumBytes: number,
    callback: () => Promise<T>
  ): Promise<T> {
    if (this.connectionStates.get(instanceId) !== 'connected') {
      throw new Error(
        this.connectionErrors.get(instanceId) ??
        `Cannot ${operation}: instrumented game is not connected.`
      );
    }

    try {
      return await this.runInstrumentedRequest(
        instanceId,
        requestKind,
        timeoutMs,
        maximumBytes,
        callback
      );
    } catch (error) {
      const message = this.connectionFailureMessage(error, operation);
      this.connectionStates.set(instanceId, 'disconnected');
      this.connectionErrors.set(instanceId, message);
      const eventType = adapterRequestEventType(error);
      if (eventType) {
        throw new AdapterRequestBoundaryError(eventType, requestKind, message);
      }
      throw new Error(message, { cause: error });
    }
  }

  private async runInstrumentedRequest<T>(
    instanceId: string,
    operation: string,
    timeoutMs: number,
    maximumBytes: number,
    callback: () => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    const active = this.activeRequestControllers.get(instanceId) ?? new Set<AbortController>();
    active.add(controller);
    this.activeRequestControllers.set(instanceId, active);

    try {
      const value = await runBoundedAdapterRequest({
        operation,
        timeoutMs,
        signal: controller.signal,
        request: callback
      });
      assertAdapterResponseSize(value, maximumBytes, operation);
      return value;
    } catch (error) {
      this.recordRequestFailure(instanceId, error);
      if (adapterRequestEventType(error) === 'adapter_request_timeout') {
        this.instrumentationClient?.abortInstance?.(instanceId);
      }
      throw error;
    } finally {
      active.delete(controller);
      if (active.size === 0) {
        this.activeRequestControllers.delete(instanceId);
      }
    }
  }

  private abortRequestsForInstance(instanceId: string): void {
    for (const controller of this.activeRequestControllers.get(instanceId) ?? []) {
      controller.abort();
    }
    this.activeRequestControllers.delete(instanceId);
  }

  private abortAllRequests(): void {
    for (const instanceId of this.activeRequestControllers.keys()) {
      this.abortRequestsForInstance(instanceId);
    }
  }

  private recordRequestFailure(instanceId: string, error: unknown): void {
    const eventType = adapterRequestEventType(error);
    if (!eventType) {
      return;
    }

    const logs = this.requestLogs.get(instanceId) ?? [];
    const message = error instanceof Error ? error.message : 'Adapter request failed.';
    logs.push({
      id: `${instanceId}-${eventType}-${logs.length + 1}`,
      level: eventType === 'adapter_request_aborted' ? 'warn' : 'error',
      message: `${eventType}: ${message}`,
      timestamp: new Date().toISOString(),
      source: `${this.id}:request`
    });
    this.requestLogs.set(instanceId, logs);
  }

  private rejectEvidence(instanceId: string, message: string): never {
    const logs = this.requestLogs.get(instanceId) ?? [];
    logs.push({
      id: `${instanceId}-adapter-evidence-rejected-${logs.length + 1}`,
      level: 'warn',
      message: `adapter_evidence_rejected: ${message}`,
      timestamp: new Date().toISOString(),
      source: `${this.id}:evidence`
    });
    this.requestLogs.set(instanceId, logs);
    throw new Error(`Instrumented evidence rejected: ${message}`);
  }

  private connectionFailureMessage(error: unknown, operation = 'connect'): string {
    const detail = error instanceof Error ? error.message : 'Unknown instrumentation error.';
    const endpoint = this.instrumentationEndpoint ?? 'the configured local endpoint';
    return `Unable to ${operation} instrumented game at ${endpoint}: ${detail}`;
  }

  private failedHealth(
    instanceId: string,
    connectionState: InstrumentationConnectionState,
    message: string,
    baseHealth: AdapterHealth
  ): AdapterHealth {
    return {
      ...baseHealth,
      instanceId,
      status: 'failed',
      checkedAt: new Date().toISOString(),
      message,
      details: {
        ...baseHealth.details,
        connectionState,
        instrumentationConnectionError: message,
        instrumentationEndpoint: this.instrumentationEndpoint,
        instrumentationTransport: this.instrumentationTransport,
        observationCapability: this.capabilities.observationCapability,
        supportsWindowFocus: this.capabilities.supportsWindowFocus,
        observationMessage: this.observationMessage()
      }
    };
  }

  private observationMessage(): string {
    if (!this.capabilities.supportsLiveObservation) {
      return 'This instrumented target has no visible game window.';
    }

    return this.capabilities.supportsWindowFocus
      ? 'This instrumented target exposes a visible game window that the simulator can focus.'
      : 'This instrumented target uses an external game window. Window focus is not supported by this adapter.';
  }

  private toGameStateSnapshot(state: InstrumentedGameState, botId: string): GameStateSnapshot {
    const {
      screenshotPath: _ignoredScreenshotPath,
      screenshotBase64: _ignoredScreenshotBase64,
      screenshotMimeType: _ignoredScreenshotMimeType,
      ...safeState
    } = state.state;

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
        ...safeState,
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
