export type AdapterRequestEventType =
  | 'adapter_request_timeout'
  | 'adapter_request_aborted'
  | 'adapter_response_too_large';

export interface AdapterRequestTimeouts {
  connectMs: number;
  healthMs: number;
  stateReadMs: number;
  availableActionsMs: number;
  performActionMs: number;
  evidenceMs: number;
  shutdownMs: number;
}

export interface AdapterResponseSizeLimits {
  healthBytes: number;
  stateBytes: number;
  availableActionsBytes: number;
  actionResultBytes: number;
  gameLogsBytes: number;
  screenshotBytes: number;
}

export interface AdapterRequestPolicy {
  timeouts: AdapterRequestTimeouts;
  responseSizeLimits: AdapterResponseSizeLimits;
}

export interface AdapterRequestPolicyInput {
  timeouts?: Partial<AdapterRequestTimeouts>;
  responseSizeLimits?: Partial<AdapterResponseSizeLimits>;
}

export const defaultAdapterRequestPolicy: AdapterRequestPolicy = {
  timeouts: {
    connectMs: 10_000,
    healthMs: 5_000,
    stateReadMs: 5_000,
    availableActionsMs: 5_000,
    performActionMs: 10_000,
    evidenceMs: 10_000,
    shutdownMs: 15_000
  },
  responseSizeLimits: {
    healthBytes: 64 * 1024,
    stateBytes: 4 * 1024 * 1024,
    availableActionsBytes: 1024 * 1024,
    actionResultBytes: 1024 * 1024,
    gameLogsBytes: 1024 * 1024,
    screenshotBytes: 16 * 1024 * 1024
  }
};

export class AdapterRequestBoundaryError extends Error {
  constructor(
    readonly eventType: AdapterRequestEventType,
    readonly operation: string,
    message: string
  ) {
    super(message);
    this.name = 'AdapterRequestBoundaryError';
  }
}

export function resolveAdapterRequestPolicy(
  input: AdapterRequestPolicyInput = {}
): AdapterRequestPolicy {
  return {
    timeouts: {
      ...defaultAdapterRequestPolicy.timeouts,
      ...input.timeouts
    },
    responseSizeLimits: {
      ...defaultAdapterRequestPolicy.responseSizeLimits,
      ...input.responseSizeLimits
    }
  };
}

export function serializedByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  return new TextEncoder().encode(serialized ?? '').byteLength;
}

export function assertAdapterResponseSize(
  value: unknown,
  maximumBytes: number,
  operation: string
): void {
  const actualBytes = serializedByteLength(value);

  if (actualBytes > maximumBytes) {
    throw new AdapterRequestBoundaryError(
      'adapter_response_too_large',
      operation,
      `${operation} returned ${actualBytes} bytes, exceeding the ${maximumBytes}-byte limit.`
    );
  }
}

export async function runBoundedAdapterRequest<T>(input: {
  operation: string;
  timeoutMs: number;
  signal?: AbortSignal;
  request: () => Promise<T>;
}): Promise<T> {
  const { operation, timeoutMs, signal, request } = input;

  if (signal?.aborted) {
    throw new AdapterRequestBoundaryError(
      'adapter_request_aborted',
      operation,
      `${operation} was aborted before it started.`
    );
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AdapterRequestBoundaryError(
        'adapter_request_timeout',
        operation,
        `${operation} timed out after ${timeoutMs} ms.`
      ));
    }, timeoutMs);
    timer.unref?.();
  });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    if (!signal) {
      return;
    }

    abortListener = () => {
      reject(new AdapterRequestBoundaryError(
        'adapter_request_aborted',
        operation,
        `${operation} was aborted because the adapter instance is stopping.`
      ));
    };
    signal.addEventListener('abort', abortListener, { once: true });
  });

  try {
    return await Promise.race([
      Promise.resolve().then(request),
      timeoutPromise,
      abortPromise
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}

export function adapterRequestEventType(error: unknown): AdapterRequestEventType | undefined {
  if (error instanceof AdapterRequestBoundaryError) {
    return error.eventType;
  }

  if (typeof error === 'object' && error !== null && 'eventType' in error) {
    const eventType = (error as { eventType?: unknown }).eventType;

    if (
      eventType === 'adapter_request_timeout' ||
      eventType === 'adapter_request_aborted' ||
      eventType === 'adapter_response_too_large'
    ) {
      return eventType;
    }
  }

  return undefined;
}
