export interface ReloadableWebContents {
  isDestroyed(): boolean;
  reload(): void;
}

export interface RendererCrashRecoveryOptions {
  maxReloadAttempts?: number;
  retryWindowMs?: number;
  reloadDelayMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => void;
  onExhausted: (message: string) => void;
}

export type RendererCrashRecoveryAction = 'reload-scheduled' | 'exit-requested' | 'ignored';

export class RendererCrashRecovery {
  private readonly maxReloadAttempts: number;
  private readonly retryWindowMs: number;
  private readonly reloadDelayMs: number;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => void;
  private readonly onExhausted: (message: string) => void;
  private crashTimes: number[] = [];
  private exhausted = false;

  constructor(options: RendererCrashRecoveryOptions) {
    this.maxReloadAttempts = options.maxReloadAttempts ?? 2;
    this.retryWindowMs = options.retryWindowMs ?? 30_000;
    this.reloadDelayMs = options.reloadDelayMs ?? 250;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref?.();
    });
    this.onExhausted = options.onExhausted;
  }

  handleCrash(webContents: ReloadableWebContents): RendererCrashRecoveryAction {
    if (this.exhausted || webContents.isDestroyed()) {
      return 'ignored';
    }

    const timestamp = this.now();
    this.crashTimes = this.crashTimes.filter(
      (crashTime) => timestamp - crashTime <= this.retryWindowMs
    );
    this.crashTimes.push(timestamp);

    if (this.crashTimes.length > this.maxReloadAttempts) {
      this.exhausted = true;
      this.onExhausted(
        `The renderer crashed ${this.crashTimes.length} times within ${this.retryWindowMs} ms. ` +
        'Automatic reload was stopped. Restart GameplaySimulator and inspect the application logs.'
      );
      return 'exit-requested';
    }

    this.schedule(() => {
      if (!webContents.isDestroyed() && !this.exhausted) {
        webContents.reload();
      }
    }, this.reloadDelayMs);
    return 'reload-scheduled';
  }
}
