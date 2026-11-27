import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import {
  FROSTBALL_TICKS,
  FROSTBITE_SECONDS,
  frostAreaRadius,
  frostAreaSlow,
  frostAreaTicks,
  frostballSlow,
  frostbiteShare,
} from "./frost.js";
import { TICKS_PER_SECOND } from "./stats.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap, RaidEvent, Roster } from "./types.js";

/**
 * The frost tribe's own abilities (beta 10, owner 27 Nov 2026, `frost.ts`):
 * a frost Eye-ra leaves a frost area that slows towers, a frost Teratorn's
 * frostballs chill what they hit, a frost Fang's bites leave frostbite.
 * Every other frost monster, and every normal one, fights as before (the
 * golden replays pin that).
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
  });

type Battle = ReturnType<typeof createBattle>;

const run = (battle: Battle, ticks: number): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) battle.step();
};

const fling = (battle: Battle, at: number, monsters: Roster) =>
  battle.apply({ kind: "fling", t: battle.tick, x: at, y: at, r: 20, monsters });

const raid = (battle: Battle, monsters: Roster, extra: Partial<RaidEvent> = {}) =>
  battle.apply({ kind: "raid", t: battle.tick, x: -300, y: -300, r: 20, monsters, ...extra });

/** A lone harvester with plenty of health to bite on. */
const harvesterYard = () =>
  yardOf({ "1": { id: 1, t: 1, l: 10, X: 0, Y: 0, st: 1_000_000 } });

/** A Cannon Tower (2) behind a wall (3) by a harvester (1). */
const towerYard = () =>
  yardOf({
    "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 1_000_000 },
    "2": { id: 2, t: 20, l: 1, X: 100, Y: 0 },
    "3": { id: 3, t: 17, l: 1, X: 60, Y: -40 },
  });

describe("the frost numbers (proposed, frost.ts)", () => {
  it("grow from level 1 to 6", () => {
    expect([1, 6].map(frostAreaRadius)).toEqual([160, 210]);
    expect([1, 6].map(frostAreaSlow)).toEqual([25, 40]);
    expect([1, 6].map(frostAreaTicks)).toEqual([5 * 80, 7.5 * 80]);
    expect([1, 6].map(frostballSlow)).toEqual([15, 20]);
    expect(FROSTBALL_TICKS).toBe(2 * TICKS_PER_SECOND);
    expect([1, 6].map(frostbiteShare)).toEqual([0.24, 0.33]);
    expect(FROSTBITE_SECONDS).toBe(3);
  });
});

describe("a frost Fang's frostbite", () => {
  const bitten = (frost: boolean, ticks: number) => {
    const battle = createBattle(harvesterYard(), { seed: 5, frostAttackers: frost });
    fling(battle, -40, { C8: 1 });
    run(battle, ticks);
    return battle;
  };

  it("bites harder over time than a normal Fang, on a building", () => {
    const ticks = 20 * TICKS_PER_SECOND;
    const normal = bitten(false, ticks).state().health["1"] ?? 0;
    const frost = bitten(true, ticks).state().health["1"] ?? 0;
    expect(frost).toBeLessThan(normal);
  });

  it("marks the Fang as frost on the field, and only when the fight says so", () => {
    expect(bitten(true, 2).creeps()[0]?.frost).toBe(true);
    expect(bitten(false, 2).creeps()[0]?.frost).toBeUndefined();
  });

  it("frostbites a defender it fights, which shows on the defender", () => {
    const battle = createBattle(
      yardOf({
        "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 1_000_000 },
        "3": { id: 3, t: 22, l: 1, X: 0, Y: 120 },
      }),
      { seed: 3, frostAttackers: true, bunkers: { 3: { C12: 1 } } },
    );
    fling(battle, 40, { C8: 4 });
    let seen = false;
    for (let step = 0; step < 30 * TICKS_PER_SECOND && !battle.over() && !seen; step += 1) {
      battle.step();
      seen = battle.creeps().some((creep) => creep.friendly && creep.frostbitten === true);
    }
    expect(seen).toBe(true);
  });
});

describe("a frost Teratorn's frostball", () => {
  it("chills the towers round what it hits", () => {
    const battle = createBattle(
      yardOf({ "2": { id: 2, t: 20, l: 1, X: 0, Y: 0 } }),
      { seed: 7, frostAttackers: true },
    );
    fling(battle, -120, { C14: 1 });
    let chilledAt = -1;
    for (let step = 0; step < 20 * TICKS_PER_SECOND && chilledAt < 0; step += 1) {
      battle.step();
      if (battle.chilledTowers().includes(2)) chilledAt = battle.tick;
    }
    expect(chilledAt).toBeGreaterThan(0);
  });

  it("does not chill when the Teratorn is not frost", () => {
    const battle = createBattle(yardOf({ "2": { id: 2, t: 20, l: 1, X: 0, Y: 0 } }), { seed: 7 });
    fling(battle, -120, { C14: 1 });
    let chilled = false;
    for (let step = 0; step < 20 * TICKS_PER_SECOND && !chilled; step += 1) {
      battle.step();
      chilled = battle.chilledTowers().length > 0;
    }
    expect(chilled).toBe(false);
  });
});

describe("a frost Eye-ra's frost area", () => {
  it("leaves an area that slows the tower inside it, and melts", () => {
    const battle = createBattle(towerYard(), { seed: 11, frostAttackers: true });
    fling(battle, -40, { C5: 1 });
    let burstAt = -1;
    for (let step = 0; step < 30 * TICKS_PER_SECOND && burstAt < 0; step += 1) {
      battle.step();
      if (battle.frostAreas().length > 0) burstAt = battle.tick;
    }
    expect(burstAt).toBeGreaterThan(0);
    const area = battle.frostAreas()[0];
    expect(area?.radius).toBe(frostAreaRadius(1));
    expect(area?.until).toBe(burstAt + frostAreaTicks(1));
    expect(battle.chilledTowers()).toEqual([2]);
    run(battle, frostAreaTicks(1));
    expect(battle.frostAreas()).toEqual([]);
    expect(battle.chilledTowers()).toEqual([]);
  });

  it("leaves nothing when the Eye-ra is not frost", () => {
    const battle = createBattle(towerYard(), { seed: 11 });
    fling(battle, -40, { C5: 1 });
    run(battle, 30 * TICKS_PER_SECOND);
    expect(battle.frostAreas()).toEqual([]);
  });

  it("slows the tower: it shoots less often inside the area", () => {
    const shots = (frost: boolean) => {
      const battle = createBattle(towerYard(), { seed: 11, frostAttackers: frost });
      fling(battle, -40, { C5: 1 });
      // Pokeys for the tower to shoot at once the Eye-ra has burst.
      run(battle, 4 * TICKS_PER_SECOND);
      fling(battle, 200, { C1: 40 });
      run(battle, 4 * TICKS_PER_SECOND);
      return battle.state().towers.find((tower) => tower.id === 2)?.shots ?? 0;
    };
    expect(shots(true)).toBeLessThan(shots(false));
  });
});

describe("a frost raid wave", () => {
  it("brings frost raiders only when it says so", () => {
    const battle = createBattle(harvesterYard(), { seed: 2, raid: true });
    raid(battle, { C8: 1 }, { frost: true });
    raid(battle, { C1: 1 });
    const creeps = battle.creeps();
    expect(creeps.find((creep) => creep.monsterId === "C8")?.frost).toBe(true);
    expect(creeps.find((creep) => creep.monsterId === "C1")?.frost).toBeUndefined();
  });

  it("brings Krampus (champion type 6) when a wave names him", () => {
    const battle = createBattle(harvesterYard(), { seed: 2, raid: true });
    raid(battle, {}, { frost: true, champion: { t: 6, l: 6 } });
    expect(battle.creeps().some((creep) => creep.monsterId === "G6")).toBe(true);
  });
});
