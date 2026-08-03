import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPathWithin, isPathWithin } from './pathSafety';

describe('pathSafety', () => {
  it('accepts contained paths and rejects traversal, absolute injection, and similar prefixes', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'gameplay-simulator-paths-'));
    const root = join(parent, 'runs');
    await mkdir(root);

    expect(isPathWithin(root, join(root, 'session-safe', 'reports'))).toBe(true);
    expect(() =>
      assertPathWithin(root, join(root, '..', 'escaped'), 'Traversal path')
    ).toThrow(/outside the approved directory/i);
    expect(() =>
      assertPathWithin(root, resolve(parent, 'absolute-injection'), 'Absolute path')
    ).toThrow(/outside the approved directory/i);
    expect(() =>
      assertPathWithin(root, `${root}-copy/session-safe`, 'Similar-prefix path')
    ).toThrow(/outside the approved directory/i);
  });
});
