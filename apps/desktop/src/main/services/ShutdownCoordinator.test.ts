import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationLogger } from './ApplicationLogger';
import { runBoundedShutdown } from './ShutdownCoordinator';

describe('bounded application shutdown', () => {
  it('forces owned-process cleanup when graceful shutdown fails', async () => {
    const forceCleanupOwnedProcesses = vi.fn().mockResolvedValue(undefined);
    const failures: string[] = [];
    const result = await runBoundedShutdown({
      shutdownAllSessions: vi.fn().mockRejectedValue(new Error('adapter stop failed')),
      forceCleanupOwnedProcesses
    }, {
      timeoutMs: 50,
      forceCleanupTimeoutMs: 50,
      onFailure: (kind) => failures.push(kind)
    });

    expect(result).toEqual({
      graceful: false,
      timedOut: false,
      forceCleanupAttempted: true
    });
    expect(forceCleanupOwnedProcesses).toHaveBeenCalledWith('shutdown_failure');
    expect(failures).toEqual(['shutdown_failure']);
  });

  it('does not wait forever when graceful shutdown hangs', async () => {
    const result = await runBoundedShutdown({
      shutdownAllSessions: vi.fn(() => new Promise(() => undefined)),
      forceCleanupOwnedProcesses: vi.fn().mockResolvedValue(undefined)
    }, {
      timeoutMs: 5,
      forceCleanupTimeoutMs: 20
    });

    expect(result.timedOut).toBe(true);
    expect(result.forceCleanupAttempted).toBe(true);
  });

  it('writes unexpected application failures to the application log', async () => {
    const logsRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-application-log-'));
    const logger = new ApplicationLogger(logsRoot, () => '2026-07-29T10:00:00.000Z');

    logger.logFailure('unhandled_rejection', new Error('browser close failed'), {
      sessionId: 'session-001'
    });
    const contents = await readFile(logger.logPath, 'utf8');

    expect(contents).toContain('unhandled_rejection');
    expect(contents).toContain('browser close failed');
    expect(contents).toContain('session-001');
  });
});
