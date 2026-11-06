import { beforeEach, describe, expect, mock, test } from "bun:test";

import { experiencePoints } from "../../game-data/stats/experiencePoints.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * Moloch's emergence raids (`docs/design/inferno.md` §2.3, WP 1.9) against
 * Flash: the scale from the player's level and the five armies
 * (`INFERNO_PORTAL_ATTACK.as:8-49`), the raid strength (`WMATTACK.as:729-753`),
 * the plan the raid routes fight, the warning screen's groups, and the raid
 * opened for a raise.
 */

const redis = memoryRedis();
mock.module("../../server.js", () => ({ postgres: { em: {} }, redis }));

const {
  EMERGENCE_BEARING,
  MOLOCH_TRIBE,
  emergenceGroups,
  emergenceScale,
  emergenceStrength,
  emergenceWarningGroups,
  isEmergenceRaid,
  openEmergenceRaid,
  planEmergenceRaid,
} = await import("./emergenceRaid.js");
const { openRaid, readOpenRaid } = await import("../raids/raidStore.js");
const { raidLanding } = await import("../raids/raidPlan.js");

const USER = 52;
const NOW = 1_800_000_000;

/** The points that make a player exactly `level` (`calculateBaseLevel`). */
const pointsFor = (level: number): string => String(experiencePoints[level - 1]);

/** The groups as Flash's rows read: type, count, spread. */
const rows = (caveLevel: number, level: number) =>
  emergenceGroups(caveLevel, level).map((group) => [group.monster, group.count, group.spread]);

type Wave = { t: number; x: number; y: number; r: number; monsters: object; strength: number };

beforeEach(() => redis.clear());

describe("the army's scale from the player's level", () => {
  test("up to level 30: L/60 - 0.25, never below 0.01", () => {
    expect(emergenceScale(10)).toBe(0.01);
    expect(emergenceScale(15)).toBe(0.01);
    expect(emergenceScale(24)).toBeCloseTo(0.15, 10);
    expect(emergenceScale(30)).toBe(0.25);
  });

  test("past 30: (L-30)/16 + 0.25, held to 0.25-1", () => {
    expect(emergenceScale(31)).toBe(0.3125);
    expect(emergenceScale(38)).toBe(0.75);
    expect(emergenceScale(42)).toBe(1);
    expect(emergenceScale(46)).toBe(1);
    expect(emergenceScale(60)).toBe(1);
  });
});

describe("the five armies, as Flash's table", () => {
  test("at full scale (level 46) each raid is Flash's row, word for word", () => {
    expect(rows(1, 46)).toEqual([["IC1", 25, 400], ["IC1", 25, 400], ["IC2", 50, 500], ["IC3", 15, 300]]);
    expect(rows(2, 46)).toEqual([["IC1", 45, 400], ["IC2", 60, 500], ["IC3", 25, 300], ["IC5", 10, 500]]);
    expect(rows(3, 46)).toEqual([["IC1", 65, 400], ["IC2", 60, 500], ["IC7", 15, 300], ["IC5", 15, 400], ["IC4", 10, 600]]);
    expect(rows(4, 46)).toEqual([["IC2", 65, 500], ["IC6", 30, 300], ["IC3", 40, 500], ["IC5", 20, 500], ["IC7", 20, 350]]);
    expect(rows(5, 46)).toEqual([["IC2", 70, 600], ["IC7", 30, 300], ["IC5", 20, 500], ["IC6", 30, 300], ["IC8", 25, 700]]);
  });

  test("at level 38 (scale 0.75) the ceil and floor of each count are Flash's", () => {
    expect(rows(1, 38)).toEqual([["IC1", 19, 400], ["IC1", 19, 400], ["IC2", 37, 500], ["IC3", 11, 300]]);
    expect(rows(3, 38)).toEqual([["IC1", 49, 400], ["IC2", 45, 500], ["IC7", 11, 300], ["IC5", 11, 400], ["IC4", 8, 600]]);
    expect(rows(5, 38)).toEqual([["IC2", 53, 600], ["IC7", 22, 300], ["IC5", 15, 500], ["IC6", 23, 300], ["IC8", 18, 700]]);
  });

  test("a low player gets the ceil'd groups only: a group of none is left out (`:31-38`)", () => {
    expect(rows(1, 10)).toEqual([["IC1", 1, 400], ["IC1", 1, 400]]);
    expect(rows(2, 10)).toEqual([["IC1", 1, 400], ["IC2", 1, 500]]);
    expect(rows(5, 10)).toEqual([["IC2", 1, 600], ["IC5", 1, 500], ["IC6", 1, 300]]);
  });

  test("a cave level out of range is held to 1-5, as Flash held its index", () => {
    expect(rows(0, 46)).toEqual(rows(1, 46));
    expect(rows(9, 46)).toEqual(rows(5, 46));
  });
});

describe("the raid strength (WMATTACK.SpawnB)", () => {
  test("0.4, then up a tenth past 1M, 3M, 6M, 15M and 50M empire points", () => {
    const steps: [number, number][] = [
      [0, 0.4],
      [1_000_000, 0.4],
      [1_000_001, 0.5],
      [3_000_000, 0.5],
      [3_000_001, 0.6],
      [6_000_001, 0.7],
      [15_000_001, 0.8],
      [50_000_000, 0.8],
      [50_000_001, 0.9],
      [900_000_000, 0.9],
    ];
    for (const [points, strength] of steps) expect(emergenceStrength(points)).toBe(strength);
  });
});

describe("the plan", () => {
  test("one wave per group, all at once on bearing 186, landing as Flash's discs, each with the strength", () => {
    const plan = planEmergenceRaid({ caveLevel: 2, points: pointsFor(46), basevalue: "0", seed: 7 });
    // A level-46 player is past 50M empire points.
    expect(plan).toMatchObject({ tribe: MOLOCH_TRIBE, level: 2, bearing: EMERGENCE_BEARING, strength: 0.9 });
    expect(EMERGENCE_BEARING).toBe(186);
    expect(plan.army).toEqual({ IC1: 45, IC2: 60, IC3: 25, IC5: 10 });
    expect(plan.log.seed).toBe(7);
    const events = plan.log.events as readonly Wave[];
    expect(events.map((event) => event.monsters)).toEqual([{ IC1: 45 }, { IC2: 60 }, { IC3: 25 }, { IC5: 10 }]);
    const spreads = [400, 500, 300, 500];
    events.forEach((event, index) => {
      const spread = spreads[index]!;
      expect(event).toMatchObject({ kind: "raid", t: 0, strength: 0.9, ...raidLanding(186, 800 + spread / 2, spread / 2) });
    });
  });

  test("raid 1's two Spurtz groups add up in the army and stay two waves", () => {
    const plan = planEmergenceRaid({ caveLevel: 1, points: pointsFor(46), basevalue: "0", seed: 1 });
    expect(plan.army["IC1"]).toBe(50);
    expect(plan.log.events).toHaveLength(4);
  });

  test("the strength reads points and base value together", () => {
    const plan = planEmergenceRaid({ caveLevel: 1, points: "10000000", basevalue: "6000000", seed: 1 });
    expect(plan.strength).toBe(0.8);
    expect((plan.log.events as readonly Wave[]).every((event) => event.strength === 0.8)).toBe(true);
  });
});

describe("the raid opened for a raise", () => {
  test("in its warning, due at once, Moloch's, for the cave level reached", async () => {
    const raid = (await openEmergenceRaid(USER, { points: pointsFor(38), basevalue: "0" }, 4, NOW))!;
    expect(raid).toMatchObject({ phase: "warning", tribe: "moloch", attackAt: NOW, warned: 0 });
    expect(raid.plan).toMatchObject({ level: 4 });
    expect(await readOpenRaid(USER)).toEqual(raid);
    expect(isEmergenceRaid(raid)).toBe(true);
    expect(isEmergenceRaid({ tribe: "Kozu" })).toBe(false);
    expect(isEmergenceRaid(null)).toBe(false);
  });

  test("its warning screen shows Flash's groups in order, one card each", async () => {
    const raid = (await openEmergenceRaid(USER, { points: pointsFor(38), basevalue: "0" }, 1, NOW))!;
    expect(emergenceWarningGroups(raid)).toEqual([
      { monster: "IC1", count: 19 },
      { monster: "IC1", count: 19 },
      { monster: "IC2", count: 37 },
      { monster: "IC3", count: 11 },
    ]);
    expect(emergenceWarningGroups({ ...raid, tribe: "Kozu" })).toEqual([]);
  });

  test("not opened over another raid", async () => {
    await openRaid(USER, { id: "w1", phase: "warning", tribe: "Kozu", plan: {}, seed: 1, attackAt: NOW + 300, warned: 0 } as never, NOW);
    expect(await openEmergenceRaid(USER, { points: "0", basevalue: "0" }, 1, NOW)).toBeNull();
    expect((await readOpenRaid(USER))?.id).toBe("w1");
  });
});
