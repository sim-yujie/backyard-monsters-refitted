import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { buildPicture } from "./buildButtonArt";
import { BUILDABLE_TYPES, BUILD_CATALOGUE, BuildCategory } from "./buildCatalogue";
import { ArtState, buildingName, resolveArt } from "./buildingArt";
import { rowOf } from "./buildingCosts";
import { OUTPOST_BUILDABLE_TYPES } from "./buildCatalogue";
import { recycleBlock } from "./recycle";
import { REVAMP_BUILDING_ROWS, OBSERVATORY_CLASSIC_ART, OBSERVATORY_MODERN_ART } from "./revampBuildings";
import { animPolicy } from "./yardAnim";
import { footprintOf } from "./YardGrid";
import type { BaseLoadResponse, BuildingData } from "@/api/types";

const ASSETS = new URL("../../../../server/public/assets/", import.meta.url);
const FOLDER = "buildings/observatory/";

/** Every file a look names. */
const filesOf = (looks: typeof OBSERVATORY_MODERN_ART): string[] =>
  looks.flatMap((look) => [
    look.top[0],
    ...(look.shadow ? [look.shadow[0]] : []),
    ...(look.anim ? [look.anim.strip[0], ...(look.anim.body ? [look.anim.body[0]] : [])] : []),
    ...(look.damaged ? [look.damaged.top[0], ...(look.damaged.shadow ? [look.damaged.shadow[0]] : [])] : []),
    ...(look.destroyed ? [look.destroyed.top[0], ...(look.destroyed.shadow ? [look.destroyed.shadow[0]] : [])] : []),
  ]);

afterEach(() => setClassicLook(false));

describe("the Observatory (150, alliances)", () => {
  it("is one row named Observatory, 100 x 100, one per main yard after Map Room 2", () => {
    expect(REVAMP_BUILDING_ROWS.map((row) => row[0])).toEqual([150]);
    expect(buildingName(150)).toBe("Observatory");
    expect(footprintOf(150)).toEqual([100, 100]);
    const row = rowOf(150);
    expect(row?.[4][0]?.slice(0, 5)).toEqual([4_000_000, 4_000_000, 4_000_000, 0, 36 * 3600]);
    expect(row?.[5][1]).toBe(1);
  });

  it("is in the build menu's Buildings, after the Map Room, on the main yard only", () => {
    const buildings = BUILD_CATALOGUE.find((category) => category.id === BuildCategory.BUILDINGS)?.types ?? [];
    expect(buildings.indexOf(150)).toBe(buildings.indexOf(11) + 1);
    expect(BUILDABLE_TYPES.has(150)).toBe(true);
    expect(OUTPOST_BUILDABLE_TYPES.has(150)).toBe(false);
  });

  it("has every file of both looks and its build pictures on disk", () => {
    for (const file of [...filesOf(OBSERVATORY_MODERN_ART), ...filesOf(OBSERVATORY_CLASSIC_ART)]) {
      expect(existsSync(new URL(FOLDER + file, ASSETS)), file).toBe(true);
    }
    setClassicLook(false);
    const modern = buildPicture(150);
    expect(modern.modern).toBe(true);
    expect(existsSync(new URL(modern.url.replace("/assets/", ""), ASSETS)), modern.url).toBe(true);
    setClassicLook(true);
    const classic = buildPicture(150);
    expect(classic.modern).toBe(false);
    expect(existsSync(new URL(classic.url.replace("/assets/", ""), ASSETS)), classic.url).toBe(true);
  });

  it("draws the 3D look with the Modern look and its own Classic look with the Classic one, idling in both", () => {
    setClassicLook(false);
    const modern = resolveArt(150, 1, ArtState.DEFAULT);
    expect(modern?.top.url).toBe(`/assets/${FOLDER}body.3d1@2x.webp`);
    expect(modern?.anims.map((anim) => anim.url)).toEqual([`/assets/${FOLDER}anim.3d1@2x.webp`]);
    expect(resolveArt(150, 1, ArtState.DAMAGED)?.top.url).toBe(`/assets/${FOLDER}top.3d1.damaged@2x.webp`);
    expect(resolveArt(150, 1, ArtState.DESTROYED)?.top.url).toBe(`/assets/${FOLDER}top.3d1.destroyed@2x.webp`);

    setClassicLook(true);
    const classic = resolveArt(150, 1, ArtState.DEFAULT);
    expect(classic?.top.url).toBe(`/assets/${FOLDER}body.c1@2x.webp`);
    expect(classic?.anims.map((anim) => anim.url)).toEqual([`/assets/${FOLDER}anim.c1@2x.webp`]);
    expect(resolveArt(150, 1, ArtState.DESTROYED)?.top.url).toBe(`/assets/${FOLDER}top.c1.destroyed@2x.webp`);
    // Under construction it shows its level 1 look.
    expect(resolveArt(150, 0, ArtState.DEFAULT)?.top.url).toBe(`/assets/${FOLDER}body.c1@2x.webp`);

    const policy = animPolicy(150);
    expect(policy?.ticksPerFrame).toBeGreaterThan(0);
    expect(policy?.work).toBeNull();
    expect(policy?.pauseWhileBusy).toBe(true);
  });

  it("cannot be recycled", () => {
    const building = { id: 7, t: 150, l: 1, X: 0, Y: 0 } as unknown as BuildingData;
    expect(recycleBlock(building, {} as BaseLoadResponse, 0)?.reason).toBe("observatory");
  });
});
