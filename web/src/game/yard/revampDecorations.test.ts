import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPicture } from "./buildButtonArt";
import { ArtState, buildingName, resolveArt } from "./buildingArt";
import { kindOf, rowOf } from "./buildingCosts";
import { DECORATIONS_FOR_SALE } from "./decorShop";
import { isDecoration } from "./planner/placement";
import { isRevampDecoration, REVAMP_DECORATION_ROWS } from "./revampDecorations";
import { footprintOf } from "./YardGrid";

const ASSETS = new URL("../../../../server/public/assets/", import.meta.url);

/** A PNG's width and height, from its IHDR chunk. */
const pngSize = (url: URL): [number, number] => {
  const bytes = readFileSync(url);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

describe("this project's own decorations (owner, 10 Nov 2026: the six autumn ones)", () => {
  const types = REVAMP_DECORATION_ROWS.map((row) => row[0]);

  it("are types 201 to 206 with their shop names", () => {
    expect(types).toEqual([201, 202, 203, 204, 205, 206]);
    expect(types.map((type) => buildingName(type))).toEqual([
      "Leaf Pile and Rake",
      "Apple Barrel",
      "Pie on a Tree Stump",
      "Harvest Barrow",
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

  it("stand on their art and shadow, which are on disk, the picture at exactly 2x", () => {
    for (const [type] of REVAMP_DECORATION_ROWS) {
      const art = resolveArt(type, 1, ArtState.DEFAULT);
      expect(art, `${type}`).not.toBeNull();
      expect(art!.top.url).toMatch(/^\/assets\/buildings\/decorations\/autumn\/[\w-]+@2x\.png$/);
      expect(art!.shadow?.url).toMatch(/-shadow\.jpg$/);
      const top = new URL(art!.top.url.slice("/assets/".length), ASSETS);
      expect(existsSync(top), art!.top.url).toBe(true);
      expect(existsSync(new URL(art!.shadow!.url.slice("/assets/".length), ASSETS))).toBe(true);
      const [width, height] = pngSize(top);
      expect(width % 2 + (height % 2), `${type} even`).toBe(0);
      // Centred on the origin, its bottom 3/4 of the footprint down, like Flash's.
      const size = footprintOf(type)[0];
      expect(Math.abs(art!.top.x + width / 4)).toBeLessThanOrEqual(1);
      expect(art!.top.y + height / 2).toBe(size === 30 ? 22 : 30);
    }
  });

  it("have a Flash-style button in both looks", () => {
    for (const [type] of REVAMP_DECORATION_ROWS) {
      for (const classic of [true, false]) {
        const picture = buildPicture(type, "main", classic);
        expect(picture.url).toBe(`/assets/buildingbuttons/${type}.jpg`);
        expect(existsSync(new URL(picture.url.slice("/assets/".length), ASSETS))).toBe(true);
      }
    }
  });
});
