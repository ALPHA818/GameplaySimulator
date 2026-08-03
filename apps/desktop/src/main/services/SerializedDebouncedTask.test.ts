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
});
