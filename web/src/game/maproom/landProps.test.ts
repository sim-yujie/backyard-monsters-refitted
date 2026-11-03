import { describe, expect, it } from "vitest";
import { LandFeature } from "@/game/combat/rules";
import {
  inClearMiddle,
  landProps,
  PROP_FRAMES,
  PROP_SHEET_COLUMNS,
  PROP_SHEET_ROWS,
  TREE_FRAMES,
} from "./landProps";

/** Inside the 150 x 75 hex top, with its points at (+-75, 0) and flat edges at y = +-37.5. */
const insideHex = (x: number, y: number): boolean =>
  Math.abs(y) <= 37.5 && Math.abs(x) <= 75 - Math.abs(y);

const cellsToTry = Array.from(
  { length: 400 },
  (_, n) => [(n * 37) % 500, (n * 91) % 500] as const,
);

describe("landProps", () => {
  it("draws nothing on open ground, a missing feature or rubbish", () => {
    expect(landProps(LandFeature.OPEN, 3, 4)).toEqual([]);
    expect(landProps(undefined, 3, 4)).toEqual([]);
    expect(landProps("forest", 3, 4)).toEqual([]);
  });

  it("is the same for the same cell, and differs between cells", () => {
    expect(landProps(LandFeature.FOREST, 12, 40)).toEqual(
      landProps(LandFeature.FOREST, 12, 40),
    );
    expect(landProps(LandFeature.FOREST, 12, 40)).not.toEqual(
      landProps(LandFeature.FOREST, 13, 40),
    );
  });

  it("fills a forest with trees and spreads the other features across the hex", () => {
    const frames = (feature: number): number[] =>
      landProps(feature, 7, 9).map((prop) => prop.frame);
    expect(frames(LandFeature.FOREST).length).toBeGreaterThanOrEqual(20);
    expect(frames(LandFeature.FOREST).every((f) => TREE_FRAMES.includes(f))).toBe(true);
    const rocks = frames(LandFeature.ROCKS);
    expect(rocks.length).toBeGreaterThanOrEqual(4);
    expect(rocks.every((f) => PROP_FRAMES.rocks.includes(f as never))).toBe(true);
    const marsh = frames(LandFeature.MARSH);
    expect(
      marsh.filter((f) => PROP_FRAMES.puddles.includes(f as never)).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      marsh.filter((f) => PROP_FRAMES.reeds.includes(f as never)).length,
    ).toBeGreaterThanOrEqual(4);
    expect(frames(LandFeature.TWIG_NODE).sort()).toEqual(
      [PROP_FRAMES.nodes[0], PROP_FRAMES.nodeSmall[0]].sort(),
    );
    expect(frames(LandFeature.GOO_NODE).sort()).toEqual(
      [PROP_FRAMES.nodes[3], PROP_FRAMES.nodeSmall[3]].sort(),
    );
  });

  it("keeps every prop on its hex, the middle clear for the camp or yard", () => {
    for (const [col, row] of cellsToTry) {
      for (let feature = LandFeature.FOREST; feature <= LandFeature.GOO_NODE; feature++) {
        for (const prop of landProps(feature, col, row)) {
          expect(insideHex(prop.x, prop.y)).toBe(true);
          expect(inClearMiddle(prop.x, prop.y)).toBe(false);
          expect(prop.frame).toBeLessThan(PROP_SHEET_COLUMNS * PROP_SHEET_ROWS);
        }
      }
    }
  });

  it("lists props back to front, so nearer ones are drawn over farther ones", () => {
    for (const [col, row] of cellsToTry.slice(0, 50)) {
      const ys = landProps(LandFeature.FOREST, col, row).map((prop) => prop.y);
      expect(ys).toEqual([...ys].sort((a, b) => a - b));
    }
  });
});
