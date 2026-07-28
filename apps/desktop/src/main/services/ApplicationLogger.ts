import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sanitizeForLogging } from './SensitiveData';

export interface ApplicationFailureDetails {
  [key: string]: unknown;
}

export class ApplicationLogger {
  readonly logsDirectory: string;
  readonly logPath: string;

  constructor(logsDirectory: string, private readonly now = () => new Date().toISOString()) {
    this.logsDirectory = resolve(logsDirectory);
    this.logPath = join(this.logsDirectory, 'application.log');
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

    appendFileSync(
      this.logPath,
      `${JSON.stringify({
        timestamp: this.now(),
        kind,
        error: safeFailure.error,
        details: safeFailure.details
      })}\n`,
      'utf8'
    );
  }
}
