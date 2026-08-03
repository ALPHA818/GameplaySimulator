import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import {
  resolveAdapterRequestPolicy,
  runBoundedAdapterRequest,
  validateEvidenceImage,
  type AdapterRequestPolicy,
  type AdapterRequestPolicyInput,
  type GameAdapter,
  type ScreenshotCapture,
  type ScreenshotCaptureScope
} from '../../../../../packages/adapters/src';
import type { GameAction, GameStateSnapshot } from '@core/types';
import { assertResolvedPathWithin } from '@core/security/pathContainment';

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
  captureScope?: ScreenshotCaptureScope;
  message?: string;
}

export interface EvidenceCaptureServiceOptions {
  adapter?: GameAdapter;
  now?: () => string;
  requestPolicy?: AdapterRequestPolicyInput;
  approvedSessionRoot?: string;
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

function readBoundedFile(path: string, maximumBytes: number): Buffer {
  const handle = openSync(path, 'r');

  try {
    const stats = fstatSync(handle);
    if (!stats.isFile()) {
      throw new Error('Adapter screenshot source is not a regular file.');
    }
    if (stats.size > maximumBytes) {
      throw new Error(
        `Adapter screenshot source is ${stats.size} bytes, exceeding the ${maximumBytes}-byte limit.`
      );
    }

    const buffer = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset <= maximumBytes) {
      const bytesRead = readSync(
        handle,
        buffer,
        offset,
        maximumBytes + 1 - offset,
        offset
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }

    if (offset > maximumBytes) {
      throw new Error(`Adapter screenshot source exceeded the ${maximumBytes}-byte limit while reading.`);
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(handle);
  }
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
  private readonly requestPolicy: AdapterRequestPolicy;
  private readonly approvedSessionRoot?: string;

  constructor(options: EvidenceCaptureServiceOptions = {}) {
    this.adapter = options.adapter;
    this.now = options.now ?? (() => new Date().toISOString());
    this.requestPolicy = resolveAdapterRequestPolicy(options.requestPolicy);
    this.approvedSessionRoot = options.approvedSessionRoot
      ? resolve(options.approvedSessionRoot)
      : undefined;
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

    let screenshotsDir = this.approvedSessionRoot
      ? assertResolvedPathWithin(
          this.approvedSessionRoot,
          context.screenshotsDir,
          'Session screenshot directory',
          true
        )
      : context.screenshotsDir;
    mkdirSync(screenshotsDir, { recursive: true });
    if (this.approvedSessionRoot) {
      screenshotsDir = assertResolvedPathWithin(
        realpathSync(this.approvedSessionRoot),
        realpathSync(screenshotsDir),
        'Resolved session screenshot directory',
        true
      );
    }
    const boundedContext = {
      ...context,
      screenshotsDir
    };

    if (this.adapter?.capabilities.supportsScreenshots && this.adapter.captureScreenshot && context.instanceId) {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const capture = await runBoundedAdapterRequest({
            operation: 'Adapter evidence capture',
            timeoutMs: this.requestPolicy.timeouts.evidenceMs,
            request: () => this.adapter!.captureScreenshot!(context.instanceId!, context.botId!)
          });
          return await this.persistAdapterCapture(boundedContext, capture);
        } catch (error) {
          lastError = error;
          if (attempt === 1) {
            await new Promise((resolveRetry) => setTimeout(resolveRetry, 100));
          }
        }
      }

      const message = lastError instanceof Error
        ? `${lastError.message} Screenshot capture was retried once.`
        : 'Adapter screenshot capture failed after one retry.';
      return this.writeFallback(boundedContext, message);
    }

    return this.writeFallback(boundedContext, 'Adapter screenshots are not available for this session.');
  }

  private async persistAdapterCapture(
    context: EvidenceCaptureContext,
    capture: ScreenshotCapture
  ): Promise<EvidenceCaptureResult> {
    if (this.adapter?.adapterType === 'instrumented' && capture.path !== undefined) {
      throw new Error('Instrumented evidence paths are not accepted.');
    }

    let sourcePath: string | undefined;
    if (capture.path) {
      if (!this.approvedSessionRoot) {
        throw new Error('Adapter screenshot paths require an approved session root.');
      }
      const candidatePath = isAbsolute(capture.path) ? capture.path : resolve(capture.path);
      const containedPath = assertResolvedPathWithin(
        this.approvedSessionRoot,
        candidatePath,
        'Adapter screenshot source path',
        true
      );
      sourcePath = assertResolvedPathWithin(
        realpathSync(this.approvedSessionRoot),
        realpathSync(containedPath),
        'Resolved adapter screenshot source path',
        true
      );
    }

    const rawData = capture.data
      ? Buffer.from(capture.data)
      : sourcePath
        ? readBoundedFile(sourcePath, this.requestPolicy.responseSizeLimits.screenshotBytes)
        : undefined;

    if (!rawData) {
      throw new Error('Adapter returned a screenshot without image data.');
    }

    const image = validateEvidenceImage({
      data: rawData,
      claimedMimeType: capture.mimeType,
      maximumBytes: this.requestPolicy.responseSizeLimits.screenshotBytes
    });
    const fileName = `${safePathSegment(context.reason)}-${randomUUID()}${image.extension}`;
    const outputPath = assertResolvedPathWithin(
      context.screenshotsDir,
      join(context.screenshotsDir, fileName),
      'Screenshot evidence path',
      false
    );

    writeFileSync(outputPath, image.data, { flag: 'wx' });
    return {
      kind: 'adapter_screenshot',
      path: outputPath,
      capturedAt: capture.capturedAt,
      mimeType: image.mimeType,
      fallback: false,
      sourcePath,
      captureScope: capture.scope
    };
  }

  private async writeFallback(
    context: EvidenceCaptureContext,
    message: string
  ): Promise<EvidenceCaptureResult> {
    const capturedAt = this.now();
    const outputPath = assertResolvedPathWithin(
      context.screenshotsDir,
      join(
        context.screenshotsDir,
        `fallback-${safePathSegment(context.reason)}-${randomUUID()}.svg`
      ),
      'Fallback evidence path',
      false
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

    writeFileSync(outputPath, svg, { encoding: 'utf8', flag: 'wx' });

    return {
      kind: 'fallback_svg',
      path: outputPath,
      capturedAt,
      mimeType: 'image/svg+xml',
      fallback: true,
      captureScope: 'unsupported',
      message
    };
  }
}
