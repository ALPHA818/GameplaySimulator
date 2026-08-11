export interface SerializedDebouncedTaskOptions {
  delayMs?: number;
  maxWaitMs?: number;
}

export class SerializedDebouncedTask {
  private readonly delayMs: number;
  private readonly maxWaitMs: number;
  private debounceTimer?: NodeJS.Timeout;
  private maxWaitTimer?: NodeJS.Timeout;
  private pendingTask?: () => void | Promise<void>;
  private running: Promise<void> = Promise.resolve();
  private storedErrors: unknown[] = [];

  constructor(options: SerializedDebouncedTaskOptions = {}) {
    this.delayMs = options.delayMs ?? 2_000;
    this.maxWaitMs = options.maxWaitMs ?? 60_000;
  }

  schedule(task: () => void | Promise<void>): void {
    this.pendingTask = task;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.startPending(), this.delayMs);
    this.debounceTimer.unref?.();

    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => this.startPending(), this.maxWaitMs);
      this.maxWaitTimer.unref?.();
    }
  }

  async flush(): Promise<void> {
    do {
      this.clearTimers();
      if (this.pendingTask) {
        this.startPending();
      }
      await this.running;
    } while (this.pendingTask);

    if (this.storedErrors.length > 0) {
      const [error] = this.storedErrors;
      this.storedErrors = [];
      throw error;
    }
  }

  cancel(): void {
    this.pendingTask = undefined;
    this.clearTimers();
  }

  private startPending(): void {
    this.clearTimers();
    const task = this.pendingTask;
    this.pendingTask = undefined;
    if (!task) {
      return;
    }

    this.running = this.running
      .catch(() => undefined)
      .then(task)
      .then(() => undefined)
      .catch((error: unknown) => {
        this.storedErrors.push(error);
      });
  }

  private clearTimers(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = undefined;
    }
  }
}
