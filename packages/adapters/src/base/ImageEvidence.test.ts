import { describe, expect, it } from 'vitest';
import {
  decodeAndValidateBase64EvidenceImage,
  validateEvidenceImage
} from './ImageEvidence';

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

describe('instrumented evidence image validation', () => {
  it('rejects dimensions that could expand into excessive decoded pixels', () => {
    const oversizedDimensions = Buffer.from(VALID_PNG);
    oversizedDimensions.writeUInt32BE(8_193, 16);

    expect(() => validateEvidenceImage({
      data: oversizedDimensions,
      claimedMimeType: 'image/png',
      maximumBytes: 1024
    })).toThrow(/dimensions.*exceed/i);
  });

  it('rejects oversized base64 before allocating decoded image bytes', () => {
    expect(() => decodeAndValidateBase64EvidenceImage({
      encoded: VALID_PNG.toString('base64'),
      claimedMimeType: 'image/png',
      maximumBytes: 16
    })).toThrow(/decoded image would exceed/i);
  });
});
