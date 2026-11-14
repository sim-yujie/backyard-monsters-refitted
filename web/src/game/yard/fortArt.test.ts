import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { fortArtFor } from "./fortArt";

const ASSETS = resolve(__dirname, "../../../../server/public");

const TYPES = [6, 14, 20, 21, 23, 25, 112, 115, 118];

/** A PNG's width and height, from its `IHDR` header. */
const pngSize = (file: string): [number, number] => {
  const bytes = readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

/** A WebP with alpha's width and height, from its `VP8X` header. */
const webpSize = (file: string): [number, number] => {
  const bytes = readFileSync(file);
  expect(bytes.toString("latin1", 12, 16), file).toBe("VP8X");
  return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
};

describe("fortArtFor, Classic look (Flash's pictures)", () => {
  beforeAll(() => setClassicLook(true));
  afterAll(() => setClassicLook(false));

  it("draws nothing for an unfortified building or a type without overlay art", () => {
    expect(fortArtFor(20, 0)).toBeNull();
    expect(fortArtFor(17, 2)).toBeNull();
    expect(fortArtFor(15, 1)).toBeNull();
  });

  it("picks the size and tier: towers and silo fort70, hall and core fort130", () => {
    expect(fortArtFor(20, 2)?.front.url).toBe("/assets/buildings/fortifications/fort70_F2.png");
    expect(fortArtFor(25, 4)?.back.url).toBe("/assets/buildings/fortifications/fort70_B4.png");
    expect(fortArtFor(6, 1)?.front.url).toBe("/assets/buildings/fortifications/fort70_F1.png");
    expect(fortArtFor(14, 3)?.back.url).toBe("/assets/buildings/fortifications/fort130_B3.png");
    expect(fortArtFor(112, 1)?.front.url).toBe("/assets/buildings/fortifications/fort130_F1.png");
  });

  it("uses the props table's offsets, which differ for the silo and the hall", () => {
    expect(fortArtFor(20, 1)).toMatchObject({ front: { x: -73, y: 21 }, back: { x: -70, y: -10 } });
    expect(fortArtFor(6, 1)).toMatchObject({ front: { x: -73, y: 28 }, back: { x: -71, y: -4 } });
    expect(fortArtFor(14, 4)).toMatchObject({ front: { x: -124, y: 15 }, back: { x: -116, y: -49 } });
  });

  it("clamps a tier above 4 to 4", () => {
    expect(fortArtFor(21, 9)?.front.url).toContain("fort70_F4");
  });

  it("every picture it names is on disk", () => {
    for (const type of TYPES) {
      for (let fort = 1; fort <= 4; fort++) {
        const art = fortArtFor(type, fort)!;
        expect(existsSync(resolve(ASSETS, art.front.url.slice(1)))).toBe(true);
        expect(existsSync(resolve(ASSETS, art.back.url.slice(1)))).toBe(true);
      }
    }
  });
});

describe("fortArtFor, Modern look (Flash's art redrawn sharp)", () => {
  beforeAll(() => setClassicLook(false));

  it("draws nothing for an unfortified building or a type without overlay art", () => {
    expect(fortArtFor(20, 0)).toBeNull();
    expect(fortArtFor(17, 2)).toBeNull();
  });

  it("picks the Modern picture of the size and tier, twice the size it is drawn", () => {
    expect(fortArtFor(20, 2)?.front.url).toBe("/assets/buildings/fortifications/fort70_F2.modern@2x.webp");
    expect(fortArtFor(6, 4)?.back.url).toBe("/assets/buildings/fortifications/fort70_B4.modern@2x.webp");
    expect(fortArtFor(14, 3)?.back.url).toBe("/assets/buildings/fortifications/fort130_B3.modern@2x.webp");
    expect(fortArtFor(112, 1)?.front.url).toBe("/assets/buildings/fortifications/fort130_F1.modern@2x.webp");
    expect(fortArtFor(21, 9)?.front.url).toContain("fort70_F4.modern");
  });

  it("stands exactly where Flash's does: the same offsets and exactly twice Flash's picture", () => {
    for (const type of TYPES) {
      for (let fort = 1; fort <= 4; fort++) {
        setClassicLook(true);
        const classic = fortArtFor(type, fort)!;
        setClassicLook(false);
        const modern = fortArtFor(type, fort)!;
        for (const [flash, sharp] of [[classic.front, modern.front], [classic.back, modern.back]] as const) {
          expect([sharp.x, sharp.y], sharp.url).toEqual([flash.x, flash.y]);
          const [width, height] = pngSize(resolve(ASSETS, flash.url.slice(1)));
          expect(webpSize(resolve(ASSETS, sharp.url.slice(1))), sharp.url).toEqual([width * 2, height * 2]);
        }
      }
    }
  });
});
