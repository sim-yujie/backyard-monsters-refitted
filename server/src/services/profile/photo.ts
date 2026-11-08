import jpeg from "jpeg-js";

/**
 * Profile photos (owner, 6 Nov 2026, beta 7 grill Q28): "cropped square,
 * stored once at 128x128 (~10-15 KB), original discarded".
 *
 * The web client crops the player's picture to a square and sends it as a
 * JPEG data URL. The server never keeps what was sent: it checks the bytes
 * really are a JPEG of a sane size, decodes them to pixels, crops to the
 * middle square and scales that to {@link PHOTO_SIZE}, then encodes a fresh
 * JPEG. Nothing of the upload but its pixels survives, so every EXIF block
 * (camera, GPS position, thumbnail), comment and trailing byte is gone.
 *
 * jpeg-js is pure JavaScript (no native code to build on the server), and
 * decodes with a resolution and memory cap, so a small file that claims to be
 * a huge picture is refused instead of filling memory.
 */

/** The stored photo's width and height, in pixels. */
export const PHOTO_SIZE = 128;

/** JPEG quality of the stored copy: about 5-10 KB for a 128x128 photo, 15 KB at worst (pure noise). */
export const PHOTO_QUALITY = 80;

/** The largest upload taken, decoded (the web client sends about 20 KB). */
export const MAX_UPLOAD_BYTES = 300 * 1024;

/** The largest picture decoded, in megapixels (2048 x 2048). */
const MAX_MEGAPIXELS = 4.2;

/** Decoding never uses more than this. */
const MAX_DECODE_MB = 64;

/** A picture smaller than this on its short side is refused. */
export const MIN_UPLOAD_SIDE = 32;

export type PhotoRefusal = "notImage" | "tooBig" | "tooSmall";

export type PhotoResult = { ok: true; bytes: Buffer } | { ok: false; reason: PhotoRefusal };

const DATA_URL = /^data:image\/jpe?g;base64,/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** True when the bytes start like a JPEG (SOI then a marker). */
export const looksLikeJpeg = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/**
 * The upload's bytes, from a `data:image/jpeg;base64,...` URL or bare base64.
 *
 * @returns The bytes, or the refusal: not text / not base64 is `notImage`,
 *   longer than {@link MAX_UPLOAD_BYTES} is `tooBig` (checked before decoding).
 */
export const uploadBytes = (value: unknown): { ok: true; bytes: Buffer } | { ok: false; reason: PhotoRefusal } => {
  if (typeof value !== "string" || value.length === 0) return { ok: false, reason: "notImage" };
  const base64 = value.replace(DATA_URL, "");
  if (base64.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4) return { ok: false, reason: "tooBig" };
  if (!BASE64.test(base64)) return { ok: false, reason: "notImage" };
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, reason: "tooBig" };
  return { ok: true, bytes };
};

/**
 * The middle square of an RGBA picture scaled to `size` x `size`. Each output
 * pixel is the average of the source pixels under it (a box filter), which
 * keeps a big photo from turning to noise; when the source is smaller than
 * `size` the nearest pixel is taken.
 */
export const squareResize = (rgba: Uint8Array, width: number, height: number, size: number): Uint8Array => {
  const side = Math.min(width, height);
  const left = Math.floor((width - side) / 2);
  const top = Math.floor((height - side) / 2);
  const scale = side / size;
  const out = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const y0 = top + Math.floor(y * scale);
    const y1 = Math.max(y0 + 1, top + Math.floor((y + 1) * scale));
    for (let x = 0; x < size; x++) {
      const x0 = left + Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, left + Math.floor((x + 1) * scale));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1 && sy < height; sy++) {
        let i = (sy * width + x0) * 4;
        for (let sx = x0; sx < x1 && sx < width; sx++, i += 4) {
          r += rgba[i]!;
          g += rgba[i + 1]!;
          b += rgba[i + 2]!;
          n++;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return out;
};

/**
 * Turns an upload into the stored photo: a fresh 128x128 JPEG made from the
 * upload's pixels alone.
 *
 * @param value - The body's `photo` field: a JPEG data URL or bare base64.
 */
export const processPhoto = (value: unknown): PhotoResult => {
  const upload = uploadBytes(value);
  if (!upload.ok) return upload;
  if (!looksLikeJpeg(upload.bytes)) return { ok: false, reason: "notImage" };

  let decoded: { width: number; height: number; data: Uint8Array };
  try {
    decoded = jpeg.decode(upload.bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: MAX_MEGAPIXELS,
      maxMemoryUsageInMB: MAX_DECODE_MB,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, reason: /maxResolutionInMP|maxMemoryUsageInMB/.test(message) ? "tooBig" : "notImage" };
  }
  const { width, height, data } = decoded;
  if (!width || !height || data.length < width * height * 4) return { ok: false, reason: "notImage" };
  if (Math.min(width, height) < MIN_UPLOAD_SIDE) return { ok: false, reason: "tooSmall" };

  const pixels = squareResize(data, width, height, PHOTO_SIZE);
  const encoded = jpeg.encode({ data: pixels, width: PHOTO_SIZE, height: PHOTO_SIZE }, PHOTO_QUALITY);
  return { ok: true, bytes: Buffer.from(encoded.data) };
};
