import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const releaseRoot = resolve(projectRoot, 'release');
const outRoot = resolve(projectRoot, 'out');
const stagedBrowserRoot = resolve(projectRoot, 'build', 'playwright');
const packageMetadata = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8')
);
const packageVersion = packageMetadata.version;
const mode = process.argv[2] ?? 'package';
const supportedModes = new Set(['package', 'linux', 'windows']);

if (typeof packageVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  throw new Error('package.json must contain a safe semantic version before packaging.');
}

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
const sandboxValidation = resolve(projectRoot, 'scripts', 'validate-packaged-sandbox.mjs');
const artifactVerification = resolve(projectRoot, 'scripts', 'verify-release-artifacts.mjs');

if (!buildCli || !existsSync(buildCli)) {
  throw new Error('Packaging must be started through an npm script so the locked npm CLI is used.');
}

for (const outputDirectory of [releaseRoot, outRoot, stagedBrowserRoot]) {
  rmSync(outputDirectory, { recursive: true, force: true });
}
mkdirSync(releaseRoot, { recursive: true });

await runNode(buildCli, ['run', 'build']);
await runNode(playwrightPreparation);

if (mode === 'package') {
  await runNode(builderCli, ['--dir']);
} else if (mode === 'linux') {
  await runNode(builderCli, ['--linux', 'AppImage']);
} else {
  await runNode(builderCli, ['--win', 'portable']);
}

if (process.platform === 'linux') {
  let sandboxTarget = resolve(releaseRoot, 'linux-unpacked');

  if (mode === 'linux') {
    const appImages = readdirSync(releaseRoot)
      .filter((entry) =>
        entry.startsWith(`GameplaySimulator-${packageVersion}-linux-`) &&
        entry.endsWith('.AppImage')
      )
      .map((entry) => join(releaseRoot, entry))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

    if (!appImages[0]) {
      throw new Error(`No Linux AppImage was generated for version ${packageVersion}.`);
    }
    sandboxTarget = appImages[0];
  }

  await runNode(sandboxValidation, [sandboxTarget]);
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(filePath);
    stream.once('error', rejectHash);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolveHash);
  });
  return hash.digest('hex');
}

if (mode !== 'package') {
  const extension = mode === 'linux' ? '.AppImage' : '.exe';
  const platformName = mode === 'linux' ? 'linux' : 'windows';
  const distributableNames = readdirSync(releaseRoot)
    .filter((entry) => entry.endsWith(extension));
  const expectedPrefix = `GameplaySimulator-${packageVersion}-${platformName}-`;

  if (distributableNames.length !== 1 || !distributableNames[0].startsWith(expectedPrefix)) {
    throw new Error(
      `Expected exactly one ${packageVersion} ${platformName} artifact, found: ${distributableNames.join(', ') || 'none'}.`
    );
  }

  const checksumLines = [];
  for (const artifactName of distributableNames) {
    const artifactPath = join(releaseRoot, artifactName);
    const digest = await sha256(artifactPath);
    const checksumLine = `${digest}  ${basename(artifactPath)}\n`;
    writeFileSync(`${artifactPath}.sha256`, checksumLine, 'utf8');
    checksumLines.push(checksumLine);
  }
  writeFileSync(
    join(releaseRoot, `SHA256SUMS-${packageVersion}-${platformName}.txt`),
    checksumLines.join(''),
    'utf8'
  );
  await runNode(artifactVerification, [platformName]);
}
