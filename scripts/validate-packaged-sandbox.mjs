import { constants } from 'node:fs';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const forbiddenSandboxArguments = [
  '--no-sandbox',
  '--disable-setuid-sandbox'
];

function assertNoSandboxBypass(value, label) {
  for (const argument of forbiddenSandboxArguments) {
    if (value.includes(argument)) {
      throw new Error(`${label} contains forbidden sandbox bypass ${argument}.`);
    }
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'pipe',
      shell: false
    });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (signal) {
        rejectRun(new Error(`${basename(command)} stopped with signal ${signal}.`));
        return;
      }
      if (code !== 0) {
        rejectRun(new Error(
          `${basename(command)} exited with code ${code ?? 'unknown'}: ${stderr.trim()}`
        ));
        return;
      }
      resolveRun();
    });
  });
}

async function extractedAppImageRoot(appImagePath) {
  const extractionRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-appimage-'));
  await run(appImagePath, ['--appimage-extract'], { cwd: extractionRoot });
  return {
    cleanupRoot: extractionRoot,
    packageRoot: join(extractionRoot, 'squashfs-root')
  };
}

export async function validatePackagedSandbox(targetPath) {
  const absoluteTarget = resolve(targetPath);
  const targetStat = await stat(absoluteTarget);
  const isUnpackedDirectory = targetStat.isDirectory();
  const extracted = isUnpackedDirectory
    ? { packageRoot: absoluteTarget }
    : await extractedAppImageRoot(absoluteTarget);

  try {
    const appRunPath = join(extracted.packageRoot, 'AppRun');
    await access(appRunPath, constants.X_OK);
    const appRun = await readFile(appRunPath, 'utf8');
    assertNoSandboxBypass(appRun, 'AppImage AppRun');

    if (!isUnpackedDirectory) {
      const desktopFiles = (await readdir(extracted.packageRoot))
        .filter((entry) => entry.endsWith('.desktop'));
      if (desktopFiles.length === 0) {
        throw new Error('The AppImage does not contain a desktop entry.');
      }

      for (const desktopFile of desktopFiles) {
        const desktopEntry = await readFile(
          join(extracted.packageRoot, desktopFile),
          'utf8'
        );
        assertNoSandboxBypass(desktopEntry, `Desktop entry ${desktopFile}`);
      }
    }
  } finally {
    if (extracted.cleanupRoot) {
      await rm(extracted.cleanupRoot, { recursive: true, force: true });
    }
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const targetPath = process.argv[2];
  if (!targetPath) {
    throw new Error('Provide an AppImage or unpacked Linux application directory to validate.');
  }

  await validatePackagedSandbox(targetPath);
  console.log(`Sandbox validation passed for ${basename(targetPath)}.`);
}
