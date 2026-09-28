import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import {
  BUILDING_COST_ROWS,
  OUTPOST_COST_ROWS,
  OUTPOST_TRAIT_ROWS,
} from "./buildingCostData";
import {
  costOf,
  fortifyStepsOf,
  hallTypeOf,
  maxLevel,
  nameOf,
  OUTPOST_CORE_TYPE,
  outpostTraitsOf,
  propsFor,
  quantityOf,
  rowOf,
  townHallLevel,
  upgradeSteps,
} from "./buildingCosts";
import { readYard } from "./yardModel";

/**
 * The outpost props table (`client/scripts/OUTPOST_YARD_PROPS.as`), generated
 * beside the main one by `tools/gen-building-costs.mjs`.
 *
 * Spot checks cite the ActionScript line they were read from. The caps are
 * research §1.2's table (`outposts/research.md`), which is `quantity[1]` and
 * the cost-ladder length of every buildable entry.
 */

/** `[type, quantity[1], level cap]` for every type an outpost can build. */
const OUTPOST_BUILDABLE: readonly (readonly [number, number, number])[] = [
  [1, 4, 10],
  [2, 4, 10],
  [3, 4, 10],
  [4, 4, 10],
  [5, 1, 4],
  [9, 1, 3],
  [10, 1, 1],
  [13, 2, 3],
  [15, 1, 6],
  [16, 1, 1],
  [17, 100, 5],
  [20, 4, 10],
  [21, 4, 10],
  [22, 2, 4],
  [23, 2, 6],
  [24, 25, 1],
  [25, 2, 6],
  [115, 2, 6],
  [117, 5, 1],
  [118, 1, 6],
];

const buildableTypes = (): number[] =>
  OUTPOST_TRAIT_ROWS.filter(([type, blocked]) => {
    const row = rowOf(type, "outpost");
    const group = row?.[3] ?? 0;
    return !blocked && group >= 1 && group <= 4 && quantityOf(type, 1, "outpost") > 0;
  }).map(([type]) => type);

describe("the outpost cost table", () => {
  it("holds one sorted row per priced type, each with a trait row", () => {
    const types = OUTPOST_COST_ROWS.map(([type]) => type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual([...types].sort((a, b) => a - b));
    expect(OUTPOST_TRAIT_ROWS.map(([type]) => type)).toEqual(types);
  });

  it("offers exactly research §1.2's buildings, with its caps and level caps", () => {
    expect(buildableTypes()).toEqual(OUTPOST_BUILDABLE.map(([type]) => type));
    for (const [type, cap, levels] of OUTPOST_BUILDABLE) {
      expect(quantityOf(type, 1, "outpost"), `type ${type} cap`).toBe(cap);
      expect(maxLevel(type, "outpost"), `type ${type} levels`).toBe(levels);
    }
  });

  it("blocks the Catapult although quantity[1] allows one", () => {
    // `OUTPOST_YARD_PROPS.as:3118` (`block`) and `:3190` (`quantity: [0, 1]`).
    expect(quantityOf(51, 1, "outpost")).toBe(1);
    expect(outpostTraitsOf(51)?.[1]).toBe(true);
  });

  it("gives the core 200,000 hp, one free step and four fortify steps", () => {
    // `OUTPOST_YARD_PROPS.as:5152-5245`.
    expect(OUTPOST_CORE_TYPE).toBe(112);
    expect(hallTypeOf("outpost")).toBe(112);
    expect(hallTypeOf("main")).toBe(14);
    expect(nameOf(112, "outpost")).toBe("Outpost");
    expect(rowOf(112)).toBeNull();
    expect(maxLevel(112, "outpost")).toBe(1);
    expect(costOf(112, 0, "outpost")).toEqual([0, 0, 0, 0, 10, []]);
    expect(quantityOf(112, 1, "outpost")).toBe(1);
    expect(outpostTraitsOf(112)?.[2]).toEqual([200000]);
    // `:5214-5242`: F1 250k/50k/25k 4 h; F2 500k x3 16 h; F3 2.5M/2.5M/1M 48 h;
    // F4 5M/5M/2.5M 96 h.
    expect(fortifyStepsOf(112, "outpost")).toEqual([
      [250000, 50000, 25000, 0, 14400, [[112, 1, 1]]],
      [500000, 500000, 500000, 0, 57600, [[112, 1, 1]]],
      [2500000, 2500000, 1000000, 0, 172800, [[112, 1, 1]]],
      [5000000, 5000000, 2500000, 0, 345600, [[112, 1, 1]]],
    ]);
    expect(fortifyStepsOf(112, "main")).toEqual([]);
  });

  it("carries fortify ladders only where can_fortify is set", () => {
    const fortifies = OUTPOST_TRAIT_ROWS.filter(([, , , fortify]) => fortify.length > 0).map(
      ([type]) => type,
    );
    // The Magma Tower has `fortify_costs` (`:6092`) but no `can_fortify`.
    expect(fortifies).toEqual([20, 21, 23, 25, 112, 115, 118]);
    // Cannon F1, `:1531-1537`.
    expect(fortifyStepsOf(20, "outpost")[0]).toEqual([50000, 37500, 12500, 0, 8100, [[112, 1, 1]]]);
  });

  it("prices the outpost's own entries, not the main yard's Map Room 2 ones", () => {
    // Flinger: `OUTPOST_YARD_PROPS.as:605-611` against `GLOBAL.as:684-690`.
    expect(costOf(5, 0, "outpost")).toEqual([10000, 10000, 5000, 0, 900, [[112, 1, 1]]]);
    expect(costOf(5, 0)).toEqual([1000, 1000, 500, 0, 900, [[14, 1, 1]]]);
    // Yard Planner, `:805-811`; Hatchery Control Center, `:1206-1212`.
    expect(costOf(10, 0, "outpost")?.slice(0, 5)).toEqual([125000, 125000, 0, 0, 43200]);
    expect(costOf(16, 0, "outpost")).toEqual([
      500000,
      500000,
      500000,
      0,
      90000,
      [[112, 1, 1], [13, 2, 1]],
    ]);
    // Railgun, `:5540-5545`, 80% of the main yard's first step.
    expect(costOf(118, 0, "outpost")?.slice(0, 5)).toEqual([1600000, 1920000, 1280000, 0, 43200]);
    // Laser L5 to L6 takes 428,800 s in an outpost (`:1982`).
    expect(costOf(23, 5, "outpost")?.[4]).toBe(428800);
    expect(costOf(23, 6, "outpost")).toBeNull();
  });

  it("keeps the harvesters' economy ladder and every hp ladder verbatim", () => {
    // Twig Snapper, `:22-28` and its `produce` (research §1.3: 56 per 10 s at L10).
    expect(costOf(1, 0, "outpost")).toEqual([0, 750, 0, 0, 15, [[112, 1, 1]]]);
    expect(rowOf(1, "outpost")?.[6]?.produce.at(-1)).toBe(56);
    expect(rowOf(1, "outpost")?.[6]?.cycleTime.at(-1)).toBe(10);
    // Laser `:2060`; Railgun `:5658`, whose level 6 reads 13,200 in Flash.
    expect(outpostTraitsOf(23)?.[2]).toEqual([9000, 12600, 17640, 26460, 34400, 60200]);
    expect(outpostTraitsOf(118)?.[2]).toEqual([17640, 34400, 45000, 58000, 75500, 13200]);
  });

  it("carries the non-economy capacity ladders", () => {
    // Housing `:1191`, Bunker `:1892`; harvesters leave theirs to `stats`.
    expect(outpostTraitsOf(15)?.[4]).toEqual([200, 260, 320, 380, 450, 540]);
    expect(outpostTraitsOf(22)?.[4]).toEqual([380, 450, 540, 660]);
    expect(outpostTraitsOf(1)?.[4]).toEqual([]);
  });

  it("leaves the main table and its lookups untouched", () => {
    expect(propsFor()).toBe(propsFor("main"));
    expect(propsFor("main").size).toBe(BUILDING_COST_ROWS.length);
    expect(propsFor("outpost").size).toBe(OUTPOST_COST_ROWS.length);
    expect(maxLevel(23)).toBe(8);
    expect(maxLevel(23, "outpost")).toBe(6);
    expect(upgradeSteps(23, 0, 8, "outpost")).toHaveLength(6);
    expect(upgradeSteps(23, 0, 8)).toHaveLength(8);
  });
});

describe("the outpost's hall", () => {
  const outpost = (buildings: BuildingData[]) =>
    readYard({
      error: 0,
      currenttime: 1_000,
      savetime: 1_000,
      buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
      buildinghealthdata: {},
    } as unknown as BaseLoadResponse);

  it("is the core, at level 1", () => {
    const yard = outpost([
      { id: 0, t: 112, X: 0, Y: -50, l: 1 },
      { id: 1, t: 20, X: 200, Y: 0, l: 1 },
    ]);
    expect(yard.townHall?.type).toBe(112);
    expect(townHallLevel(yard)).toBe(1);
  });

  it("is absent from an outpost with no core", () => {
    const yard = outpost([{ id: 1, t: 20, X: 200, Y: 0, l: 1 }]);
    expect(yard.townHall).toBeNull();
    expect(townHallLevel(yard)).toBe(0);
  });
});
