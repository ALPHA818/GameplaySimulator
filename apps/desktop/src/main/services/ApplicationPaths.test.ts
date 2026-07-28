import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveApplicationDataPaths } from './ApplicationPaths';
import { isPathWithin } from './pathSafety';

describe('application data paths', () => {
  it('uses Electron userData for all packaged writable data', () => {
    const paths = resolveApplicationDataPaths({
      userDataPath: '/home/test/.config/GameplaySimulator',
      appPath: '/opt/GameplaySimulator/resources/app.asar',
      currentWorkingDirectory: '/home/test/GameplaySimulator',
      isPackaged: true
    });

    expect(paths.runsRoot).toBe(resolve('/home/test/.config/GameplaySimulator/runs'));
    expect(paths.workspaceRoot).toBe(resolve('/home/test/.config/GameplaySimulator/workspace'));
    expect(paths.logsRoot).toBe(resolve('/home/test/.config/GameplaySimulator/logs'));
    expect(paths.legacyRunsRoots).toEqual([resolve('/home/test/GameplaySimulator/runs')]);
  });

  it('keeps development runs in the application repository', () => {
    const paths = resolveApplicationDataPaths({
      userDataPath: '/tmp/gameplay-simulator-user-data',
      appPath: '/workspace/GameplaySimulator',
      currentWorkingDirectory: '/unrelated',
      isPackaged: false
    });

    expect(paths.runsRoot).toBe(resolve('/workspace/GameplaySimulator/runs'));
    expect(paths.legacyRunsRoots).toEqual([]);
  });

  it('uses path-relative containment rather than unsafe string prefixes', () => {
    const root = join('/tmp', 'runs', 'session-001');

    expect(isPathWithin(root, join(root, 'screenshots', 'issue.png'))).toBe(true);
    expect(isPathWithin(root, join('/tmp', 'runs', 'session-001-copy', 'issue.png'))).toBe(false);
    expect(isPathWithin(root, join(root, '..', 'session-002', 'issue.png'))).toBe(false);
  });
});
