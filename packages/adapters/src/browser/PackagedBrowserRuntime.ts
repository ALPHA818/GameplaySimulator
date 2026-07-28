import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface PackagedBrowserRuntimeOptions {
  platform?: NodeJS.Platform;
  resourcesPath?: string;
}

function chromiumExecutableCandidates(
  browserDirectory: string,
  platform: NodeJS.Platform
): string[] {
  if (platform === 'win32') {
    return [
      join(browserDirectory, 'chrome-win64', 'chrome.exe'),
      join(browserDirectory, 'chrome-win', 'chrome.exe')
    ];
  }

  if (platform === 'linux') {
    return [
      join(browserDirectory, 'chrome-linux64', 'chrome'),
      join(browserDirectory, 'chrome-linux', 'chrome')
    ];
  }

  return [];
}

export function findPackagedChromiumExecutable(
  options: PackagedBrowserRuntimeOptions = {}
): string | undefined {
  const resourcesPath = options.resourcesPath?.trim();
  const platform = options.platform ?? process.platform;

  if (!resourcesPath || (platform !== 'linux' && platform !== 'win32')) {
    return undefined;
  }

  const browserRoot = resolve(resourcesPath, 'playwright');

  if (!existsSync(browserRoot)) {
    return undefined;
  }

  const directories = readdirSync(browserRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));

  for (const directory of directories) {
    const executablePath = chromiumExecutableCandidates(
      join(browserRoot, directory.name),
      platform
    ).find((candidate) => existsSync(candidate));

    if (executablePath) {
      return executablePath;
    }
  }

  return undefined;
}

export function electronResourcesPath(): string | undefined {
  const value = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function isPackagedElectronRuntime(): boolean {
  const runtime = process as NodeJS.Process & { defaultApp?: boolean };
  return Boolean(process.versions.electron && runtime.defaultApp !== true);
}
