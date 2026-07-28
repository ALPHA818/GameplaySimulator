import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const mode = process.argv[2] ?? 'package';
const supportedModes = new Set(['package', 'linux', 'windows']);

if (!supportedModes.has(mode)) {
  throw new Error(`Unknown package mode "${mode}".`);
}

if (mode === 'linux' && process.platform !== 'linux') {
  throw new Error('dist:linux must run on Linux so the bundled Chromium runtime matches Linux.');
}

if (mode === 'windows' && process.platform !== 'win32') {
  throw new Error('dist:windows must run on Windows so the bundled Chromium runtime matches Windows.');
}

function runNode(scriptPath, args = []) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false
    });

    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (signal) {
        rejectRun(new Error(`${scriptPath} stopped with signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        rejectRun(new Error(`${scriptPath} exited with code ${code ?? 'unknown'}.`));
        return;
      }

      resolveRun();
    });
  });
}

const buildCli = process.env.npm_execpath;
const playwrightPreparation = resolve(projectRoot, 'scripts', 'prepare-playwright-browser.mjs');
const builderCli = resolve(projectRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

if (!buildCli || !existsSync(buildCli)) {
  throw new Error('Packaging must be started through an npm script so the locked npm CLI is used.');
}

await runNode(buildCli, ['run', 'build']);
await runNode(playwrightPreparation);

if (mode === 'package') {
  await runNode(builderCli, ['--dir']);
} else if (mode === 'linux') {
  await runNode(builderCli, ['--linux', 'AppImage']);
} else {
  await runNode(builderCli, ['--win', 'portable']);
}
