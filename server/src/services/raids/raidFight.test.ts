import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { replayRaid } from "../../game-rules/combat/replay.js";
import type { CombatBuildingDataMap, RaidEvent, ResourceAmounts } from "../../game-rules/combat/types.js";
import { fightRaid, fightSecondsOf } from "./raidFight.js";
import { planRaid } from "./raidPlan.js";

/**
 * The raid's fight on the server (#226 WP3): the same battle `replayRaid`
 * fights, plus the split of what was stolen between the bank and each
 * harvester's unbanked amount, and the yard's health share.
 */

const SANDBOX = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url)), "utf8"),
) as { buildingdata: CombatBuildingDataMap; resources: Partial<ResourceAmounts> };

/** The sandbox with every harvester holding something unbanked, so raiders can drain them. */
const BUILDINGDATA: CombatBuildingDataMap = Object.fromEntries(
  Object.entries(SANDBOX.buildingdata).map(([key, building]) => [
    key,
    [1, 2, 3, 4].includes(Number(building.t)) ? { ...building, st: 4000 } : building,
  ]),
);

const fightFor = (seed: number) => {
  const plan = planRaid({ buildingdata: BUILDINGDATA, resources: SANDBOX.resources, level: 20, preference: 1, seed });
  if (!plan) throw new Error("the sandbox yard always has a raid");
  const input = { buildingdata: BUILDINGDATA, resources: SANDBOX.resources, log: plan.log };
  return { plan, input, outcome: fightRaid(input) };
};

const SEEDS = [1, 2, 3, 4];
const fights = SEEDS.map(fightFor);

describe("fightRaid", () => {
  test("fights the very battle replayRaid fights", () => {
    for (const { input, outcome } of fights) {
      const replayed = replayRaid(input);
      expect(outcome.digest).toBe(replayed.digest);
      expect(outcome.ticks).toBe(replayed.ticks);
      expect(outcome.health).toEqual(replayed.health);
      expect(outcome.defenderLoss).toEqual(replayed.defenderLoss);
      expect(outcome.damage).toBe(replayed.damage);
      expect([...outcome.firedTraps]).toEqual([...replayed.firedTraps]);
    }
  });

  test("what was stolen is the bank's part and the harvesters' together", () => {
    for (const { outcome } of fights) {
      const fromHarvesters: Record<string, number> = { r1: 0, r2: 0, r3: 0, r4: 0 };
      for (const [id, gave] of Object.entries(outcome.harvesterLoss)) {
        const type = Number(BUILDINGDATA[id]?.t);
        fromHarvesters[`r${type}`]! += gave;
        expect(gave).toBeGreaterThan(0);
        expect(gave).toBeLessThanOrEqual(4000);
      }
      for (const key of ["r1", "r2", "r3", "r4"] as const) {
        expect(outcome.bankLoss[key] + fromHarvesters[key]!).toBe(outcome.defenderLoss[key]);
      }
    }
    expect(fights.some(({ outcome }) => Object.keys(outcome.harvesterLoss).length > 0)).toBe(true);
  });

  test("the health share is what the attack's damage percentage leaves, in 0..1", () => {
    for (const { outcome } of fights) {
      expect(outcome.healthShare).toBeCloseTo(1 - outcome.damage / 100, 12);
      expect(outcome.healthShare).toBeGreaterThanOrEqual(0);
      expect(outcome.healthShare).toBeLessThanOrEqual(1);
    }
    const untouched = fightRaid({ ...fights[0]!.input, log: { v: 1, seed: 1, events: [] } });
    expect(untouched.healthShare).toBe(1);
    expect(untouched.harvesterLoss).toEqual({});
  });

  test("the fight's length is its ticks at 80 a second", () => {
    expect(fightSecondsOf({ ticks: 800 })).toBe(10);
    for (const { outcome } of fights) expect(fightSecondsOf(outcome)).toBeLessThanOrEqual(600);
  });
});

/** Beta 10: wild champions and groups landing over time. */
describe("fightRaid: beta 10 raids", () => {
  const champion = (t: number, l = 3) => ({
    kind: "raid" as const,
    t: 0,
    x: 900,
    y: 0,
    r: 50,
    monsters: {},
    champion: { t, l, pl: 1, leave: 120 * 80 },
  });

  test("each wild champion lands, fights and leaves when its time is up, not at the cap", () => {
    for (const t of [1, 2, 3, 4]) {
      const input = { buildingdata: BUILDINGDATA, resources: SANDBOX.resources, log: { v: 1 as const, seed: 9, events: [champion(t)] } };
      const outcome = fightRaid(input);
      expect(outcome.creepsFlung).toBe(1);
      // It hurt the yard.
      expect(outcome.healthShare).toBeLessThan(1);
      // Over by the time it leaves (120 s), or sooner when it fell.
      expect(fightSecondsOf(outcome)).toBeLessThanOrEqual(120.1);
      const replayed = replayRaid(input);
      expect(outcome.digest).toBe(replayed.digest);
      expect(outcome.ticks).toBe(replayed.ticks);
    }
  }, 60_000);

  test("the yard's caged champion fights a wild one", () => {
    const events = [champion(1, 1)];
    const alone = fightRaid({ buildingdata: BUILDINGDATA, resources: SANDBOX.resources, log: { v: 1, seed: 9, events } });
    const guarded = fightRaid({
      buildingdata: BUILDINGDATA,
      resources: SANDBOX.resources,
      log: { v: 1, seed: 9, events },
      defence: { bunkers: {}, defenderLevels: {}, defenderChampions: [{ t: 4, l: 6, hp: 1_000_000, pl: 3 }] },
    });
    expect(guarded.defenderChampions).toHaveLength(1);
    // The caged Korath took hits from the wild Gorgo, so the fight went otherwise.
    expect(guarded.digest).not.toBe(alone.digest);
    expect(guarded.defenderChampions[0]!.hp).toBeLessThan(1_000_000);
  });

  test("a raid does not end between groups: the later one still lands", () => {
    // One Pokey now, which the towers kill; another group 30 s later.
    const events: RaidEvent[] = [
      { kind: "raid" as const, t: 0, x: 900, y: 0, r: 20, monsters: { C1: 1 } },
      { kind: "raid" as const, t: 2400, x: -900, y: 0, r: 20, monsters: { C2: 3 } },
    ];
    const input = { buildingdata: BUILDINGDATA, resources: SANDBOX.resources, log: { v: 1 as const, seed: 3, events } };
    const outcome = fightRaid(input);
    expect(outcome.creepsFlung).toBe(4);
    expect(outcome.ticks).toBeGreaterThan(2400);
    const replayed = replayRaid(input);
    expect(outcome.digest).toBe(replayed.digest);
    expect(outcome.ticks).toBe(replayed.ticks);
  });

  test("the retreat wave sends every raider home and ends the raid then", () => {
    const events: RaidEvent[] = [
      { kind: "raid", t: 0, x: 900, y: 0, r: 60, monsters: { C10: 40 } },
      { kind: "raid", t: 800, x: 0, y: 0, r: 0, monsters: {}, retreat: true },
    ];
    const input = { buildingdata: BUILDINGDATA, resources: SANDBOX.resources, log: { v: 1 as const, seed: 4, events } };
    const outcome = fightRaid(input);
    expect(outcome.creepsFlung).toBe(40);
    expect(outcome.creepsKilled).toBeLessThan(40);
    expect(outcome.ticks).toBeGreaterThanOrEqual(800);
    expect(outcome.ticks).toBeLessThanOrEqual(802);
    expect(outcome.digest).toBe(replayRaid(input).digest);
  });

  test("a top-threat raid fights the same on the server as in its replay", () => {
    for (const seed of [1, 2]) {
      const plan = planRaid({ buildingdata: BUILDINGDATA, resources: SANDBOX.resources, level: 30, preference: 0, seed, threat: 12 });
      if (!plan) throw new Error("the sandbox yard always has a raid");
      const input = { buildingdata: BUILDINGDATA, resources: SANDBOX.resources, log: plan.log };
      const outcome = fightRaid(input);
      const flung = Object.values(plan.army).reduce((a, b) => a + b, 0) + (plan.champion ? 1 : 0);
      expect(outcome.creepsFlung).toBe(flung);
      expect(outcome.digest).toBe(replayRaid(input).digest);
    }
    // Two 400-raider fights, each twice: a few seconds on a CI runner.
  }, 60_000);
});
