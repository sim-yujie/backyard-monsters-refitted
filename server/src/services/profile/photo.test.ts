import { describe, expect, test } from "bun:test";
import jpeg from "jpeg-js";

import { MAX_UPLOAD_BYTES, PHOTO_SIZE, processPhoto, squareResize, uploadBytes } from "./photo.js";

/** A photo-like picture: a gradient with some grain, so the JPEG is not trivially small. */
const picture = (width: number, height: number, seed = 1): Uint8Array => {
  const data = new Uint8Array(width * height * 4);
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 40 - 20;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.max(0, Math.min(255, (x / width) * 255 + rand()));
      data[i + 1] = Math.max(0, Math.min(255, (y / height) * 255 + rand()));
      data[i + 2] = Math.max(0, Math.min(255, 128 + rand()));
      data[i + 3] = 255;
    }
  }
  return data;
};

const jpegOf = (width: number, height: number, quality = 90): Buffer =>
  Buffer.from(jpeg.encode({ data: picture(width, height), width, height }, quality).data);

/** Puts an EXIF block (with a fake GPS tag) and a comment right after the JPEG's start marker. */
const withMetadata = (bytes: Buffer): Buffer => {
  const exifBody = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from("GPSLatitude 14.5995 secret-camera-serial", "latin1")]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exifBody.length + 2) >> 8, (exifBody.length + 2) & 0xff]), exifBody]);
  const comment = Buffer.from("my home address", "latin1");
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, (comment.length + 2) >> 8, (comment.length + 2) & 0xff]), comment]);
  return Buffer.concat([bytes.subarray(0, 2), app1, com, bytes.subarray(2)]);
};

const dataUrl = (bytes: Buffer): string => `data:image/jpeg;base64,${bytes.toString("base64")}`;

describe("profile photos", () => {
  test("a JPEG becomes a fresh 128x128 JPEG", () => {
    const result = processPhoto(dataUrl(jpegOf(400, 300)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = jpeg.decode(result.bytes, { useTArray: true });
    expect(stored.width).toBe(PHOTO_SIZE);
    expect(stored.height).toBe(PHOTO_SIZE);
  });

  test("a stored photo is about 10-15 KB or less", () => {
    const result = processPhoto(dataUrl(jpegOf(512, 512)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.length).toBeLessThan(16 * 1024);
    expect(result.bytes.length).toBeGreaterThan(1024);
  });

  test("EXIF, GPS and comments in the upload are not kept", () => {
    const upload = withMetadata(jpegOf(256, 256));
    expect(upload.includes(Buffer.from("secret-camera-serial"))).toBe(true);
    // The upload still decodes with its metadata.
    expect(() => jpeg.decode(upload)).not.toThrow();
    const result = processPhoto(dataUrl(upload));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.includes(Buffer.from("Exif"))).toBe(false);
    expect(result.bytes.includes(Buffer.from("secret-camera-serial"))).toBe(false);
    expect(result.bytes.includes(Buffer.from("my home address"))).toBe(false);
    expect(result.bytes.equals(upload)).toBe(false);
  });

  test("bare base64 is taken too", () => {
    expect(processPhoto(jpegOf(200, 200).toString("base64")).ok).toBe(true);
  });

  test("anything that is not a JPEG is refused", () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    expect(processPhoto(`data:image/png;base64,${png.toString("base64")}`)).toEqual({ ok: false, reason: "notImage" });
    expect(processPhoto(dataUrl(png))).toEqual({ ok: false, reason: "notImage" });
    expect(processPhoto(dataUrl(Buffer.from("<script>alert(1)</script>")))).toEqual({ ok: false, reason: "notImage" });
    expect(processPhoto("not base64 at all!")).toEqual({ ok: false, reason: "notImage" });
    expect(processPhoto(undefined)).toEqual({ ok: false, reason: "notImage" });
    expect(processPhoto(12)).toEqual({ ok: false, reason: "notImage" });
    expect(processPhoto("")).toEqual({ ok: false, reason: "notImage" });
  });

  test("a JPEG start with junk after it is refused", () => {
    const junk = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
    expect(processPhoto(dataUrl(junk))).toEqual({ ok: false, reason: "notImage" });
  });

  test("a cut-off JPEG is refused", () => {
    const whole = jpegOf(200, 200);
    expect(processPhoto(dataUrl(whole.subarray(0, Math.floor(whole.length / 3))))).toEqual({ ok: false, reason: "notImage" });
  });

  test("an upload over the limit is refused before decoding", () => {
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 10, 0xaa);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    expect(uploadBytes(dataUrl(big))).toEqual({ ok: false, reason: "tooBig" });
    expect(processPhoto(dataUrl(big))).toEqual({ ok: false, reason: "tooBig" });
  });

  test("a picture bigger than 2048x2048 is refused", () => {
    const width = 2200;
    const height = 2100;
    const flat = new Uint8Array(width * height * 4).fill(200);
    const bytes = Buffer.from(jpeg.encode({ data: flat, width, height }, 50).data);
    expect(bytes.length).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(processPhoto(dataUrl(bytes))).toEqual({ ok: false, reason: "tooBig" });
  });

  test("a tiny picture is refused", () => {
    expect(processPhoto(dataUrl(jpegOf(16, 16)))).toEqual({ ok: false, reason: "tooSmall" });
  });

  test("squareResize keeps the middle square", () => {
    // 4x2: left half red, right half blue; the middle square is one of each.
    const data = new Uint8Array(4 * 2 * 4);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        data.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
      }
    }
    const out = squareResize(data, 4, 2, 2);
    expect([...out.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...out.subarray(4, 8)]).toEqual([0, 0, 255, 255]);
  });

  test("squareResize averages when shrinking", () => {
    const data = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    const out = squareResize(data, 2, 2, 1);
    expect([...out]).toEqual([128, 128, 128, 255]);
  });
});
