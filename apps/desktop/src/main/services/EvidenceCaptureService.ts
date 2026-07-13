import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import type { GameAdapter, ScreenshotCapture } from '../../../../../packages/adapters/src';
import type { GameAction, GameStateSnapshot } from '@core/types';

export type EvidenceCaptureKind = 'adapter_screenshot' | 'fallback_svg' | 'skipped' | 'failed';

export interface EvidenceCaptureContext {
  sessionId: string;
  botId?: string;
  instanceId?: string;
  reason: string;
  issueId?: string;
  screenshotsDir: string;
  area?: string;
  lastAction?: GameAction | null;
  progressState?: string;
  lastState?: GameStateSnapshot | null;
}

export interface EvidenceCaptureResult {
  kind: EvidenceCaptureKind;
  path?: string;
  capturedAt: string;
  mimeType?: string;
  fallback: boolean;
  sourcePath?: string;
  message?: string;
}

export interface EvidenceCaptureServiceOptions {
  adapter?: GameAdapter;
  now?: () => string;
}

function safePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extensionForCapture(capture: ScreenshotCapture): string {
  if (capture.path) {
    const extension = extname(capture.path);

    if (extension) {
      return extension;
    }
  }

  if (capture.mimeType === 'image/jpeg') {
    return '.jpg';
  }

  if (capture.mimeType === 'image/webp') {
    return '.webp';
  }

  if (capture.mimeType === 'image/svg+xml') {
    return '.svg';
  }

  return '.png';
}

function isSamePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function fallbackSvg(input: {
  sessionId: string;
  botId: string;
  instanceId?: string;
  reason: string;
  capturedAt: string;
  area?: string;
  lastAction?: string;
  progressState?: string;
  fallbackReason?: string;
}): string {
  const lines = [
    'Fallback/debug evidence',
    `Session: ${input.sessionId}`,
    `Bot: ${input.botId}`,
    `Instance: ${input.instanceId ?? 'none'}`,
    `Reason: ${input.reason}`,
    `Area: ${input.area ?? 'unknown'}`,
    `Last action: ${input.lastAction ?? 'none'}`,
    `Progress: ${input.progressState ?? 'unknown'}`,
    `Fallback reason: ${input.fallbackReason ?? 'real screenshot unavailable'}`,
    `Captured: ${input.capturedAt}`
  ];

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
    '<rect width="1280" height="720" fill="#101216"/>',
    '<rect x="48" y="48" width="1184" height="624" rx="18" fill="#191b20" stroke="#f59e0b" stroke-width="3"/>',
    '<text x="82" y="110" fill="#eef2f7" font-family="monospace" font-size="34" font-weight="700">GameplaySimulator Evidence</text>',
    ...lines.map(
      (line, index) =>
        `<text x="82" y="${162 + index * 48}" fill="#d8e0eb" font-family="monospace" font-size="24">${xmlEscape(line)}</text>`
    ),
    '</svg>'
  ].join('');
}

export class EvidenceCaptureService {
  private readonly adapter?: GameAdapter;
  private readonly now: () => string;

  constructor(options: EvidenceCaptureServiceOptions = {}) {
    this.adapter = options.adapter;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async captureScreenshot(context: EvidenceCaptureContext): Promise<EvidenceCaptureResult> {
    const capturedAt = this.now();

    if (!context.botId) {
      return {
        kind: 'skipped',
        capturedAt,
        fallback: false,
        message: 'No bot id was available for screenshot evidence.'
      };
    }

    mkdirSync(context.screenshotsDir, { recursive: true });

    if (this.adapter?.capabilities.supportsScreenshots && this.adapter.captureScreenshot && context.instanceId) {
      try {
        const capture = await this.adapter.captureScreenshot(context.instanceId, context.botId);
        return await this.persistAdapterCapture(context, capture);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Adapter screenshot capture failed.';
        return this.writeFallback(context, message);
      }
    }

    return this.writeFallback(context, 'Adapter screenshots are not available for this session.');
  }

  private async persistAdapterCapture(
    context: EvidenceCaptureContext,
    capture: ScreenshotCapture
  ): Promise<EvidenceCaptureResult> {
    const extension = extensionForCapture(capture);
    const fileName = `${safePathSegment(context.reason)}-${safePathSegment(context.issueId ?? capture.capturedAt)}${extension}`;
    const outputPath = join(context.screenshotsDir, fileName);

    if (capture.data) {
      writeFileSync(outputPath, capture.data);
      return {
        kind: 'adapter_screenshot',
        path: outputPath,
        capturedAt: capture.capturedAt,
        mimeType: capture.mimeType,
        fallback: false
      };
    }

    if (capture.path) {
      const sourcePath = isAbsolute(capture.path) ? capture.path : resolve(capture.path);
      const targetPath = isSamePath(sourcePath, outputPath)
        ? sourcePath
        : join(
            context.screenshotsDir,
            `${safePathSegment(context.reason)}-${safePathSegment(context.issueId ?? basename(sourcePath, extname(sourcePath)))}${extension}`
          );

      if (!existsSync(sourcePath)) {
        throw new Error(`Adapter screenshot file does not exist: ${sourcePath}`);
      }

      if (!isSamePath(sourcePath, targetPath)) {
        copyFileSync(sourcePath, targetPath);
      }

      return {
        kind: 'adapter_screenshot',
        path: targetPath,
        capturedAt: capture.capturedAt,
        mimeType: capture.mimeType,
        fallback: false,
        sourcePath
      };
    }

    throw new Error('Adapter returned a screenshot without file path or image data.');
  }

  private async writeFallback(
    context: EvidenceCaptureContext,
    message: string
  ): Promise<EvidenceCaptureResult> {
    const capturedAt = this.now();
    const outputPath = join(
      context.screenshotsDir,
      `fallback-${safePathSegment(context.reason)}-${safePathSegment(context.issueId ?? capturedAt)}.svg`
    );
    const svg = fallbackSvg({
      sessionId: context.sessionId,
      botId: context.botId ?? 'unknown-bot',
      instanceId: context.instanceId,
      reason: context.reason,
      capturedAt,
      area: context.area,
      lastAction: context.lastAction?.type,
      progressState: context.progressState,
      fallbackReason: message
    });

    writeFileSync(outputPath, svg, 'utf8');

    return {
      kind: 'fallback_svg',
      path: outputPath,
      capturedAt,
      mimeType: 'image/svg+xml',
      fallback: true,
      message
    };
  }
}
