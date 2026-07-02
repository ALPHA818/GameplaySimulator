import { spawn } from 'node:child_process';
import { join } from 'node:path';

const env = { ...process.env };
const needsLinuxElectronCompatibility = process.platform === 'linux' && env.ELECTRON_RUN_AS_NODE === '1';
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);

if (needsLinuxElectronCompatibility && args[0] === 'dev' && !args.includes('--')) {
  args.push('--', '--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--in-process-gpu');
}

const command = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
);
const child = spawn(command, args, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
