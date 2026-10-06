import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import { replayAttack, replayRaid } from "./replay.js";
import { RAID_MAX_SECONDS, monsterStat, ticks } from "./stats.js";
import { buildEngineYard, screenPointOf } from "./yard.js";
import type { BattleOptions } from "./engine.js";
import type { CombatBuildingDataMap, RaidEvent, RaidLog } from "./types.js";

/**
 * Wild monster raids (issue #226, `docs/design/wild-raids.md` §6.2, fidelity
 * note 17): a raid wave off the yard, raiders at the defender's own academy
 * level, no hit limit (dropped, owner decision 2026-10-06), and an end with
 * no countdown.
 */

const yardOf = (buildings: CombatBuildingDataMap, resources = { r1: 0, r2: 0, r3: 0, r4: 0 }) =>
  buildEngineYard({ buildingdata: buildings, buildinghealthdata: {}, resources });

const run = (battle: ReturnType<typeof createBattle>, limit = ticks(RAID_MAX_SECONDS) + 10) => {
  for (let step = 0; step < limit && !battle.over(); step += 1) battle.step();
};

const wave = (monsters: Record<string, number>, x = 400, y = 0, r = 20): RaidEvent => ({
  kind: "raid",
  t: 0,
  x,
  y,
  r,
  monsters,
});

/** Health every building lost, summed. */
const healthLost = (yard: ReturnType<typeof yardOf>): number =>
  yard.buildings.reduce((sum, building) => sum + (building.maxHp - building.hp), 0);

/** A level 1 Monster Bunker (10,000 health), alone. */
const BUNKER: CombatBuildingDataMap = { "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 } };

/** One raid on one yard, run to its end. */
const raidOn = (buildings: CombatBuildingDataMap, event: RaidEvent, options: Partial<BattleOptions>) => {
  const yard = yardOf(buildings);
  const battle = createBattle(yard, { seed: 7, raid: true, ...options });
  battle.apply(event);
  run(battle);
  return { yard, battle, state: battle.state() };
};

describe("a raid wave", () => {
  it("spawns every raider at the defender's own academy level for its type", () => {
    const yard = yardOf(BUNKER);
    const battle = createBattle(yard, { seed: 1, defenderLevels: { C1: 6 }, raid: true });
    battle.apply(wave({ C1: 3, C3: 2 }));
    const creeps = battle.creeps();
    expect(creeps).toHaveLength(5);
    const trained = creeps.filter((creep) => creep.monsterId === "C1");
    const untrained = creeps.filter((creep) => creep.monsterId === "C3");
    expect(trained).toHaveLength(3);
    for (const creep of trained) {
      expect(creep.level).toBe(6);
      expect(creep.maxHp).toBe(monsterStat("C1", "health", 6));
      expect(creep.friendly).toBe(false);
    }
    // A type the player has not trained in the Academy stays at level 1.
    expect(untrained).toHaveLength(2);
    for (const creep of untrained) expect(creep.level).toBe(1);
    expect(battle.state().creepsFlung).toBe(5);
  });

  it("stays at level 1 when the defender has no academy levels at all", () => {
    const yard = yardOf(BUNKER);
    const battle = createBattle(yard, { seed: 1, raid: true });
    battle.apply(wave({ C1: 3 }));
    for (const creep of battle.creeps()) expect(creep.level).toBe(1);
  });

  it("reads the defender's own academy, never the attacker's `levels`", () => {
    const yard = yardOf(BUNKER);
    const battle = createBattle(yard, { seed: 1, levels: { C1: 6 }, raid: true });
    battle.apply(wave({ C1: 3 }));
    for (const creep of battle.creeps()) expect(creep.level).toBe(1);
  });

  it("scatters its raiders inside the disc the planner chose", () => {
    const yard = yardOf(BUNKER);
    const battle = createBattle(yard, { seed: 2, raid: true });
    battle.apply(wave({ C1: 40 }, 900, -300, 50));
    const centre = screenPointOf(900, -300);
    for (const creep of battle.creeps()) {
      const at = screenPointOf(creep.ix, creep.iy);
      expect(Math.hypot(at.x - centre.x, at.y - centre.y)).toBeLessThanOrEqual(50 + 1e-6);
    }
  });

  it("is taken only by a raid battle, which takes nothing else", () => {
    const attack = createBattle(yardOf(BUNKER), { seed: 3 });
    attack.apply(wave({ C1: 5 }));
    expect(attack.creeps()).toHaveLength(0);

    const raid = createBattle(yardOf(BUNKER), { seed: 3, raid: true });
    raid.apply({ kind: "fling", t: 0, x: 300, y: 0, r: 200, monsters: { C1: 5 } });
    raid.apply({ kind: "bomb", t: 0, x: 0, y: 0, id: "tw3" });
    raid.apply({ kind: "retreat", t: 0 });
    expect(raid.creeps()).toHaveLength(0);
    expect(raid.state().health).toEqual({});
    expect(raid.over()).toBe(false);
  });

  it("walks in from off the pathing grid and still reaches the yard", () => {
    const { state } = raidOn(BUNKER, wave({ C1: 1 }, 1900, 0), {});
    expect(state.health["1"]).toBeLessThan(10000);
  });
});

describe("no hit limit (dropped, owner decision 2026-10-06)", () => {
  it("keeps a raider swinging at an undefended building far past the old 31-swing limit", () => {
    // A level 1 Bunker has 10,000 health and no garrison, so nothing fights
    // back; Flash's hit limit (`CreepBase.as:926-941`) would have sent the
    // raider home after 31 swings (`hitLimit` 30), long before it could take
    // the Bunker down. With no limit it keeps swinging until the Bunker
    // falls, then retreats with nothing left to attack (note 7).
    const { yard, state } = raidOn(BUNKER, wave({ C3: 1 }), {});
    expect(healthLost(yard)).toBeGreaterThan(31 * monsterStat("C3", "damage", 1));
    expect(state.destroyedIds).toEqual([1]);
    expect(state.creepsKilled).toBe(0);
    expect(state.creepsAlive).toBe(0);
    expect(state.over).toBe(true);
  });

  it("is not applied to an attack either: a creep keeps fighting past 31 swings there too", () => {
    const yard = yardOf(BUNKER);
    const battle = createBattle(yard, { seed: 7 });
    battle.apply({ kind: "fling", t: 0, x: 300, y: 0, r: 200, monsters: { C3: 1 } });
    for (let step = 0; step < ticks(120); step += 1) battle.step();
    // Far more than 31 swings' worth of a level 1 C3 in two minutes, and still there.
    expect(battle.state().creepsAlive).toBe(1);
  });
});

describe("the end of a raid", () => {
  it("comes when the last raider dies, long before any countdown", () => {
    // A level 1 Cannon Tower against one Pokey.
    const { state } = raidOn(
      { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
      wave({ C1: 1 }, 250, 0),
      {},
    );
    expect(state.over).toBe(true);
    expect(state.creepsKilled).toBe(1);
    expect(state.tick).toBeLessThan(ticks(60));
  });

  it("ends when a raider has nothing left to attack, as an attack does (note 7)", () => {
    // The raider's only target falls and nothing else stands; it retreats
    // and is gone, the same way an attacker with nothing left to hit does.
    const { state } = raidOn(
      { "1": { id: 1, t: 1, l: 1, X: 0, Y: 0 } },
      wave({ C12: 1 }, 250, 0),
      {},
    );
    expect(state.over).toBe(true);
    expect(state.destroyedIds).toEqual([1]);
  });

  it("runs past an attack's countdown and grace with raiders still at work", () => {
    // A C3 deals 15 a swing; a level 5 Town Hall has 94,000 health, which
    // outlasts the raid's own cap with no hit limit to send the raider home.
    const { state } = raidOn(
      { "1": { id: 1, t: 14, l: 5, X: 0, Y: 0 } },
      wave({ C3: 1 }, 250, 0),
      {},
    );
    expect(state.over).toBe(true);
    expect(state.tick).toBe(ticks(RAID_MAX_SECONDS));
    expect(state.creepsAlive).toBe(1);
  });

  it("does not end before a raider has come", () => {
    const battle = createBattle(yardOf(BUNKER), { seed: 1, raid: true });
    for (let step = 0; step < 100; step += 1) battle.step();
    expect(battle.over()).toBe(false);
    battle.apply({ ...wave({ C1: 1 }, 250, 0), t: 100 });
    expect(battle.state().creepsFlung).toBe(1);
  });
});

describe("theft", () => {
  it("takes from a harvester's unbanked store, as the defender's loss", () => {
    const yard = yardOf({ "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 500 } });
    const battle = createBattle(yard, { seed: 5, raid: true });
    battle.apply(wave({ C3: 2 }, 250, 0));
    run(battle);
    const state = battle.state();
    expect(state.defenderLoss.r1).toBeGreaterThan(0);
    expect(state.defenderLoss.r1).toBeLessThanOrEqual(500);
    expect(yard.buildings[0]?.stored).toBe(500 - state.defenderLoss.r1);
  });
});

describe("replayRaid", () => {
  const log: RaidLog = { v: 1, seed: 11, events: [wave({ C1: 6, C3: 4 }, 300, -50, 40)] };
  const buildingdata: CombatBuildingDataMap = {
    "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 },
    "2": { id: 2, t: 20, l: 1, X: 120, Y: 0 },
    "3": { id: 3, t: 1, l: 1, X: -120, Y: 0, st: 300 },
  };

  it("is the same battle twice", () => {
    const one = replayRaid({ buildingdata, log, resources: { r1: 5000 } });
    const two = replayRaid({ buildingdata, log, resources: { r1: 5000 } });
    expect(two.digest).toBe(one.digest);
    expect(two.checkpoints).toEqual(one.checkpoints);
  });

  it("fights on a main yard, never as a wild camp", () => {
    const raid = replayRaid({ buildingdata, log, resources: { r1: 5000 } });
    const asCamp = replayAttack({
      buildingdata,
      log,
      kind: "wild",
      resources: { r1: 5000 },
      raid: true,
    });
    expect(asCamp.digest).toBe(raid.digest);
    expect(raid.destroyed).toBeUndefined();
  });

  it("ends by itself, inside its cap", () => {
    const outcome = replayRaid({ buildingdata, log, resources: { r1: 5000 } });
    expect(outcome.ticks).toBeLessThanOrEqual(ticks(RAID_MAX_SECONDS));
    expect(outcome.creepsFlung).toBe(10);
  });
});
