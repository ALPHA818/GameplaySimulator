import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ReleasePackage {
  version: string;
  license?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  build?: {
    afterPack?: string;
    files?: string[];
    extraResources?: Array<{
      from?: string;
      to?: string;
      filter?: string[];
    }>;
    linux?: Record<string, unknown>;
    appImage?: Record<string, unknown>;
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
    expect(packageJson.license).toBe('MIT');
    expect(packageJson.engines?.node).toBe('>=22.13.0 <23');
    expect(packageJson.devDependencies?.['@types/node']).toMatch(/^\^22\./);
    expect(readFileSync(resolve(projectRoot, '.nvmrc'), 'utf8').trim()).toBe('22.13.0');
    expect(readFileSync(resolve(projectRoot, '.node-version'), 'utf8').trim()).toBe('22.13.0');
  });

  it('ships only built application files plus packaged Chromium', () => {
    expect(packageJson.scripts).toMatchObject({
      package: 'node scripts/package.mjs package',
      'dist:linux': 'node scripts/package.mjs linux',
      'dist:windows': 'node scripts/package.mjs windows'
    });
    expect(packageJson.build?.files).toEqual(expect.arrayContaining([
      'out/**/*',
      'package.json',
      'LICENSE',
      '!**/*.map',
      '!**/*.d.ts',
      '!node_modules/**/*.ts',
      '!node_modules/**/{test,tests,__tests__,benchmark,benchmarks,example,examples,fixtures}/**/*'
    ]));
    expect(packageJson.build?.afterPack).toBe('scripts/after-pack.cjs');
    expect(readFileSync(resolve(projectRoot, 'LICENSE'), 'utf8')).toContain(
      'Copyright (c) 2026 Hanre Bornman'
    );
    expect(packageJson.build?.extraResources).toEqual([
      {
        from: 'build/playwright',
        to: 'playwright',
        filter: ['chromium-*/**/*']
      }
    ]);
    expect(packageJson.build?.linux).toMatchObject({
      target: ['AppImage'],
      syncDesktopName: true,
      executableArgs: []
    });
    expect(packageJson.build?.appImage).toEqual({
      executableArgs: []
    });
    expect(packageJson.build?.win).toMatchObject({
      target: ['portable'],
      artifactName: '${productName}-${version}-windows-${arch}.${ext}',
      requestedExecutionLevel: 'asInvoker'
    });
    expect(existsSync(resolve(projectRoot, 'build/icon.png'))).toBe(true);
    expect(existsSync(resolve(projectRoot, 'build/icon.ico'))).toBe(true);
  });

  it('does not add sandbox bypasses to production launch paths', () => {
    const packagedSmoke = readFileSync(
      resolve(projectRoot, 'scripts/test-packaged-app.mjs'),
      'utf8'
    );
    const appImageLauncher = readFileSync(
      resolve(projectRoot, 'scripts/after-pack.cjs'),
      'utf8'
    );
    expect(appImageLauncher).toContain("packagedFiles.includes('/LICENSE')");
    expect(appImageLauncher).toContain('packagedLicense !== sourceLicense');

    for (const argument of ['--no-sandbox', '--disable-setuid-sandbox']) {
      expect(packagedSmoke).not.toContain(argument);
      expect(appImageLauncher).not.toContain(argument);
      expect(packageJson.build?.linux?.executableArgs ?? []).not.toContain(argument);
      expect(packageJson.build?.appImage?.executableArgs ?? []).not.toContain(argument);
    }
    expect(packagedSmoke).toContain('delete env.APPIMAGE_EXTRACT_AND_RUN');

    const sandboxValidator = readFileSync(
      resolve(projectRoot, 'scripts/validate-packaged-sandbox.mjs'),
      'utf8'
    );
    expect(sandboxValidator).toContain('const isUnpackedDirectory = targetStat.isDirectory()');
    expect(sandboxValidator).toContain('if (!isUnpackedDirectory)');
  });

  it('uses the real browser action-hook contract and drives a packaged UI journey', () => {
    const packagedSmoke = readFileSync(
      resolve(projectRoot, 'scripts/test-packaged-app.mjs'),
      'utf8'
    );

    expect(packagedSmoke).toContain('__GAMEPLAY_SIM_PERFORM_ACTION__ = async (action)');
    expect(packagedSmoke).not.toContain('__GAMEPLAY_SIM_PERFORM_ACTION__ = ({ action })');
    expect(packagedSmoke).toContain('assertSuccessfulPackagedAction');
    expect(packagedSmoke).toContain("getByRole('button', { name: 'Game Profiles'");
    expect(packagedSmoke).toContain("getByRole('button', { name: 'New Session'");
    expect(packagedSmoke).toContain("getByRole('button', { name: 'Start Session'");
    expect(packagedSmoke).toContain("getByRole('heading', { name: 'Live Session'");
    expect(packagedSmoke).toContain("getByRole('button', { name: 'Reports'");
    expect(packagedSmoke).toContain("getByRole('button', { name: 'Summary report'");
    expect(packagedSmoke).toContain('GameplaySimulator Portable Path With Spaces');
    expect(packagedSmoke).toContain('expectedPortableName');
    expect(packagedSmoke).toContain('launchWindowsPortableApplication');
    expect(packagedSmoke).toContain('chromium.connectOverCDP');
    expect(packagedSmoke).toContain('remote-debugging-address=127.0.0.1');
    expect(packagedSmoke).toContain("if (process.platform === 'win32')");
    expect(packagedSmoke).toContain('diagnosticLogs');
    expect(packagedSmoke).toContain('adapter_launch_failed');
    expect(packagedSmoke).toContain('removeTemporaryDirectory');
    expect(packagedSmoke).toContain("maxRetries: process.platform === 'win32' ? 20 : 0");
    expect(packagedSmoke).toContain('windowsLaunchIdentity');
    expect(packagedSmoke).toContain('active-shutdown session');
    expect(packagedSmoke).toContain('startInstrumentedExample');
    expect(packagedSmoke).toContain('packaged-instrumented-move-forward');
    expect(packagedSmoke).toContain("assertSessionReportContainsAction(instrumentedSummary, 'move-forward')");
    expect(packagedSmoke).toContain('GAMEPLAY_SIMULATOR_RELEASE_HEXCRAFT');
    expect(packagedSmoke).toContain("const permittedHexcraftUrl = 'http://127.0.0.1:5173/'");
    expect(packagedSmoke).toContain("startupFlowId: hexcraftReleaseTarget ? 'hexcraft-create-world'");
    expect(packagedSmoke).toContain("directiveId: 'hexcraft-open-pause-menu'");
    expect(packagedSmoke).toContain("log.raw?.payload?.scene === 'pause-menu'");
    expect(packagedSmoke).toContain('windows-validation-');
    const standardUserSmoke = readFileSync(
      resolve(projectRoot, 'scripts/test-windows-standard-user.ps1'),
      'utf8'
    );
    expect(standardUserSmoke).toContain('New-LocalUser');
    expect(standardUserSmoke).toContain('GAMEPLAY_SIMULATOR_STANDARD_USER_SMOKE');
    expect(standardUserSmoke).toContain('GameplaySimulator Standard User Test With Spaces');
    expect(standardUserSmoke).toContain("Get-LocalGroupMember -Group 'Administrators'");
    expect(standardUserSmoke).toContain('launch-standard-user-smoke.ps1');
    expect(standardUserSmoke).toContain("-File `\"$launcherPath`\"");
    expect(standardUserSmoke).not.toContain('-EncodedCommand');
    expect(standardUserSmoke).toContain('$childProcess.ExitCode -ne 0');
    expect(standardUserSmoke).toContain('Get-OwnedProcessTreeIds');
    expect(standardUserSmoke).not.toContain("Name -like 'GameplaySimulator*.exe'");
    expect(standardUserSmoke).toContain('standardUserLaunch = \'passed\'');
    const electronMain = readFileSync(
      resolve(projectRoot, 'apps/desktop/src/main/index.ts'),
      'utf8'
    );
    expect(electronMain).toContain('user: userInfo().username');
    expect(electronMain).toContain('processId: process.pid');
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
    expect(workflow).toContain("APP_VERSION=' + require('./package.json').version");
    expect(workflow).toContain('scripts/verify-release-artifacts.mjs');
    expect(workflow).toContain('release/GameplaySimulator-$env:APP_VERSION-windows-x64.exe');
    expect(workflow).toContain('test-windows-standard-user.ps1');
    expect(workflow).not.toContain('release/win-unpacked');
    expect(workflow).not.toContain('GameplaySimulator-0.1.0-linux-x86_64.AppImage');
    expect(workflow).not.toMatch(/uses:\s+actions\/(?:checkout|setup-node|upload-artifact)@v\d+/);
    expect(workflow).toMatch(/actions\/checkout@[a-f0-9]{40}/);
    expect(workflow).toMatch(/actions\/setup-node@[a-f0-9]{40}/);
    expect(workflow).toMatch(/actions\/upload-artifact@[a-f0-9]{40}/);
  });

  it('cleans release output and creates verified checksums for current-version artifacts', () => {
    const packagingScript = readFileSync(
      resolve(projectRoot, 'scripts/package.mjs'),
      'utf8'
    );
    const verificationScript = readFileSync(
      resolve(projectRoot, 'scripts/verify-release-artifacts.mjs'),
      'utf8'
    );

    expect(packagingScript).toContain('rmSync(outputDirectory');
    expect(packagingScript).toContain('packageMetadata.version');
    expect(packagingScript).toContain("'--publish', 'never'");
    expect(packagingScript).toContain('.sha256');
    expect(packagingScript).toContain('SHA256SUMS-');
    expect(packagingScript).toContain('verify-release-artifacts.mjs');
    expect(verificationScript).toContain('packageVersion');
    expect(verificationScript).toContain('exactly one current');
    const afterPackScript = readFileSync(
      resolve(projectRoot, 'scripts/after-pack.cjs'),
      'utf8'
    );
    expect(afterPackScript).toContain("path.replaceAll('\\\\', '/')");
  });
});
