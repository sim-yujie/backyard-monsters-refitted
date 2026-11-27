import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { propSpots } from "./thanksgivingSkin";
import { CLASSIC_SNOW, winterDressUp } from "./winterSkin";

const ASSETS = new URL("../../../../server/public/assets/", import.meta.url);
const onDisk = (url: string): boolean => existsSync(new URL(url.replace(/^.*\/assets\//, ""), ASSETS));

/** A 40 x 40 plot's corners, as the yard has them (clockwise from the top). */
const CORNERS = [
  { x: 1600, y: 0 },
  { x: 3200, y: 800 },
  { x: 1600, y: 1600 },
  { x: 0, y: 800 },
];

describe("the Christmas dress-up (owner, 27 Nov 2026)", () => {
  it("lays a few props round the plot, sparser than Thanksgiving's first hay bales", () => {
    const set = winterDressUp();
    const spots = propSpots(set, CORNERS, 7);
    expect(spots.length).toBeGreaterThan(8);
    expect(spots.length).toBeLessThan(45);
    expect(new Set(spots.map((spot) => spot.prop))).toEqual(new Set(["snowman", "presents", "tree"]));
  });

  it("uses the winter decorations' own pictures, in each look, all on disk", () => {
    const set = winterDressUp();
    for (const classic of [true, false]) {
      for (const pieces of Object.values(set.pieces(classic))) {
        for (const piece of pieces) {
          expect(piece.url).toContain("/decorations/winter/");
          expect(piece.url.includes(".modern")).toBe(!classic);
          expect(onDisk(piece.url), piece.url).toBe(true);
        }
      }
    }
  });

  it("gives the Classic look its own snow tiles, on disk, the range ring drawn dark", () => {
    for (const file of CLASSIC_SNOW.files) expect(onDisk(CLASSIC_SNOW.root + file), file).toBe(true);
    expect(CLASSIC_SNOW.painted).toBe(false);
    expect(CLASSIC_SNOW.rangeInk).toBeDefined();
  });
});
