import { describe, expect, it } from "vitest";
import { YARD_FALLBACK_LEVEL, YARD_MAX_LEVEL, yardArtLevel } from "./buildingAvatars";
import { appearanceOf } from "./cellVisuals";
import type { MapCell, PlayerCell } from "@/api/types";

const player = (overrides: Partial<PlayerCell> = {}): MapCell =>
  ({ uid: 7, b: 2, i: 150, bid: "2", aid: null, n: "Bramblefoot", l: 24, v: 0, f: 1, c: 1, dm: 0, d: 0, lo: 0, p: 0, mine: 0, ...overrides }) as unknown as MapCell;

describe("yardArtLevel (the hall picture a main yard wears)", () => {
  it("uses the owner's own level, 1 to 10", () => {
    for (let level = 1; level <= YARD_MAX_LEVEL; level++) expect(yardArtLevel(level)).toBe(level);
  });

  it("falls back to the level-3 picture when the level is unknown", () => {
    expect(yardArtLevel(undefined)).toBe(YARD_FALLBACK_LEVEL);
    expect(yardArtLevel(0)).toBe(3);
    expect(yardArtLevel(-2)).toBe(3);
    expect(yardArtLevel(Number.NaN)).toBe(3);
  });

  it("caps a level above the art at the tallest hall", () => {
    expect(yardArtLevel(11)).toBe(YARD_MAX_LEVEL);
  });
});

describe("appearanceOf hallLevel", () => {
  it("carries a main yard cell's th", () => {
    expect(appearanceOf(player({ b: 2, th: 8 }), 0).hallLevel).toBe(8);
  });

  it("is 0 when th is absent, and on an outpost whatever it holds", () => {
    expect(appearanceOf(player({ b: 2 }), 0).hallLevel).toBe(0);
    expect(appearanceOf(player({ b: 3, th: 8 }), 0).hallLevel).toBe(0);
  });
});
