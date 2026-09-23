import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  BUILDING_COST_ROWS,
  COSTS,
  costOf,
  maxLevel,
  productionOf,
  siloCapacity,
  STORAGE_SILO_TYPE,
  TRAP_TYPES,
  WALL_TYPES,
} from "./buildingCosts.js";

/**
 * The generated cost table, checked against the numbers the Flash client's
 * props file actually holds.
 *
 * The table is machine-written, so these are not tests of arithmetic: they are
 * a tripwire on the generator. A regex that stops matching after an edit to
 * `YARD_PROPS.as` would quietly emit an empty `costs` array or a zero price,
 * and the server would then charge nothing for a wall.
 */

/**
 * The sandbox yard capture the web client's tests run against: a real 575
 * building save, so every type in it is a type a live account can send us.
 */
const FIXTURE = "../../../web/test/fixtures/baseload-sandbox-yard.json";

interface Building {
  t: number;
  id: number;
}

const fixtureTypes = (): number[] => {
  const raw = JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));
  const buildings = Object.values(raw.buildingdata as Record<string, Building>);
  return [...new Set(buildings.map((building) => building.t))].sort((a, b) => a - b);
};

describe("buildingCosts", () => {
  test("every type in the sandbox yard fixture has a row", () => {
    const missing = fixtureTypes().filter((type) => COSTS[type] === undefined);
    expect(missing).toEqual([]);
  });

  test("the fixture is the yard it claims to be", () => {
    // Guards against the fixture being swapped for a near-empty save, which
    // would make the check above pass for the wrong reason.
    expect(fixtureTypes().length).toBeGreaterThan(20);
  });

  test("the table covers the whole props file, not a prefix of it", () => {
    // 135 of the 140 entries in `_yardProps` carry a `costs` array; the five
    // without one are not buildable at any price.
    expect(BUILDING_COST_ROWS.length).toBe(135);
    expect(Object.keys(COSTS).length).toBe(135);
  });

  test("rows are sorted by type and each type appears once", () => {
    const types = BUILDING_COST_ROWS.map(([type]) => type);
    expect(types).toEqual([...types].sort((a, b) => a - b));
    expect(new Set(types).size).toBe(types.length);
  });

  test("every amount, time and quantity entry is a non-negative integer", () => {
    for (const [type, name, kind, group, costs, quantity] of BUILDING_COST_ROWS) {
      expect(Number.isInteger(type)).toBe(true);
      expect(typeof name).toBe("string");
      expect(typeof kind).toBe("string");
      expect(Number.isInteger(group)).toBe(true);
      expect(costs.length, `type ${type} has no cost steps`).toBeGreaterThan(0);

      for (const [index, step] of costs.entries()) {
        const [r1, r2, r3, r4, time, re] = step;
        for (const [key, amount] of [
          ["r1", r1],
          ["r2", r2],
          ["r3", r3],
          ["r4", r4],
          ["time", time],
        ] as const) {
          expect(Number.isInteger(amount), `type ${type} step ${index} ${key}`).toBe(true);
          expect(amount, `type ${type} step ${index} ${key}`).toBeGreaterThanOrEqual(0);
        }
        for (const entry of re) {
          expect(entry.length, `type ${type} step ${index} re entry`).toBe(3);
          for (const part of entry) expect(Number.isInteger(part)).toBe(true);
          // Group 999 is the non-buildable tab — the mushroom, the Horsey, the
          // taunt sign — and the mushroom's entry carries a `[0, 0, 0]`
          // placeholder rather than a real gate (`YARD_PROPS.as:885-894`).
          // Nothing buildable is allowed one.
          if (group !== 999) {
            expect(entry[1], `type ${type} step ${index} re count`).toBeGreaterThan(0);
            expect(entry[0], `type ${type} step ${index} re type`).toBeGreaterThan(0);
          }
        }
      }

      for (const cap of quantity) {
        expect(Number.isInteger(cap), `type ${type} quantity`).toBe(true);
        expect(cap, `type ${type} quantity`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("a type with no row reads as unbuildable rather than throwing", () => {
    expect(costOf(99999)).toBeUndefined();
    expect(maxLevel(99999)).toBe(0);
  });

  describe("walls", () => {
    // `client/scripts/YARD_PROPS.as:1722-1757`.
    test("the Wooden Block has five 5-second steps gated on the Town Hall", () => {
      const wall = costOf(17);
      expect(wall?.kind).toBe("wall");
      expect(wall?.costs.length).toBe(5);
      expect(maxLevel(17)).toBe(5);

      for (const [k, step] of (wall?.costs ?? []).entries()) {
        expect(step[4], `step ${k} time`).toBe(5);
        expect(step[5], `step ${k} re`).toEqual([[14, 1, k + 2]]);
      }
    });

    test("the Wooden Block ladder is the price the props table names", () => {
      expect(costOf(17)?.costs).toEqual([
        [1000, 0, 0, 0, 5, [[14, 1, 2]]],
        [0, 10000, 0, 0, 5, [[14, 1, 3]]],
        [100000, 100000, 0, 0, 5, [[14, 1, 4]]],
        [200000, 200000, 0, 0, 5, [[14, 1, 5]]],
        [400000, 400000, 0, 0, 5, [[14, 1, 6]]],
      ]);
    });

    test("the Stone Block is the legacy single-step entry", () => {
      // `:1844`. The Flash client rewrites `t: 18` to `t: 17, l: 2` on load
      // (`client/scripts/BASE.as:1523-1526`), so this ladder is never climbed.
      expect(costOf(18)?.costs.length).toBe(1);
      expect(WALL_TYPES).toEqual([17, 18]);
    });
  });

  describe("traps", () => {
    test("both trap types have a single 5-second build step", () => {
      for (const type of TRAP_TYPES) {
        const trap = costOf(type);
        expect(trap?.kind, `type ${type}`).toBe("trap");
        expect(trap?.costs.length, `type ${type}`).toBe(1);
        expect(maxLevel(type), `type ${type}`).toBe(1);
        expect(trap?.costs[0]?.[4], `type ${type} time`).toBe(5);
      }
    });

    test("the trap prices and Town Hall caps match the props table", () => {
      // `:2695-2702` and `:2723`.
      expect(costOf(24)?.costs[0]).toEqual([1000, 1000, 1000, 0, 5, [[14, 1, 2]]]);
      expect(costOf(24)?.quantity).toEqual([0, 0, 8, 15, 20, 28, 35, 42, 50, 60, 75]);

      // `:6295-6303` and `:6307`.
      expect(costOf(117)?.costs[0]).toEqual([50000, 50000, 50000, 0, 5, [[14, 1, 4]]]);
      expect(costOf(117)?.quantity).toEqual([0, 0, 0, 0, 4, 6, 8, 10, 12, 15, 18]);
    });
  });

  describe("Map Room 2 overrides", () => {
    /**
     * `GLOBAL.changeNotMaproom3SpecificBuildings()` rewrites four entries of
     * `_buildingProps` whenever the account is not in Map Room 3
     * (`client/scripts/GLOBAL.as:615-714`, applied at `:731-739`). The indexes
     * it touches are 4, 8, 14 and 21, which are ids 5, 9, 15 and 22, because
     * `_buildingProps` is indexed by `id - 1`.
     *
     * This project runs Map Room 2 as the default overworld, so the generated
     * table has to carry the overridden prices, not the props file's.
     */

    test("the Monster Juicer takes its Map Room 2 costs and cap", () => {
      // `GLOBAL.as:616-638`.
      expect(costOf(9)?.costs).toEqual([
        [1000000, 1000000, 1000000, 0, 43200, [[14, 1, 3], [15, 1, 1]]],
        [250000, 250000, 0, 0, 21600, [[14, 1, 3], [15, 1, 1]]],
        [500000, 500000, 0, 0, 43200, [[14, 1, 3], [15, 1, 1]]],
      ]);
      expect(costOf(9)?.quantity).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
      expect(maxLevel(9)).toBe(3);
    });

    test("Monster Housing takes its Map Room 2 costs", () => {
      // `GLOBAL.as:639-681`. Only `costs` and `capacity` are replaced; the cap
      // ladder stays the props file's.
      expect(costOf(15)?.costs).toEqual([
        [2160, 2160, 0, 0, 300, [[14, 1, 1]]],
        [8640, 8640, 0, 0, 4500, [[14, 1, 3], [8, 1, 1]]],
        [34560, 34560, 0, 0, 10800, [[14, 1, 4], [8, 1, 1]]],
        [138240, 138240, 0, 0, 28800, [[14, 1, 5], [8, 1, 1]]],
        [552960, 552960, 0, 0, 72000, [[14, 1, 6], [8, 1, 1]]],
        [2211840, 2211840, 0, 0, 144000, [[14, 1, 6], [8, 1, 1]]],
      ]);
      expect(maxLevel(15)).toBe(6);
    });

    test("the Flinger takes its Map Room 2 costs", () => {
      // `GLOBAL.as:684-712`.
      expect(costOf(5)?.costs).toEqual([
        [1000, 1000, 500, 0, 900, [[14, 1, 1]]],
        [64300, 64300, 32150, 0, 10800, [[14, 1, 3], [11, 1, 1]]],
        [283600, 283600, 141800, 0, 32400, [[14, 1, 4], [11, 1, 1]]],
        [1247840, 1247840, 623920, 0, 97200, [[14, 1, 4], [11, 1, 1]]],
      ]);
      expect(maxLevel(5)).toBe(4);
    });

    test("the Monster Bunker keeps the props table's costs", () => {
      // `GLOBAL.as:683` replaces `_buildingProps[21].capacity` and nothing
      // else, so the Bunker is on the override list without its price moving.
      // `YARD_PROPS.as:2424` is where these five steps live.
      expect(costOf(22)?.costs[0]).toEqual([
        250000, 187500, 62500, 0, 21600, [[14, 1, 3], [15, 1, 1]],
      ]);
      expect(maxLevel(22)).toBe(5);
    });
  });

  describe("the numbers the batch wall route depends on", () => {
    test("taking a wall from level 1 to level 5 costs 700k twigs and 710k pebbles", () => {
      const steps = costOf(17)?.costs.slice(1, 5) ?? [];
      expect(steps.length).toBe(4);
      const r1 = steps.reduce((total, step) => total + step[0], 0);
      const r2 = steps.reduce((total, step) => total + step[1], 0);
      const r3 = steps.reduce((total, step) => total + step[2], 0);
      const r4 = steps.reduce((total, step) => total + step[3], 0);

      expect(r1).toBe(700_000);
      expect(r2).toBe(710_000);
      expect(r3).toBe(0);
      expect(r4).toBe(0);

      // The sandbox yard's 400 walls, which is the figure the plan quotes.
      expect(r1 * 400).toBe(280_000_000);
      expect(r2 * 400).toBe(284_000_000);
    });

    test("every wall and trap step is free to finish", () => {
      // 5 seconds is well under the 300-second threshold
      // (`client/scripts/BFOUNDATION.as:2063-2083`), which is what lets the
      // batch routes write a finished building instead of starting a job.
      for (const type of [...WALL_TYPES, ...TRAP_TYPES]) {
        for (const step of costOf(type)?.costs ?? []) {
          expect(step[4], `type ${type}`).toBeLessThanOrEqual(300);
        }
      }
    });
  });

  describe("the harvester and silo ladders the economy audit derives from", () => {
    /**
     * These five rows are the only ones with a `stats` element, and the audit
     * turns them into a production budget and a storage cap
     * (`docs/design/economy-save-validation.md` §2.6, §2.7). A regex that
     * stopped matching would not fail loudly here: it would hand the audit an
     * empty ladder and a budget of zero, which reads as every honest save
     * cheating. The numbers are the spec's (`docs/specs/base-building.md:484-526`).
     */
    const HARVESTERS = [1, 2, 3, 4];
    const PRODUCE = [2, 4, 7, 11, 16, 22, 29, 37, 46, 56];
    const CYCLE_TIME = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
    const CAPACITY = [720, 2160, 5670, 13365, 29160, 60142, 118918, 227584, 424414, 775018];
    const SILO_CAPACITY = [
      7500, 15000, 30000, 60000, 120000, 240000, 480000, 960000, 1920000, 3840000,
    ];

    test("all four harvesters share one produce, cycleTime and capacity ladder", () => {
      // `YARD_PROPS.as:151-153` and the three parallel entries at `:298`,
      // `:445` and `:592`. Only the currency differs between them.
      for (const type of HARVESTERS) {
        const stats = productionOf(type);
        expect(costOf(type)?.kind, `type ${type}`).toBe("resource");
        expect(stats?.produce, `type ${type}`).toEqual(PRODUCE);
        expect(stats?.cycleTime, `type ${type}`).toEqual(CYCLE_TIME);
        expect(stats?.capacity, `type ${type}`).toEqual(CAPACITY);
        expect(stats?.capacity.at(-1), `type ${type}`).toBe(775_018);
      }
    });

    test("each ladder is as long as the cost ladder, so a level 10 has a price", () => {
      // `produce[l - 1]` is the lookup the client makes
      // (`client/scripts/BRESOURCE.as:425`), so a ladder one short would read
      // a top-level harvester as producing nothing.
      for (const type of [...HARVESTERS, STORAGE_SILO_TYPE]) {
        const stats = COSTS[type]?.stats;
        expect(stats, `type ${type}`).toBeDefined();
        expect(stats?.capacity.length, `type ${type} capacity`).toBe(maxLevel(type));
        expect(maxLevel(type), `type ${type}`).toBe(10);
      }
      for (const type of HARVESTERS) {
        expect(COSTS[type]?.stats?.produce.length, `type ${type}`).toBe(maxLevel(type));
        expect(COSTS[type]?.stats?.cycleTime.length, `type ${type}`).toBe(maxLevel(type));
      }
    });

    test("the Storage Silo carries a capacity ladder and produces nothing", () => {
      // `YARD_PROPS.as:869`.
      expect(STORAGE_SILO_TYPE).toBe(6);
      expect(COSTS[STORAGE_SILO_TYPE]?.stats?.capacity).toEqual(SILO_CAPACITY);
      expect(COSTS[STORAGE_SILO_TYPE]?.stats?.capacity.at(-1)).toBe(3_840_000);
      expect(COSTS[STORAGE_SILO_TYPE]?.stats?.produce).toEqual([]);
      expect(COSTS[STORAGE_SILO_TYPE]?.stats?.cycleTime).toEqual([]);
      expect(productionOf(STORAGE_SILO_TYPE)).toBeUndefined();
    });

    test("siloCapacity reads the level the client reads", () => {
      // `BASE.CalcResources` sums `capacity[l - 1]` over finished silos
      // (`client/scripts/BASE.as:4705-4828`).
      expect(siloCapacity(1)).toBe(7_500);
      expect(siloCapacity(10)).toBe(3_840_000);

      // A silo still building is level 0 and adds nothing.
      expect(siloCapacity(0)).toBe(0);
      expect(siloCapacity(11)).toBe(0);
      expect(siloCapacity(-1)).toBe(0);

      // The sandbox yard's six level 10 silos, which is the 23,050,000 cap the
      // audit derives for it.
      expect(10_000 + 6 * siloCapacity(10)).toBe(23_050_000);
    });

    test("no other row carries stats", () => {
      const statted = BUILDING_COST_ROWS.filter((row) => row[6] !== undefined).map(([type]) => type);
      expect(statted).toEqual([1, 2, 3, 4, STORAGE_SILO_TYPE]);

      // The props file spells `capacity` and `produce` on four other entries,
      // none of them a resource amount: the Flinger's payload
      // (`YARD_PROPS.as:709`), Monster Housing's rooms (`:1659`), the Wild
      // Monster Baiter's monsters (`:1961-1962`) and the Monster Bunker's
      // garrison (`:2483`). Reading any of them as storage would be a category
      // error, so the generator leaves them out.
      for (const type of [5, 15, 19, 22]) {
        expect(costOf(type)?.stats, `type ${type}`).toBeUndefined();
        expect(productionOf(type), `type ${type}`).toBeUndefined();
      }
      expect(productionOf(99999)).toBeUndefined();
    });

    test("every stats entry is a positive integer", () => {
      for (const [type, , , , , , stats] of BUILDING_COST_ROWS) {
        if (!stats) continue;
        for (const [key, ladder] of Object.entries(stats)) {
          for (const [index, value] of ladder.entries()) {
            expect(Number.isInteger(value), `type ${type} ${key} ${index}`).toBe(true);
            expect(value, `type ${type} ${key} ${index}`).toBeGreaterThan(0);
          }
        }
      }
    });
  });
});
