import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Tribe } from "../../enums/Tribes.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { replayRaid } from "../../game-rules/combat/replay.js";
import { RAID_MAX_SECONDS, ticks } from "../../game-rules/combat/stats.js";
import type { CombatBuildingDataMap, ResourceAmounts } from "../../game-rules/combat/types.js";
import { DEGREES } from "./raidDirection.js";
import { RAID_LANDING_LIMIT, SWARM_SPACING_DEGREES, planRaid, raidLanding, type RaidPlan } from "./raidPlan.js";
import { RAID_TRIBES, pickRaidTribe } from "./raidTribe.js";

const SANDBOX = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url)), "utf8"),
) as { buildingdata: CombatBuildingDataMap; resources: Partial<ResourceAmounts> };

const plan = (seed: number, overrides: { level?: number; preference?: -1 | 0 | 1 } = {}): RaidPlan => {
  const planned = planRaid({
    buildingdata: SANDBOX.buildingdata,
    resources: SANDBOX.resources,
    level: overrides.level ?? 20,
    preference: overrides.preference ?? 0,
    seed,
  });
  if (!planned) throw new Error("the sandbox yard always has a raid");
  return planned;
};

/** Seeds whose first draw is each tribe. */
const seedFor = (tribe: Tribe): number => {
  for (let seed = 1; ; seed += 1) if (pickRaidTribe(mulberry32(seed)) === tribe) return seed;
};

/** How far a disc of screen radius r reaches along a yard axis (`raidPlan.ts`). */
const REACH = Math.sqrt(1.25);

describe("pickRaidTribe", () => {
  test("random, one of the four, for everyone", () => {
    const seen = new Set<Tribe>();
    for (let seed = 1; seed <= 200; seed += 1) seen.add(pickRaidTribe(mulberry32(seed)));
    expect([...seen].sort()).toEqual([...RAID_TRIBES].sort());
  });

  test("the plan's tribe is its seed's first draw", () => {
    for (const seed of [1, 2, 3, 4, 5]) expect(plan(seed).tribe).toBe(pickRaidTribe(mulberry32(seed)));
  });
});

describe("raidLanding", () => {
  test("a disc well inside the grid is left where it is", () => {
    expect(raidLanding(45, 900, 100)).toEqual({ x: 636, y: 636, r: 100 });
  });

  test("a disc reaching past the grid is pulled in along its bearing", () => {
    const landing = raidLanding(0, 1100, 300);
    expect(landing).toEqual({ x: Math.round(RAID_LANDING_LIMIT - REACH * 300), y: 0, r: 300 });
  });

  test("one that would have to come inside the 800 ring is made smaller instead", () => {
    const landing = raidLanding(0, 1400, 600);
    expect(landing.x).toBe(800);
    expect(landing.r).toBe(Math.round((RAID_LANDING_LIMIT - 800) / REACH));
  });
});

describe("planRaid", () => {
  test("the same input and seed give the same plan", () => {
    expect(plan(42)).toEqual(plan(42));
  });

  test("the choice scales the army", () => {
    const size = (preference: -1 | 0 | 1) =>
      Object.values(plan(seedFor(Tribe.LEGIONNAIRE), { preference }).army).reduce((sum, count) => sum + count, 0);
    expect(size(1)).toBeGreaterThan(size(0));
    expect(size(0)).toBeGreaterThan(size(-1));
  });

  test("the log carries the whole army, every raider at tick 0, on its own seed", () => {
    for (const tribe of RAID_TRIBES) {
      const planned = plan(seedFor(tribe));
      expect(planned.log.v).toBe(1);
      expect(planned.log.seed).toBe(seedFor(tribe));
      const landed: Record<string, number> = {};
      for (const event of planned.log.events) {
        expect(event.kind).toBe("raid");
        expect(event.t).toBe(0);
        for (const [monster, count] of Object.entries(event.monsters)) landed[monster] = (landed[monster] ?? 0) + count;
      }
      expect(landed).toEqual({ ...planned.army });
    }
  });

  test("every landing disc stays on the pathing grid and outside the 800 ring", () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      for (const event of plan(seed, { level: 40 }).log.events) {
        expect(Math.abs(event.x) + REACH * event.r).toBeLessThanOrEqual(RAID_LANDING_LIMIT + 1);
        expect(Math.abs(event.y) + REACH * event.r).toBeLessThanOrEqual(RAID_LANDING_LIMIT + 1);
        expect(Math.hypot(event.x, event.y)).toBeGreaterThanOrEqual(799);
      }
    }
  });

  test("one disc per type on the bearing, centred 800 + d/2 out, d/2 across", () => {
    const planned = plan(seedFor(Tribe.LEGIONNAIRE));
    expect(planned.log.events).toHaveLength(Object.keys(planned.army).length);
    for (const event of planned.log.events) {
      const out = Math.hypot(event.x, event.y);
      expect(Math.abs(out - (800 + event.r))).toBeLessThanOrEqual(1.5);
      expect(Math.atan2(event.y, event.x) / DEGREES).toBeCloseTo(((planned.bearing + 180) % 360) - 180, 0);
    }
  });

  test("Kozu comes in threes, each three 8 degrees further round, the leftovers with the last", () => {
    const planned = plan(seedFor(Tribe.KOZU));
    expect(planned.tribe).toBe(Tribe.KOZU);
    for (const monster of Object.keys(planned.army)) {
      const waves = planned.log.events.filter((event) => event.monsters[monster] !== undefined);
      const count = planned.army[monster] ?? 0;
      const full = Math.trunc(count / 3);
      expect(waves.slice(0, full).every((event) => event.monsters[monster] === 3)).toBe(true);
      expect(waves.length).toBe(full + (count % 3 > 0 ? 1 : 0));
      waves.slice(0, full).forEach((event, index) => {
        const expected = planned.bearing + SWARM_SPACING_DEGREES * (index + 1);
        const angle = Math.atan2(event.y, event.x) / DEGREES;
        expect(Math.abs((((angle - expected) % 360) + 540) % 360 - 180)).toBeLessThan(0.5);
      });
    }
  });

  test("an empty yard plans no raid", () => {
    expect(planRaid({ buildingdata: {}, level: 20, preference: 0, seed: 1 })).toBeNull();
  });

  test("the engine fights the planned log: every raider lands, and the raid ends by its cap", () => {
    const planned = plan(seedFor(Tribe.LEGIONNAIRE));
    const outcome = replayRaid({
      buildingdata: SANDBOX.buildingdata,
      resources: SANDBOX.resources,
      log: planned.log,
    });
    expect(outcome.creepsFlung).toBe(Object.values(planned.army).reduce((sum, count) => sum + count, 0));
    expect(outcome.damage).toBeGreaterThan(0);
    expect(outcome.ticks).toBeLessThanOrEqual(ticks(RAID_MAX_SECONDS));
  });
});
