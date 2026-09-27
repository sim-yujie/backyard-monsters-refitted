import { describe, expect, it } from "vitest";

import {
  bucketCost,
  createBattle,
  dropRadius,
  flingerPayload,
  type BattleVisualEvent,
} from "./engine.js";
import { digestOf } from "./digest.js";
import { BOMBS, bombBlast } from "./stats.js";
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
    // 60 damage a swing, and the Pokey got nine in before it died.
    expect(tower!.maxHp - tower!.hp).toBe(540);
  });

  it("ends the battle once the last attacker is gone and the countdown has run", () => {
    const { battle } = battleOf();
    run(battle, 40000);
    expect(battle.over()).toBe(true);
  });
});

describe("traps", () => {
  /** The trap sits at the Town Hall's near corner, where the Pokeys arrive. */
  const trapYard = () =>
    yardOf({
      "1": { id: 1, t: 14, X: 400, Y: 400 },
      "2": { id: 2, t: 24, X: 380, Y: 380 },
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

  it("deals particles times the share, with no falloff", () => {
    // pb1: 9,000 over 200 particles is 45 a particle, 9,000 in all, wherever it
    // lands. A level 3 Town Hall has 20,000 to lose.
    const yard = yardOf({ "1": { id: 1, t: 14, l: 3, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 2 });
    const before = yard.buildings[0]!.hp;
    battle.apply({ kind: "bomb", t: 0, x: 40, y: 0, id: "pb1" });
    expect(before - yard.buildings[0]!.hp).toBe(9000);
  });

  it("takes 6% off a wall and leaves a trap alone", () => {
    const yard = yardOf({
      "1": { id: 1, t: 17, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 24, l: 1, X: 10, Y: 10 },
    });
    const battle = createBattle(yard, { seed: 2 });
    const [wall, trap] = [yard.buildings[0]!, yard.buildings[1]!];
    const before = { wall: wall.hp, trap: trap.hp };
    battle.apply({ kind: "bomb", t: 0, x: 0, y: 0, id: "pb3" });
    // int(375 * 0.06) = 22 a particle, 4,400 in all.
    expect(before.wall - wall.hp).toBe(Math.min(4400, before.wall));
    expect(trap.hp).toBe(before.trap);
  });

  /**
   * The ring the attack screen draws for a bomb is `bombBlast`, in world
   * pixels. A sizeless building (the Laser Tower's props entry has none) just
   * inside that ellipse must be hit and one just outside must not, for every
   * damage tier, so the ring and the engine speak the same units (#75).
   */
  it("hits exactly what the drawn ring covers", () => {
    for (const bomb of BOMBS.filter((one) => one.damage > 0)) {
      const ring = bombBlast(bomb);
      // Even horizontal offsets keep the yard point whole (x = sy + sx / 2).
      const inside = 2 * Math.floor((ring.rx - 1) / 2);
      const outside = 2 * Math.ceil((ring.rx + 1) / 2);
      const probes: Array<[number, number, boolean]> = [
        [inside, 0, true],
        [outside, 0, false],
        [0, ring.ry - 2, true],
        [0, ring.ry + 2, false],
      ];
      for (const [dx, dy, hit] of probes) {
        const yard = yardOf({ "1": { id: 1, t: 23, l: 1, X: 0, Y: 0 } });
        const laser = yard.buildings[0]!;
        // The building's middle sits at screen (0, middle); put the blast's
        // centre (dx, dy) short of it. Screen to yard: x = sy + sx / 2.
        const sx = -dx;
        const sy = laser.middle - dy;
        const x = sy + sx / 2;
        const y = sy - sx / 2;
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
        const battle = createBattle(yard, { seed: 2 });
        const before = laser.hp;
        battle.apply({ kind: "bomb", t: 0, x, y, id: bomb.id });
        expect({ bomb: bomb.id, dx, dy, hit: laser.hp < before }).toEqual({
          bomb: bomb.id,
          dx,
          dy,
          hit,
        });
      }
    }
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

describe("flyers (issue #58)", () => {
  /**
   * A level 1 Cannon Tower (70 x 70 at 0,0) inside a closed ring of twenty
   * walls (20 x 20 each). A flyer is sent straight at the tower with no route
   * (`MonsterBase.as:1121`), so no wall is ever its target, and the Cannon,
   * which has flyer mode 0 (`BTOWER.as:25-35`), may not shoot at it.
   */
  const ringed = (tower: number): CombatBuildingDataMap => {
    const buildings: Record<string, CombatBuildingDataMap[string]> = {
      "1": { id: 1, t: tower, l: 1, X: 0, Y: 0 },
    };
    let id = 2;
    const wall = (X: number, Y: number) => {
      buildings[String(id)] = { id, t: 17, X, Y };
      id += 1;
    };
    for (let x = -20; x <= 80; x += 20) {
      wall(x, -20);
      wall(x, 80);
    }
    for (let y = 0; y <= 60; y += 20) {
      wall(-20, y);
      wall(80, y);
    }
    return buildings;
  };

  const attack = (tower: number, monsters: Record<string, number>) => {
    const yard = yardOf(ringed(tower));
    const battle = createBattle(yard, { seed: 5, playerLevel: 8 });
    battle.apply({ kind: "fling", t: 0, x: -300, y: -300, r: 200, monsters });
    return { yard, battle };
  };

  const wallsHurt = (yard: ReturnType<typeof yardOf>): number =>
    yard.buildings.filter((one) => one.type === 17 && one.hp < one.maxHp).length;

  it("puts Teratorn and Zafreeti in the air", () => {
    const { battle } = attack(20, { C14: 1, C15: 1 });
    run(battle, 5);
    const creeps = battle.creeps();
    expect(creeps).toHaveLength(2);
    for (const creep of creeps) expect(creep.flying).toBe(true);
  });

  it("flies a Teratorn over the wall ring to the tower, and the Cannon never fires", () => {
    const { yard, battle } = attack(20, { C14: 1 });
    run(battle, 3000);
    const tower = yard.buildings.find((one) => one.type === 20);
    expect(tower!.hp).toBeLessThan(tower!.maxHp);
    expect(wallsHurt(yard)).toBe(0);
    expect(battle.state().towers[0]?.shots).toBe(0);
  });

  it("lets a Flak Tower, which shoots only flyers, bring a Teratorn down", () => {
    const { battle } = attack(115, { C14: 1 });
    run(battle, 6000);
    const flak = battle.state().towers[0];
    expect(flak?.shots).toBeGreaterThan(0);
    expect(flak?.kills).toBe(1);
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
        } else if (event.kind === "death") {
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

  it("reports each swing that lands as a hit, and each wound as a hurt", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    const events: BattleVisualEvent[] = [];
    let seen = 0;
    for (let step = 0; step < 1200; step += 1) {
      battle.step();
      if (step % 5 !== 0) continue;
      events.push(...battle.recentEvents(seen));
      seen = battle.tick;
    }
    const hits = events.filter((event) => event.kind === "hit");
    const hurts = events.filter((event) => event.kind === "hurt");
    // The Pokey got nine swings in before it died, 60 a swing, on foot, at
    // the tower it was standing on.
    expect(hits).toHaveLength(9);
    for (const hit of hits) {
      if (hit.kind !== "hit") throw new Error("filtered");
      expect(hit.creepId).toBe(1);
      expect(hit.buildingId).toBe(1);
      expect(hit.creepTargetId).toBe(-1);
      expect(hit.ranged).toBe(false);
      expect(hit.flying).toBe(false);
      expect(hit.amount).toBe(60);
      expect(hit.targetIx).toBe(0);
      expect(hit.targetIy).toBe(0);
    }
    // Ten shots of 20, each one a wound with the Pokey's position that tick.
    expect(hurts).toHaveLength(10);
    for (const hurt of hurts) {
      if (hurt.kind !== "hurt") throw new Error("filtered");
      expect(hurt.creepId).toBe(1);
      expect(hurt.friendly).toBe(false);
      expect(hurt.amount).toBe(20);
      expect(Number.isFinite(hurt.ix)).toBe(true);
    }
    // Hits and hurts come with a tick, in tick order, like every other event.
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]!.tick).toBeGreaterThanOrEqual(events[index - 1]!.tick);
    }
  });

  it("keeps hits and hurts out of the checkpoint", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    run(battle, 400);
    expect(battle.recentEvents(0).some((event) => event.kind === "hit")).toBe(true);
    expect(battle.recentEvents(0).some((event) => event.kind === "hurt")).toBe(true);
    // One tick, four numbers per building, five per creep, twelve totals: the
    // checkpoint is exactly as long with a hundred visual events behind it as
    // it would be with none, and the digest is over those numbers alone.
    const creeps = battle.creeps().length;
    expect(battle.checkpoint()).toHaveLength(1 + 4 * yard.buildings.length + 5 * creeps + 12);
    const again = createBattle(yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } }), { seed: 1 });
    again.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    run(again, 400);
    expect(digestOf(battle.checkpoint())).toBe(digestOf(again.checkpoint()));
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
    expect(battle.state().championsHp).toEqual({ G5: 0 });
  });

  it("keeps each champion's health apart when an ordinary champion and Krallen both fight (#74)", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    expect(battle.state().championsHp).toEqual({});
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: {}, champion: { t: 3, l: 1 } });
    run(battle, 200);
    battle.apply({ kind: "fling", t: battle.tick, x: -100, y: -100, r: 200, monsters: {}, champion: { t: 5, l: 1 } });
    run(battle, 200);
    const hp = battle.state().championsHp;
    expect(Object.keys(hp).sort()).toEqual(["G3", "G5"]);
    expect(hp["G3"]).toBeGreaterThan(0);
    expect(hp["G5"]).toBeGreaterThan(0);
    expect(battle.creeps().filter((creep) => creep.champion)).toHaveLength(2);
  });
});
