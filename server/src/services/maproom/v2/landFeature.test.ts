import { afterEach, describe, expect, test } from "bun:test";

import { LandFeature } from "../../../game-rules/combat/index.js";
import { mr2LandFeaturesEnabled } from "../../../config/MapRoom2Config.js";
import type { BuildingData } from "../../../types/BuildingData.js";
import { generateNoise, getTerrainHeight } from "./generateMap.js";
import { activeLandFeature, cellHash, landFeatureAt } from "./landFeature.js";
import { harvesterIncome, outpostIncome } from "./autobank.js";

/**
 * Map Room 2 land features (`landFeature.ts`, design A of
 * `docs/mr2-civ-study.md`): picked the same way every time from the world
 * seed, in the approved shares, only with the switch on, and paid through
 * the outpost income.
 */

const switchWas = process.env.MR2_LAND_FEATURES;
afterEach(() => {
  if (switchWas === undefined) delete process.env.MR2_LAND_FEATURES;
  else process.env.MR2_LAND_FEATURES = switchWas;
});

/** Each feature's share of land in a world, every second cell each way (160,000 cells). */
const shares = (worldid: string): number[] => {
  const noise = generateNoise(worldid);
  const counts = new Array<number>(8).fill(0);
  let land = 0;
  for (let x = 0; x < 800; x += 2) {
    for (let y = 0; y < 800; y += 2) {
      const height = getTerrainHeight(noise, x, y);
      if (height <= 99) continue;
      land += 1;
      counts[landFeatureAt(worldid, x, y, height)]! += 1;
    }
  }
  return counts.map((count) => count / land);
};

describe("which feature a cell has", () => {
  test("is the same on every call and every server: pinned cells of one world", () => {
    const world = "5f0b2c1e-land-test";
    const noise = generateNoise(world);
    const picks = [
      [10, 10],
      [123, 456],
      [399, 2],
      [700, 650],
    ].map(([x, y]) => landFeatureAt(world, x!, y!, getTerrainHeight(noise, x!, y!)));
    for (let round = 0; round < 3; round += 1) {
      const again = [
        [10, 10],
        [123, 456],
        [399, 2],
        [700, 650],
      ].map(([x, y]) => landFeatureAt(world, x!, y!, getTerrainHeight(noise, x!, y!)));
      expect(again).toEqual(picks);
    }
    expect(cellHash(world, 123, 456)).toBe(cellHash(world, 123, 456));
    expect(cellHash(world, 123, 456)).not.toBe(cellHash(world, 456, 123));
  });

  test("differs between worlds", () => {
    let same = 0;
    for (let x = 0; x < 200; x += 1) {
      if (landFeatureAt("world-a", x, 300, 130) === landFeatureAt("world-b", x, 300, 130)) same += 1;
    }
    expect(same).toBeLessThan(180);
  });

  test("is open ground on water", () => {
    for (let x = 0; x < 100; x += 1) expect(landFeatureAt("world-a", x, 7, 99)).toBe(LandFeature.OPEN);
  });

  test.each(["study-seed-1", "0c9a1f6e-3b44-4d7e-9a61-1f2e3d4c5b6a"])(
    "gives about 55%% open, 20%% forest, 10%% rocks, 10%% marsh, 5%% nodes in world %s",
    (world) => {
      const share = shares(world);
      expect(share[LandFeature.OPEN]!).toBeCloseTo(0.55, 1);
      expect(share[LandFeature.FOREST]!).toBeCloseTo(0.2, 1);
      expect(share[LandFeature.ROCKS]!).toBeCloseTo(0.1, 1);
      expect(share[LandFeature.MARSH]!).toBeCloseTo(0.1, 1);
      const nodes = share.slice(LandFeature.TWIG_NODE).reduce((sum, one) => sum + one, 0);
      expect(nodes).toBeGreaterThan(0.04);
      expect(nodes).toBeLessThan(0.06);
      // Every resource gets its share of the nodes.
      for (const node of share.slice(LandFeature.TWIG_NODE)) expect(node).toBeGreaterThan(0.009);
    },
    60_000
  );

  test("leans rocks to high ground and marsh to low ground", () => {
    let rocksHigh = 0;
    let rocksLow = 0;
    let marshHigh = 0;
    let marshLow = 0;
    for (let x = 0; x < 400; x += 1) {
      for (let y = 0; y < 100; y += 1) {
        const high = landFeatureAt("tilt", x, y, 165);
        const low = landFeatureAt("tilt", x, y, 105);
        if (high === LandFeature.ROCKS) rocksHigh += 1;
        if (low === LandFeature.ROCKS) rocksLow += 1;
        if (high === LandFeature.MARSH) marshHigh += 1;
        if (low === LandFeature.MARSH) marshLow += 1;
      }
    }
    expect(rocksHigh).toBeGreaterThan(rocksLow);
    expect(marshLow).toBeGreaterThan(marshHigh);
  });
});

describe("the MR2_LAND_FEATURES switch", () => {
  test("is off unless set on", () => {
    expect(mr2LandFeaturesEnabled({})).toBe(false);
    expect(mr2LandFeaturesEnabled({ MR2_LAND_FEATURES: "off" })).toBe(false);
    expect(mr2LandFeaturesEnabled({ MR2_LAND_FEATURES: "on" })).toBe(true);
    expect(mr2LandFeaturesEnabled({ MR2_LAND_FEATURES: "true" })).toBe(true);
  });

  test("gives open ground everywhere with it off, and the real feature with it on", () => {
    // Find a cell with a feature first.
    let x = 0;
    while (landFeatureAt("switch-world", x, 50, 130) === LandFeature.OPEN) x += 1;
    delete process.env.MR2_LAND_FEATURES;
    expect(activeLandFeature("switch-world", x, 50, 130)).toBe(LandFeature.OPEN);
    process.env.MR2_LAND_FEATURES = "on";
    expect(activeLandFeature("switch-world", x, 50, 130)).toBe(landFeatureAt("switch-world", x, 50, 130));
  });
});

describe("outpost income", () => {
  const harvester = (t: number, l: number): BuildingData => ({ id: 1, t, X: 0, Y: 0, l }) as BuildingData;

  test("is exactly today's with open ground", () => {
    for (const t of [1, 2, 3, 4]) {
      for (const height of [100, 125, 160]) {
        expect(harvesterIncome(harvester(t, 5), undefined, height, LandFeature.OPEN)).toBe(
          harvesterIncome(harvester(t, 5), undefined, height)
        );
      }
    }
  });

  test("scales one resource after the height rule", () => {
    const base = (t: number) => harvesterIncome(harvester(t, 10), undefined, 125);
    const forest = (t: number) => harvesterIncome(harvester(t, 10), undefined, 125, LandFeature.FOREST);
    expect(forest(1)).toBe(Math.trunc((base(1) * 150) / 100));
    expect(forest(2)).toBe(base(2));
    expect(harvesterIncome(harvester(4, 10), undefined, 125, LandFeature.MARSH)).toBe(
      Math.trunc((base(4) * 150) / 100)
    );
    expect(harvesterIncome(harvester(3, 10), undefined, 125, LandFeature.MARSH)).toBe(
      Math.trunc((base(3) * 125) / 100)
    );
    expect(harvesterIncome(harvester(2, 10), undefined, 125, LandFeature.PEBBLE_NODE)).toBe(base(2) * 2);
  });

  test("pays a whole outpost through the same rule", () => {
    const buildingdata = { a: harvester(1, 10), b: { ...harvester(4, 10), id: 2 } };
    const open = outpostIncome({ buildingdata }, 140);
    const forest = outpostIncome({ buildingdata }, 140, LandFeature.FOREST);
    expect(forest.r1).toBe(Math.trunc((open.r1 * 150) / 100));
    expect(forest.r4).toBe(open.r4);
  });
});
