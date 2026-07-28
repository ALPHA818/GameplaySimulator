import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ReleasePackage {
  version: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  build?: {
    files?: string[];
    extraResources?: Array<{
      from?: string;
      to?: string;
      filter?: string[];
    }>;
    linux?: Record<string, unknown>;
    win?: Record<string, unknown>;
  };
}

const projectRoot = process.cwd();
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8')
) as ReleasePackage;

describe('release packaging configuration', () => {
  it('pins the final release and Node 22 LTS toolchain', () => {
    expect(packageJson.version).toBe('0.1.0');
    expect(packageJson.engines?.node).toBe('>=22.13.0 <23');
    expect(readFileSync(resolve(projectRoot, '.nvmrc'), 'utf8').trim()).toBe('22.13.0');
    expect(readFileSync(resolve(projectRoot, '.node-version'), 'utf8').trim()).toBe('22.13.0');
  });

  it('ships only built application files plus packaged Chromium', () => {
    expect(packageJson.scripts).toMatchObject({
      package: 'node scripts/package.mjs package',
      'dist:linux': 'node scripts/package.mjs linux',
      'dist:windows': 'node scripts/package.mjs windows'
    });
    expect(packageJson.build?.files).toEqual(['out/**/*', 'package.json']);
    expect(packageJson.build?.extraResources).toEqual([
      {
        from: 'build/playwright',
        to: 'playwright',
        filter: ['chromium-*/**/*']
      }
    ]);
    expect(packageJson.build?.linux).toMatchObject({
      target: ['AppImage'],
      syncDesktopName: true
    });
    expect(packageJson.build?.win).toMatchObject({
      target: ['portable']
    });
    expect(existsSync(resolve(projectRoot, 'build/icon.png'))).toBe(true);
    expect(existsSync(resolve(projectRoot, 'build/icon.ico'))).toBe(true);
  });

  it('runs validation and native package smoke tests on Linux and Windows CI', () => {
    const workflow = readFileSync(
      resolve(projectRoot, '.github/workflows/ci.yml'),
      'utf8'
    );

    expect(workflow).toContain('ubuntu-latest');
    expect(workflow).toContain('windows-latest');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('npm run test:e2e');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('npm run test:packaged');
  });
});
