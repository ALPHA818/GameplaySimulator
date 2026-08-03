import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const releaseRoot = resolve(projectRoot, 'release');
const platformName = process.argv[2] ?? (process.platform === 'win32' ? 'windows' : 'linux');
const extension = platformName === 'windows' ? '.exe' : platformName === 'linux' ? '.AppImage' : undefined;
const packageVersion = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8')
).version;

if (!extension) {
  throw new Error(`Unsupported release artifact platform "${platformName}".`);
}

const distributedArtifacts = readdirSync(releaseRoot)
  .filter((entry) => entry.endsWith(extension));
const expectedPrefix = `GameplaySimulator-${packageVersion}-${platformName}-`;

if (distributedArtifacts.length !== 1 || !distributedArtifacts[0].startsWith(expectedPrefix)) {
  throw new Error(
    `Release output must contain exactly one current ${platformName} artifact for ${packageVersion}; found ${distributedArtifacts.join(', ') || 'none'}.`
  );
}

const manifestPath = join(releaseRoot, `SHA256SUMS-${packageVersion}-${platformName}.txt`);
const manifest = readFileSync(manifestPath, 'utf8');

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

for (const artifactName of distributedArtifacts) {
  const artifactPath = join(releaseRoot, artifactName);
  const digest = await sha256(artifactPath);
  const expectedLine = `${digest}  ${basename(artifactPath)}`;
  const sidecar = readFileSync(`${artifactPath}.sha256`, 'utf8').trim();

  if (sidecar !== expectedLine) {
    throw new Error(`Checksum sidecar does not match ${artifactName}.`);
  }
  if (!manifest.split(/\r?\n/).includes(expectedLine)) {
    throw new Error(`Checksum manifest does not include ${artifactName}.`);
  }
}

console.log(`Verified ${distributedArtifacts.length} ${platformName} artifact for version ${packageVersion}.`);
