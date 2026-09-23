import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILDING_COST_ROWS, type CostStep } from "./buildingCostData";
import {
  costOf,
  FREE_FINISH_SECONDS,
  instantCost,
  kindOf,
  maxLevel,
  nameOf,
  quantityOf,
  requirementsMet,
  rowOf,
  sumCosts,
  timeCost,
  townHallLevel,
  TRAP_TYPES,
  upgradeSteps,
  WALL_TYPES,
} from "./buildingCosts";
import { readYard } from "./yardModel";
import type { BaseLoadResponse } from "@/api/types";

/**
 * The generated cost table and the helpers that read it.
 *
 * The table integrity half mirrors `server/src/game-data/buildingCosts.test.ts`
 * on purpose: the two files are generated together and hold identical rows, so
 * a change that breaks one has to break the other too or the client is showing
 * a price the server will not charge.
 */

const FIXTURE = "../../../test/fixtures/baseload-sandbox-yard.json";

const sandbox = (): BaseLoadResponse =>
  JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));

const fixtureTypes = (): number[] => {
  const buildings = Object.values(sandbox().buildingdata ?? {});
  return [...new Set(buildings.map((building) => building.t))].sort((a, b) => a - b);
};

describe("the cost table", () => {
  it("covers every type in the sandbox yard", () => {
    expect(fixtureTypes().filter((type) => rowOf(type) === null)).toEqual([]);
    expect(fixtureTypes().length).toBeGreaterThan(20);
  });

  it("holds one sorted row for each of the 135 priced types", () => {
    const types = BUILDING_COST_ROWS.map(([type]) => type);
    expect(types.length).toBe(135);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual([...types].sort((a, b) => a - b));
  });

  it("has non-negative integers throughout", () => {
    for (const [type, , , group, costs, quantity] of BUILDING_COST_ROWS) {
      expect(costs.length, `type ${type}`).toBeGreaterThan(0);
      for (const [index, [r1, r2, r3, r4, time, re]] of costs.entries()) {
        for (const amount of [r1, r2, r3, r4, time]) {
          expect(Number.isInteger(amount), `type ${type} step ${index}`).toBe(true);
          expect(amount, `type ${type} step ${index}`).toBeGreaterThanOrEqual(0);
        }
        for (const entry of re) {
          expect(entry.length).toBe(3);
          // Group 999 is the non-buildable tab; the mushroom's entry is a
          // `[0, 0, 0]` placeholder (`YARD_PROPS.as:885-894`).
          if (group !== 999) expect(entry[1], `type ${type} step ${index}`).toBeGreaterThan(0);
        }
      }
      for (const cap of quantity) expect(cap).toBeGreaterThanOrEqual(0);
    }
  });

  it("prices the Wooden Block exactly as the props table does", () => {
    // `client/scripts/YARD_PROPS.as:1722-1757`.
    expect(maxLevel(17)).toBe(5);
    expect(kindOf(17)).toBe("wall");
    expect(nameOf(17)).toBe("Block");
    for (let k = 0; k < 5; k++) {
      const step = costOf(17, k);
      expect(step?.[4], `step ${k} time`).toBe(5);
      expect(step?.[5], `step ${k} re`).toEqual([[14, 1, k + 2]]);
    }
    expect(costOf(17, 4)).toEqual([400000, 400000, 0, 0, 5, [[14, 1, 6]]]);
    expect(costOf(17, 5)).toBeNull();
  });

  it("prices both traps as single 5-second builds", () => {
    expect(costOf(24, 0)).toEqual([1000, 1000, 1000, 0, 5, [[14, 1, 2]]]);
    expect(costOf(117, 0)).toEqual([50000, 50000, 50000, 0, 5, [[14, 1, 4]]]);
    for (const type of TRAP_TYPES) {
      expect(maxLevel(type), `type ${type}`).toBe(1);
      expect(kindOf(type), `type ${type}`).toBe("trap");
      expect(costOf(type, 1), `type ${type}`).toBeNull();
    }
  });

  it("carries the Map Room 2 prices, not the props file's", () => {
    // `GLOBAL.changeNotMaproom3SpecificBuildings()`, `client/scripts/GLOBAL.as:615-714`.
    expect(costOf(9, 0)).toEqual([1000000, 1000000, 1000000, 0, 43200, [[14, 1, 3], [15, 1, 1]]]);
    expect(maxLevel(9)).toBe(3);
    expect(costOf(15, 0)).toEqual([2160, 2160, 0, 0, 300, [[14, 1, 1]]]);
    expect(maxLevel(15)).toBe(6);
    expect(costOf(5, 0)).toEqual([1000, 1000, 500, 0, 900, [[14, 1, 1]]]);
    expect(maxLevel(5)).toBe(4);
    // The Bunker's override is its capacity only (`GLOBAL.as:683`), so its
    // price is still the props table's (`YARD_PROPS.as:2424`).
    expect(costOf(22, 0)).toEqual([250000, 187500, 62500, 0, 21600, [[14, 1, 3], [15, 1, 1]]]);
  });

  it("names the wall and trap types the batch actions work on", () => {
    expect(WALL_TYPES).toEqual([17, 18]);
    expect(TRAP_TYPES).toEqual([24, 117]);
    expect(FREE_FINISH_SECONDS).toBe(300);
  });

  it("carries the harvester and silo ladders, and nothing else's", () => {
    /**
     * The five rows with a seventh element. The server derives production and
     * storage caps from these same numbers
     * (`server/src/game-data/buildingCosts.ts`,
     * `docs/design/economy-save-validation.md` §3.6), so the two copies have to
     * agree here as much as they do on prices. The ladders are the spec's
     * (`docs/specs/base-building.md:484-526`).
     */
    const statted = BUILDING_COST_ROWS.filter((row) => row[6] !== undefined).map(([type]) => type);
    expect(statted).toEqual([1, 2, 3, 4, 6]);

    for (const type of [1, 2, 3, 4]) {
      // `YARD_PROPS.as:151-153` and the three parallel entries.
      const stats = rowOf(type)?.[6];
      expect(stats?.produce, `type ${type}`).toEqual([2, 4, 7, 11, 16, 22, 29, 37, 46, 56]);
      expect(stats?.cycleTime, `type ${type}`).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
      expect(stats?.capacity, `type ${type}`).toEqual([
        720, 2160, 5670, 13365, 29160, 60142, 118918, 227584, 424414, 775018,
      ]);
      expect(stats?.capacity.at(-1), `type ${type}`).toBe(775_018);
      expect(stats?.capacity.length, `type ${type}`).toBe(maxLevel(type));
    }

    // The Storage Silo stores rather than produces (`YARD_PROPS.as:869`).
    const silo = rowOf(6)?.[6];
    expect(silo?.produce).toEqual([]);
    expect(silo?.cycleTime).toEqual([]);
    expect(silo?.capacity).toEqual([
      7500, 15000, 30000, 60000, 120000, 240000, 480000, 960000, 1920000, 3840000,
    ]);
    expect(silo?.capacity.at(-1)).toBe(3_840_000);

    // The other four entries that spell `capacity` or `produce` mean monsters,
    // Flinger payloads and bunker garrison, not resources, so they carry none.
    for (const type of [5, 15, 19, 22]) expect(rowOf(type)?.[6], `type ${type}`).toBeUndefined();
  });

  it("answers for an unknown type instead of throwing", () => {
    expect(rowOf(99999)).toBeNull();
    expect(costOf(99999, 0)).toBeNull();
    expect(maxLevel(99999)).toBe(0);
    expect(kindOf(99999)).toBe("");
    expect(nameOf(99999)).toBe("");
    expect(quantityOf(99999, 10)).toBe(0);
  });
});

describe("quantityOf", () => {
  it("reads the Town Hall cap ladder", () => {
    // `YARD_PROPS.as:2723` and `:6307`.
    expect(quantityOf(24, 10)).toBe(75);
    expect(quantityOf(24, 2)).toBe(8);
    expect(quantityOf(24, 1)).toBe(0);
    expect(quantityOf(117, 10)).toBe(18);
    expect(quantityOf(117, 4)).toBe(4);
    expect(quantityOf(17, 10)).toBe(400);
  });

  it("is 0 past the end of the ladder or below it", () => {
    expect(quantityOf(24, 99)).toBe(0);
    expect(quantityOf(24, -1)).toBe(0);
  });
});

describe("upgradeSteps and sumCosts", () => {
  it("takes a wall from level 1 to level 5 for 700k twigs and 710k pebbles", () => {
    const steps = upgradeSteps(17, 1, 5);
    expect(steps.length).toBe(4);
    expect(sumCosts(steps)).toEqual({ r1: 700_000, r2: 710_000, r3: 0, r4: 0, time: 20 });
  });

  it("scales to the sandbox yard's 400 walls", () => {
    const one = sumCosts(upgradeSteps(17, 1, 5));
    expect(one.r1 * 400).toBe(280_000_000);
    expect(one.r2 * 400).toBe(284_000_000);
  });

  it("returns nothing for a building already at the target", () => {
    expect(upgradeSteps(17, 5, 5)).toEqual([]);
    expect(upgradeSteps(17, 5, 2)).toEqual([]);
    expect(sumCosts([])).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0, time: 0 });
  });

  it("truncates at the top of the ladder rather than throwing", () => {
    expect(upgradeSteps(17, 1, 99).length).toBe(4);
    expect(upgradeSteps(99999, 0, 5)).toEqual([]);
  });
});

describe("timeCost", () => {
  it("is free at or under the free-finish threshold", () => {
    // `STORE.GetTimeCost`, `client/scripts/STORE.as:162-171`.
    expect(timeCost(0)).toBe(0);
    expect(timeCost(5)).toBe(0);
    expect(timeCost(300)).toBe(0);
  });

  it("is the smaller of the linear and square-root terms above it", () => {
    // 301 s: ceil(301 * 20 / 3600) = 2, trunc(sqrt(301 * 0.8)) = 15.
    expect(timeCost(301)).toBe(2);
    // 43200 s: ceil(240) = 240, trunc(sqrt(34560)) = 185.
    expect(timeCost(43200)).toBe(185);
  });

  it("can be asked to ignore the threshold, as a couple of call sites do", () => {
    expect(timeCost(300, false)).toBe(2);
  });
});

describe("instantCost", () => {
  it("drops the time term entirely at or under 300 seconds", () => {
    // A wall's level 4 to 5 step: 400000 + 400000 + 0 twigs, pebbles and putty.
    // ceil(sqrt(800000 / 2) ** 0.75) = ceil(632.45 ** 0.75) = 127, and the
    // 5-second countdown adds nothing. trunc(127 * 0.95) = 120.
    const step = costOf(17, 4);
    expect(step).not.toBeNull();
    expect(instantCost(step as CostStep)).toBe(120);
  });

  it("adds the time term above the threshold", () => {
    // The Flinger's build step under Map Room 2: 1000 + 1000 + 500 resources
    // and a 900-second countdown. ceil(sqrt(1250) ** 0.75) = 15,
    // timeCost(900) = min(5, 26) = 5, trunc(20 * 0.95) = 19.
    const step = costOf(5, 0);
    expect(instantCost(step as CostStep)).toBe(19);
  });

  it("ignores goo, which the client leaves out of the sum", () => {
    // `BFOUNDATION.InstantUpgradeCost`, `:2114-2128`.
    expect(instantCost([0, 0, 0, 1_000_000, 5, []])).toBe(0);
  });

  it("is never negative for a free step", () => {
    expect(instantCost([0, 0, 0, 0, 5, []])).toBe(0);
  });
});

describe("requirementsMet and townHallLevel", () => {
  const yard = () => readYard(sandbox());

  it("reads the sandbox yard's Town Hall level", () => {
    expect(townHallLevel(yard())).toBe(10);
  });

  it("clears every wall gate on a Town Hall 10 yard", () => {
    const sandboxYard = yard();
    for (let k = 0; k < maxLevel(17); k++) {
      const step = costOf(17, k);
      expect(requirementsMet(step?.[5] ?? [], sandboxYard), `step ${k}`).toBe(true);
    }
  });

  it("refuses a gate the yard cannot meet", () => {
    const sandboxYard = yard();
    // Nothing in the sandbox yard is a Town Hall 11, and there is one hall.
    expect(requirementsMet([[14, 1, 11]], sandboxYard)).toBe(false);
    expect(requirementsMet([[14, 2, 1]], sandboxYard)).toBe(false);
    expect(requirementsMet([], sandboxYard)).toBe(true);
  });

  it("counts by type and level together", () => {
    const sandboxYard = yard();
    // Four Monster Housings (`t: 15`) and three Laser Towers (`t: 23`).
    expect(requirementsMet([[15, 4, 1]], sandboxYard)).toBe(true);
    expect(requirementsMet([[15, 5, 1]], sandboxYard)).toBe(false);
    expect(requirementsMet([[23, 3, 1]], sandboxYard)).toBe(true);
    // Both entries have to hold.
    expect(requirementsMet([[14, 1, 10], [15, 5, 1]], sandboxYard)).toBe(false);
  });

  it("reports 0 for a yard with no hall", () => {
    const raw = sandbox();
    const buildings = { ...raw.buildingdata };
    for (const [id, building] of Object.entries(buildings)) {
      if (building.t === 14) delete buildings[id];
    }
    const hallless = readYard({ ...raw, buildingdata: buildings });
    expect(townHallLevel(hallless)).toBe(0);
    expect(requirementsMet([[14, 1, 2]], hallless)).toBe(false);
  });
});
