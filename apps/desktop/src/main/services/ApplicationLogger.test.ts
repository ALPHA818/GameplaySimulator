import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApplicationLogger } from './ApplicationLogger';
import { redactSensitiveText, sanitizeForLogging } from './SensitiveData';

describe('application log credential redaction', () => {
  it('redacts sensitive keys and token-shaped text recursively', () => {
    expect(sanitizeForLogging({
      token: 'ghp_1234567890abcdef',
      nested: {
        authorization: 'Bearer private-value',
        message: 'Request failed with Bearer another-private-value'
      }
    })).toEqual({
      token: '[REDACTED]',
      nested: {
        authorization: '[REDACTED]',
        message: 'Request failed with Bearer [REDACTED]'
      }
    });
    expect(redactSensitiveText('Token ghp_1234567890abcdef failed')).toBe(
      'Token [REDACTED] failed'
    );
    expect(
      redactSensitiveText(
        'https://example.test/callback?access_token=private-value&next=reports'
      )
    ).toBe(
      'https://example.test/callback?access_token=[REDACTED]&next=reports'
    );
    expect(redactSensitiveText('github_pat_1234567890abcdef')).toBe('[REDACTED]');
  });

  it('never writes GitHub tokens from errors or details', async () => {
    const logsDirectory = await mkdtemp(join(tmpdir(), 'gameplay-simulator-secure-logs-'));
    const logger = new ApplicationLogger(
      logsDirectory,
      () => '2026-07-28T20:00:00.000Z'
    );

    try {
      logger.logFailure(
        'security_test',
        new Error('Request used Bearer ghp_1234567890abcdef'),
        {
          githubToken: 'ghp_abcdefghijklmnop',
          request: {
            authorization: 'Bearer secret-header'
          }
        }
      );
      await logger.flush();
      const contents = await readFile(logger.logPath, 'utf8');

      expect(contents).not.toContain('ghp_');
      expect(contents).not.toContain('secret-header');
      expect(contents).toContain('[REDACTED]');
    } finally {
      await rm(logsDirectory, { recursive: true, force: true });
    }
  });

  it('rotates oversized application logs and keeps only the configured history', async () => {
    const logsDirectory = await mkdtemp(join(tmpdir(), 'gameplay-simulator-rotating-logs-'));
    const logger = new ApplicationLogger(
      logsDirectory,
      () => '2026-07-29T10:00:00.000Z',
      { maxFileSizeBytes: 1_024, retainedFiles: 2 }
    );

    try {
      for (let index = 0; index < 30; index += 1) {
        logger.logFailure('rotation_test', new Error(`Failure ${index} ${'x'.repeat(180)}`));
      }
      await logger.flush();
      const files = (await readdir(logsDirectory)).filter((name) => name.startsWith('application.log'));

      expect(files).toContain('application.log');
      expect(files).toContain('application.log.1');
      expect(files).not.toContain('application.log.3');
      expect(files.length).toBeLessThanOrEqual(3);
    } finally {
      await rm(logsDirectory, { recursive: true, force: true });
    }
  });
});
