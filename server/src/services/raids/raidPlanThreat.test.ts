import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RAID_MAX_RAIDERS, RAID_THREAT_MAX, RAID_THREAT_STEPS } from "../../config/RaidThreatConfig.js";
import { Tribe } from "../../enums/Tribes.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import type { CombatBuildingDataMap, RaidEvent, ResourceAmounts } from "../../game-rules/combat/types.js";
import { bearingGap, raidSpawnsUntilOf } from "./raidDrops.js";
import { capRaidArmy, planRaid, RAID_VORG, RAID_ZAFREETI, type RaidPlan } from "./raidPlan.js";
import { pickRaidTribe } from "./raidTribe.js";

/** Beta 10: the planner at a threat (owner, 27 Nov 2026). */

const SANDBOX = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url)), "utf8"),
) as { buildingdata: CombatBuildingDataMap; resources: Partial<ResourceAmounts> };

const plan = (seed: number, threat?: number): RaidPlan => {
  const planned = planRaid({
    buildingdata: SANDBOX.buildingdata,
    resources: SANDBOX.resources,
    level: 30,
    preference: 0,
    seed,
    ...(threat === undefined ? {} : { threat }),
  });
  if (!planned) throw new Error("the sandbox yard always has a raid");
  return planned;
};

const count = (roster: Readonly<Record<string, number>>): number => Object.values(roster).reduce((a, b) => a + b, 0);

const landed = (events: readonly RaidEvent[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const event of events) {
    for (const [monster, n] of Object.entries(event.monsters)) out[monster] = (out[monster] ?? 0) + n;
  }
  return out;
};

const bearingOf = (event: RaidEvent): number => ((Math.atan2(event.y, event.x) * 180) / Math.PI + 360) % 360;

const seedFor = (tribe: Tribe): number => {
  for (let seed = 1; ; seed += 1) if (pickRaidTribe(mulberry32(seed)) === tribe) return seed;
};

const SEEDS = [seedFor(Tribe.LEGIONNAIRE), seedFor(Tribe.KOZU), seedFor(Tribe.ABUNAKKI), seedFor(Tribe.DREADNAUT)];

describe("planRaid at a threat", () => {
  test("threat 0 is exactly the raid planned with no threat (before beta 10)", () => {
    for (const seed of SEEDS) {
      const before = plan(seed);
      const zero = plan(seed, 0);
      expect(zero.log).toEqual(before.log);
      expect(zero.army).toEqual(before.army);
      expect(zero.bearing).toBe(before.bearing);
      expect(zero.champion).toBeUndefined();
      expect(raidSpawnsUntilOf(zero.log.events)).toBe(0);
    }
  });

  test("every monster the plan lists lands, once", () => {
    for (const seed of SEEDS) {
      for (const threat of [0, 3, 6, 10, RAID_THREAT_MAX]) {
        const planned = plan(seed, threat);
        expect(landed(planned.log.events)).toEqual(planned.army);
      }
    }
  });

  test("a higher threat brings more monsters, up to the cap", () => {
    for (const seed of SEEDS) {
      let last = 0;
      for (let threat = 0; threat <= RAID_THREAT_MAX; threat += 1) {
        const size = count(plan(seed, threat).army);
        expect(size).toBeGreaterThanOrEqual(last);
        expect(size).toBeLessThanOrEqual(RAID_MAX_RAIDERS);
        last = size;
      }
      expect(count(plan(seed, RAID_THREAT_MAX).army)).toBeGreaterThan(count(plan(seed, 0).army));
    }
  });

  test("the sides grow with the table, the first the least-defended way in, all 90 degrees apart", () => {
    for (const seed of SEEDS) {
      for (let threat = 0; threat <= RAID_THREAT_MAX; threat += 1) {
        const planned = plan(seed, threat);
        const sides = planned.sides!;
        expect(sides).toHaveLength(RAID_THREAT_STEPS[threat]!.sides);
        expect(sides[0]).toBe(plan(seed).bearing);
        for (let one = 0; one < sides.length; one += 1) {
          for (let other = one + 1; other < sides.length; other += 1) {
            expect(bearingGap(sides[one]!, sides[other]!)).toBeGreaterThanOrEqual(90);
          }
        }
      }
    }
  });

  test("monsters land on every side (Kozu fans out from each)", () => {
    for (const seed of SEEDS) {
      const planned = plan(seed, 10);
      const sides = planned.sides!;
      for (const side of sides) {
        const near = planned.log.events.filter(
          (event) => !event.champion && bearingGap(bearingOf(event), side) <= 45,
        );
        expect(near.length).toBeGreaterThan(0);
      }
    }
  });

  test("groups land over time once the table says so", () => {
    for (const seed of SEEDS) {
      const planned = plan(seed, 6);
      const step = RAID_THREAT_STEPS[6]!;
      const times = new Set(planned.log.events.filter((event) => !event.retreat).map((event) => event.t));
      expect(times.size).toBe(step.sides * step.drops);
      expect(raidSpawnsUntilOf(planned.log.events)).toBeGreaterThan(0);
    }
  });

  test("every raider left leaves the table's seconds after the last group (none at threat 0)", () => {
    for (const seed of SEEDS) {
      expect(plan(seed, 0).log.events.some((event) => event.retreat)).toBe(false);
      for (const threat of [1, 6, RAID_THREAT_MAX]) {
        const events = plan(seed, threat).log.events;
        const retreats = events.filter((event) => event.retreat);
        expect(retreats).toHaveLength(1);
        expect(retreats[0]!.t).toBe(raidSpawnsUntilOf(events) + RAID_THREAT_STEPS[threat]!.retreatSeconds * 80);
        expect(events.at(-1)).toBe(retreats[0]!);
      }
    }
  });

  test("Vorgs and Zafreetis come once their share is above 0", () => {
    // Vorgs from 6, Zafreetis from 8 (owner, 27 Nov 2026).
    const vorgsFrom = RAID_THREAT_STEPS.findIndex((step) => step.vorgShare > 0);
    const zafreetisFrom = RAID_THREAT_STEPS.findIndex((step) => step.zafreetiShare > 0);
    expect([vorgsFrom, zafreetisFrom]).toEqual([6, 8]);
    for (const seed of SEEDS) {
      const low = plan(seed, vorgsFrom - 1).army;
      expect(low[RAID_VORG]).toBeUndefined();
      expect(low[RAID_ZAFREETI]).toBeUndefined();
      const vorgs = plan(seed, vorgsFrom).army;
      expect(vorgs[RAID_VORG]).toBeGreaterThanOrEqual(1);
      expect(vorgs[RAID_ZAFREETI]).toBeUndefined();
      const both = plan(seed, zafreetisFrom).army;
      expect(both[RAID_VORG]).toBeGreaterThanOrEqual(1);
      expect(both[RAID_ZAFREETI]).toBeGreaterThanOrEqual(1);
    }
  });

  test("one random champion from its step on, at the table's level, the same for a seed", () => {
    const championFrom = RAID_THREAT_STEPS.findIndex((step) => step.championLevel > 0);
    expect(championFrom).toBeGreaterThan(0);
    const types = new Set<number>();
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(plan(seed, championFrom - 1).champion).toBeUndefined();
      const planned = plan(seed, RAID_THREAT_MAX);
      const step = RAID_THREAT_STEPS[RAID_THREAT_MAX]!;
      expect(planned.champion).toEqual(expect.objectContaining({ l: step.championLevel, pl: step.championPower }));
      expect(planned.log.events.filter((event) => event.champion)).toHaveLength(1);
      expect(plan(seed, RAID_THREAT_MAX).champion).toEqual(planned.champion!);
      types.add(planned.champion!.t);
    }
    expect([...types].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("capRaidArmy", () => {
  test("an army over the cap shrinks in proportion, none of a type lost", () => {
    const capped = capRaidArmy({ C1: 600, C2: 300, C16: 1 }, 300);
    // 199.8 and 99.9 round up on their remainders; the lone Vorg is kept.
    expect(capped).toEqual({ C1: 200, C2: 100, C16: 1 });
    expect(capped.C16).toBe(1);
    expect(capRaidArmy({ C1: 5 }, 300)).toEqual({ C1: 5 });
  });
});
