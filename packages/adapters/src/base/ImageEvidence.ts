export type SupportedEvidenceImageMimeType = 'image/png' | 'image/jpeg';

export interface ValidatedEvidenceImage {
  data: Buffer;
  mimeType: SupportedEvidenceImageMimeType;
  extension: '.png' | '.jpg';
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const MAX_IMAGE_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 40_000_000;

export class EvidenceImageValidationError extends Error {
  constructor(message: string) {
    super(`Evidence image rejected: ${message}`);
    this.name = 'EvidenceImageValidationError';
  }
}

function validateDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new EvidenceImageValidationError('image dimensions are invalid.');
  }

  if (
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new EvidenceImageValidationError(
      `decoded dimensions ${width}x${height} exceed the supported image limit.`
    );
  }
}

function pngDimensions(data: Buffer): { width: number; height: number } | undefined {
  if (
    data.byteLength < 33 ||
    !data.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE) ||
    data.toString('ascii', 12, 16) !== 'IHDR' ||
    !data.subarray(data.byteLength - PNG_IEND.byteLength).equals(PNG_IEND)
  ) {
    return undefined;
  }

  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20)
  };
}

function jpegDimensions(data: Buffer): { width: number; height: number } | undefined {
  if (
    data.byteLength < 4 ||
    data[0] !== 0xff ||
    data[1] !== 0xd8 ||
    data[2] !== 0xff ||
    data[data.byteLength - 2] !== 0xff ||
    data[data.byteLength - 1] !== 0xd9
  ) {
    return undefined;
  }

  let offset = 2;
  while (offset + 3 < data.byteLength) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (data[offset] === 0xff) {
      offset += 1;
    }
    const marker = data[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      continue;
    }
    if (offset + 1 >= data.byteLength) {
      return undefined;
    }

    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.byteLength) {
      return undefined;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (segmentLength < 7) {
        return undefined;
      }
      return {
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5)
      };
    }

    offset += segmentLength;
  }

  return undefined;
}

export function validateEvidenceImage(input: {
  data: Uint8Array;
  claimedMimeType: string | undefined;
  maximumBytes: number;
}): ValidatedEvidenceImage {
  const data = Buffer.from(input.data);

  if (data.byteLength === 0) {
    throw new EvidenceImageValidationError('image data is empty.');
  }
  if (data.byteLength > input.maximumBytes) {
    throw new EvidenceImageValidationError(
      `decoded image is ${data.byteLength} bytes, exceeding the ${input.maximumBytes}-byte limit.`
    );
  }
  if (input.claimedMimeType !== 'image/png' && input.claimedMimeType !== 'image/jpeg') {
    throw new EvidenceImageValidationError('MIME type must be image/png or image/jpeg.');
  }

  const png = pngDimensions(data);
  if (png) {
    if (input.claimedMimeType !== 'image/png') {
      throw new EvidenceImageValidationError('claimed MIME type does not match PNG image bytes.');
    }
    validateDimensions(png.width, png.height);
    return {
      data,
      mimeType: 'image/png',
      extension: '.png',
      width: png.width,
      height: png.height
    };
  }

  const jpeg = jpegDimensions(data);
  if (jpeg) {
    if (input.claimedMimeType !== 'image/jpeg') {
      throw new EvidenceImageValidationError('claimed MIME type does not match JPEG image bytes.');
    }
    validateDimensions(jpeg.width, jpeg.height);
    return {
      data,
      mimeType: 'image/jpeg',
      extension: '.jpg',
      width: jpeg.width,
      height: jpeg.height
    };
  }

  throw new EvidenceImageValidationError('file signature is not a supported PNG or JPEG image.');
}

export function decodeAndValidateBase64EvidenceImage(input: {
  encoded: string;
  claimedMimeType: string | undefined;
  maximumBytes: number;
}): ValidatedEvidenceImage {
  if (
    input.encoded.length === 0 ||
    input.encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.encoded)
  ) {
    throw new EvidenceImageValidationError('image data is not valid canonical base64.');
  }

  const paddingBytes = input.encoded.endsWith('==') ? 2 : input.encoded.endsWith('=') ? 1 : 0;
  const decodedBytes = (input.encoded.length / 4) * 3 - paddingBytes;
  if (decodedBytes > input.maximumBytes) {
    throw new EvidenceImageValidationError(
      `decoded image would exceed the ${input.maximumBytes}-byte limit.`
    );
  }

  const data = Buffer.from(input.encoded, 'base64');
  if (data.byteLength !== decodedBytes || data.toString('base64') !== input.encoded) {
    throw new EvidenceImageValidationError('image data is malformed base64.');
  }

  return validateEvidenceImage({
    data,
    claimedMimeType: input.claimedMimeType,
    maximumBytes: input.maximumBytes
  });
}
