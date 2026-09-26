import { describe, expect, it } from "vitest";

import { bucketCost, createBattle, dropRadius, flingerPayload } from "./engine.js";
import { digestOf } from "./digest.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * The engine, one rule at a time.
 *
 * The golden replays in `replay.test.ts` prove that a whole battle reproduces;
 * they do not say *why* it came out the way it did. These do: one creep against
 * one tower with the arithmetic written out, a trap that fires once, loot that
 * follows damage, and the determinism property the digests rest on.
 */

const yardOf = (buildings: CombatBuildingDataMap, health?: Record<string, number>) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: health ?? {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

const run = (battle: ReturnType<typeof createBattle>, ticks: number): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) battle.step();
};

describe("a Pokey against a lone Cannon Tower", () => {
  /**
   * Level 1 Cannon Tower: range 160, damage 20, rate 40, so a shot a second
   * (`rate * 2` fast ticks, `BTOWER.as:179`) and 6,000 health.
   * Level 1 Pokey: 200 health, 60 damage, 60-tick swing.
   */
  const battleOf = () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    return { yard, battle };
  };

  it("kills it in ten shots, at a shot a second", () => {
    const { battle } = battleOf();
    run(battle, 1200);
    const state = battle.state();
    const tower = state.towers[0];
    expect(tower?.shots).toBe(10);
    expect(tower?.kills).toBe(1);
    // Ten shots of 20 is the Pokey's whole 200 health.
    expect(tower?.damageDealt).toBe(200);
    expect(state.creepsKilled).toBe(1);
  });

  it("takes a swing a second from the Pokey while it lives", () => {
    const { yard, battle } = battleOf();
    run(battle, 1200);
    const tower = yard.buildings[0];
    // 60 damage a swing, and the Pokey got eight in before it died.
    expect(tower!.maxHp - tower!.hp).toBe(480);
  });

  it("ends the battle once the last attacker is gone and the countdown has run", () => {
    const { battle } = battleOf();
    run(battle, 40000);
    expect(battle.over()).toBe(true);
  });
});

describe("traps", () => {
  const trapYard = () =>
    yardOf({
      "1": { id: 1, t: 14, X: 400, Y: 400 },
      "2": { id: 2, t: 24, X: -40, Y: -40 },
    });

  it("fires once when a ground creep walks over it, and kills what it catches", () => {
    const yard = trapYard();
    const battle = createBattle(yard, { seed: 3 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C1: 3 } });
    run(battle, 4000);
    const state = battle.state();
    expect(state.firedTraps).toEqual([2]);
    // A Booby Trap deals 1,000 over a 50-unit blast; a level 1 Pokey has 200.
    expect(state.creepsKilled).toBeGreaterThan(0);
    expect(yard.buildings.find((one) => one.id === 2)?.fired).toBe(true);
  });

  it("stays armed when nothing comes near it", () => {
    const yard = trapYard();
    const battle = createBattle(yard, { seed: 3 });
    battle.apply({ kind: "fling", t: 0, x: 900, y: 900, r: 40, monsters: { C1: 2 } });
    run(battle, 400);
    expect(battle.state().firedTraps).toEqual([]);
  });

  it("reports a fired trap as health 0, which is what the save carries", () => {
    const yard = trapYard();
    const battle = createBattle(yard, { seed: 3 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C1: 3 } });
    run(battle, 4000);
    expect(battle.state().health["2"]).toBe(0);
  });
});

describe("loot", () => {
  it("draws a harvester's buffer as the damage lands", () => {
    const yard = yardOf({
      "1": { id: 1, t: 1, X: 0, Y: 0, st: 400 },
    });
    const battle = createBattle(yard, { seed: 11, playerLevel: 20 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 4 } });
    run(battle, 4000);
    const state = battle.state();
    // A point of damage is a unit of resource, capped by what the buffer held.
    expect(state.defenderLoss.r1).toBe(400);
    expect(state.loot.r1).toBe(400);
    expect(yard.buildings[0]?.looted).toBe(true);
  });

  it("gives a low-level attacker the `ATTACK.Loot` bonus", () => {
    const yard = yardOf({ "1": { id: 1, t: 1, X: 0, Y: 0, st: 400 } });
    const battle = createBattle(yard, { seed: 11, playerLevel: 1 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 4 } });
    run(battle, 4000);
    // `+ (20 - 1) * 3%` is `+57%`, which is where `LOOT_GAIN_RATIO` comes from.
    expect(battle.state().loot.r1).toBeCloseTo(400 * 1.57, 6);
    expect(battle.state().defenderLoss.r1).toBe(400);
  });

  it("scales a main yard's storage draw by nine tenths", () => {
    const yard = yardOf({ "1": { id: 1, t: 6, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 11, playerLevel: 20 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 6 } });
    run(battle, 4000);
    const state = battle.state();
    expect(state.defenderLoss.r1).toBeGreaterThan(0);
    expect(state.loot.r1).toBeCloseTo(state.defenderLoss.r1 * 0.9, 6);
  });
});

describe("bombs", () => {
  it("takes health off everything inside the blast", () => {
    const yard = yardOf({ "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 2 });
    const before = yard.buildings[0]!.hp;
    battle.apply({ kind: "bomb", t: 0, x: 0, y: 0, id: "pb1" });
    expect(yard.buildings[0]!.hp).toBeLessThan(before);
  });

  it("ignores a putty bomb, which slows rather than damages", () => {
    const yard = yardOf({ "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 2 });
    const before = yard.buildings[0]!.hp;
    battle.apply({ kind: "bomb", t: 0, x: 0, y: 0, id: "pu3" });
    expect(yard.buildings[0]!.hp).toBe(before);
  });
});

describe("determinism", () => {
  const scripted = (seed: number) => {
    const yard = yardOf({
      "1": { id: 1, t: 14, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 2, X: 200, Y: 100 },
      "3": { id: 3, t: 17, X: -100, Y: -100 },
      "4": { id: 4, t: 24, X: -60, Y: -60 },
      "5": { id: 5, t: 1, X: 150, Y: -150, st: 900 },
    });
    const battle = createBattle(yard, { seed, playerLevel: 8 });
    battle.apply({ kind: "fling", t: 0, x: -300, y: -300, r: 200, monsters: { C1: 8, C5: 2 } });
    run(battle, 6000);
    return digestOf(battle.checkpoint());
  };

  it("gives the same digest for the same seed", () => {
    expect(scripted(777)).toBe(scripted(777));
  });

  it("gives a different one for a different seed", () => {
    expect(scripted(777)).not.toBe(scripted(778));
  });
});

describe("the flinger", () => {
  it("prices a payload in bucket units at the roster's levels", () => {
    // A Pokey is 7 bucket units at every level (`monsterStats.ts` C1).
    expect(bucketCost({ C1: 10 }, {})).toBe(70);
    expect(bucketCost({ C1: 10, C4: 2 }, {})).toBe(110);
  });

  it("carries 2,250 units a fling in Map Room 2", () => {
    // `GLOBAL` pins the flinger to level 4 outside Map Room 3 (`GLOBAL.as:863`).
    expect(flingerPayload()).toBe(2250);
  });

  it("sizes the drop circle from the payload, with a floor of 200", () => {
    expect(dropRadius(0)).toBe(100);
    expect(dropRadius(2000)).toBe(250);
  });
});

describe("the renderer's view of the field (issue #32, WP5)", () => {
  /** The determinism yard: a Pokey drop against a tower, a wall and a trap. */
  const scripted = () => {
    const yard = yardOf({
      "1": { id: 1, t: 14, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 2, X: 200, Y: 100 },
      "3": { id: 3, t: 17, X: -100, Y: -100 },
      "4": { id: 4, t: 24, X: -60, Y: -60 },
      "5": { id: 5, t: 1, X: 150, Y: -150, st: 900 },
    });
    const battle = createBattle(yard, { seed: 777, playerLevel: 8 });
    battle.apply({ kind: "fling", t: 0, x: -300, y: -300, r: 200, monsters: { C1: 8, C5: 2 } });
    return battle;
  };

  it("lists every creep with its position, health and state, ascending id", () => {
    const battle = scripted();
    run(battle, 10);
    const creeps = battle.creeps();
    expect(creeps.map((creep) => creep.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(creeps.filter((creep) => creep.monsterId === "C1")).toHaveLength(8);
    expect(creeps.filter((creep) => creep.monsterId === "C5")).toHaveLength(2);
    for (const creep of creeps) {
      expect(creep.hp).toBe(creep.maxHp);
      expect(creep.flying).toBe(false);
      expect(creep.champion).toBe(false);
      expect(creep.friendly).toBe(false);
      expect(creep.state).toBe("walking");
      // Inside the drop circle around (-300, -300), in the fling's own units.
      expect(Math.hypot(creep.ix + 300, creep.iy + 300)).toBeLessThanOrEqual(200);
    }
    expect(battle.state().creepsAlive).toBe(creeps.length);
  });

  it("shows a creep attacking once it reaches its target, and drops it when it dies", () => {
    const battle = scripted();
    run(battle, 6000);
    const creeps = battle.creeps();
    expect(creeps.length).toBe(battle.state().creepsAlive);
    for (const creep of creeps) expect(creep.hp).toBeGreaterThan(0);
    const attacking = creeps.filter((creep) => creep.state === "attacking");
    for (const creep of attacking) expect(creep.targetBuilding).toBeGreaterThan(0);
  });

  it("changes nothing about the battle: the digest is the same whether or not it is read", () => {
    const watched = scripted();
    const unwatched = scripted();
    for (let step = 0; step < 6000; step += 1) {
      watched.step();
      unwatched.step();
      if (step % 7 === 0) {
        watched.creeps();
        watched.recentEvents(step - 3);
      }
    }
    expect(digestOf(watched.checkpoint())).toBe(digestOf(unwatched.checkpoint()));
    expect(watched.state()).toEqual(unwatched.state());
  });

  it("reports each tower shot with the tick and the creep it hit", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    let seen = 0;
    let shots = 0;
    let deaths = 0;
    for (let step = 0; step < 1200; step += 1) {
      battle.step();
      // Read every few ticks, as a renderer at 60 fps would.
      if (step % 3 !== 0) continue;
      for (const event of battle.recentEvents(seen)) {
        expect(event.tick).toBeGreaterThan(seen);
        if (event.kind === "shot") {
          shots += 1;
          expect(event.towerId).toBe(1);
          expect(event.creepId).toBe(1);
        } else {
          deaths += 1;
          expect(event.creepId).toBe(1);
          expect(event.monsterId).toBe("C1");
        }
      }
      seen = battle.tick;
    }
    // Ten shots kill the Pokey, which is what the tower report says too.
    expect(shots).toBe(battle.state().towers[0]?.shots);
    expect(shots).toBe(10);
    expect(deaths).toBe(1);
  });

  it("forgets events older than the memory window", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    run(battle, 1200);
    // The Pokey died around tick 800; two seconds later nothing is left to tell.
    run(battle, 400);
    expect(battle.recentEvents(0)).toEqual([]);
  });
});

describe("the champion's health after the field is left (issue #32)", () => {
  /** A Gorgo alone against a lone level 1 Cannon Tower, which barely scratches it. */
  const flung = () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({
      kind: "fling",
      t: 0,
      x: -100,
      y: -100,
      r: 200,
      monsters: {},
      champion: { t: 1, l: 1 },
    });
    return battle;
  };

  it("keeps the health a retreated champion left with, rather than reporting it dead", () => {
    const battle = flung();
    run(battle, 400);
    const before = battle.state().championHp;
    expect(before).not.toBeNull();
    expect(before).toBeGreaterThan(0);
    battle.apply({ kind: "retreat", t: battle.tick });
    run(battle, 10);
    expect(battle.over()).toBe(true);
    expect(battle.state().creepsKilled).toBe(0);
    expect(battle.state().championHp).toBe(before);
  });

  it("keeps the health of a champion that walked home once the yard was flat", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({
      kind: "fling",
      t: 0,
      x: -100,
      y: -100,
      r: 200,
      monsters: { C1: 60 },
      champion: { t: 1, l: 1 },
    });
    // Two minutes: the tower falls, everyone walks home and is taken off the
    // field, long before the countdown ends the battle.
    run(battle, 80 * 120);
    expect(battle.state().creepsAlive).toBe(0);
    expect(battle.state().creepsKilled).toBe(0);
    const hp = battle.state().championHp;
    expect(hp).not.toBeNull();
    expect(hp).toBeGreaterThan(0);
  });

  it("reports zero once the champion has actually died", () => {
    const ring: Record<string, { id: number; t: number; l: number; X: number; Y: number }> = {};
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      ring[String(index + 1)] = {
        id: index + 1,
        t: 21,
        l: 5,
        X: Math.round(Math.cos(angle) * 400),
        Y: Math.round(Math.sin(angle) * 400),
      };
    }
    const battle = createBattle(yardOf(ring), { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: 0, y: 0, r: 200, monsters: {}, champion: { t: 5, l: 5 } });
    run(battle, 80 * 100);
    expect(battle.state().creepsKilled).toBe(1);
    expect(battle.state().championHp).toBe(0);
  });
});
