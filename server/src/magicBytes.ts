/**
 * File-type detection from the first bytes of a buffer.
 *
 * The client can lie about Content-Type in a multipart upload. The only
 * trustworthy signal is the file's own header. These signatures are the
 * canonical first bytes for each format — same ones `file(1)` uses.
 */

type Sig = {
  mime: string;
  test: (b: Buffer) => boolean;
};

const IMAGE_SIGNATURES: Sig[] = [
  {
    mime: 'image/jpeg',
    test: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/gif',
    test: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 &&
      b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) &&
      b[5] === 0x61,
  },
  {
    mime: 'image/webp',
    // RIFF????WEBP
    test: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    mime: 'image/heic',
    // ISO BMFF: bytes 4-7 == 'ftyp', brand at 8-11 is heic / heix / mif1 / msf1
    test: (b) => {
      if (b.length < 12) return false;
      if (b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) return false;
      const brand = b.slice(8, 12).toString('ascii');
      return brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1';
    },
  },
];

const DOC_SIGNATURES: Sig[] = [
  {
    mime: 'application/pdf',
    test: (b) =>
      b.length >= 5 &&
      b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 &&
      b[4] === 0x2d,
  },
  {
    mime: 'application/zip',
    test: (b) =>
      b.length >= 4 &&
      b[0] === 0x50 && b[1] === 0x4b &&
      ((b[2] === 0x03 && b[3] === 0x04) ||
        (b[2] === 0x05 && b[3] === 0x06) ||
        (b[2] === 0x07 && b[3] === 0x08)),
  },
  {
    mime: 'audio/mpeg',
    test: (b) =>
      b.length >= 3 &&
      ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
        (b[0] === 0xff && (b[1] ?? 0) >= 0xe0)),
  },
  {
    mime: 'video/mp4',
    test: (b) => {
      if (b.length < 12) return false;
      if (b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) return false;
      const brand = b.slice(8, 12).toString('ascii');
      return brand.startsWith('isom') || brand.startsWith('mp4') || brand.startsWith('M4V');
    },
  },
];

/** Returns the MIME type if `buf` looks like a known image, else null. */
export function detectImageMime(buf: Buffer): string | null {
  for (const sig of IMAGE_SIGNATURES) if (sig.test(buf)) return sig.mime;
  return null;
}

/** Returns the MIME type if `buf` looks like a known document/audio/video. */
export function detectDocMime(buf: Buffer): string | null {
  for (const sig of DOC_SIGNATURES) if (sig.test(buf)) return sig.mime;
  return null;
}

/** True if the buffer begins with a recognizable image signature. */
export function isImage(buf: Buffer): boolean {
  return detectImageMime(buf) !== null;
}
