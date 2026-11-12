import { describe, expect, it } from "vitest";

import {
  createBattle,
  raiseOrbFlight,
  type Battle,
  type BattleOptions,
  type BattleVisualEvent,
  type CreepSnapshot,
} from "./engine.js";
import { TICKS_PER_SECOND } from "./stats.js";
import type { CombatBuildingDataMap } from "./types.js";
import { buildEngineYard } from "./yard.js";

/**
 * Rezghul raises the dead as Flash's does (`creeps/Rezghul.as`,
 * `components/abilities/RezghulResurrectAttack.as`, `Zombiefy.as`,
 * `projectiles/ResurrectProjectile.as`): a raise thrown every
 * `resurrectCooldown` whole seconds while it is in battle, fighting a
 * defender or not, at a corpse of its own side within 300; it flies at 2 px a
 * loop and raises every corpse of its side within 50 of where it lands, as
 * grey zombies. A defending Rezghul raises the defenders.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

interface Watched {
  readonly throws: Extract<BattleVisualEvent, { kind: "raiseOrb" }>[];
  readonly rises: Extract<BattleVisualEvent, { kind: "rise" }>[];
  /** Each creep that joined the field after the first tick, as it first showed. */
  readonly born: Array<{ readonly tick: number; readonly creep: CreepSnapshot }>;
  /** The throwing Rezghul's snapshot on the tick of each throw. */
  readonly throwers: CreepSnapshot[];
}

const watch = (battle: Battle, ticks: number): Watched => {
  const watched: Watched = { throws: [], rises: [], born: [], throwers: [] };
  const seen = new Set(battle.creeps().map((creep) => creep.id));
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    battle.step();
    const creeps = battle.creeps();
    for (const event of battle.recentEvents(battle.tick - 1)) {
      if (event.kind === "raiseOrb") {
        watched.throws.push(event);
        const thrower = creeps.find((creep) => creep.id === event.creepId);
        if (thrower) watched.throwers.push(thrower);
      }
      if (event.kind === "rise") watched.rises.push(event);
    }
    for (const creep of creeps) {
      if (seen.has(creep.id)) continue;
      seen.add(creep.id);
      watched.born.push({ tick: battle.tick, creep });
    }
  }
  return watched;
};

/**
 * Six Pokeys and a level 3 Rezghul dropped on a harvester between two level
 * 6 Cannon Towers, which cut the Pokeys down. Cannons never reach the air,
 * so an Aerial Defense joins them where a flyer is dropped.
 */
const cannonYard = (monsters: Record<string, number>, options: Partial<BattleOptions> = {}) => {
  const yard = yardOf({
    "1": { id: 1, t: 20, l: 6, X: 0, Y: 0 },
    "2": { id: 2, t: 20, l: 6, X: 100, Y: 0 },
    "3": { id: 3, t: 115, l: 3, X: 0, Y: 100 },
    "4": { id: 4, t: 1, l: 1, X: 150, Y: 150 },
  });
  const battle = createBattle(yard, { seed: 3, levels: { C19: 3 }, ...options });
  battle.apply({ kind: "fling", t: 0, x: 150, y: 150, r: 0, monsters });
  return battle;
};

/**
 * A level 1 Monster Bunker at the origin with a harvester by it, as the
 * bunker tests use (`housingBunker.test.ts`): attackers dropped on the
 * harvester are met by what the bunker holds.
 */
const bunkerYard = (
  attackers: Record<string, number>,
  garrison: Record<string, number>,
  options: Partial<BattleOptions> = {},
) => {
  const yard = yardOf({
    "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
    "2": { id: 2, t: 1, l: 1, X: 160, Y: 160 },
  });
  const battle = createBattle(yard, {
    seed: 3,
    levels: { C19: 3 },
    defenderLevels: { C19: 3 },
    bunkers: { 1: garrison },
    ...options,
  });
  battle.apply({ kind: "fling", t: 0, x: 160, y: 160, r: 0, monsters: attackers });
  return battle;
};

describe("the raise's flight (ResurrectProjectile.as, Projectilev2.as:107-135)", () => {
  it("moves 2 px a loop and lands the loop it comes within 2 px", () => {
    // 100 px: 49 more loops after the first, and it lands on its aim.
    expect(raiseOrbFlight(0, 0, 100, 0)).toEqual({ loops: 49, x: 100, y: 0 });
    // Already there: it lands at once, one step along x (`atan2(0, 0)` is 0).
    expect(raiseOrbFlight(5, 5, 5, 5)).toEqual({ loops: 0, x: 7, y: 5 });
  });
});

describe("Rezghul raises the dead (issue #129)", () => {
  it("raises the fallen Pokeys as grey zombies with the Rezghul's health multiplier", () => {
    const { born } = watch(cannonYard({ C1: 6, C19: 1 }), 3000);
    expect(born.length).toBeGreaterThan(0);
    for (const { creep } of born) {
      expect(creep.monsterId).toBe("C1");
      expect(creep.friendly).toBe(false);
      // A level 1 Pokey's 200, times a level 3 Rezghul's 1.2 (`CREATURELOCKER.as:594`).
      expect(creep.maxHp).toBe(240);
      expect(creep.hp).toBe(240);
      expect(creep.zombie).toBe(true);
    }
  });

  it("throws a raise that flies before anyone rises, and raises where it lands", () => {
    const { throws, rises } = watch(cannonYard({ C1: 6, C19: 1 }), 3000);
    expect(throws.length).toBeGreaterThan(0);
    expect(rises.length).toBeGreaterThan(0);
    // Every rising comes on the loop a raise landed, not the one it was thrown.
    const landings = new Set(throws.map((orb) => orb.landTick));
    for (const rise of rises) expect(landings.has(rise.tick)).toBe(true);
    expect(throws.some((orb) => orb.landTick > orb.tick)).toBe(true);
    for (const orb of throws) {
      // 2 px a loop: the yard points it flew between, back on screen.
      const dx = orb.toIx - orb.fromIx - (orb.toIy - orb.fromIy);
      const dy = (orb.toIx - orb.fromIx + (orb.toIy - orb.fromIy)) / 2;
      const length = Math.sqrt(dx * dx + dy * dy);
      expect(length).toBeCloseTo((orb.landTick - orb.tick + 1) * 2, 6);
    }
  });

  it("throws again only once 6 whole seconds of the clock have passed, at level 3", () => {
    const { throws } = watch(cannonYard({ C1: 6, C19: 1 }), 3000);
    expect(throws.length).toBeGreaterThan(1);
    for (let at = 1; at < throws.length; at += 1) {
      const second = Math.trunc(throws[at]!.tick / TICKS_PER_SECOND);
      const before = Math.trunc(throws[at - 1]!.tick / TICKS_PER_SECOND);
      expect(second - before).toBeGreaterThanOrEqual(6);
    }
  });

  it("raises each corpse once: a zombie leaves none", () => {
    const { born } = watch(cannonYard({ C1: 6, C19: 1 }), 3000);
    expect(born.length).toBeLessThanOrEqual(6);
  });

  it("raises nothing without a Rezghul, never a Mini and never a flyer", () => {
    expect(watch(cannonYard({ C1: 6 }), 3000).born).toHaveLength(0);
    // Slimeattikus falls and splits and its Minis fall too: every Mini that
    // joins is a fresh split at 250, never a zombie.
    const minis = watch(
      cannonYard({ C17: 2, C19: 1 }, { levels: { C19: 3, C17: 1 } }),
      3000,
    ).born.filter(({ creep }) => creep.monsterId === "C18");
    expect(minis.length).toBeGreaterThan(0);
    for (const { creep } of minis) expect(creep.zombie).toBeUndefined();
    // A Teratorn flies: its corpse is hit by `k_TARGETS_FLYING`, which the
    // raise does not carry (`Rezghul.as:49`, `Targeting.canHitCreep`).
    const { born } = watch(cannonYard({ C14: 4, C1: 4, C19: 1 }), 3000);
    expect(born.some(({ creep }) => creep.monsterId === "C1")).toBe(true);
    expect(born.some(({ creep }) => creep.monsterId === "C14")).toBe(false);
  });

  it("raises while it fights a bunker's defender, not only when it is free", () => {
    const { throwers, born } = watch(bunkerYard({ C1: 6, C19: 1 }, { C12: 2 }), 4000);
    const risen = born.filter(({ creep }) => creep.zombie && !creep.friendly);
    expect(risen.length).toBeGreaterThan(0);
    // At least one raise was thrown with a defender as its quarry.
    expect(throwers.some((rezghul) => rezghul.targetCreep >= 0)).toBe(true);
  });

  it("defending, raises the fallen defenders as defenders", () => {
    const { born, throwers } = watch(bunkerYard({ C1: 12 }, { C1: 6, C19: 1 }), 4000);
    expect(throwers.length).toBeGreaterThan(0);
    for (const rezghul of throwers) expect(rezghul.friendly).toBe(true);
    const risen = born.filter(({ creep }) => creep.zombie);
    expect(risen.length).toBeGreaterThan(0);
    for (const { creep } of risen) {
      expect(creep.friendly).toBe(true);
      expect(creep.monsterId).toBe("C1");
      expect(creep.maxHp).toBe(240);
    }
  });
});
