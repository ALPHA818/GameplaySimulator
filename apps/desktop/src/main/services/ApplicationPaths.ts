import { join, resolve } from 'node:path';

export interface ApplicationDataPaths {
  userDataRoot: string;
  workspaceRoot: string;
  runsRoot: string;
  logsRoot: string;
  legacyRunsRoots: string[];
}

export interface ApplicationDataPathInput {
  userDataPath: string;
  appPath: string;
  isPackaged: boolean;
  currentWorkingDirectory?: string;
}

function isAsarPath(path: string): boolean {
  return path.split(/[\\/]/).some((part) => part.toLowerCase().endsWith('.asar'));
}

export function resolveApplicationDataPaths(input: ApplicationDataPathInput): ApplicationDataPaths {
  const userDataRoot = resolve(input.userDataPath);
  const appPath = resolve(input.appPath);
  const workingDirectory = resolve(input.currentWorkingDirectory ?? process.cwd());
  const runsRoot = input.isPackaged
    ? join(userDataRoot, 'runs')
    : join(appPath, 'runs');
  const legacyRunsRoots = input.isPackaged
    ? [...new Set([join(workingDirectory, 'runs'), join(appPath, 'runs')])]
        .filter((path) => resolve(path) !== resolve(runsRoot))
        .filter((path) => !isAsarPath(path))
    : [];

  return {
    userDataRoot,
    workspaceRoot: join(userDataRoot, 'workspace'),
    runsRoot,
    logsRoot: join(userDataRoot, 'logs'),
    legacyRunsRoots
  };
}
