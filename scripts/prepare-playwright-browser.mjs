import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const browserRoot = resolve(projectRoot, 'build', 'playwright');
const playwrightCli = resolve(projectRoot, 'node_modules', 'playwright', 'cli.js');

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
      ...options
    });

    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (signal) {
        rejectRun(new Error(`Browser preparation stopped with signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        rejectRun(new Error(`Browser preparation exited with code ${code ?? 'unknown'}.`));
        return;
      }

      resolveRun();
    });
  });
}

function chromiumExecutableCandidates(directory) {
  if (process.platform === 'win32') {
    return [
      join(directory, 'chrome-win64', 'chrome.exe'),
      join(directory, 'chrome-win', 'chrome.exe')
    ];
  }

  return [
    join(directory, 'chrome-linux64', 'chrome'),
    join(directory, 'chrome-linux', 'chrome')
  ];
}

async function chromiumDirectories() {
  if (!existsSync(browserRoot)) {
    return [];
  }

  return (await readdir(browserRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
  .map((entry) => join(browserRoot, entry.name));
}

let stagedChromiumDirectories = await chromiumDirectories();
let executablePath = stagedChromiumDirectories
  .flatMap(chromiumExecutableCandidates)
  .find((candidate) => existsSync(candidate));

if (!executablePath) {
  await rm(browserRoot, { recursive: true, force: true });
  await mkdir(browserRoot, { recursive: true });
  await run(process.execPath, [playwrightCli, 'install', '--no-shell', 'chromium'], {
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browserRoot
    }
  });
  stagedChromiumDirectories = await chromiumDirectories();
}

const entries = await readdir(browserRoot, { withFileTypes: true });
for (const entry of entries) {
  if (!stagedChromiumDirectories.includes(join(browserRoot, entry.name))) {
    await rm(join(browserRoot, entry.name), { recursive: true, force: true });
  }
}

executablePath = stagedChromiumDirectories
  .flatMap(chromiumExecutableCandidates)
  .find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error(
    `Playwright installed Chromium, but its executable was not found under ${browserRoot}.`
  );
}

console.log(`Staged packaged Chromium at ${executablePath}`);
