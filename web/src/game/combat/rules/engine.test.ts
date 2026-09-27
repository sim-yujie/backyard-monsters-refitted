import { describe, expect, it } from "vitest";

import {
  bucketCost,
  createBattle,
  dropRadius,
  flingerPayload,
  scatterRadius,
  type BattleVisualEvent,
} from "./engine.js";
import { digestOf } from "./digest.js";
import { BOMBS, bombBlast, championStat, monsterTickSpeed } from "./stats.js";
import { buildEngineYard, reachesBuilding, screenDistanceSquared } from "./yard.js";
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
    // 60 damage a swing, and the Pokey got ten in before it died. It lands
    // within 50 screen pixels of (-100, -100) (issue #91), which with this
    // seed puts it at the tower in time for a tenth swing.
    expect(tower!.maxHp - tower!.hp).toBe(600);
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

describe("a creep's reach is a circle on screen (issue #85)", () => {
  /** The screen directions a reach used to stretch or squash. */
  const DIRECTIONS: ReadonlyArray<readonly [string, number, number]> = [
    ["east", 1, 0],
    ["west", -1, 0],
    ["south", 0, 1],
    ["north", 0, -1],
    ["along yard X", 2 / Math.sqrt(5), 1 / Math.sqrt(5)],
    ["along yard Y", -2 / Math.sqrt(5), 1 / Math.sqrt(5)],
  ];

  /** The yard point `away` screen pixels from a building's drawn anchor. */
  const offAnchor = (sx: number, sy: number, ux: number, uy: number, away: number) => {
    const screenX = sx + ux * away;
    const screenY = sy + uy * away;
    return { x: screenX * 0.5 + screenY, y: screenY - screenX * 0.5 };
  };

  it("reaches Krallen's range in screen pixels, the same in every direction", () => {
    const yard = buildEngineYard({ buildingdata: { "1": { id: 1, t: 1, X: 100, Y: 60 } } });
    const building = yard.buildings[0]!;
    // Krallen's range by level, which `CHAMPIONCAGE.as:236` gives in screen pixels.
    const ranges = [1, 2, 3, 4, 5].map((level) => championStat("G5", "range", level));
    expect(ranges).toEqual([35, 45, 55, 60, 65]);
    for (const range of ranges) {
      for (const [name, ux, uy] of DIRECTIONS) {
        const inside = offAnchor(building.sx, building.sy, ux, uy, range - 0.05);
        const outside = offAnchor(building.sx, building.sy, ux, uy, range + 0.05);
        expect(reachesBuilding(inside.x, inside.y, building, range), `${name} ${range}`).toBe(true);
        expect(reachesBuilding(outside.x, outside.y, building, range), `${name} ${range}`).toBe(
          false,
        );
      }
    }
  });

  it("measures creep to creep on screen too", () => {
    for (const [, ux, uy] of DIRECTIONS) {
      const at = offAnchor(0, 0, ux, uy, 50);
      expect(screenDistanceSquared(at.x, at.y, 0, 0)).toBeCloseTo(2500, 6);
    }
  });

  it("stops a level 5 Krallen walking in from the north 65 px from the anchor", () => {
    const yard = yardOf({ "1": { id: 1, t: 1, X: 100, Y: 100 } });
    const building = yard.buildings[0]!;
    const battle = createBattle(yard, { seed: 21 });
    // 400 px straight up the screen from the building's top corner.
    const drop = offAnchor(building.sx, building.sy, 0, -1, 400);
    battle.apply({ kind: "fling", t: 0, ...drop, r: 100, monsters: {}, champion: { t: 5, l: 5 } });
    const speed = championStat("G5", "speed", 5) / 4;
    let stoppedAt = -1;
    for (let step = 0; step < 4000 && stoppedAt < 0; step += 1) {
      battle.step();
      const krallen = battle.creeps()[0]!;
      if (krallen.state !== "attacking") continue;
      const at = { x: krallen.ix - krallen.iy, y: (krallen.ix + krallen.iy) / 2 };
      stoppedAt = Math.hypot(at.x - building.sx, at.y - building.sy);
    }
    expect(stoppedAt).toBeLessThanOrEqual(65);
    expect(stoppedAt).toBeGreaterThan(65 - 2 * speed);
  });
});

describe("walking speed (issue #86)", () => {
  it("covers the same screen distance a tick whichever way a creep walks", () => {
    // Flash moves `_tmpPoint` by `speed` screen px a tick (`CreepBase.as:1679`).
    const speed = monsterTickSpeed("C1", 1);
    const lengths: number[] = [];
    let across = 0;
    let down = 0;
    // One Pokey from each side of a lone Town Hall: they walk every way there is.
    for (const [x, y] of [
      [-500, -500],
      [900, 900],
      [700, -300],
      [-300, 700],
      [900, 0],
      [0, -500],
    ] as const) {
      const yard = yardOf({ "1": { id: 1, t: 14, X: 200, Y: 200 } });
      const battle = createBattle(yard, { seed: 5 });
      battle.apply({ kind: "fling", t: 0, x, y, r: 100, monsters: { C1: 1 } });
      battle.step();
      let before = battle.creeps()[0]!;
      for (let step = 0; step < 3000; step += 1) {
        battle.step();
        const now = battle.creeps()[0];
        if (!now || now.state === "attacking") break;
        const dx = now.ix - before.ix;
        const dy = now.iy - before.iy;
        const screenX = dx - dy;
        const screenY = (dx + dy) / 2;
        const length = Math.hypot(screenX, screenY);
        if (length > 0) {
          lengths.push(length);
          if (Math.abs(screenX) > 2 * Math.abs(screenY)) across += 1;
          if (Math.abs(screenY) > 2 * Math.abs(screenX)) down += 1;
        }
        before = now;
      }
    }
    // Plenty of steps mostly across the screen and plenty mostly down it.
    expect(across).toBeGreaterThan(100);
    expect(down).toBeGreaterThan(100);
    for (const length of lengths) expect(length).toBeCloseTo(speed, 9);
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

  /**
   * One level 1 champion of `type` alone against one building, until it has
   * landed three swings. The building is level 8, so it outlasts them: a fall
   * would hand over the rest of its buffer at no multiplier.
   */
  const championLoot = (type: number, building: { t: number; st?: number }) => {
    const yard = yardOf({ "1": { id: 1, l: 8, X: 0, Y: 0, ...building } });
    const battle = createBattle(yard, { seed: 9, playerLevel: 20 });
    battle.apply({
      kind: "fling",
      t: 0,
      x: -150,
      y: -150,
      r: 100,
      monsters: {},
      champion: { t: type, l: 1 },
    });
    const amounts: number[] = [];
    let seen = 0;
    for (let step = 0; step < 8000 && amounts.length < 3; step += 1) {
      battle.step();
      for (const event of battle.recentEvents(seen)) {
        if (event.kind === "hit" && event.amount > 0) amounts.push(event.amount);
      }
      seen = battle.tick;
    }
    return { amounts, standing: yard.buildings[0]!.hp > 0, loss: battle.state().defenderLoss.r1 };
  };

  it("gives Krallen (G5), and no other champion, its loot multipliers (issue #80)", () => {
    // `champions/Krallen.as:31-32`: twice from a harvester, three times from storage.
    for (const type of [1, 2, 3, 4, 5]) {
      const krallen = type === 5;
      const harvester = championLoot(type, { t: 1, st: 1_000_000 });
      expect(harvester.amounts, `G${type}`).toHaveLength(3);
      expect(harvester.standing, `G${type}`).toBe(true);
      const fromHarvester = harvester.amounts.reduce(
        (sum, amount) => sum + Math.floor(amount * (krallen ? 2 : 1)),
        0,
      );
      expect(harvester.loss, `G${type} harvester`).toBe(fromHarvester);

      const storage = championLoot(type, { t: 6 });
      expect(storage.amounts, `G${type}`).toHaveLength(3);
      expect(storage.standing, `G${type}`).toBe(true);
      const fromStorage = storage.amounts.reduce(
        (sum, amount) => sum + Math.ceil(amount * (krallen ? 3 : 1)),
        0,
      );
      expect(storage.loss, `G${type} storage`).toBe(fromStorage);
    }
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

describe("where a fling's creeps land (issue #91)", () => {
  /** 300 Pokeys, 2,100 bucket units: a zone of size 525 and a scatter of 131.25. */
  const PAYLOAD = { C1: 300 };
  const flung = (seed: number) => {
    const battle = createBattle(yardOf({}), { seed });
    battle.apply({ kind: "fling", t: 0, x: 40, y: -60, r: 0, monsters: PAYLOAD });
    return battle.creeps();
  };

  it("reaches a quarter of the drop zone's size, which is half the logged radius", () => {
    // `DROPZONE.Drop` passes `_size / 2`, `ATTACK.Spawn` goes up to half of that.
    for (const bucket of [0, 700, 2100, 2250]) {
      const size = Math.max(200, bucket / 4);
      expect(scatterRadius(bucket)).toBe(size / 4);
      expect(scatterRadius(bucket)).toBe(dropRadius(bucket) / 2);
    }
    expect(scatterRadius(bucketCost(PAYLOAD, {}))).toBe(131.25);
  });

  it("scatters over a circle on screen, not in yard units", () => {
    const reach = scatterRadius(bucketCost(PAYLOAD, {}));
    const creeps = flung(9);
    expect(creeps).toHaveLength(300);
    let furthestOnScreen = 0;
    let furthestInYard = 0;
    for (const creep of creeps) {
      const onScreen = Math.sqrt(screenDistanceSquared(creep.ix, creep.iy, 40, -60));
      expect(onScreen).toBeLessThanOrEqual(reach + 1e-9);
      furthestOnScreen = Math.max(furthestOnScreen, onScreen);
      furthestInYard = Math.max(furthestInYard, Math.hypot(creep.ix - 40, creep.iy + 60));
    }
    expect(furthestOnScreen).toBeGreaterThan(reach * 0.95);
    // Straight down the screen a pixel is 1.41 yard units, so a screen circle
    // reaches past its own radius in yard units; a yard circle could not.
    expect(furthestInYard).toBeGreaterThan(reach * 1.2);
  });

  it("draws the distance uniformly along the radius, as Flash does", () => {
    // `random * param2 / 2` crowds the middle: half the creeps inside half
    // the radius, where a uniform disc would put a quarter there.
    const reach = scatterRadius(bucketCost(PAYLOAD, {}));
    const distances = flung(4)
      .map((creep) => Math.sqrt(screenDistanceSquared(creep.ix, creep.iy, 40, -60)) / reach)
      .sort((a, b) => a - b);
    const median = distances[distances.length / 2]!;
    expect(median).toBeGreaterThan(0.4);
    expect(median).toBeLessThan(0.6);
  });

  it("puts every creep of the same log in the same place", () => {
    expect(flung(12)).toEqual(flung(12));
  });
});

describe("a bunker's reach (issue #91)", () => {
  /**
   * A level 1 Monster Bunker (range 300, 90 x 90) at the origin scans from the
   * middle of its footprint, (45, 45) (`HOUSINGBUNKER.as:156`,
   * `BUILDING22.as:90`). A Pokey dropped by a harvester off to the south-east
   * stops at it and swings; the bunker's first look is on tick 30.
   */
  const battleOf = (harvesterAt: number) => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: harvesterAt, Y: harvesterAt },
    });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C1: 2 } } });
    battle.apply({
      kind: "fling",
      t: 0,
      x: harvesterAt - 20,
      y: harvesterAt - 20,
      r: 0,
      monsters: { C1: 1 },
    });
    run(battle, 29);
    const pokey = battle.creeps()[0]!;
    run(battle, 1);
    const defenders = battle.creeps().filter((creep) => creep.friendly);
    return { pokey, defenders };
  };

  it("sends a defender at a creep in range of the middle but not of the anchor", () => {
    const { pokey, defenders } = battleOf(290);
    expect(Math.hypot(pokey.ix, pokey.iy)).toBeGreaterThan(300);
    expect(Math.hypot(pokey.ix - 45, pokey.iy - 45)).toBeLessThan(300);
    expect(defenders).toHaveLength(1);
  });

  it("still sends nothing at a creep out of range of the middle", () => {
    const { pokey, defenders } = battleOf(350);
    expect(Math.hypot(pokey.ix - 45, pokey.iy - 45)).toBeGreaterThan(300);
    expect(defenders).toHaveLength(0);
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
    // The Pokey got ten swings in before it died, 60 a swing, on foot, at
    // the tower it was standing on.
    expect(hits).toHaveLength(10);
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
