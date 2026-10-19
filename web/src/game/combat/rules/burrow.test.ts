import { describe, expect, it } from "vitest";

import { createBattle, type Battle, type BattleVisualEvent, type CreepSnapshot } from "./engine.js";
import {
  TRAP_TARGETS,
  canHit,
  defenseFlags,
  shellBlastTargets,
  towerTargets,
} from "./targeting.js";
import type { CombatBuildingDataMap, FlingEvent } from "./types.js";
import { buildEngineYard } from "./yard.js";

/**
 * The Wormzer tunnels (`MonsterBase.renderBurrow`, `MonsterBase.as:625-691`):
 * underground and invisible whenever it is not swinging, up to swing, and back
 * under for the next target. Only what reaches the invisible hurts it there.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

const dropOf = (id: string, x = 0, y = 0, count = 1): FlingEvent => ({
  kind: "fling",
  t: 0,
  x,
  y,
  r: 0,
  monsters: { [id]: count },
});

/** Steps the battle and hands every tick's creeps and new events to `each`. */
const watch = (
  battle: Battle,
  ticks: number,
  each: (creeps: readonly CreepSnapshot[], events: readonly BattleVisualEvent[]) => void,
): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    const before = battle.tick;
    battle.step();
    each(battle.creeps(), battle.recentEvents(before));
  }
};

const wormzerOf = (creeps: readonly CreepSnapshot[]) =>
  creeps.find((creep) => creep.monsterId === "C13" && !creep.friendly);

describe("the Wormzer's tunnel", () => {
  it("digs in at once, pops up to swing and goes back under for the next target", () => {
    // Two small huts far apart: it has to tunnel to the second after the first.
    const yard = yardOf({
      "1": { id: 1, t: 6, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 6, l: 1, X: 400, Y: 400 },
    });
    const battle = createBattle(yard, { seed: 7 });
    battle.apply(dropOf("C13", -250, -250));
    // Each tick reduced to U (underground), S (swinging) or W (walking above).
    const states: string[] = [];
    watch(battle, 6000, (creeps) => {
      const worm = wormzerOf(creeps);
      if (!worm) return;
      const now = worm.burrowed ? "U" : worm.state === "attacking" ? "S" : "W";
      if (states[states.length - 1] !== now) states.push(now);
    });
    // Under, up, under, up; above ground without a swing only as it leaves.
    expect(states.slice(0, 4)).toEqual(["U", "S", "U", "S"]);
    expect(states.slice(0, -1)).not.toContain("W");
    expect(yard.buildings.every((building) => building.hp <= 0)).toBe(true);
  });

  it("is drawn as burrowed, never as a see-through cloak", () => {
    const yard = yardOf({ "1": { id: 1, t: 6, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 7 });
    battle.apply(dropOf("C13", -250, -250));
    let burrowed = 0;
    let cloaked = 0;
    watch(battle, 400, (creeps) => {
      const worm = wormzerOf(creeps);
      if (worm?.burrowed) burrowed += 1;
      if (worm?.invisible) cloaked += 1;
    });
    expect(burrowed).toBeGreaterThan(0);
    expect(cloaked).toBe(0);
  });

  it("cannot be picked by a tower underground, and is shot once it surfaces", () => {
    // A Cannon Tower is the only building, so the Wormzer tunnels right up to it.
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 5 });
    battle.apply(dropOf("C13", -300, -300));
    let shotsUnder = 0;
    let shotsUp = 0;
    let last = 0;
    watch(battle, 4000, (creeps) => {
      const worm = wormzerOf(creeps);
      const shots = battle.state().towers[0]?.shots ?? 0;
      if (worm?.burrowed) shotsUnder += shots - last;
      else if (worm) shotsUp += shots - last;
      last = shots;
    });
    expect(shotsUnder).toBe(0);
    expect(shotsUp).toBeGreaterThan(0);
  });

  it("is shot all the way in when it walks instead (the Pokey, for contrast)", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 5 });
    battle.apply(dropOf("C1", -300, -300));
    let shotsWalking = 0;
    let last = 0;
    watch(battle, 4000, (creeps) => {
      const pokey = creeps.find((creep) => creep.monsterId === "C1");
      const shots = battle.state().towers[0]?.shots ?? 0;
      if (pokey && pokey.state === "walking") shotsWalking += shots - last;
      last = shots;
    });
    expect(shotsWalking).toBeGreaterThan(0);
  });

  it("sets off a trap it tunnels under", () => {
    const yard = yardOf({
      "1": { id: 1, t: 6, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 24, l: 1, X: -100, Y: -100 },
    });
    const battle = createBattle(yard, { seed: 5 });
    battle.apply(dropOf("C13", -250, -250));
    // The trap ticks before the creeps, so it went off under the Wormzer as
    // the tick before left it; the blast may well have killed it.
    let underBefore = false;
    let firedUnder: boolean | null = null;
    watch(battle, 1500, (creeps) => {
      if (yard.buildings[1]?.fired && firedUnder === null) firedUnder = underBefore;
      underBefore = wormzerOf(creeps)?.burrowed === true;
    });
    expect(firedUnder).toBe(true);
  });

  it("cannot be hurt by a bunker's monsters while it tunnels", () => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 6, l: 1, X: 150, Y: 150 },
    });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C10: 1 } } });
    battle.apply(dropOf("C13", 300, 300));
    let whileUnder = 0;
    watch(battle, 1500, (creeps, events) => {
      const taken = events.filter((event) => event.kind === "hurt" && !event.friendly).length;
      if (wormzerOf(creeps)?.burrowed) whileUnder += taken;
    });
    expect(whileUnder).toBe(0);
  });

  it("tunnels as a bunker's defender while it chases, up to bite", () => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 6, l: 1, X: 150, Y: 150 },
    });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C13: 2 } } });
    battle.apply(dropOf("C1", 300, 300, 3));
    let burrowed = 0;
    let bitUnder = 0;
    // Each defender's ticks reduced to U (underground), S (swinging) or W (walking above).
    const states = new Map<number, string[]>();
    watch(battle, 1500, (creeps) => {
      for (const creep of creeps) {
        if (!creep.friendly || creep.monsterId !== "C13") continue;
        if (creep.burrowed) burrowed += 1;
        if (creep.state === "attacking" && creep.burrowed) bitUnder += 1;
        const now = creep.burrowed ? "U" : creep.state === "attacking" ? "S" : "W";
        const seen = states.get(creep.id) ?? [];
        if (seen[seen.length - 1] !== now) seen.push(now);
        states.set(creep.id, seen);
      }
    });
    expect(burrowed).toBeGreaterThan(0);
    expect(bitUnder).toBe(0);
    // It tunnels to a foe and pops up to bite it.
    expect([...states.values()].some((seen) => seen.join("").includes("US"))).toBe(true);
  });

  it("cannot be hit by attackers while it tunnels as a defender", () => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 6, l: 1, X: 150, Y: 150 },
    });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C13: 2 } } });
    battle.apply(dropOf("C1", 300, 300, 3));
    let hitUnder = 0;
    let wasUnder = new Set<number>();
    watch(battle, 1500, (creeps, events) => {
      // Under at both ends of the tick, it was invisible all through it.
      for (const event of events) {
        if (event.kind !== "hurt" || !event.friendly) continue;
        const hit = creeps.find((creep) => creep.id === event.creepId);
        if (hit?.burrowed && wasUnder.has(hit.id)) hitUnder += 1;
      }
      wasUnder = new Set(
        creeps
          .filter((creep) => creep.friendly && creep.monsterId === "C13" && creep.burrowed)
          .map((creep) => creep.id),
      );
    });
    expect(hitUnder).toBe(0);
  });

  it("walks up to its next foe when it takes one close by, as Flash's defender does", () => {
    const yard = yardOf({ "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C13: 1 } } });
    battle.apply(dropOf("C1", 150, 150, 3));
    const states: string[] = [];
    watch(battle, 300, (creeps) => {
      const worm = creeps.find((creep) => creep.friendly && creep.monsterId === "C13");
      if (!worm) return;
      const now = worm.burrowed ? "U" : worm.state === "attacking" ? "S" : "W";
      if (states[states.length - 1] !== now) states.push(now);
    });
    // Out of the bunker it tunnels to its first foe; the next stands close, so it walks.
    expect(states.slice(0, 4)).toEqual(["U", "S", "W", "S"]);
  });
});

describe("what a shell's blast reaches", () => {
  const underground = defenseFlags(false, false, true);

  it("the Cannon's and the Inferno Cannon's reach the invisible, as a trap does", () => {
    expect(shellBlastTargets(20)).toBe(TRAP_TARGETS);
    expect(shellBlastTargets(130)).toBe(TRAP_TARGETS);
    expect(canHit(shellBlastTargets(20), underground)).toBe(true);
    // The tower itself still cannot pick it.
    expect(canHit(towerTargets(20), underground)).toBe(false);
  });

  it("every other tower's hits only what the tower aims at", () => {
    for (const type of [21, 25, 115, 129, 132]) {
      expect(shellBlastTargets(type)).toBe(towerTargets(type));
      expect(canHit(shellBlastTargets(type), underground)).toBe(false);
    }
  });
});
