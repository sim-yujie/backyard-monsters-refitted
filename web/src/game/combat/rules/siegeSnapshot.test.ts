import { describe, expect, it } from "vitest";
import { createBattle } from "./engine";
import type { AttackEvent, BattleOptions } from "./engine";
import { decoyPlan, DECOY_FALL_TICKS } from "./decoy";
import { jarsPlan } from "./jars";
import { vacuumPlan } from "./vacuum";
import { buildEngineYard } from "./yard";
import type { CombatBuildingDataMap } from "./types";

/**
 * `Battle.siege()` (Inferno WP 6.8): what the renderer and the siege button
 * read of the weapon on the field. It only reports what the Decoy, Vacuum and
 * Jars blocks already hold, so these follow one weapon of each from the drop
 * to the end.
 */

const hall = { id: 1, t: 14, l: 1, X: 820, Y: 820 };
const sniper = { id: 2, t: 21, l: 4, X: 700, Y: 700 };

const battleOf = (siege: BattleOptions["siege"], extra: CombatBuildingDataMap = {}) => {
  const yard = buildEngineYard({
    buildingdata: { "1": hall, ...extra },
    buildinghealthdata: {},
    resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
  });
  return createBattle(yard, { seed: 3, ...(siege ? { siege } : {}) });
};

const drop = (weapon: string, x = 500, y = 500): AttackEvent => ({ kind: "siege", t: 0, x, y, weapon });

describe("the siege snapshot", () => {
  it("is empty with no weapon out, and for a weapon with no level", () => {
    const empty = { active: null, decoy: null, vacuum: null, jars: [] };
    const plain = battleOf(undefined);
    expect(plain.siege()).toEqual(empty);
    plain.apply(drop("decoy"));
    expect(plain.siege()).toEqual(empty);
  });

  it("follows the Decoy from the drop until it blows up", () => {
    const battle = battleOf({ decoy: 2 });
    battle.apply(drop("decoy", 480, 520));
    const plan = decoyPlan(2, 0)!;
    expect(battle.siege()).toEqual({
      active: "decoy",
      decoy: {
        x: 480,
        y: 520,
        droppedAt: 0,
        landsAt: DECOY_FALL_TICKS,
        explodesAt: plan.explodesAt,
        range: plan.range,
      },
      vacuum: null,
      jars: [],
    });
    battle.runTo(plan.explodesAt - 1);
    expect(battle.siege().active).toBe("decoy");
    battle.runTo(plan.explodesAt + 1);
    expect(battle.siege()).toMatchObject({ active: null, decoy: null });
  });

  it("follows the Vacuum's hose over the Town Hall until its time runs out", () => {
    const battle = battleOf({ vacuum: 1 });
    battle.apply(drop("vacuum"));
    const plan = vacuumPlan(1, 0)!;
    expect(battle.siege()).toMatchObject({
      active: "vacuum",
      vacuum: { buildingId: 1, droppedAt: 0, endsAt: plan.endsAt, health: plan.durability, durability: plan.durability },
    });
    battle.runTo(plan.endsAt + 1);
    expect(battle.siege()).toMatchObject({ active: null, vacuum: null });
  });

  it("shows each jar falling, landed with its health, and gone once its strip ends", () => {
    const battle = battleOf({ jars: 1 }, { "2": sniper });
    battle.apply(drop("jars", 700, 700));
    const plan = jarsPlan(1, 0)!;
    expect(battle.siege()).toMatchObject({
      active: "jars",
      jars: [{ buildingId: 2, landsAt: plan.landsAt, frame: 0, breaking: false, health: null, durability: 2000 }],
    });
    battle.runTo(plan.landsAt + 1);
    expect(battle.siege().jars[0]?.health).toBe(2000);
    // Nothing shoots this jar (no monsters), so it stays whole.
    battle.runTo(plan.landsAt + 200);
    expect(battle.siege().jars).toHaveLength(1);
    expect(battle.siege().active).toBe("jars");
  });

  it("is a fresh copy each call", () => {
    const battle = battleOf({ jars: 1 }, { "2": sniper });
    battle.apply(drop("jars", 700, 700));
    expect(battle.siege()).not.toBe(battle.siege());
    expect(battle.siege().jars).not.toBe(battle.siege().jars);
  });
});
