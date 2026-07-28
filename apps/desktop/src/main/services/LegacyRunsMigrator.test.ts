import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameProfileSchema, SimulationRunConfigSchema } from '@core/types';
import {
  LEGACY_RUNS_MIGRATION_MARKER,
  LegacyRunsMigrator
} from './LegacyRunsMigrator';
import { SessionRepository } from './SessionRepository';

const gameProfile = GameProfileSchema.parse({
  gameId: 'migration-game',
  gameName: 'Migration Game',
  version: '1.0.0',
  engine: { type: 'browser' },
  launch: {
    platform: 'browser',
    url: 'http://localhost:5173',
    arguments: []
  },
  adapter: {
    type: 'browser',
    supportsMultipleInstances: true,
    supportsStateRead: true,
    supportsDirectActions: true,
    supportsScreenshots: true,
    supportsVideo: false,
    supportsSaveIsolation: false
  }
});

function runConfig(sessionId: string) {
  return SimulationRunConfigSchema.parse({
    sessionId,
    gameProfilePath: 'memory://migration-game',
    adapterType: 'browser',
    runMode: 'sequential',
    runUntilStopped: false,
    maxRuntimeMinutes: 5,
    stopOnCriticalIssue: true,
    saveScreenshots: true,
    saveVideo: false,
    saveActionTimeline: true,
    saveStateSnapshots: false,
    botPools: [{
      profileId: 'ui-tester-bot',
      enabled: true,
      minCount: 1,
      desiredCount: 1,
      maxCount: 1,
      scalingMode: 'fixed',
      priority: 10,
      resourceWeight: 'light'
    }],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: 500,
    maxActionsPerBot: 10,
    resourceLimits: {
      maxCpuPercent: 70,
      maxRamPercent: 70,
      reserveRamMb: 1024,
      maxGameInstances: 1,
      allowAutoScaling: false
    }
  });
}

function writeSession(root: string, directoryName: string, sessionId: string, status = 'stopped'): string {
  const sessionDir = join(root, directoryName);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'config.json'), `${JSON.stringify({
    runConfig: runConfig(sessionId),
    gameProfile
  }, null, 2)}\n`);
  writeFileSync(join(sessionDir, 'session-log.jsonl'), '');
  writeFileSync(join(sessionDir, 'evidence.txt'), 'preserve me\n');
  writeFileSync(join(sessionDir, 'session.json'), `${JSON.stringify({
    sessionId,
    gameName: gameProfile.gameName,
    createdAt: '2026-07-28T09:00:00.000Z',
    status,
    issueCounts: { total: 0, bySeverity: {}, byCategory: {} },
    botCounts: { requested: 0, actual: 0, running: status === 'running' ? 1 : 0, stopped: 0, stuck: 0 },
    reportPaths: {
      sessionDirectory: '/old/development/runs/session',
      summaryMarkdown: '/old/development/runs/session/session-summary.md'
    }
  }, null, 2)}\n`);
  return sessionDir;
}

describe('LegacyRunsMigrator', () => {
  it('copies valid sessions once, preserves the source, and rebases paths to the target root', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-run-migration-'));
    const sourceRoot = join(tempRoot, 'legacy-runs');
    const targetRoot = join(tempRoot, 'user-data', 'runs');
    const sourceSession = writeSession(sourceRoot, 'session-old', 'legacy-session');
    const now = () => '2026-07-28T10:00:00.000Z';
    const migrator = new LegacyRunsMigrator(targetRoot, [sourceRoot], { now });

    const first = migrator.migrateOnce();
    const second = migrator.migrateOnce();
    const targetSession = join(targetRoot, 'session-old');
    const loaded = new SessionRepository(targetRoot, { now }).loadSession('legacy-session');

    expect(first.copiedSessionIds).toEqual(['legacy-session']);
    expect(second.alreadyChecked).toBe(true);
    expect(existsSync(join(targetRoot, LEGACY_RUNS_MIGRATION_MARKER))).toBe(true);
    expect(readFileSync(join(sourceSession, 'evidence.txt'), 'utf8')).toBe('preserve me\n');
    expect(readFileSync(join(targetSession, 'evidence.txt'), 'utf8')).toBe('preserve me\n');
    expect(loaded.metadata.reportPaths.sessionDirectory).toBe(targetSession);
  });

  it('skips duplicate session IDs without changing either copy', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-run-duplicate-'));
    const sourceRoot = join(tempRoot, 'legacy-runs');
    const targetRoot = join(tempRoot, 'user-data', 'runs');
    writeSession(sourceRoot, 'session-source', 'duplicate-session');
    writeSession(targetRoot, 'session-target', 'duplicate-session');

    const result = new LegacyRunsMigrator(targetRoot, [sourceRoot]).migrateOnce();

    expect(result.copiedSessionIds).toEqual([]);
    expect(result.skippedDuplicateSessionIds).toEqual(['duplicate-session']);
    expect(existsSync(join(sourceRoot, 'session-source', 'config.json'))).toBe(true);
    expect(existsSync(join(targetRoot, 'session-target', 'config.json'))).toBe(true);
  });
});

describe('SessionRepository production boundaries', () => {
  it('rejects session traversal and external report paths', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-session-boundary-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-session-outside-'));
    const outsideSession = writeSession(outsideRoot, 'session-outside', 'outside-session');
    const localSession = writeSession(runsRoot, 'session-local', 'local-session');
    const repository = new SessionRepository(runsRoot);
    const loaded = repository.loadSession('local-session');

    expect(() => repository.resolveSessionDir(outsideSession)).toThrow('outside the approved directory');
    expect(() => repository.writeSessionMetadata({
      sessionDir: localSession,
      sessionId: loaded.metadata.sessionId,
      gameProfile: loaded.gameProfile,
      runConfig: loaded.runConfig,
      status: 'stopped',
      createdAt: loaded.metadata.createdAt,
      issues: [],
      botStatuses: [],
      reportPaths: {
        sessionDirectory: localSession,
        summaryMarkdown: join(outsideRoot, 'escaped-summary.md')
      }
    })).toThrow('outside the approved directory');
  });

  it('marks a session left running by a crashed application as failed and interrupted', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-session-interrupted-'));
    const sessionDir = writeSession(runsRoot, 'session-running', 'running-session', 'running');
    const repository = new SessionRepository(runsRoot, {
      now: () => '2026-07-28T11:00:00.000Z'
    });

    const loaded = repository.loadSession('running-session');
    const savedMetadata = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8')) as {
      status: string;
      stoppedAt?: string;
    };

    expect(loaded.metadata.status).toBe('failed');
    expect(loaded.metadata.stoppedAt).toBe('2026-07-28T11:00:00.000Z');
    expect(loaded.logs.at(-1)?.message).toContain('interrupted');
    expect(savedMetadata).toEqual(expect.objectContaining({
      status: 'failed',
      stoppedAt: '2026-07-28T11:00:00.000Z'
    }));
  });
});
