import { describe, expect, it } from "vitest";

import { createBattle, type BattleBuffs, type BattleOptions } from "./engine.js";
import {
  battleDefence,
  defenderForcesOf,
  parseDefenderForces,
  storeBuffs,
  withAttackerBuffs,
} from "./defence.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * The shop's boosts in battle (engine fidelity note 19): Tower Overdrive,
 * Monster Overdrive, the Monster Defensive Buff and the Monster Speed Buff,
 * each on the side it belongs to and nowhere else, and a battle without any
 * exactly the battle it always was.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

const run = (battle: ReturnType<typeof createBattle>, ticks: number): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) battle.step();
};

/** A level 1 Cannon Tower (damage 20) against one Pokey (200 health, 60 a swing). */
const CANNON: CombatBuildingDataMap = { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } };
/** The same tower being upgraded: silent, so the Pokey only swings. */
const SILENT: CombatBuildingDataMap = { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0, cU: 600 } };

const pokeyBattle = (buildings: CombatBuildingDataMap, extra: Partial<BattleOptions> = {}) => {
  const yard = yardOf(buildings);
  const battle = createBattle(yard, { seed: 1, ...extra });
  battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
  return { yard, battle };
};

/** The checkpoint values after `ticks`, the battle's whole state as the digest sees it. */
const checkpointAfter = (buildings: CombatBuildingDataMap, extra: Partial<BattleOptions>, ticks: number) => {
  const { battle } = pokeyBattle(buildings, extra);
  run(battle, ticks);
  return battle.checkpoint();
};

const lost = (yard: ReturnType<typeof yardOf>) => yard.buildings[0]!.maxHp - yard.buildings[0]!.hp;

describe("no boosts", () => {
  it.each<[string, BattleBuffs]>([
    ["an empty set", {}],
    ["empty sides", { attacker: {}, defender: {} }],
    ["every boost switched off", {
      attacker: { monsterDamage: false, monsterArmour: false, monsterSpeed: false },
      defender: { towerDamage: false },
    }],
  ])("plays the battle exactly as before with %s", (_name, buffs) => {
    expect(checkpointAfter(CANNON, { buffs }, 1500)).toEqual(checkpointAfter(CANNON, {}, 1500));
  });
});

describe("Tower Overdrive", () => {
  it("multiplies the defender's tower shots by 1.25", () => {
    const plain = pokeyBattle(CANNON);
    const boosted = pokeyBattle(CANNON, { buffs: { defender: { towerDamage: true } } });
    run(plain.battle, 1200);
    run(boosted.battle, 1200);
    const plainTower = plain.battle.state().towers[0]!;
    const boostedTower = boosted.battle.state().towers[0]!;
    // Eleven shots of 20 down to 8 kill it plain; at 25 and down it takes fewer.
    expect(plainTower.shots).toBe(11);
    expect(boostedTower.shots).toBeLessThan(plainTower.shots);
    expect(boostedTower.kills).toBe(1);
  });

  it("puts 25 on the first shot, int(20 x 1.25)", () => {
    const { battle } = pokeyBattle(CANNON, { buffs: { defender: { towerDamage: true } } });
    let hurt: number | undefined;
    for (let step = 0; step < 400 && hurt === undefined; step += 1) {
      battle.step();
      hurt = battle.recentEvents(0).find((event) => event.kind === "hurt")?.amount;
    }
    expect(hurt).toBe(25);
  });

  it("does nothing for the attacker, who has no towers", () => {
    expect(checkpointAfter(CANNON, { buffs: { attacker: { towerDamage: true } } }, 1500)).toEqual(
      checkpointAfter(CANNON, {}, 1500),
    );
  });
});

describe("Monster Overdrive", () => {
  it("makes the attacker's Pokey hit for 75 rather than 60", () => {
    const plain = pokeyBattle(SILENT);
    const boosted = pokeyBattle(SILENT, { buffs: { attacker: { monsterDamage: true } } });
    run(plain.battle, 900);
    run(boosted.battle, 900);
    const swings = lost(plain.yard) / 60;
    expect(Number.isInteger(swings) && swings > 0).toBe(true);
    expect(lost(boosted.yard)).toBe(swings * 75);
  });

  it("leaves the attacker alone when only the defender has it", () => {
    const plain = pokeyBattle(SILENT);
    const theirs = pokeyBattle(SILENT, { buffs: { defender: { monsterDamage: true } } });
    run(plain.battle, 900);
    run(theirs.battle, 900);
    expect(lost(theirs.yard)).toBe(lost(plain.yard));
  });

  it("makes the defender's bunker monsters hit harder", () => {
    const fight = (buffs?: BattleBuffs) => {
      const yard = yardOf({
        "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
        "2": { id: 2, t: 1, l: 1, X: 250, Y: 250 },
      });
      const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C1: 2 } }, ...(buffs && { buffs }) });
      battle.apply({ kind: "fling", t: 0, x: 230, y: 230, r: 0, monsters: { C3: 2 } });
      let killedAt = -1;
      for (let step = 0; step < 4000 && killedAt < 0; step += 1) {
        battle.step();
        if (battle.state().creepsKilled >= 2) killedAt = step;
      }
      return killedAt;
    };
    const plain = fight();
    const boosted = fight({ defender: { monsterDamage: true } });
    expect(plain).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThan(0);
    expect(boosted).toBeLessThan(plain);
  });
});

describe("the Monster Defensive Buff", () => {
  it("takes 30% off every hit the attacker's monsters take", () => {
    const plain = pokeyBattle(CANNON);
    const tough = pokeyBattle(CANNON, { buffs: { attacker: { monsterArmour: true } } });
    run(plain.battle, 1200);
    run(tough.battle, 2400);
    expect(tough.battle.state().towers[0]!.shots).toBeGreaterThan(plain.battle.state().towers[0]!.shots);
    // The first shot, 20, lands as 14.
    const first = pokeyBattle(CANNON, { buffs: { attacker: { monsterArmour: true } } }).battle;
    let hurt: number | undefined;
    for (let step = 0; step < 400 && hurt === undefined; step += 1) {
      first.step();
      hurt = first.recentEvents(0).find((event) => event.kind === "hurt")?.amount;
    }
    expect(hurt).toBeCloseTo(14, 9);
  });
});

describe("the Monster Speed Buff", () => {
  it("gets the attacker's Pokey to the tower sooner and swinging more often", () => {
    const firstSwing = (buffs?: BattleBuffs) => {
      const { yard, battle } = pokeyBattle(SILENT, buffs && { buffs });
      for (let step = 0; step < 2000; step += 1) {
        battle.step();
        if (lost(yard) > 0) return step;
      }
      return -1;
    };
    const plain = firstSwing();
    const fast = firstSwing({ attacker: { monsterSpeed: true } });
    expect(plain).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(0);
    expect(fast).toBeLessThan(plain);

    // Over 1,500 ticks at the tower: one swing per 60 ticks plain, per 40 boosted.
    const swingsIn = (buffs?: BattleBuffs) => {
      const { yard, battle } = pokeyBattle(SILENT, buffs && { buffs });
      run(battle, 3000);
      return lost(yard) / 60;
    };
    const plainSwings = swingsIn();
    const fastSwings = swingsIn({ attacker: { monsterSpeed: true } });
    expect(fastSwings / plainSwings).toBeGreaterThan(1.4);
    expect(fastSwings / plainSwings).toBeLessThan(1.6);
  });
});

describe("a wild raid", () => {
  it("never gives the raiders the attacker's boosts", () => {
    const raid = (buffs?: BattleBuffs) => {
      const yard = yardOf(SILENT);
      const battle = createBattle(yard, { seed: 7, raid: true, ...(buffs && { buffs }) });
      battle.apply({ kind: "raid", t: 0, x: -100, y: -100, r: 20, monsters: { C1: 2 } });
      run(battle, 1500);
      return battle.checkpoint();
    };
    expect(raid({ attacker: { monsterDamage: true, monsterArmour: true, monsterSpeed: true } })).toEqual(raid());
  });

  it("still gives the defender its own", () => {
    const raid = (buffs?: BattleBuffs) => {
      const yard = yardOf(CANNON);
      const battle = createBattle(yard, { seed: 7, raid: true, ...(buffs && { buffs }) });
      battle.apply({ kind: "raid", t: 0, x: -100, y: -100, r: 20, monsters: { C1: 1 } });
      run(battle, 1500);
      return battle.state().towers[0]!.shots;
    };
    expect(raid({ defender: { towerDamage: true } })).toBeLessThan(raid());
  });
});

describe("the same boosts, the same battle", () => {
  it("replays a boosted battle to the same checkpoint every time", () => {
    const buffs: BattleBuffs = {
      attacker: { monsterDamage: true, monsterArmour: true, monsterSpeed: true },
      defender: { towerDamage: true },
    };
    expect(checkpointAfter(CANNON, { buffs }, 2000)).toEqual(checkpointAfter(CANNON, { buffs }, 2000));
    expect(checkpointAfter(CANNON, { buffs }, 2000)).not.toEqual(checkpointAfter(CANNON, {}, 2000));
  });
});

describe("boosts off a yard's storedata", () => {
  const NOW = 1_800_000_000;
  const store = {
    TOD: { q: 1, s: NOW - 10, e: NOW + 100 },
    MOD: { q: 1, s: NOW - 10, e: NOW + 100 },
    MDOD: { q: 1, s: NOW - 90000, e: NOW - 1 },
    MSOD: { q: 1, s: NOW - 10, e: NOW + 1 },
    POD: { q: 1, s: NOW - 10, e: NOW + 100 },
  };

  it("reads only the running boosts", () => {
    expect(storeBuffs(store, NOW, "defender")).toEqual({
      towerDamage: true,
      monsterDamage: true,
      monsterSpeed: true,
    });
  });

  it("leaves Tower Overdrive off the attacker's", () => {
    expect(storeBuffs(store, NOW, "attacker")).toEqual({ monsterDamage: true, monsterSpeed: true });
  });

  it("has none for a missing, empty or run-out store", () => {
    expect(storeBuffs(null, NOW, "defender")).toBeUndefined();
    expect(storeBuffs({}, NOW, "defender")).toBeUndefined();
    expect(storeBuffs({ MOD: { e: NOW } }, NOW, "attacker")).toBeUndefined();
    expect(storeBuffs({ MOD: { e: "soon" } }, NOW, "attacker")).toBeUndefined();
  });

  it("puts the defender's into its forces only when given the time", () => {
    const save = { buildingdata: {}, academy: {}, champion: [], storedata: store };
    expect(defenderForcesOf(save).buffs).toBeUndefined();
    expect(defenderForcesOf({ ...save, now: NOW }).buffs).toEqual({
      defender: { towerDamage: true, monsterDamage: true, monsterSpeed: true },
    });
    expect(defenderForcesOf({ ...save, storedata: {}, now: NOW })).not.toHaveProperty("buffs");
  });

  it("adds the attacker's beside the defender's", () => {
    const forces = defenderForcesOf({ buildingdata: {}, academy: {}, champion: [], storedata: store, now: NOW });
    const both = withAttackerBuffs(forces, { MSOD: { e: NOW + 5 }, TOD: { e: NOW + 5 } }, NOW);
    expect(both.buffs).toEqual({
      defender: { towerDamage: true, monsterDamage: true, monsterSpeed: true },
      attacker: { monsterSpeed: true },
    });
    expect(withAttackerBuffs(forces, {}, NOW)).toBe(forces);
  });

  it("survives being stored and served, and drops anything it does not know", () => {
    const raw = JSON.parse(
      JSON.stringify({
        bunkers: {},
        defenderLevels: {},
        defenderChampions: [],
        buffs: {
          attacker: { monsterDamage: true, monsterSpeed: "yes", wings: true },
          defender: { towerDamage: true, monsterArmour: false },
          spectators: { towerDamage: true },
        },
      }),
    );
    const parsed = parseDefenderForces(raw);
    expect(parsed?.buffs).toEqual({ attacker: { monsterDamage: true }, defender: { towerDamage: true } });
    expect(battleDefence(parsed).buffs).toEqual(parsed?.buffs);
    expect(parseDefenderForces({ bunkers: {}, buffs: { attacker: {} } })).not.toHaveProperty("buffs");
    expect(battleDefence(parseDefenderForces({ bunkers: {} }))).not.toHaveProperty("buffs");
  });
});
