// @vitest-environment jsdom
// jsdom: the yard's sprites are made without a GPU.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { setClassicLook } from "@/game/classicLook";
import { BAR_HEIGHT, BAR_OFFSET } from "@/game/attack/buildingBars";
import { INFERNO_TOWER_TIER_ART, MODERN_TOWERS, TOWER_TIER_ART, tierArtFor } from "./buildingArtTiers";
import {
  TIER_PLATE_FILES,
  TIER_PLATE_HEIGHT,
  TIER_PLATE_SPOT,
  TIER_PLATE_SPOT_INFERNO,
  TIER_PLATE_WIDTH,
  classicTowerTier,
  tierPlateImage,
  tierPlateScale,
  tierPlateSpot,
} from "./classicTierPlates";
import type { YardArtAtlas } from "./yardAtlas";
import { YardBuildings } from "./YardBuildings";
import { readYard } from "./yardModel";

// Run from web/ (jsdom's `import.meta.url` is not a file address).
const onDisk = (path: string): string => resolve(process.cwd(), "../server/public", path.slice(1));

/** A PNG's width and height, from its IHDR chunk. */
const pngSize = (url: string): [number, number] => {
  const bytes = readFileSync(url);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

/** The towers with three tiers of Modern art in each kind of yard. */
const TIERED_MAIN = MODERN_TOWERS.filter((type) => (TOWER_TIER_ART[type]?.length ?? 0) >= 3);
const TIERED_INFERNO = MODERN_TOWERS.filter(
  (type) => ((type in INFERNO_TOWER_TIER_ART ? INFERNO_TOWER_TIER_ART[type] : TOWER_TIER_ART[type])?.length ?? 0) >= 3,
);

afterEach(() => setClassicLook(false));

describe("classicTowerTier (beta 9, desk card b9-tier-look: a plate on every tier)", () => {
  it("is the Modern look's tier at every level, in both yards, tier 1 included", () => {
    for (const kind of ["main", "inferno"] as const) {
      for (const type of kind === "main" ? TIERED_MAIN : TIERED_INFERNO) {
        for (let level = 1; level <= 10; level += 1) {
          setClassicLook(false);
          const modern = tierArtFor(type, level, kind);
          const looks = kind === "inferno" && type in INFERNO_TOWER_TIER_ART ? INFERNO_TOWER_TIER_ART[type]! : TOWER_TIER_ART[type]!;
          const want = looks.indexOf(modern!) + 1;
          setClassicLook(true);
          expect(classicTowerTier(type, level, kind), `${kind} ${type} L${level}`).toBe(want);
          expect(want).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("covers every tiered tower, the Inferno's own included", () => {
    expect(TIERED_MAIN.sort((a, b) => a - b)).toEqual([20, 21, 22, 23, 25, 115, 118, 132]);
    expect(TIERED_INFERNO.sort((a, b) => a - b)).toEqual([20, 21, 22, 23, 25, 115, 118, 130, 132]);
    setClassicLook(true);
    // Cannon: tiers start at levels 1, 4 and 7; Magma (six levels) at 1, 3 and 5.
    expect([1, 3, 4, 6, 7, 10].map((level) => classicTowerTier(20, level, "main"))).toEqual([1, 1, 2, 2, 3, 3]);
    expect([1, 2, 3, 5, 6].map((level) => classicTowerTier(132, level, "main"))).toEqual([1, 1, 2, 3, 3]);
    expect([1, 4, 7].map((level) => classicTowerTier(21, level, "inferno"))).toEqual([1, 2, 3]);
    expect([1, 4, 7].map((level) => classicTowerTier(130, level, "inferno"))).toEqual([1, 2, 3]);
  });

  it("is 0 with the Modern look, mid-build, and for towers with one look (Quake, Spurtz) or none", () => {
    expect(classicTowerTier(20, 5, "main")).toBe(0);
    setClassicLook(true);
    expect(classicTowerTier(20, 0, "main")).toBe(0);
    for (const type of [129, 136, 137, 24, 14, 17]) expect(classicTowerTier(type, 3, "main"), String(type)).toBe(0);
  });
});

describe("the tier plates' pictures and spots", () => {
  it("are three @2x PNGs of the plate's size on disk", () => {
    expect(TIER_PLATE_FILES).toHaveLength(3);
    for (const file of TIER_PLATE_FILES) {
      expect(pngSize(onDisk(file)), file).toEqual([TIER_PLATE_WIDTH * 2, TIER_PLATE_HEIGHT * 2]);
    }
    expect(tierPlateImage(2)?.url).toContain("/assets/buildings/tierplates/plate.t2@2x.png");
    expect(tierPlateImage(0)).toBeNull();
    expect(tierPlateImage(4)).toBeNull();
  });

  it("has a spot on every tiered tower, below the battle health bar (astra round 2: keep them apart)", () => {
    for (const type of TIERED_MAIN) expect(TIER_PLATE_SPOT[type], String(type)).toBeDefined();
    for (const type of [20, 21, 130]) expect(TIER_PLATE_SPOT_INFERNO[type], String(type)).toBeDefined();
    const barBottom = BAR_OFFSET.y + BAR_HEIGHT;
    for (const [, top] of [...Object.values(TIER_PLATE_SPOT), ...Object.values(TIER_PLATE_SPOT_INFERNO)]) {
      expect(top).toBeGreaterThanOrEqual(barBottom + 3);
    }
    // The Inferno's Sharpshooter shares type 21 with the Sniper but not its picture.
    expect(tierPlateSpot(21, "inferno")).toBe(TIER_PLATE_SPOT_INFERNO[21]);
    expect(tierPlateSpot(23, "inferno")).toBe(TIER_PLATE_SPOT[23]);
  });

  it("grows when the camera zooms out, never past 1.7 times", () => {
    expect(tierPlateScale(1)).toBe(1);
    expect(tierPlateScale(2)).toBe(1);
    expect(tierPlateScale(0.6) * TIER_PLATE_WIDTH * 0.6).toBeCloseTo(24);
    expect(tierPlateScale(0.1)).toBe(1.7);
  });
});

const fakeAtlas = (): YardArtAtlas => ({
  placeholder: Texture.WHITE,
  mushroom: Texture.WHITE,
  working: Texture.WHITE,
  destroy() {},
});

/** A Cannon at level 5 (tier 2), a Quake Tower, a Booby Trap and a Sniper still being built. */
const yardResponse = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 20, l: 5, X: 100, Y: 100 },
      "2": { id: 2, t: 129, l: 3, X: 300, Y: 100 },
      "3": { id: 3, t: 24, l: 1, X: 100, Y: 300 },
      "4": { id: 4, t: 21, l: 0, X: 300, Y: 300, cB: 600 },
    },
    buildinghealthdata: {},
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
    storedata: {},
  }) as unknown as BaseLoadResponse;

describe("YardBuildings' tier plates", () => {
  it("puts one plate on each tiered tower with the Classic look, and none with the Modern look", () => {
    setClassicLook(false);
    const modern = new YardBuildings();
    modern.show(readYard(yardResponse()), fakeAtlas());
    // The Sniper's countdown badge is the only marker.
    expect(modern.markers.children).toHaveLength(1);
    modern.destroy();

    setClassicLook(true);
    const classic = new YardBuildings();
    classic.show(readYard(yardResponse()), fakeAtlas());
    expect(classic.markers.children).toHaveLength(2);
    classic.destroy();
  });
});
