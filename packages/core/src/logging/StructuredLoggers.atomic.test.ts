import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renameWithTransientRetry, writeTextAtomically } from './StructuredLoggers';

const temporaryDirectories: string[] = [];

function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'gameplay-atomic-'));
  temporaryDirectories.push(directory);
  return directory;
}

function filesystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('renameWithTransientRetry', () => {
  it('renames immediately when the first attempt succeeds', () => {
    const directory = makeDirectory();
    const source = join(directory, 'source');
    const destination = join(directory, 'destination');
    writeFileSync(source, 'new');

    renameWithTransientRetry(source, destination, { sleep: () => undefined });

    expect(readFileSync(destination, 'utf8')).toBe('new');
  });

  it('retries EPERM once and then succeeds', () => {
    let attempts = 0;
    renameWithTransientRetry('source', 'destination', {
      sleep: () => undefined,
      rename: () => {
        attempts += 1;
        if (attempts === 1) throw filesystemError('EPERM');
      }
    });

    expect(attempts).toBe(2);
  });

  it('retries repeated EBUSY failures before succeeding', () => {
    let attempts = 0;
    renameWithTransientRetry('source', 'destination', {
      sleep: () => undefined,
      rename: () => {
        attempts += 1;
        if (attempts <= 3) throw filesystemError('EBUSY');
      }
    });

    expect(attempts).toBe(4);
  });

  it('does not retry non-transient errors', () => {
    let attempts = 0;

    expect(() => renameWithTransientRetry('source', 'destination', {
      sleep: () => undefined,
      rename: () => {
        attempts += 1;
        throw filesystemError('EINVAL');
      }
    })).toThrow('EINVAL');

    expect(attempts).toBe(1);
  });

  it('throws a persistent transient error after the retry limit', () => {
    let attempts = 0;

    expect(() => renameWithTransientRetry('source', 'destination', {
      maxAttempts: 3,
      sleep: () => undefined,
      rename: () => {
        attempts += 1;
        throw filesystemError('EPERM');
      }
    })).toThrow('EPERM');

    expect(attempts).toBe(3);
  });
});

describe('writeTextAtomically', () => {
  it('cleans the temporary file after replacement failure', () => {
    const directory = makeDirectory();
    const destination = join(directory, 'session-summary.json');

    expect(() => writeTextAtomically(destination, '{"new":true}\n', {
      maxAttempts: 2,
      retryDelaysMs: [0],
      sleep: () => undefined,
      rename: () => {
        throw filesystemError('EPERM');
      }
    })).toThrow('EPERM');

    expect(readdirSync(directory).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('keeps the old destination when every replacement attempt fails', () => {
    const directory = makeDirectory();
    const destination = join(directory, 'session-summary.json');
    writeFileSync(destination, '{"old":true}\n');

    expect(() => writeTextAtomically(destination, '{"new":true}\n', {
      maxAttempts: 2,
      retryDelaysMs: [0],
      sleep: () => undefined,
      rename: () => {
        throw filesystemError('EACCES');
      }
    })).toThrow('EACCES');

    expect(readFileSync(destination, 'utf8')).toBe('{"old":true}\n');
  });

  it('leaves complete new JSON after a transient replacement failure', () => {
    const directory = makeDirectory();
    const destination = join(directory, 'session-summary.json');
    let attempts = 0;

    writeTextAtomically(destination, JSON.stringify({ status: 'completed', actions: 3 }) + '\n', {
      sleep: () => undefined,
      rename: (source, target) => {
        attempts += 1;
        if (attempts === 1) throw filesystemError('EPERM');
        renameSync(source, target);
      }
    });

    expect(JSON.parse(readFileSync(destination, 'utf8'))).toEqual({ status: 'completed', actions: 3 });
    expect(readdirSync(directory).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });
});
