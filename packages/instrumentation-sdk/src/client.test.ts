import { describe, expect, it, vi } from 'vitest';
import {
  InstrumentationRequestError,
  LocalHttpInstrumentationClient
} from './client';

function neverRespondingFetch(): typeof fetch {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason ?? new Error('aborted'));
      }, { once: true });
    })
  ) as unknown as typeof fetch;
}

describe('LocalHttpInstrumentationClient request boundaries', () => {
  it('aborts a health request when an HTTP endpoint never responds', async () => {
    const client = new LocalHttpInstrumentationClient({
      endpoint: 'http://127.0.0.1:4317',
      fetchImpl: neverRespondingFetch(),
      requestTimeouts: { healthMs: 20 }
    });

    await expect(client.getHealth('health-timeout-instance')).rejects.toMatchObject({
      eventType: 'adapter_request_timeout'
    });
  });

  it('rejects oversized JSON before parsing it', async () => {
    const oversizedBody = JSON.stringify({
      ok: true,
      protocolVersion: '0.1.0',
      capabilities: {
        stateRead: true,
        directActions: true,
        events: true,
        logs: true
      },
      padding: 'x'.repeat(1024)
    });
    const client = new LocalHttpInstrumentationClient({
      endpoint: 'http://127.0.0.1:4317',
      fetchImpl: vi.fn(async () => new Response(oversizedBody, {
        headers: {
          'content-type': 'application/json',
          'content-length': String(oversizedBody.length)
        }
      })) as unknown as typeof fetch,
      responseSizeLimits: { healthBytes: 128 }
    });

    await expect(client.getHealth('oversized-health-instance')).rejects.toMatchObject({
      eventType: 'adapter_response_too_large'
    });
  });

  it('aborts active instance requests when the instance stops', async () => {
    const client = new LocalHttpInstrumentationClient({
      endpoint: 'http://127.0.0.1:4317',
      fetchImpl: neverRespondingFetch(),
      requestTimeouts: { stateReadMs: 5_000 }
    });
    const request = client.getState('abort-instance', 'bot-001');

    await new Promise((resolve) => setTimeout(resolve, 5));
    client.abortInstance('abort-instance');

    await expect(request).rejects.toSatisfy((error: unknown) =>
      error instanceof InstrumentationRequestError &&
      error.eventType === 'adapter_request_aborted'
    );
  });
});
