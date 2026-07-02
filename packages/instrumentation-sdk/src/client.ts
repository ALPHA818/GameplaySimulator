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

export interface InstrumentationClient {
  transport: InstrumentationTransport;
  getHealth(): Promise<InstrumentationHealth>;
  getState(instanceId: string, botId: string): Promise<InstrumentedGameState>;
  getAvailableActions(instanceId: string, botId: string): Promise<InstrumentedAction[]>;
  performAction(request: PerformActionRequest): Promise<PerformActionResponse>;
  emitEvent(event: InstrumentationEvent): Promise<void>;
}

export interface LocalHttpInstrumentationClientOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

interface LocalHttpErrorBody {
  message?: string;
}

function endpointUrl(baseEndpoint: string, path: string, params?: Record<string, string>): string {
  const url = new URL(path, baseEndpoint.endsWith('/') ? baseEndpoint : `${baseEndpoint}/`);

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    let body: LocalHttpErrorBody = {};

    try {
      body = (await response.json()) as LocalHttpErrorBody;
    } catch {
      body = {};
    }

    throw new Error(body.message ?? `${fallbackMessage}: HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export class LocalHttpInstrumentationClient implements InstrumentationClient {
  readonly transport = 'local-http';
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LocalHttpInstrumentationClientOptions) {
    this.endpoint = options.endpoint;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getHealth(): Promise<InstrumentationHealth> {
    const response = await this.fetchImpl(endpointUrl(this.endpoint, 'gsi/v1/health'));
    const payload = await parseJsonResponse<unknown>(response, 'Unable to read instrumentation health');

    return InstrumentationHealthSchema.parse(payload);
  }

  async getState(instanceId: string, botId: string): Promise<InstrumentedGameState> {
    const response = await this.fetchImpl(
      endpointUrl(this.endpoint, 'gsi/v1/state', {
        instanceId,
        botId
      })
    );
    const payload = await parseJsonResponse<unknown>(response, 'Unable to read instrumentation state');

    return InstrumentedGameStateSchema.parse(payload);
  }

  async getAvailableActions(instanceId: string, botId: string): Promise<InstrumentedAction[]> {
    const response = await this.fetchImpl(
      endpointUrl(this.endpoint, 'gsi/v1/actions', {
        instanceId,
        botId
      })
    );
    const payload = await parseJsonResponse<unknown>(response, 'Unable to read instrumentation actions');

    return InstrumentedActionSchema.array().parse(payload);
  }

  async performAction(request: PerformActionRequest): Promise<PerformActionResponse> {
    const response = await this.fetchImpl(endpointUrl(this.endpoint, 'gsi/v1/actions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(request)
    });
    const payload = await parseJsonResponse<unknown>(response, 'Unable to perform instrumentation action');

    return PerformActionResponseSchema.parse(payload);
  }

  async emitEvent(event: InstrumentationEvent): Promise<void> {
    const validatedEvent = InstrumentationEventSchema.parse(event);
    const response = await this.fetchImpl(endpointUrl(this.endpoint, 'gsi/v1/events'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(validatedEvent)
    });

    await parseJsonResponse<unknown>(response, 'Unable to emit instrumentation event');
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
}): InstrumentationClient {
  const transport = InstrumentationTransportSchema.parse(options.transport);

  if (transport === 'local-http') {
    return new LocalHttpInstrumentationClient({
      endpoint: options.endpoint,
      fetchImpl: options.fetchImpl
    });
  }

  throw new Error(`${transport} instrumentation client is not implemented yet.`);
}
