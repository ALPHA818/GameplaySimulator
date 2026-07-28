export interface ShutdownService {
  shutdownAllSessions(reason: string): Promise<unknown>;
  forceCleanupOwnedProcesses(reason: string): Promise<unknown>;
}

export interface ShutdownCoordinatorOptions {
  timeoutMs?: number;
  forceCleanupTimeoutMs?: number;
  onFailure?: (kind: string, error: unknown) => void;
}

export interface ShutdownResult {
  graceful: boolean;
  timedOut: boolean;
  forceCleanupAttempted: boolean;
}

function timeoutAfter(ms: number, message: string): {
  promise: Promise<never>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return {
    promise,
    cancel: () => clearTimeout(timer)
  };
}

export async function runBoundedShutdown(
  service: ShutdownService,
  options: ShutdownCoordinatorOptions = {}
): Promise<ShutdownResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const forceCleanupTimeoutMs = options.forceCleanupTimeoutMs ?? 2_000;
  const gracefulTimeout = timeoutAfter(timeoutMs, `Graceful shutdown exceeded ${timeoutMs} ms.`);

  try {
    await Promise.race([
      service.shutdownAllSessions('app_before_quit'),
      gracefulTimeout.promise
    ]);
    return {
      graceful: true,
      timedOut: false,
      forceCleanupAttempted: false
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.message.includes('exceeded');
    options.onFailure?.(timedOut ? 'shutdown_timeout' : 'shutdown_failure', error);
    const forceTimeout = timeoutAfter(
      forceCleanupTimeoutMs,
      `Forced owned-process cleanup exceeded ${forceCleanupTimeoutMs} ms.`
    );

    try {
      await Promise.race([
        service.forceCleanupOwnedProcesses(timedOut ? 'shutdown_timeout' : 'shutdown_failure'),
        forceTimeout.promise
      ]);
    } catch (forceError) {
      options.onFailure?.('forced_cleanup_failure', forceError);
    } finally {
      forceTimeout.cancel();
    }

    return {
      graceful: false,
      timedOut,
      forceCleanupAttempted: true
    };
  } finally {
    gracefulTimeout.cancel();
  }
}
