import { describe, expect, it } from "vitest";
import type { Rect } from "./YardGrid";
import { inBox, pickBySpriteBox, type SpriteBoxCandidate } from "./yardPlacement";
import type { YardBuilding } from "./yardModel";

/**
 * `pickBySpriteBox` only ever hands back one of the `building` references it
 * was given, so a candidate here needs nothing beyond an identity a test can
 * compare against — not a real `YardBuilding`.
 */
const buildingNamed = (name: string): YardBuilding => ({ name }) as unknown as YardBuilding;

const box = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

describe("inBox", () => {
  const rect = box(10, 20, 100, 50);

  it("is true inside the box", () => {
    expect(inBox(50, 40, rect)).toBe(true);
  });

  it("is true on every edge, inclusive", () => {
    expect(inBox(10, 20, rect)).toBe(true); // top-left
    expect(inBox(110, 70, rect)).toBe(true); // bottom-right
    expect(inBox(10, 70, rect)).toBe(true); // bottom-left
    expect(inBox(110, 20, rect)).toBe(true); // top-right
  });

  it("is false just outside each edge", () => {
    expect(inBox(9, 40, rect)).toBe(false);
    expect(inBox(111, 40, rect)).toBe(false);
    expect(inBox(50, 19, rect)).toBe(false);
    expect(inBox(50, 71, rect)).toBe(false);
  });
});

describe("pickBySpriteBox", () => {
  it("returns null with no candidates", () => {
    expect(pickBySpriteBox(50, 50, [])).toBeNull();
  });

  it("picks a building whose art rises above its footprint and contains the point", () => {
    const hatchery = buildingNamed("Hatchery");
    const candidates: SpriteBoxCandidate[] = [
      { building: hatchery, box: box(0, 0, 100, 200), footprintTop: 150 },
    ];
    // A click on the upper body: well inside the sprite box, well above the
    // footprint — exactly the case issue #41 reports as a miss.
    expect(pickBySpriteBox(50, 20, candidates)).toBe(hatchery);
  });

  it("excludes a candidate whose art does not rise above its footprint", () => {
    // The sprite box starts no higher than the footprint itself: nothing this
    // pass can add over the diamond test that already missed it.
    const wall = buildingNamed("Wall");
    const candidates: SpriteBoxCandidate[] = [
      { building: wall, box: box(0, 100, 50, 50), footprintTop: 100 },
    ];
    expect(pickBySpriteBox(25, 120, candidates)).toBeNull();
  });

  it("excludes a candidate whose sprite box does not contain the point", () => {
    const tower = buildingNamed("Sniper Tower");
    const candidates: SpriteBoxCandidate[] = [
      { building: tower, box: box(0, 0, 50, 50), footprintTop: 40 },
    ];
    expect(pickBySpriteBox(200, 200, candidates)).toBeNull();
  });

  it("prefers the footprint closest below the click when sprite boxes overlap", () => {
    // A tower (B) standing behind a tall building (A): both sprites cover the
    // click, but B's footprint sits directly under it while A's is far below.
    const tallBuilding = buildingNamed("Tall building");
    const towerBehind = buildingNamed("Tower behind");
    const candidates: SpriteBoxCandidate[] = [
      { building: tallBuilding, box: box(0, 0, 100, 200), footprintTop: 150 },
      { building: towerBehind, box: box(0, 0, 100, 200), footprintTop: 80 },
    ];
    expect(pickBySpriteBox(50, 50, candidates)).toBe(towerBehind);
  });

  it("keeps the earlier candidate on a tie", () => {
    const first = buildingNamed("First, topmost");
    const second = buildingNamed("Second, same distance");
    const candidates: SpriteBoxCandidate[] = [
      { building: first, box: box(0, 0, 100, 200), footprintTop: 80 },
      { building: second, box: box(0, 0, 100, 200), footprintTop: 80 },
    ];
    expect(pickBySpriteBox(50, 50, candidates)).toBe(first);
  });

  it("falls back to draw order when no footprint sits below the click", () => {
    // Both footprints are above the click (negative "below"); the first
    // (topmost) candidate wins rather than whichever is numerically closest.
    const topmost = buildingNamed("Topmost");
    const behindIt = buildingNamed("Behind it");
    const candidates: SpriteBoxCandidate[] = [
      { building: topmost, box: box(0, 0, 100, 200), footprintTop: 10 },
      { building: behindIt, box: box(0, 0, 100, 200), footprintTop: 5 },
    ];
    expect(pickBySpriteBox(50, 50, candidates)).toBe(topmost);
  });
});
