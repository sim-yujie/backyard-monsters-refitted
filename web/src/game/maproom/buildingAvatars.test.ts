import { afterEach, describe, expect, it } from "vitest";
import { Rectangle } from "pixi.js";
import { setClassicLook } from "@/game/classicLook";
import { BuildingKind, YARD_FALLBACK_LEVEL, YARD_MAX_LEVEL, buildingArtUrl, yardArtLevel } from "./buildingAvatars";
import { framePoints } from "./tribeAvatars";
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

describe("buildingArtUrl (which picture a player's hex wears)", () => {
  afterEach(() => setClassicLook(false));

  it("gives a main yard the repainted hall for its level in Modern", () => {
    setClassicLook(false);
    for (let level = 1; level <= YARD_MAX_LEVEL; level++) {
      expect(buildingArtUrl(BuildingKind.YARD, level)).toBe(`/assets/buildings/townhall/top.new${level}@2x.webp`);
    }
  });

  it("gives a main yard Flash's hall for its level in Classic", () => {
    setClassicLook(true);
    for (let level = 1; level <= YARD_MAX_LEVEL; level++) {
      expect(buildingArtUrl(BuildingKind.YARD, level)).toMatch(/^\/assets\/buildings\/townhall\/top\.\d+\.png$/);
    }
    expect(buildingArtUrl(BuildingKind.YARD, 10)).toBe("/assets/buildings/townhall/top.10.png");
  });

  it("falls back to the level-3 hall when the level is unknown, in either look", () => {
    expect(buildingArtUrl(BuildingKind.YARD, 0)).toBe("/assets/buildings/townhall/top.new3@2x.webp");
    setClassicLook(true);
    expect(buildingArtUrl(BuildingKind.YARD, undefined)).toBe(buildingArtUrl(BuildingKind.YARD, 3));
  });

  it("gives every outpost Flash's level-1 outpost core, whatever the hall level", () => {
    expect(buildingArtUrl(BuildingKind.OUTPOST)).toBe("/assets/buildings/outpost/top.1.png");
    expect(buildingArtUrl(BuildingKind.OUTPOST, 9)).toBe("/assets/buildings/outpost/top.1.png");
  });
});

describe("framePoints (a trimmed picture's frame)", () => {
  it("keeps a plain picture's pixel bounds", () => {
    expect(framePoints(new Rectangle(2, 4, 100, 120), 1)).toMatchObject({ x: 2, y: 4, width: 100, height: 120 });
  });

  it("halves an @2x picture's pixel bounds, so the hall is not drawn at half size", () => {
    expect(framePoints(new Rectangle(0, 0, 308, 409), 2)).toMatchObject({ x: 0, y: 0, width: 154, height: 204.5 });
  });

  it("treats a missing resolution as 1", () => {
    expect(framePoints(new Rectangle(0, 0, 10, 10), 0)).toMatchObject({ width: 10, height: 10 });
  });
});
