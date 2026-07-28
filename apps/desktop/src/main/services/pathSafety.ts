import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function canonicalPath(path: string): string {
  let existingAncestor = resolve(path);
  const missingSegments: string[] = [];

  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);

    if (parent === existingAncestor) {
      return resolve(path);
    }

    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }

  return resolve(realpathSync(existingAncestor), ...missingSegments);
}

export function isPathWithin(rootPath: string, candidatePath: string, allowRoot = true): boolean {
  const root = canonicalPath(rootPath);
  const candidate = canonicalPath(candidatePath);
  const relativePath = relative(root, candidate);

  if (relativePath === '') {
    return allowRoot;
  }

  return relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath);
}

export function assertPathWithin(
  rootPath: string,
  candidatePath: string,
  description = 'Path',
  allowRoot = true
): string {
  const candidate = resolve(candidatePath);

  if (!isPathWithin(rootPath, candidate, allowRoot)) {
    throw new Error(`${description} is outside the approved directory.`);
  }

  return candidate;
}
