import {
  InstrumentationEventSchema,
  InstrumentationHealthSchema,
  InstrumentationTransportSchema,
  InstrumentedActionSchema,
  InstrumentedGameStateSchema,
  PerformActionResponseSchema,
  type InstrumentationEvent,
  type InstrumentationHealth,
  type InstrumentationTransport,
  type InstrumentedAction,
  type InstrumentedGameState,
  type PerformActionRequest,
  type PerformActionResponse
} from './protocol';
import { parseLoopbackInstrumentationEndpoint } from './endpointSecurity';

export interface InstrumentationClient {
  transport: InstrumentationTransport;
  getHealth(instanceId?: string, timeoutMs?: number): Promise<InstrumentationHealth>;
  getState(instanceId: string, botId: string): Promise<InstrumentedGameState>;
  getAvailableActions(instanceId: string, botId: string): Promise<InstrumentedAction[]>;
  performAction(request: PerformActionRequest): Promise<PerformActionResponse>;
  emitEvent(event: InstrumentationEvent): Promise<void>;
  abortInstance?(instanceId: string): void;
  abortAll?(reason?: string): void;
}

export interface InstrumentationRequestTimeouts {
  healthMs: number;
  stateReadMs: number;
  availableActionsMs: number;
  performActionMs: number;
}

export interface InstrumentationResponseSizeLimits {
  healthBytes: number;
  stateBytes: number;
  availableActionsBytes: number;
  actionResultBytes: number;
  gameLogsBytes: number;
  screenshotBytes: number;
}

export interface LocalHttpInstrumentationClientOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  requestTimeouts?: Partial<InstrumentationRequestTimeouts>;
  responseSizeLimits?: Partial<InstrumentationResponseSizeLimits>;
}

interface LocalHttpErrorBody {
  message?: string;
}

export type InstrumentationRequestEventType =
  | 'adapter_request_timeout'
  | 'adapter_request_aborted'
  | 'adapter_response_too_large';

export class InstrumentationRequestError extends Error {
  constructor(
    readonly eventType: InstrumentationRequestEventType,
    readonly operation: string,
    message: string
  ) {
    super(message);
    this.name = 'InstrumentationRequestError';
  }
}

const defaultRequestTimeouts: InstrumentationRequestTimeouts = {
  healthMs: 5_000,
  stateReadMs: 5_000,
  availableActionsMs: 5_000,
  performActionMs: 10_000
};

const defaultResponseSizeLimits: InstrumentationResponseSizeLimits = {
  healthBytes: 64 * 1024,
  stateBytes: 4 * 1024 * 1024,
  availableActionsBytes: 1024 * 1024,
  actionResultBytes: 1024 * 1024,
  gameLogsBytes: 1024 * 1024,
  screenshotBytes: 16 * 1024 * 1024
};

function endpointUrl(baseEndpoint: string, path: string, params?: Record<string, string>): string {
  const url = new URL(path, baseEndpoint.endsWith('/') ? baseEndpoint : `${baseEndpoint}/`);

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength;
}

function assertPayloadSize(
  value: unknown,
  maximumBytes: number,
  operation: string
): void {
  const actualBytes = byteLength(value);

  if (actualBytes > maximumBytes) {
    throw new InstrumentationRequestError(
      'adapter_response_too_large',
      operation,
      `${operation} returned ${actualBytes} bytes, exceeding the ${maximumBytes}-byte limit.`
    );
  }
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
  operation: string,
  controller: AbortController
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));

  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    const error = new InstrumentationRequestError(
      'adapter_response_too_large',
      operation,
      `${operation} declared ${declaredLength} bytes, exceeding the ${maximumBytes}-byte limit.`
    );
    controller.abort(error);
    throw error;
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        const error = new InstrumentationRequestError(
          'adapter_response_too_large',
          operation,
          `${operation} exceeded the ${maximumBytes}-byte response limit.`
        );
        controller.abort(error);
        await reader.cancel().catch(() => undefined);
        throw error;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

async function parseJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
  maximumBytes: number,
  operation: string,
  controller: AbortController
): Promise<T> {
  const text = await readBoundedResponseBody(response, maximumBytes, operation, controller);
  let payload: unknown;

  try {
    payload = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${fallbackMessage}: response was not valid JSON.`);
  }

  if (!response.ok) {
    const body = payload as LocalHttpErrorBody;
    throw new Error(body.message ?? `${fallbackMessage}: HTTP ${response.status}`);
  }

  return payload as T;
}

export class LocalHttpInstrumentationClient implements InstrumentationClient {
  readonly transport = 'local-http';
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeouts: InstrumentationRequestTimeouts;
  private readonly responseSizeLimits: InstrumentationResponseSizeLimits;
  private readonly activeControllers = new Map<string, Set<AbortController>>();

  constructor(options: LocalHttpInstrumentationClientOptions) {
    this.endpoint = parseLoopbackInstrumentationEndpoint(options.endpoint).toString();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeouts = {
      ...defaultRequestTimeouts,
      ...options.requestTimeouts
    };
    this.responseSizeLimits = {
      ...defaultResponseSizeLimits,
      ...options.responseSizeLimits
    };
  }

  async getHealth(
    instanceId = '__health__',
    timeoutMs = this.requestTimeouts.healthMs
  ): Promise<InstrumentationHealth> {
    const payload = await this.requestJson<unknown>({
      instanceId,
      operation: 'Instrumentation health request',
      url: endpointUrl(this.endpoint, 'gsi/v1/health'),
      timeoutMs,
      maximumBytes: this.responseSizeLimits.healthBytes,
      fallbackMessage: 'Unable to read instrumentation health'
    });

    return InstrumentationHealthSchema.parse(payload);
  }

  async getState(instanceId: string, botId: string): Promise<InstrumentedGameState> {
    const payload = await this.requestJson<unknown>({
      instanceId,
      operation: 'Instrumentation state request',
      url: endpointUrl(this.endpoint, 'gsi/v1/state', {
        instanceId,
        botId
      }),
      timeoutMs: this.requestTimeouts.stateReadMs,
      maximumBytes: this.responseSizeLimits.stateBytes,
      fallbackMessage: 'Unable to read instrumentation state'
    });
    const state = InstrumentedGameStateSchema.parse(payload);
    assertPayloadSize(
      state.logs,
      this.responseSizeLimits.gameLogsBytes,
      'Instrumentation game logs'
    );
    const screenshotBase64 = state.state.screenshotBase64;
    if (typeof screenshotBase64 === 'string') {
      const approximateBytes = Math.ceil(screenshotBase64.length * 0.75);
      if (approximateBytes > this.responseSizeLimits.screenshotBytes) {
        throw new InstrumentationRequestError(
          'adapter_response_too_large',
          'Instrumentation screenshot payload',
          `Instrumentation screenshot payload exceeded the ${this.responseSizeLimits.screenshotBytes}-byte limit.`
        );
      }
    }

    return state;
  }

  async getAvailableActions(instanceId: string, botId: string): Promise<InstrumentedAction[]> {
    const payload = await this.requestJson<unknown>({
      instanceId,
      operation: 'Instrumentation available-actions request',
      url: endpointUrl(this.endpoint, 'gsi/v1/actions', {
        instanceId,
        botId
      }),
      timeoutMs: this.requestTimeouts.availableActionsMs,
      maximumBytes: this.responseSizeLimits.availableActionsBytes,
      fallbackMessage: 'Unable to read instrumentation actions'
    });

    return InstrumentedActionSchema.array().parse(payload);
  }

  async performAction(request: PerformActionRequest): Promise<PerformActionResponse> {
    const payload = await this.requestJson<unknown>({
      instanceId: request.instanceId,
      operation: `Instrumentation action "${request.actionType}"`,
      url: endpointUrl(this.endpoint, 'gsi/v1/actions'),
      timeoutMs: Math.min(
        request.timeoutMs ?? this.requestTimeouts.performActionMs,
        this.requestTimeouts.performActionMs
      ),
      maximumBytes: this.responseSizeLimits.actionResultBytes,
      fallbackMessage: 'Unable to perform instrumentation action',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(request)
      }
    });

    return PerformActionResponseSchema.parse(payload);
  }

  async emitEvent(event: InstrumentationEvent): Promise<void> {
    const validatedEvent = InstrumentationEventSchema.parse(event);
    await this.requestJson<unknown>({
      instanceId: validatedEvent.instanceId,
      operation: `Instrumentation event "${validatedEvent.kind}"`,
      url: endpointUrl(this.endpoint, 'gsi/v1/events'),
      timeoutMs: this.requestTimeouts.performActionMs,
      maximumBytes: this.responseSizeLimits.actionResultBytes,
      fallbackMessage: 'Unable to emit instrumentation event',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(validatedEvent)
      }
    });
  }

  abortInstance(instanceId: string): void {
    for (const controller of this.activeControllers.get(instanceId) ?? []) {
      controller.abort(new InstrumentationRequestError(
        'adapter_request_aborted',
        'Instrumentation request',
        `Instrumentation requests for ${instanceId} were aborted because the instance is stopping.`
      ));
    }
    this.activeControllers.delete(instanceId);
  }

  abortAll(reason = 'the adapter is stopping'): void {
    for (const [instanceId] of this.activeControllers) {
      this.abortInstance(instanceId);
    }
    this.activeControllers.clear();
    void reason;
  }

  private async requestJson<T>(input: {
    instanceId: string;
    operation: string;
    url: string;
    timeoutMs: number;
    maximumBytes: number;
    fallbackMessage: string;
    init?: RequestInit;
  }): Promise<T> {
    const controller = new AbortController();
    const controllers = this.activeControllers.get(input.instanceId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.activeControllers.set(input.instanceId, controllers);
    const timer = setTimeout(() => {
      controller.abort(new InstrumentationRequestError(
        'adapter_request_timeout',
        input.operation,
        `${input.operation} timed out after ${input.timeoutMs} ms.`
      ));
    }, input.timeoutMs);
    timer.unref?.();

    try {
      const response = await this.fetchImpl(input.url, {
        ...input.init,
        redirect: 'error',
        signal: controller.signal
      });
      return await parseJsonResponse<T>(
        response,
        input.fallbackMessage,
        input.maximumBytes,
        input.operation,
        controller
      );
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        if (reason instanceof Error) {
          throw reason;
        }
        throw new InstrumentationRequestError(
          'adapter_request_aborted',
          input.operation,
          `${input.operation} was aborted.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
      if (controllers.size === 0) {
        this.activeControllers.delete(input.instanceId);
      }
    }
  }
}

export interface LocalWebSocketBridgeDescriptor {
  transport: 'local-websocket';
  url: string;
  protocol?: string;
}

export interface LocalFileBridgeDescriptor {
  transport: 'local-file-bridge';
  inboxPath: string;
  outboxPath: string;
}

export interface PluginBridgeDescriptor {
  transport: 'plugin-bridge';
  pluginId: string;
  endpointName?: string;
}

export type InstrumentationBridgeDescriptor =
  | LocalWebSocketBridgeDescriptor
  | LocalFileBridgeDescriptor
  | PluginBridgeDescriptor;

export function createInstrumentationClient(options: {
  transport: InstrumentationTransport;
  endpoint: string;
  fetchImpl?: typeof fetch;
  requestTimeouts?: Partial<InstrumentationRequestTimeouts>;
  responseSizeLimits?: Partial<InstrumentationResponseSizeLimits>;
}): InstrumentationClient {
  const transport = InstrumentationTransportSchema.parse(options.transport);

  if (transport === 'local-http') {
    return new LocalHttpInstrumentationClient({
      endpoint: options.endpoint,
      fetchImpl: options.fetchImpl,
      requestTimeouts: options.requestTimeouts,
      responseSizeLimits: options.responseSizeLimits
    });
  }

  throw new Error(`${transport} instrumentation transport is unavailable in this build.`);
}
