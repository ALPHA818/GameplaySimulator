import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  createDefaultWorkspaceData,
  WorkspaceDataPatchSchema,
  WorkspaceDataSchema,
  type WorkspaceData,
  type WorkspaceDataPatch,
  type WorkspaceLoadResult
} from '@core/config/workspaceData';

export interface WorkspaceRepositoryOptions {
  now?: () => Date;
  maxBackups?: number;
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export class WorkspaceRepository {
  readonly workspaceDirectory: string;
  readonly backupsDirectory: string;
  readonly workspacePath: string;
  private readonly now: () => Date;
  private readonly maxBackups: number;
  private sequence = 0;

  constructor(userDataDirectory: string, options: WorkspaceRepositoryOptions = {}) {
    this.workspaceDirectory = join(userDataDirectory, 'workspace');
    this.backupsDirectory = join(this.workspaceDirectory, 'backups');
    this.workspacePath = join(this.workspaceDirectory, 'workspace-v1.json');
    this.now = options.now ?? (() => new Date());
    this.maxBackups = Math.max(1, options.maxBackups ?? 10);
  }

  load(): WorkspaceLoadResult {
    this.ensureDirectories();

    if (!existsSync(this.workspacePath)) {
      return {
        data: createDefaultWorkspaceData(),
        recoveredFromBackup: false
      };
    }

    const workspace = this.readValidatedFile(this.workspacePath);
    if (workspace) {
      return {
        data: workspace,
        recoveredFromBackup: false
      };
    }

    const corruptPath = join(
      this.backupsDirectory,
      `workspace-v1-corrupt-${this.nextFileSuffix()}.json`
    );
    copyFileSync(this.workspacePath, corruptPath);

    const recovered = this.recoverFromBackup();
    if (recovered) {
      return {
        data: recovered,
        warning: `Workspace data was invalid. The damaged file was preserved as ${basename(corruptPath)}, and the newest valid backup was restored.`,
        recoveredFromBackup: true
      };
    }

    const defaults = createDefaultWorkspaceData();
    this.writeAtomic(defaults);
    return {
      data: defaults,
      warning: `Workspace data was invalid. The damaged file was preserved as ${basename(corruptPath)}. No valid backup was available, so safe defaults were loaded.`,
      recoveredFromBackup: false
    };
  }

  save(data: WorkspaceData): WorkspaceData {
    const validated = WorkspaceDataSchema.parse(data);
    this.ensureDirectories();
    this.createBackup();
    this.writeAtomic(validated);
    return validated;
  }

  update(patch: WorkspaceDataPatch): WorkspaceData {
    const validatedPatch = WorkspaceDataPatchSchema.parse(patch);
    const current = this.load().data;
    return this.save({
      ...current,
      ...validatedPatch,
      migrations: {
        ...current.migrations,
        ...validatedPatch.migrations
      }
    });
  }

  createBackup(): string | null {
    if (!existsSync(this.workspacePath) || !this.readValidatedFile(this.workspacePath)) {
      return null;
    }

    this.ensureDirectories();
    const backupPath = join(
      this.backupsDirectory,
      `workspace-v1-backup-${this.nextFileSuffix()}.json`
    );
    copyFileSync(this.workspacePath, backupPath);
    this.pruneBackups();
    return backupPath;
  }

  recoverFromBackup(): WorkspaceData | null {
    this.ensureDirectories();
    const candidates = readdirSync(this.backupsDirectory)
      .filter((name) => name.startsWith('workspace-v1-backup-') && name.endsWith('.json'))
      .map((name) => join(this.backupsDirectory, name))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

    for (const candidate of candidates) {
      const data = this.readValidatedFile(candidate);
      if (data) {
        this.writeAtomic(data);
        return data;
      }
    }

    return null;
  }

  private ensureDirectories(): void {
    mkdirSync(this.backupsDirectory, { recursive: true });
  }

  private pruneBackups(): void {
    const backups = readdirSync(this.backupsDirectory)
      .filter((name) => name.startsWith('workspace-v1-backup-') && name.endsWith('.json'))
      .map((name) => join(this.backupsDirectory, name))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

    for (const path of backups.slice(this.maxBackups)) {
      rmSync(path, { force: true });
    }
  }

  private nextFileSuffix(): string {
    this.sequence += 1;
    return `${timestampForPath(this.now())}-${process.pid}-${this.sequence}`;
  }

  private readValidatedFile(path: string): WorkspaceData | null {
    try {
      return WorkspaceDataSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      return null;
    }
  }

  private writeAtomic(data: WorkspaceData): void {
    const validated = WorkspaceDataSchema.parse(data);
    this.ensureDirectories();
    const temporaryPath = join(
      this.workspaceDirectory,
      `.workspace-v1-${this.nextFileSuffix()}.tmp`
    );

    try {
      writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
      const temporaryData = this.readValidatedFile(temporaryPath);
      if (!temporaryData) {
        throw new Error('Temporary workspace file failed validation.');
      }
      renameSync(temporaryPath, this.workspacePath);
    } finally {
      if (existsSync(temporaryPath)) {
        rmSync(temporaryPath, { force: true });
      }
    }
  }
}
