import { describe, expect, it, vi } from 'vitest';
import { RendererCrashRecovery } from './RendererCrashRecovery';

describe('RendererCrashRecovery', () => {
  it('stops reloading after a bounded number of repeated renderer crashes', () => {
    const reload = vi.fn();
    const exhausted = vi.fn();
    const scheduled: Array<() => void> = [];
    const recovery = new RendererCrashRecovery({
      maxReloadAttempts: 2,
      retryWindowMs: 30_000,
      now: () => 1_000,
      schedule: (callback) => scheduled.push(callback),
      onExhausted: exhausted
    });
    const webContents = {
      isDestroyed: () => false,
      reload
    };

    expect(recovery.handleCrash(webContents)).toBe('reload-scheduled');
    expect(recovery.handleCrash(webContents)).toBe('reload-scheduled');
    expect(recovery.handleCrash(webContents)).toBe('exit-requested');
    for (const callback of scheduled) callback();

    expect(reload).not.toHaveBeenCalled();
    expect(exhausted).toHaveBeenCalledOnce();
    expect(exhausted.mock.calls[0][0]).toContain('Automatic reload was stopped');
    expect(recovery.handleCrash(webContents)).toBe('ignored');
  });

  it('allows a new bounded recovery window after old crashes age out', () => {
    let now = 0;
    const reload = vi.fn();
    const recovery = new RendererCrashRecovery({
      maxReloadAttempts: 1,
      retryWindowMs: 100,
      now: () => now,
      schedule: (callback) => callback(),
      onExhausted: vi.fn()
    });
    const webContents = {
      isDestroyed: () => false,
      reload
    };

    expect(recovery.handleCrash(webContents)).toBe('reload-scheduled');
    now = 101;
    expect(recovery.handleCrash(webContents)).toBe('reload-scheduled');
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
