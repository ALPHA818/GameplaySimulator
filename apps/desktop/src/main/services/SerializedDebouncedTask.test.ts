import { describe, expect, it } from 'vitest';
import { SerializedDebouncedTask } from './SerializedDebouncedTask';

describe('SerializedDebouncedTask', () => {
  it('persists the latest pending state and never overlaps writes', async () => {
    const persistence = new SerializedDebouncedTask({ delayMs: 60_000, maxWaitMs: 60_000 });
    const written: number[] = [];
    let activeWrites = 0;
    let maximumActiveWrites = 0;

    const save = (value: number) => async () => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await Promise.resolve();
      written.push(value);
      activeWrites -= 1;
    };

    persistence.schedule(save(1));
    persistence.schedule(save(2));
    await persistence.flush();
    persistence.schedule(save(3));
    await persistence.flush();

    expect(written).toEqual([2, 3]);
    expect(maximumActiveWrites).toBe(1);
  });

  it('flushes a pending write during shutdown-style finalization', async () => {
    const persistence = new SerializedDebouncedTask({ delayMs: 60_000, maxWaitMs: 60_000 });
    let saved = false;
    persistence.schedule(() => {
      saved = true;
    });

    await persistence.flush();

    expect(saved).toBe(true);
  });

  it('does not emit an unhandled rejection for a failed scheduled task', async () => {
    const persistence = new SerializedDebouncedTask({ delayMs: 0, maxWaitMs: 60_000 });
    let unhandledRejection = false;
    const onUnhandledRejection = () => {
      unhandledRejection = true;
    };
    process.on('unhandledRejection', onUnhandledRejection);

    persistence.schedule(async () => {
      throw new Error('report write failed');
    });

    await expect(persistence.flush()).rejects.toThrow('report write failed');
    await Promise.resolve();
    process.off('unhandledRejection', onUnhandledRejection);

    expect(unhandledRejection).toBe(false);
  });

  it('surfaces a failed scheduled task through flush', async () => {
    const persistence = new SerializedDebouncedTask({ delayMs: 60_000, maxWaitMs: 60_000 });
    const error = new Error('session summary failed');
    persistence.schedule(() => Promise.reject(error));

    await expect(persistence.flush()).rejects.toBe(error);
  });

  it('continues serialized work after a failure', async () => {
    const persistence = new SerializedDebouncedTask({ delayMs: 60_000, maxWaitMs: 60_000 });
    const written: string[] = [];

    persistence.schedule(() => Promise.reject(new Error('first failure')));
    await expect(persistence.flush()).rejects.toThrow('first failure');

    persistence.schedule(async () => {
      written.push('second');
    });
    await persistence.flush();

    expect(written).toEqual(['second']);
  });
});
