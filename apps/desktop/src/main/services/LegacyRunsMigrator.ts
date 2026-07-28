import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { SessionRepository } from './SessionRepository';
import { assertPathWithin, isPathWithin } from './pathSafety';

export const LEGACY_RUNS_MIGRATION_MARKER = '.legacy-runs-migration-v1.json';

export interface LegacyRunsMigrationResult {
  alreadyChecked: boolean;
  checkedAt: string;
  sourceRoots: string[];
  copiedSessionIds: string[];
  skippedDuplicateSessionIds: string[];
  skippedInvalidDirectories: string[];
}

export interface LegacyRunsMigratorOptions {
  now?: () => string;
}

function writeJsonAtomically(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(dirname(path), { recursive: true });

  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    JSON.parse(readFileSync(temporaryPath, 'utf8'));
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export class LegacyRunsMigrator {
  private readonly targetRunsRoot: string;
  private readonly sourceRunsRoots: string[];
  private readonly now: () => string;

  constructor(targetRunsRoot: string, sourceRunsRoots: string[], options: LegacyRunsMigratorOptions = {}) {
    this.targetRunsRoot = resolve(targetRunsRoot);
    this.sourceRunsRoots = [...new Set(sourceRunsRoots.map((path) => resolve(path)))]
      .filter((path) => path !== this.targetRunsRoot);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  migrateOnce(): LegacyRunsMigrationResult {
    mkdirSync(this.targetRunsRoot, { recursive: true });
    const markerPath = join(this.targetRunsRoot, LEGACY_RUNS_MIGRATION_MARKER);

    if (existsSync(markerPath)) {
      try {
        const saved = JSON.parse(readFileSync(markerPath, 'utf8')) as LegacyRunsMigrationResult;
        return { ...saved, alreadyChecked: true };
      } catch {
        renameSync(markerPath, `${markerPath}.corrupt-${Date.now()}`);
      }
    }

    const checkedAt = this.now();
    const result: LegacyRunsMigrationResult = {
      alreadyChecked: false,
      checkedAt,
      sourceRoots: [],
      copiedSessionIds: [],
      skippedDuplicateSessionIds: [],
      skippedInvalidDirectories: []
    };
    const targetRepository = new SessionRepository(this.targetRunsRoot);
    const existingSessionIds = new Set(targetRepository.listSessions().map((session) => session.sessionId));

    for (const sourceRoot of this.sourceRunsRoots) {
      if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
        continue;
      }

      result.sourceRoots.push(sourceRoot);
      const sourceRepository = new SessionRepository(sourceRoot, {
        reconcileInterruptedSessions: false
      });

      for (const sourceDirectory of sourceRepository.listSessionDirectories()) {
        let sessionId: string;

        try {
          const artifacts = sourceRepository.loadSession(sourceDirectory);
          sessionId = artifacts.metadata.sessionId;
        } catch {
          result.skippedInvalidDirectories.push(sourceDirectory);
          continue;
        }

        const destination = assertPathWithin(
          this.targetRunsRoot,
          join(this.targetRunsRoot, basename(sourceDirectory)),
          'Migrated session directory',
          false
        );

        if (existingSessionIds.has(sessionId) || existsSync(destination)) {
          result.skippedDuplicateSessionIds.push(sessionId);
          continue;
        }

        if (!isPathWithin(sourceRoot, sourceDirectory, false)) {
          result.skippedInvalidDirectories.push(sourceDirectory);
          continue;
        }

        cpSync(sourceDirectory, destination, {
          recursive: true,
          errorOnExist: true,
          force: false
        });
        existingSessionIds.add(sessionId);
        result.copiedSessionIds.push(sessionId);
      }
    }

    writeJsonAtomically(markerPath, result);
    return result;
  }
}
