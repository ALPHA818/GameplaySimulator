import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { GameAdapter, GameAdapterInstance, ScreenshotCapture } from '../../../../../packages/adapters/src';
import type { ActionResult, GameAction, GameInstanceConfig, GameStateSnapshot } from '@core/types';
import { describe, expect, it } from 'vitest';
import { EvidenceCaptureService } from './EvidenceCaptureService';

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const VALID_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
  'base64'
);

class ScreenshotAdapter implements GameAdapter {
  readonly id = 'screenshot-adapter';
  readonly name = 'Screenshot Adapter';
  readonly adapterType = 'browser';
  readonly capabilities = {
    supportsMultipleInstances: true,
    supportsMultipleBotsPerInstance: true,
    supportsStateRead: true,
    supportsDirectActions: true,
    supportsInputSimulation: true,
    supportsScreenshots: true,
    supportsVideo: false,
    supportsGameLogs: false,
    supportsSaveIsolation: true,
    supportsReset: false,
    supportsCheckpointReload: false,
    supportsLiveObservation: true,
    supportsWindowFocus: true,
    supportsMultipleVisibleWindows: true,
    observationCapability: 'visible-window' as const
  };

  constructor(private readonly sourcePath: string, private readonly shouldFail = false) {}

  async launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance> {
    return {
      instanceId: config.instanceId,
      adapterId: this.id,
      gameProfileId: config.gameProfileId,
      launchConfig: config,
      startedAt: '2026-07-07T10:00:00.000Z',
      metadata: {}
    };
  }

  async stopInstance(): Promise<void> {}

  async stopAll(): Promise<void> {}

  async getState(): Promise<GameStateSnapshot | null> {
    return null;
  }

  async getAvailableActions() {
    return [];
  }

  async performAction(_instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    return {
      actionId: action.actionId,
      botId,
      status: 'skipped',
      startedAt: action.requestedAt,
      completedAt: '2026-07-07T10:00:00.000Z',
      durationMs: 0,
      issueIds: []
    };
  }

  async captureScreenshot(instanceId: string, botId: string): Promise<ScreenshotCapture> {
    if (this.shouldFail) {
      throw new Error('camera unavailable');
    }

    return {
      instanceId,
      botId,
      capturedAt: '2026-07-07T10:00:00.000Z',
      scope: 'game-window',
      path: this.sourcePath,
      mimeType: 'image/png'
    };
  }

  async isRunning(): Promise<boolean> {
    return true;
  }

  async getHealth() {
    return {
      instanceId: 'game-instance-001',
      status: 'running' as const,
      checkedAt: '2026-07-07T10:00:00.000Z',
      details: {}
    };
  }
}

describe('EvidenceCaptureService', () => {
  it('copies real adapter screenshots into the bot screenshot folder', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-evidence-real-'));
    const sourcePath = join(tempDir, 'adapter-source.png');
    const screenshotsDir = join(tempDir, 'bots', 'explorer-001', 'screenshots');
    await writeFile(sourcePath, VALID_PNG);
    const service = new EvidenceCaptureService({
      adapter: new ScreenshotAdapter(sourcePath),
      approvedSessionRoot: tempDir,
      now: () => '2026-07-07T10:00:00.000Z'
    });

    const result = await service.captureScreenshot({
      sessionId: 'session-evidence-real',
      botId: 'explorer-001',
      instanceId: 'game-instance-001',
      reason: 'issue-detected',
      issueId: 'issue-001',
      screenshotsDir
    });

    expect(result.kind).toBe('adapter_screenshot');
    expect(result.fallback).toBe(false);
    expect(result.path).toContain(screenshotsDir);
    expect(result.path?.endsWith('.png')).toBe(true);
    expect(result.captureScope).toBe('game-window');
    expect(result.path ? await readFile(result.path) : Buffer.alloc(0)).toEqual(VALID_PNG);
    expect(dirname(result.path ?? '')).toBe(screenshotsDir);
  });

  it('writes fallback SVG evidence when adapter screenshots fail', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-evidence-fallback-'));
    const sourcePath = join(tempDir, 'missing.png');
    const screenshotsDir = join(tempDir, 'bots', 'explorer-001', 'screenshots');
    const service = new EvidenceCaptureService({
      adapter: new ScreenshotAdapter(sourcePath, true),
      now: () => '2026-07-07T10:00:00.000Z'
    });

    const result = await service.captureScreenshot({
      sessionId: 'session-evidence-fallback',
      botId: 'explorer-001',
      instanceId: 'game-instance-001',
      reason: 'issue-detected',
      issueId: 'issue-001',
      screenshotsDir,
      area: 'Start Area',
      progressState: 'Recovery failed'
    });

    expect(result.kind).toBe('fallback_svg');
    expect(result.fallback).toBe(true);
    expect(result.message).toContain('camera unavailable');
    expect(result.path?.endsWith('.svg')).toBe(true);
    expect(result.path ? existsSync(result.path) : false).toBe(true);
    expect(result.path ? await readFile(result.path, 'utf8') : '').toContain('Fallback/debug evidence');
  });

  it('retries one transient adapter screenshot failure before using fallback evidence', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-evidence-retry-'));
    const sourcePath = join(tempDir, 'adapter.png');
    const screenshotsDir = join(tempDir, 'bots', 'explorer-001', 'screenshots');
    await writeFile(sourcePath, VALID_PNG);
    const adapter = new ScreenshotAdapter(sourcePath);
    let attempts = 0;
    const captureScreenshot = adapter.captureScreenshot.bind(adapter);
    adapter.captureScreenshot = async (instanceId, botId) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('headed browser capture was temporarily unavailable');
      }
      return captureScreenshot(instanceId, botId);
    };
    const service = new EvidenceCaptureService({ adapter, approvedSessionRoot: tempDir });

    const result = await service.captureScreenshot({
      sessionId: 'session-evidence-retry',
      botId: 'explorer-001',
      instanceId: 'game-instance-001',
      reason: 'action-1',
      screenshotsDir
    });

    expect(attempts).toBe(2);
    expect(result.kind).toBe('adapter_screenshot');
    expect(result.fallback).toBe(false);
    expect(result.path ? await readFile(result.path) : Buffer.alloc(0)).toEqual(VALID_PNG);
  });

  it('bounds a screenshot adapter that never responds', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-evidence-timeout-'));
    const screenshotsDir = join(tempDir, 'bots', 'explorer-001', 'screenshots');
    const adapter = new ScreenshotAdapter(join(tempDir, 'unused.png'));
    adapter.captureScreenshot = async () => await new Promise<never>(() => undefined);
    const service = new EvidenceCaptureService({
      adapter,
      requestPolicy: {
        timeouts: {
          evidenceMs: 20
        }
      },
      now: () => '2026-07-07T10:00:00.000Z'
    });

    const result = await service.captureScreenshot({
      sessionId: 'session-evidence-timeout',
      botId: 'explorer-001',
      instanceId: 'game-instance-001',
      reason: 'issue-detected',
      issueId: 'issue-timeout',
      screenshotsDir
    });

    expect(result.kind).toBe('fallback_svg');
    expect(result.message).toMatch(/timed out after 20 ms/i);
  });

  it('rejects MIME spoofing without writing untrusted adapter bytes', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-evidence-mime-'));
    const screenshotsDir = join(tempDir, 'bots', 'explorer-001', 'screenshots');
    const adapter = new ScreenshotAdapter(join(tempDir, 'unused.png'));
    adapter.captureScreenshot = async (instanceId, botId) => ({
      instanceId,
      botId,
      capturedAt: '2026-07-07T10:00:00.000Z',
      data: VALID_PNG,
      mimeType: 'image/jpeg'
    });
    const service = new EvidenceCaptureService({ adapter });

    const result = await service.captureScreenshot({
      sessionId: 'session-evidence-mime',
      botId: 'explorer-001',
      instanceId: 'game-instance-001',
      reason: 'issue-detected',
      issueId: 'issue-mime',
      screenshotsDir
    });

    expect(result.kind).toBe('fallback_svg');
    expect(result.message).toMatch(/MIME type does not match PNG/i);
    expect(dirname(result.path ?? '')).toBe(screenshotsDir);
  });

  it('chooses a safe JPEG extension from validated bytes', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gameplay-simulator-evidence-jpeg-'));
    const screenshotsDir = join(tempDir, 'bots', 'explorer-001', 'screenshots');
    const adapter = new ScreenshotAdapter(join(tempDir, 'untrusted-name.png'));
    adapter.captureScreenshot = async (instanceId, botId) => ({
      instanceId,
      botId,
      capturedAt: '2026-07-07T10:00:00.000Z',
      data: VALID_JPEG,
      mimeType: 'image/jpeg'
    });
    const service = new EvidenceCaptureService({
      adapter,
      approvedSessionRoot: tempDir
    });

    const result = await service.captureScreenshot({
      sessionId: 'session-evidence-jpeg',
      botId: 'explorer-001',
      instanceId: 'game-instance-001',
      reason: 'issue-detected',
      issueId: 'issue-jpeg',
      screenshotsDir
    });

    expect(result.kind).toBe('adapter_screenshot');
    expect(dirname(result.path ?? '')).toBe(screenshotsDir);
    expect(basename(result.path ?? '')).toMatch(/^issue-detected-/);
    expect(result.path?.endsWith('.jpg')).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
  });
});
