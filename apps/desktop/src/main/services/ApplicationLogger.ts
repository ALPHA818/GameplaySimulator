import { existsSync, mkdirSync } from 'node:fs';
import { appendFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sanitizeForLogging } from './SensitiveData';

export interface ApplicationFailureDetails {
  [key: string]: unknown;
}

export interface ApplicationLoggerOptions {
  maxFileSizeBytes?: number;
  retainedFiles?: number;
}

export class ApplicationLogger {
  readonly logsDirectory: string;
  readonly logPath: string;
  private readonly maxFileSizeBytes: number;
  private readonly retainedFiles: number;
  private writeChain: Promise<void> = Promise.resolve();
  private writeError: unknown;

  constructor(
    logsDirectory: string,
    private readonly now = () => new Date().toISOString(),
    options: ApplicationLoggerOptions = {}
  ) {
    this.logsDirectory = resolve(logsDirectory);
    this.logPath = join(this.logsDirectory, 'application.log');
    this.maxFileSizeBytes = Math.max(1_024, options.maxFileSizeBytes ?? 5 * 1024 * 1024);
    this.retainedFiles = Math.max(1, options.retainedFiles ?? 5);
    mkdirSync(this.logsDirectory, { recursive: true });
  }

  logFailure(kind: string, error: unknown, details: ApplicationFailureDetails = {}): void {
    const normalized = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: 'Error', message: String(error) };
    const safeFailure = sanitizeForLogging({
      error: normalized,
      details
    }) as {
      error: Record<string, unknown>;
      details: Record<string, unknown>;
    };
    const line = `${JSON.stringify({
      timestamp: this.now(),
      kind,
      error: safeFailure.error,
      details: safeFailure.details
    })}\n`;

    this.writeChain = this.writeChain
      .then(async () => {
        await this.rotateIfNeeded(Buffer.byteLength(line));
        await appendFile(this.logPath, line, 'utf8');
      })
      .catch((writeError: unknown) => {
        this.writeError ??= writeError;
      });
  }

  async flush(): Promise<void> {
    let observedChain: Promise<void>;
    do {
      observedChain = this.writeChain;
      await observedChain;
    } while (observedChain !== this.writeChain);

    if (this.writeError) {
      const error = this.writeError;
      this.writeError = undefined;
      throw error;
    }
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    let currentSize = 0;
    try {
      currentSize = (await stat(this.logPath)).size;
    } catch {
      return;
    }

    if (currentSize + incomingBytes <= this.maxFileSizeBytes) {
      return;
    }

    await rm(`${this.logPath}.${this.retainedFiles}`, { force: true });
    for (let index = this.retainedFiles - 1; index >= 1; index -= 1) {
      const source = `${this.logPath}.${index}`;
      if (existsSync(source)) {
        await rename(source, `${this.logPath}.${index + 1}`);
      }
    }
    if (existsSync(this.logPath)) {
      await rename(this.logPath, `${this.logPath}.1`);
    }
  }
}
