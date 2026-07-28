import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPackagedChromiumExecutable } from './PackagedBrowserRuntime';

describe('packaged Chromium discovery', () => {
  it('finds the newest supported Linux Chromium executable', async () => {
    const resourcesPath = join(
      tmpdir(),
      `gameplay-simulator-packaged-browser-${Date.now()}`
    );
    const older = join(resourcesPath, 'playwright', 'chromium-1200', 'chrome-linux64');
    const newer = join(resourcesPath, 'playwright', 'chromium-1228', 'chrome-linux64');
    await mkdir(older, { recursive: true });
    await mkdir(newer, { recursive: true });
    await writeFile(join(older, 'chrome'), '');
    await writeFile(join(newer, 'chrome'), '');

    try {
      expect(findPackagedChromiumExecutable({
        resourcesPath,
        platform: 'linux'
      })).toBe(join(newer, 'chrome'));
    } finally {
      await rm(resourcesPath, { recursive: true, force: true });
    }
  });

  it('does not claim an unsupported or missing browser runtime', () => {
    expect(findPackagedChromiumExecutable({
      resourcesPath: '/missing/resources',
      platform: 'linux'
    })).toBeUndefined();
    expect(findPackagedChromiumExecutable({
      resourcesPath: '/Applications/GameplaySimulator.app/Contents/Resources',
      platform: 'darwin'
    })).toBeUndefined();
  });
});
