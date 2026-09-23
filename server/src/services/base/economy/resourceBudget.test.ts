import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COSTS } from "../../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";
import {
  baseValueOf,
  bufferCeiling,
  harvestAllowance,
  instantCost,
  outpostAllowance,
  packingMultiplier,
  refundOf,
  slackFor,
  storageCap,
  timeCost,
  topupCost,
} from "./resourceBudget.js";

/**
 * The arithmetic the delta budget and the derived fields rest on, checked
 * against the sandbox yard the web client's tests use: 575 buildings, a level
 * 10 Town Hall, 400 walls at level 1, six of each harvester at level 1 with a
 * full 720 buffer, six level 10 silos
 * (`docs/design/yard-planner-phase1-remainder.md` §4.1).
 */

const FIXTURE = "../../../../../web/test/fixtures/baseload-sandbox-yard.json";

interface Fixture {
  buildingdata: BuildingDataMap;
  buildinghealthdata: Record<string, number>;
  resources: Record<string, number>;
  storedata: Record<string, { q?: number; e?: number }>;
}

const loadFixture = (): Fixture =>
  JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));

/** A fresh, mutable copy of the fixture's yard. */
const sandbox = (): BuildingDataMap => structuredClone(loadFixture().buildingdata);

/** A hand-built building, with the coordinates every row needs and nothing else. */
const at = (over: Partial<BuildingData> & { t: number; id: number }): BuildingData => ({
  x: 0,
  y: 0,
  ...over,
});

describe("timeCost", () => {
  test("a job of five minutes or less is free", () => {
    expect(timeCost(0)).toBe(0);
    expect(timeCost(300)).toBe(0);
  });

  test("the linear term wins below the crossing point", () => {
    // 20 shiny an hour, rounded up.
    expect(timeCost(3600)).toBe(20);
    expect(timeCost(301)).toBe(2);
  });

  test("the square-root term caps the price above it", () => {
    // int(sqrt(86400 * 0.8)) = 262, below the linear term's 480.
    expect(timeCost(86400)).toBe(262);
  });

  test("the two terms cross at two hundred minutes", () => {
    // Where ceil(t * 20 / 3600) meets int(sqrt(t * 0.8)): both 144 at 25,920 s.
    expect(timeCost(25920)).toBe(144);
  });
});

describe("instantCost", () => {
  test("prices a step from its first three resources and its time", () => {
    // Cannon Tower costs[0] = 2,000 / 1,500 / 500 over 30 s. The time is inside
    // the free window, so only the resource term counts:
    // int(ceil(pow(sqrt(4000 / 2), 0.75)) * 0.95) = int(18 * 0.95) = 17.
    expect(instantCost(COSTS[20]!.costs[0])).toBe(17);
  });

  test("adds the time term once the step is slow enough to cost shiny", () => {
    // Twig Snapper costs[7]: 135,000 r2 over 86,400 s.
    expect(instantCost(COSTS[1]!.costs[7])).toBe(310);
  });

  test("an absent step is free", () => {
    expect(instantCost(undefined)).toBe(0);
  });
});

describe("topupCost", () => {
  test("prices the whole shortfall through the resource curve", () => {
    // ceil(pow(sqrt(10000 / 2), 0.75)) = 25.
    expect(topupCost({ r1: 10000, r2: 0, r3: 0, r4: 0 })).toBe(25);
  });

  test("sums the shortfall across resources", () => {
    expect(topupCost({ r1: 4000, r2: 4000, r3: 2000, r4: 0 })).toBe(
      topupCost({ r1: 10000, r2: 0, r3: 0, r4: 0 })
    );
  });
});

describe("bufferCeiling", () => {
  test("a level 1 harvester fills its 720 buffer in an hour and stops", () => {
    // 2 per 10 s would be 722 over 3,600 s; the buffer caps it at 720.
    expect(bufferCeiling(1, 1, 0, 3600)).toBe(720);
  });

  test("a whole cycle is allowed on top of the elapsed time", () => {
    // 60 s is six cycles of 2, plus the cycle that was already part way through.
    expect(bufferCeiling(1, 1, 0, 60)).toBe(14);
  });

  test("a full buffer stays full", () => {
    expect(bufferCeiling(1, 1, 720, 3600)).toBe(720);
  });

  test("a level 10 harvester produces 56 a cycle", () => {
    expect(bufferCeiling(1, 10, 0, 3600)).toBe(361 * 56);
  });

  test("anything that is not a harvester produces nothing", () => {
    expect(bufferCeiling(20, 1, 0, 3600)).toBe(0);
    expect(bufferCeiling(6, 10, 0, 3600)).toBe(0);
  });
});

describe("harvestAllowance", () => {
  test("credits what left the buffer", () => {
    const stored: BuildingDataMap = { "1": at({ t: 1, id: 1, st: 720 }) };
    const submitted: BuildingDataMap = { "1": at({ t: 1, id: 1, st: 0 }) };

    expect(harvestAllowance(stored, submitted, 3600).allowance.r1).toBe(720);
  });

  test("credits nothing when the buffer did not move", () => {
    const yard: BuildingDataMap = { "1": at({ t: 1, id: 1, st: 720 }) };

    expect(harvestAllowance(yard, structuredClone(yard), 3600).allowance.r1).toBe(0);
  });

  test("credits the whole ceiling when the harvester is gone", () => {
    const stored: BuildingDataMap = { "1": at({ t: 1, id: 1, st: 720 }) };

    expect(harvestAllowance(stored, {}, 3600).allowance.r1).toBe(720);
  });

  test("uses the higher of the two levels, so an upgrade this save is never a violation", () => {
    const stored: BuildingDataMap = { "1": at({ t: 1, id: 1, st: 0 }) };
    const submitted: BuildingDataMap = { "1": at({ t: 1, id: 1, l: 10, st: 0 }) };

    expect(harvestAllowance(stored, submitted, 3600).allowance.r1).toBe(361 * 56);
  });

  test("a harvester type fills its own resource", () => {
    const stored: BuildingDataMap = {
      "1": at({ t: 3, id: 1, st: 720 }),
      "2": at({ t: 4, id: 2, st: 720 }),
    };

    const { allowance } = harvestAllowance(stored, {}, 3600);
    expect(allowance).toEqual({ r1: 0, r2: 0, r3: 720, r4: 720 });
  });

  test("reports a buffer above what the harvester could have produced", () => {
    const stored: BuildingDataMap = { "1": at({ t: 1, id: 1, st: 0 }) };
    const submitted: BuildingDataMap = { "1": at({ t: 1, id: 1, st: 500 }) };

    const { overfull, allowance } = harvestAllowance(stored, submitted, 60);
    expect(overfull).toEqual([{ id: 1, sent: 500, max: 14 }]);
    expect(allowance.r1).toBe(0);
  });

  test("over the fixture, six full level 1 harvesters bank 720 each", () => {
    const stored = sandbox();
    const emptied = sandbox();
    for (const building of Object.values(emptied)) {
      if (Number(building.t) <= 4) building.st = 0;
    }

    const { allowance } = harvestAllowance(stored, emptied, 60);
    expect(allowance).toEqual({ r1: 4320, r2: 4320, r3: 4320, r4: 4320 });
  });
});

describe("outpostAllowance", () => {
  test("credits the gross income per ten seconds over the gap", () => {
    const income = { b12: { r1: 10, r2: 0, r3: 0, r4: 5 }, t: 1_700_000_000 };

    expect(outpostAllowance(income, 3600, 1)).toEqual({
      r1: 3600,
      r2: 0,
      r3: 0,
      r4: 1800,
    });
  });

  test("multiplies by the overdrive bound", () => {
    const income = { b12: { r1: 10, r2: 0, r3: 0, r4: 0 } };

    expect(outpostAllowance(income, 3600, 2).r1).toBe(7200);
  });

  test("clamps the gap at two days", () => {
    const income = { b12: { r1: 10, r2: 0, r3: 0, r4: 0 } };
    const twoDays = 60 * 60 * 24 * 2;

    expect(outpostAllowance(income, twoDays * 10, 1).r1).toBe(twoDays);
  });

  test("ignores the timestamp key and anything that is not an outpost", () => {
    expect(outpostAllowance({ t: 1_700_000_000, nonsense: { r1: 999 } }, 3600, 1)).toEqual({
      r1: 0,
      r2: 0,
      r3: 0,
      r4: 0,
    });
  });

  test("a yard with no outposts is allowed nothing", () => {
    expect(outpostAllowance({}, 3600, 2).r1).toBe(0);
    expect(outpostAllowance(null, 3600, 2).r1).toBe(0);
  });
});

describe("refundOf", () => {
  test("a build still in progress hands back all of the first step", () => {
    expect(refundOf(at({ t: 20, id: 1, cB: 10 }))).toEqual({
      r1: 2000,
      r2: 1500,
      r3: 500,
      r4: 0,
    });
  });

  test("a finished building hands back half of every step it paid", () => {
    // Cannon Tower levels 1 to 3: 2,000 + 10,000 + 50,000 twigs, halved.
    expect(refundOf(at({ t: 20, id: 1, l: 3 }))).toEqual({
      r1: 31000,
      r2: 23250,
      r3: 7750,
      r4: 0,
    });
  });

  test("floors each resource rather than the total", () => {
    // Silo costs[0] is 3,010 / 1,855: half of 1,855 is 927.5.
    expect(refundOf(at({ t: 6, id: 1, l: 1 })).r2).toBe(927);
  });

  test("a decoration hands back nothing; it returns to inventory", () => {
    expect(refundOf(at({ t: 57, id: 1, l: 1 }))).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  test("a type with no cost row hands back nothing", () => {
    expect(refundOf(at({ t: 9999, id: 1, l: 1 })).r1).toBe(0);
  });

  test("a legacy Stone Block is refunded on the Block ladder at level 2", () => {
    // Half of Block costs[0] + costs[1]: 1,000 twigs and 10,000 pebbles.
    expect(refundOf(at({ t: 18, id: 1 }))).toEqual({ r1: 500, r2: 5000, r3: 0, r4: 0 });
  });
});

describe("packingMultiplier", () => {
  test("is 1 with no Improved Packing Skills", () => {
    expect(packingMultiplier(null)).toBe(1);
    expect(packingMultiplier({})).toBe(1);
  });

  test("adds a tenth per purchase, clamped to two decimals", () => {
    expect(packingMultiplier({ BIP: { q: 3 } })).toBe(1.3);
    expect(packingMultiplier({ BIP: { q: 10 } })).toBe(2);
  });
});

describe("storageCap", () => {
  test("is the base pool plus every finished silo", () => {
    const fixture = loadFixture();

    // 10,000 + six level 10 silos at 3,840,000 each.
    expect(
      storageCap({
        buildingdata: fixture.buildingdata,
        storedata: fixture.storedata,
        outposts: [],
      })
    ).toBe(23050000);
  });

  test("ignores More Yardage, which buys room and not storage", () => {
    const fixture = loadFixture();

    expect(
      storageCap({ buildingdata: fixture.buildingdata, storedata: { ENL: { q: 6 } } })
    ).toBe(23050000);
  });

  test("doubles with full Improved Packing Skills", () => {
    const fixture = loadFixture();

    expect(
      storageCap({ buildingdata: fixture.buildingdata, storedata: { BIP: { q: 10 } } })
    ).toBe(46100000);
  });

  test("a silo still under construction adds nothing", () => {
    const yard: BuildingDataMap = { "1": at({ t: 6, id: 1, l: 10, cB: 5 }) };

    expect(storageCap({ buildingdata: yard })).toBe(10000);
  });

  test("each owned outpost adds two million", () => {
    expect(storageCap({ buildingdata: {}, outposts: [[1, 2, "3"], [4, 5, "6"]] })).toBe(
      10000 + 4000000
    );
  });

  test("an empty yard still holds the base pool", () => {
    expect(storageCap({})).toBe(10000);
  });
});

describe("baseValueOf", () => {
  test("is a tenth of the last step every finished building completed", () => {
    // One level 1 Block: 1,000 twigs over 5 s.
    expect(baseValueOf({ "1": at({ t: 17, id: 1 }) })).toBe(Math.ceil(0.1 * 1005));
  });

  test("counts walls", () => {
    const walls: BuildingDataMap = {};
    for (let id = 1; id <= 400; id++) walls[String(id)] = at({ t: 17, id });

    expect(baseValueOf(walls)).toBe(Math.ceil(0.1 * 400 * 1005));
  });

  test("skips decorations, traps, enemies and immovables", () => {
    const yard: BuildingDataMap = {
      "1": at({ t: 57, id: 1 }), // decoration
      "2": at({ t: 24, id: 2 }), // Booby Trap
      "3": at({ t: 53, id: 3 }), // Halloween pumpkin, immovable
    };

    expect(baseValueOf(yard)).toBe(0);
  });

  test("skips a building that has not finished its first build", () => {
    expect(baseValueOf({ "1": at({ t: 17, id: 1, cB: 3 }) })).toBe(0);
  });

  test("over the fixture it matches the hand sum of every counted row", () => {
    const yard = sandbox();

    let raw = 0;
    for (const building of Object.values(yard)) {
      const type = Number(building.t) === 18 ? 17 : Number(building.t);
      const row = COSTS[type];
      if (!row) continue;
      if (["decoration", "enemy", "immovable", "trap"].includes(row.kind)) continue;
      if (Number(building.cB) > 0) continue;

      const level = Number(building.l) > 0 ? Number(building.l) : 1;
      const step = row.costs[Math.min(level, row.costs.length) - 1];
      if (!step) continue;

      raw += step[0] + step[1] + step[2] + step[3] + step[4];
    }

    expect(raw).toBe(142427475);
    expect(baseValueOf(yard)).toBe(14242748);
  });
});

describe("slackFor", () => {
  test("is one unit at the smallest", () => {
    expect(slackFor(0)).toBe(1);
    expect(slackFor(50)).toBe(1);
  });

  test("is a hundredth of the production term above that", () => {
    expect(slackFor(4320)).toBe(43);
  });
});
