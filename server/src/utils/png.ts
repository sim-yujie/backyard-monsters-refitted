import { deflateSync, inflateSync } from "node:zlib";

/**
 * A small PNG reader and writer, enough for the in-game check's picture
 * (#273, `services/user/botPicture.ts`) without an image library: the server
 * has none, and the game's art is plain PNG.
 *
 * Reads 8-bit, non-interlaced truecolour (RGB, RGBA) and palette images,
 * every one of the five row filters; anything else throws. Writes 8-bit RGB
 * (no alpha: the picture is opaque), each row with the filter that leaves
 * the smallest differences (the usual heuristic), deflated by zlib.
 */

/** Pixels as RGBA, four bytes each, rows top to bottom. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Reads a PNG into RGBA. */
export const decodePng = (file: Uint8Array): RgbaImage => {
  const bytes = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error("png: not a PNG file");
  let width = 0;
  let height = 0;
  let colourType = -1;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 3 && colour !== 6)) {
        throw new Error(`png: depth ${depth}, colour type ${colour}, interlace ${interlace} is not read`);
      }
      colourType = colour;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  if (colourType < 0) throw new Error("png: no IHDR");
  if (colourType === 3 && palette === null) throw new Error("png: palette image with no PLTE");

  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 1;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const from = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[from + x]!;
      const left = x >= channels ? rows[row + x - channels]! : 0;
      const up = y > 0 ? rows[row - stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? rows[row - stride + x - channels]! : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + up;
          break;
        case 3:
          out = value + ((left + up) >> 1);
          break;
        case 4:
          out = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`png: row filter ${filter}`);
      }
      rows[row + x] = out & 0xff;
    }
  }

  if (channels === 4) return { width, height, data: rows };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    if (channels === 3) {
      data[i * 4] = rows[i * 3]!;
      data[i * 4 + 1] = rows[i * 3 + 1]!;
      data[i * 4 + 2] = rows[i * 3 + 2]!;
      data[i * 4 + 3] = 255;
    } else {
      const index = rows[i]!;
      data[i * 4] = palette![index * 3] ?? 0;
      data[i * 4 + 1] = palette![index * 3 + 1] ?? 0;
      data[i * 4 + 2] = palette![index * 3 + 2] ?? 0;
      data[i * 4 + 3] = transparency?.[index] ?? 255;
    }
  }
  return { width, height, data };
};

const chunk = (type: string, body: Uint8Array): Buffer => {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
};

/** Writes RGBA pixels as an opaque RGB PNG: the alpha is dropped. */
export const encodePng = (image: RgbaImage, level = 6): Buffer => {
  const { width, height, data } = image;
  const rowBytes = width * 3;
  const rgb = new Uint8Array(rowBytes * height);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = data[i * 4]!;
    rgb[i * 3 + 1] = data[i * 4 + 1]!;
    rgb[i * 3 + 2] = data[i * 4 + 2]!;
  }
  const raw = Buffer.alloc((rowBytes + 1) * height);
  const trial = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const row = y * rowBytes;
    let best = Number.POSITIVE_INFINITY;
    for (const filter of [0, 1, 2, 4]) {
      let cost = 0;
      for (let x = 0; x < rowBytes; x += 1) {
        const left = x >= 3 ? rgb[row + x - 3]! : 0;
        const up = y > 0 ? rgb[row - rowBytes + x]! : 0;
        const upLeft = y > 0 && x >= 3 ? rgb[row - rowBytes + x - 3]! : 0;
        const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : paeth(left, up, upLeft);
        const value = (rgb[row + x]! - predicted) & 0xff;
        trial[x] = value;
        cost += value < 128 ? value : 256 - value;
      }
      if (cost < best) {
        best = cost;
        raw[y * (rowBytes + 1)] = filter;
        raw.set(trial, y * (rowBytes + 1) + 1);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level })),
    chunk("IEND", new Uint8Array(0)),
  ]);
};
