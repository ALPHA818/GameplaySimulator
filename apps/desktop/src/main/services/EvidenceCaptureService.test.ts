import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameAdapter, GameAdapterInstance, ScreenshotCapture } from '../../../../../packages/adapters/src';
import type { ActionResult, GameAction, GameInstanceConfig, GameStateSnapshot } from '@core/types';
import { describe, expect, it } from 'vitest';
import { EvidenceCaptureService } from './EvidenceCaptureService';

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
    supportsCheckpointReload: false
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
    await writeFile(sourcePath, 'real screenshot bytes', 'utf8');
    const service = new EvidenceCaptureService({
      adapter: new ScreenshotAdapter(sourcePath),
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
    expect(result.path ? await readFile(result.path, 'utf8') : '').toBe('real screenshot bytes');
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
});
