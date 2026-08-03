import { isAbsolute, relative, resolve, sep } from 'node:path';

export function isResolvedPathWithin(
  rootPath: string,
  candidatePath: string,
  allowRoot = true
): boolean {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  const relativePath = relative(root, candidate);

  if (relativePath === '') {
    return allowRoot;
  }

  return relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath);
}

export function assertResolvedPathWithin(
  rootPath: string,
  candidatePath: string,
  description = 'Path',
  allowRoot = true
): string {
  const candidate = resolve(candidatePath);

  if (!isResolvedPathWithin(rootPath, candidate, allowRoot)) {
    throw new Error(`${description} is outside the approved directory.`);
  }

  return candidate;
}
