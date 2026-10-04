import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { decodePng, encodePng } from "./png.js";

/** The small PNG reader and writer behind the in-game check's picture (#273). */

describe("png", () => {
  test("what it writes, it reads back", () => {
    const width = 37;
    const height = 23;
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      data[i * 4] = (i * 7) & 0xff;
      data[i * 4 + 1] = (i * 13 + 50) & 0xff;
      data[i * 4 + 2] = (i % width) * 6;
      data[i * 4 + 3] = 255;
    }
    const back = decodePng(encodePng({ width, height, data }));
    expect([back.width, back.height]).toEqual([width, height]);
    expect(Buffer.from(back.data).equals(Buffer.from(data))).toBe(true);
  });

  test("reads the game's monster art", () => {
    const image = decodePng(readFileSync(new URL("../../public/assets/monsters/C1-150.png", import.meta.url)));
    expect([image.width, image.height]).toEqual([108, 109]);
    // Transparent corner, a solid middle.
    expect(image.data[3]).toBe(0);
    expect(image.data[((54 * 108 + 54) * 4) + 3]).toBe(255);
  });

  test("reads a palette image with transparency", () => {
    const chunk = (type: string, body: Uint8Array) => {
      const out = Buffer.alloc(12 + body.length);
      out.writeUInt32BE(body.length, 0);
      out.write(type, 4, "latin1");
      out.set(body, 8);
      return out;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 3;
    const file = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("PLTE", Uint8Array.from([10, 20, 30, 200, 100, 0])),
      chunk("tRNS", Uint8Array.from([0])),
      chunk("IDAT", deflateSync(Uint8Array.from([0, 0, 1]))),
      chunk("IEND", new Uint8Array(0)),
    ]);
    expect([...decodePng(file).data]).toEqual([10, 20, 30, 0, 200, 100, 0, 255]);
  });

  test("refuses what is not a PNG", () => {
    expect(() => decodePng(Buffer.from("GIF89a and more bytes"))).toThrow("not a PNG");
  });
});
