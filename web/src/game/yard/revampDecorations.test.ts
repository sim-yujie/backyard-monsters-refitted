import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { buildPicture, buttonUrl } from "./buildButtonArt";
import { MODERN_BUTTON_FILE } from "./buildButtonModernData";
import { ArtState, buildingName, newLookFor, resolveArt } from "./buildingArt";
import { kindOf, rowOf } from "./buildingCosts";
import { DECORATIONS_FOR_SALE } from "./decorShop";
import { isDecoration } from "./planner/placement";
import { isRevampDecoration, REVAMP_DECORATION_MODERN_ART, REVAMP_DECORATION_ROWS } from "./revampDecorations";
import { footprintOf } from "./YardGrid";

const ASSETS = new URL("../../../../server/public/assets/", import.meta.url);

/** A PNG's width and height, from its IHDR chunk. */
const pngSize = (url: URL): [number, number] => {
  const bytes = readFileSync(url);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

/** A WebP with alpha's width and height, from its `VP8X` header. */
const webpSize = (url: URL): [number, number] => {
  const bytes = readFileSync(url);
  expect(bytes.toString("latin1", 12, 16), url.pathname).toBe("VP8X");
  return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
};

const onDisk = (url: string): URL => new URL(url.slice("/assets/".length), ASSETS);

describe("this project's own decorations (owner, 10 Nov 2026: the six autumn ones)", () => {
  const types = REVAMP_DECORATION_ROWS.map((row) => row[0]);

  it("are types 201 to 206 with their shop names", () => {
    expect(types).toEqual([201, 202, 203, 204, 205, 206]);
    expect(types.map((type) => buildingName(type))).toEqual([
      "Leaf Pile and Rake",
      "Apple Barrel",
      "Pie on a Tree Stump",
      "Harvest Wheelbarrow",
      "Turkey Topiary",
      "Autumn Maple Tree",
    ]);
  });

  it("are decorations everywhere a Flash one is: placement, cost table, footprint, shop", () => {
    const sold = new Set(DECORATIONS_FOR_SALE.map(([type]) => type));
    for (const [type, , , , , size] of REVAMP_DECORATION_ROWS) {
      expect(isRevampDecoration(type)).toBe(true);
      expect(isDecoration(type), `${type}`).toBe(true);
      expect(kindOf(type), `${type}`).toBe("decoration");
      expect(rowOf(type)?.[3], `${type} in the Decorations tab`).toBe(4);
      expect(footprintOf(type)).toEqual([size, size]);
      expect(sold.has(type), `${type} sold`).toBe(true);
    }
    expect(isRevampDecoration(69)).toBe(false);
  });

  describe("with the Classic look", () => {
    beforeAll(() => setClassicLook(true));
    afterAll(() => setClassicLook(false));

    it("stand on their Flash-style art and shadow, which are on disk, the picture at exactly 2x", () => {
      for (const [type] of REVAMP_DECORATION_ROWS) {
        expect(newLookFor(type, 1), `${type}`).toBeNull();
        const art = resolveArt(type, 1, ArtState.DEFAULT);
        expect(art, `${type}`).not.toBeNull();
        expect(art!.top.url).toMatch(/^\/assets\/buildings\/decorations\/autumn\/[\w-]+@2x\.png$/);
        expect(art!.shadow?.url).toMatch(/^\/assets\/buildings\/decorations\/autumn\/[\w-]+-shadow\.jpg$/);
        expect(existsSync(onDisk(art!.top.url)), art!.top.url).toBe(true);
        expect(existsSync(onDisk(art!.shadow!.url))).toBe(true);
        const [width, height] = pngSize(onDisk(art!.top.url));
        expect(width % 2 + (height % 2), `${type} even`).toBe(0);
        // Centred on the origin, its bottom 3/4 of the footprint down, like Flash's.
        const size = footprintOf(type)[0];
        expect(Math.abs(art!.top.x + width / 4)).toBeLessThanOrEqual(1);
        expect(art!.top.y + height / 2).toBe(size === 30 ? 22 : 30);
      }
    });
  });

  describe("with the Modern look (owner, 10 Nov 2026)", () => {
    beforeAll(() => setClassicLook(false));

    it("every one has a Modern look", () => {
      expect(Object.keys(REVAMP_DECORATION_MODERN_ART).map(Number)).toEqual(REVAMP_DECORATION_ROWS.map((row) => row[0]));
    });

    it("stand on their Modern art and shadow, on disk, at 2x, where the Classic picture stands", () => {
      for (const [type] of REVAMP_DECORATION_ROWS) {
        const art = resolveArt(type, 1, ArtState.DEFAULT);
        expect(art, `${type}`).not.toBeNull();
        expect(art!.top.url).toMatch(/^\/assets\/buildings\/decorations\/autumn\/[\w-]+\.modern@2x\.webp$/);
        expect(art!.shadow?.url).toMatch(/^\/assets\/buildings\/decorations\/autumn\/[\w-]+\.modern-shadow\.jpg$/);
        expect(existsSync(onDisk(art!.top.url)), art!.top.url).toBe(true);
        expect(existsSync(onDisk(art!.shadow!.url)), art!.shadow!.url).toBe(true);
        const [width, height] = webpSize(onDisk(art!.top.url));
        expect(width % 2 + (height % 2), `${type} even`).toBe(0);
        // The same bottom line as the Classic picture, centred on the origin: it stands on the same spot.
        const size = footprintOf(type)[0];
        expect(Math.abs(art!.top.x + width / 4), `${type} centred`).toBeLessThanOrEqual(1);
        expect(art!.top.y + height / 2, `${type} bottom`).toBe(size === 30 ? 22 : 30);
      }
    });

    it("keep the Modern look when damaged or destroyed (a decoration has no wreck)", () => {
      for (const [type] of REVAMP_DECORATION_ROWS) {
        const plain = resolveArt(type, 1, ArtState.DEFAULT)!;
        for (const state of [ArtState.DAMAGED, ArtState.DESTROYED]) {
          const art = resolveArt(type, 1, state)!;
          expect(art.top.url, `${type} ${state}`).toBe(plain.top.url);
          expect(art.shadow?.url, `${type} ${state}`).toBe(plain.shadow?.url);
        }
      }
    });
  });

  it("show Flash-style buttons with the Classic look and their Modern picture with the Modern look", () => {
    for (const [type] of REVAMP_DECORATION_ROWS) {
      const classic = buildPicture(type, "main", true);
      expect(classic).toEqual({ url: `/assets/buildingbuttons/${type}.jpg`, modern: false });
      expect(classic.url).toBe(buttonUrl(type));
      expect(existsSync(onDisk(classic.url))).toBe(true);
      const modern = buildPicture(type, "main", false);
      expect(modern.modern, `${type}: run web/tools/build-pictures/make.py`).toBe(true);
      expect(modern.url).toBe(`/assets/buildingbuttons/modern/${MODERN_BUTTON_FILE.main[type]}`);
      expect(existsSync(onDisk(modern.url)), modern.url).toBe(true);
    }
  });
});
