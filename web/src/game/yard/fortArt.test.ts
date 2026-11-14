import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { fortArtFor } from "./fortArt";

const ASSETS = resolve(__dirname, "../../../../server/public");

const TYPES = [6, 14, 20, 21, 23, 25, 112, 115, 118];

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

describe("fortArtFor, Modern look (Thorn and Bone)", () => {
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

  it("every picture it names is on disk, with whole drawn pixels", () => {
    for (const type of TYPES) {
      for (let fort = 1; fort <= 4; fort++) {
        const art = fortArtFor(type, fort)!;
        for (const image of [art.front, art.back]) {
          const [width, height] = webpSize(resolve(ASSETS, image.url.slice(1)));
          expect((width % 2) + (height % 2), image.url).toBe(0);
          expect(Number.isInteger(image.x) && Number.isInteger(image.y), image.url).toBe(true);
        }
      }
    }
  });

  it("keeps one ring at every tier: the back's and the front's ends meet on the same corners", () => {
    // The ring's corners are where the back half's bottom edge and the front half's top edge are: the back
    // half ends at its bottom, the front half begins at its top (give or take the end discs and the shadow).
    for (const [type, centre, half] of [[20, 35, 69], [6, 41, 69], [14, 65, 124]] as const) {
      for (let fort = 1; fort <= 4; fort++) {
        const { front, back } = fortArtFor(type, fort)!;
        const [frontWidth] = webpSize(resolve(ASSETS, front.url.slice(1)));
        const [backWidth, backHeight] = webpSize(resolve(ASSETS, back.url.slice(1)));
        // Both halves span the diamond's two corners, a disc and a little shadow beyond.
        for (const [x, width] of [[front.x, frontWidth / 2], [back.x, backWidth / 2]] as const) {
          expect(x, `${type} tier ${fort}`).toBeLessThanOrEqual(-half - 4);
          expect(x, `${type} tier ${fort}`).toBeGreaterThanOrEqual(-half - 20);
          expect(x + width, `${type} tier ${fort}`).toBeGreaterThanOrEqual(half + 4);
          expect(x + width, `${type} tier ${fort}`).toBeLessThanOrEqual(half + 30);
        }
        // The back half reaches down to the corners, the front half up to them, and they overlap only there.
        expect(back.y + backHeight / 2, `${type} tier ${fort}`).toBeGreaterThan(centre);
        expect(back.y + backHeight / 2, `${type} tier ${fort}`).toBeLessThan(centre + 40);
        expect(front.y, `${type} tier ${fort}`).toBeLessThan(centre);
      }
    }
  });

  it("puts the Silo's ring 6 px below a tower's and leaves x alone", () => {
    const tower = fortArtFor(20, 1)!;
    const silo = fortArtFor(6, 1)!;
    expect(silo.front.y - tower.front.y).toBe(6);
    expect(silo.back.y - tower.back.y).toBe(6);
    expect(silo.front.x).toBe(tower.front.x);
  });
});
