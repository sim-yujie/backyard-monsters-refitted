import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { replayRaid } from "../../game-rules/combat/replay.js";
import type { CombatBuildingDataMap, ResourceAmounts } from "../../game-rules/combat/types.js";
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
  const input = { buildingdata: BUILDINGDATA, resources: SANDBOX.resources, log: plan.log, hitLimit: plan.hitLimit };
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

  test("the health share leaves walls and traps out and stays in 0..1", () => {
    for (const { outcome } of fights) {
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
