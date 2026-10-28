import { describe, expect, test } from "bun:test";
import { buildEngineYard, createBattle, type AttackEvent } from "../../../game-rules/combat/index.js";
import { JAR_TOWER_TYPES, jarsPlan } from "../../../game-rules/combat/jars.js";
import { strongholds } from "../../../game-data/tribes/v3/strongholds.js";

/**
 * Jars cap only the defences a player builds and the Map Room 3 strongholds'
 * Spurtz Cannons (owner, 28 Oct): the server's copy of the rules, which
 * replays attacks, must leave the Stronghold (138) alone exactly as the web
 * client's does, though Flash jarred it too. The client refuses a drop over no
 * jar tower, so an honest log never spends a jar on the Stronghold alone.
 */

const SPURTZ = [136, 137];
const STRONGHOLD = 138;

const hall = { id: 1, t: 14, l: 1, X: 820, Y: 820 };
const pokeys: AttackEvent = { kind: "fling", t: 0, x: 760, y: 760, r: 0, monsters: { C1: 4 } };
const jarsAt: AttackEvent = { kind: "siege", t: 0, x: 700, y: 700, weapon: "jars" };
const landsAt = jarsPlan(1, 0)!.landsAt;

const battleOf = (extra: Record<string, { id: number; t: number; l: number; X: number; Y: number }>) => {
  const yard = buildEngineYard({
    buildingdata: { "1": hall, ...extra },
    buildinghealthdata: {},
    resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
  });
  const battle = createBattle(yard, { seed: 5, siege: { jars: 1 } });
  for (const event of [pokeys, jarsAt]) battle.apply(event);
  const jarred = (id: number) => yard.buildings.find((building) => building.id === id)!.jarred;
  return { battle, jarred };
};

describe("Jars cap the defences and the Spurtz Cannons, never the Stronghold", () => {
  test("the jar towers, against the Map Room 3 strongholds' own towers", () => {
    expect([...JAR_TOWER_TYPES]).toEqual([20, 21, 23, 25, 115, 118, 129, 130, 132, 136, 137]);
    const types = Object.values(strongholds).flatMap((yard) =>
      Object.values((yard.buildingdata ?? {}) as Record<string, { t?: unknown }>).map((building) => Number(building.t))
    );
    for (const type of [...SPURTZ, STRONGHOLD]) expect(types).toContain(type);
    expect(JAR_TOWER_TYPES).not.toContain(STRONGHOLD);
  });

  test("a drop over the Stronghold leaves it unjarred, and it fires on", () => {
    const { battle, jarred } = battleOf({ "2": { id: 2, t: STRONGHOLD, l: 1, X: 700, Y: 700 } });
    for (const tick of [1, landsAt, landsAt + 1, 1200]) {
      battle.runTo(tick);
      expect(jarred(2)).toBe(false);
    }
    expect(battle.state().towers.find((entry) => entry.id === 2)!.damageDealt).toBeGreaterThan(0);
  });

  test("a drop over the Stronghold and a Sniper beside it caps the Sniper only", () => {
    const { battle, jarred } = battleOf({
      "2": { id: 2, t: STRONGHOLD, l: 1, X: 700, Y: 700 },
      "3": { id: 3, t: 21, l: 4, X: 720, Y: 720 },
    });
    battle.runTo(landsAt + 1);
    expect(jarred(3)).toBe(true);
    expect(jarred(2)).toBe(false);
  });

  test.each(SPURTZ)("a drop over Spurtz Cannon %i caps it: its shots hit the jar till it breaks", (t) => {
    const { battle, jarred } = battleOf({ "2": { id: 2, t, l: 1, X: 700, Y: 700 } });
    const report = () => battle.state().towers.find((entry) => entry.id === 2)!;
    // Uncapped, it has hit the Pokeys by 240 ticks; capped, it fires at its jar.
    battle.runTo(240);
    expect(jarred(2)).toBe(true);
    expect(report().shots).toBeGreaterThan(0);
    expect(report().damageDealt).toBe(0);
    battle.runTo(1200);
    expect(jarred(2)).toBe(false);
    expect(report().damageDealt).toBeGreaterThan(0);
  });
});
