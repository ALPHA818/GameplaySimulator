import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StructuredRunLogger } from '../../packages/core/src/logging/StructuredLoggers';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })));
});

describe('long-session persistence', () => {
  it('keeps a large active-run history append-only and flushes it exactly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gameplay-simulator-long-session-'));
    temporaryRoots.push(root);
    const logger = new StructuredRunLogger({
      rootDir: root,
      sessionId: 'long-session',
      createdAt: '2026-07-29T12:00:00.000Z'
    });

    for (let index = 0; index < 20_000; index += 1) {
      logger.logSession('state_snapshot', {
        sequence: index,
        scene: `scene-${index % 20}`
      });
    }

    await logger.flush();

    const sessionLines = (await readFile(logger.sessionLogPath, 'utf8')).trim().split('\n');
    const bundleLines = (await readFile(logger.sessionLogger.fullStructuredLogsPath, 'utf8')).trim().split('\n');
    expect(sessionLines).toHaveLength(20_000);
    expect(bundleLines).toHaveLength(20_000);
    expect(JSON.parse(bundleLines.at(-1)!)).toEqual(expect.objectContaining({
      eventType: 'state_snapshot',
      payload: {
        sequence: 19_999,
        scene: 'scene-19'
      }
    }));
  });
});
