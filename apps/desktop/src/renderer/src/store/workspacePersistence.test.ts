import { afterEach, describe, expect, it } from 'vitest';
import {
  configureWorkspacePersistence,
  flushWorkspacePersistence,
  requestWorkspacePersistence
} from './workspacePersistence';

describe('workspace persistence scheduling', () => {
  afterEach(() => {
    configureWorkspacePersistence(null);
  });

  it('coalesces concurrent changes and serializes follow-up writes', async () => {
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    let writes = 0;
    configureWorkspacePersistence(async () => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await Promise.resolve();
      writes += 1;
      activeWrites -= 1;
    });

    requestWorkspacePersistence();
    requestWorkspacePersistence();
    requestWorkspacePersistence();
    await flushWorkspacePersistence();

    expect(writes).toBe(1);
    expect(maximumActiveWrites).toBe(1);
  });

  it('flushes the latest pending workspace state on shutdown', async () => {
    let saved = false;
    configureWorkspacePersistence(() => {
      saved = true;
    });
    requestWorkspacePersistence();

    await flushWorkspacePersistence();

    expect(saved).toBe(true);
  });
});
