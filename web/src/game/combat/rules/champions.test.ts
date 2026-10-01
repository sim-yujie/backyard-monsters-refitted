import { describe, expect, it } from "vitest";

import {
  ENRAGE_INTERVAL,
  FLAME_INTERVAL,
  QUAKE_STRIKE_FRAME,
  fomorBuff,
  linearAreaDamage,
} from "./champions.js";
import { createBattle, type BattleVisualEvent, type CreepSnapshot } from "./engine.js";
import { championStatWithPower } from "./stats.js";
import { findChampionTarget } from "./targeting.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap, Roster } from "./types.js";

/**
 * Issue #222: the Flash champions' own behaviour, one ability at a time, on
 * both sides of the fight where Flash gives it both.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
  });

type Battle = ReturnType<typeof createBattle>;

/** Steps `ticks` times, handing every new visual event to `seen`. */
const watch = (
  battle: Battle,
  ticks: number,
  seen: (event: BattleVisualEvent, battle: Battle) => void = () => {},
): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    const before = battle.tick;
    battle.step();
    for (const event of battle.recentEvents(before)) seen(event, battle);
  }
};

const run = (battle: Battle, ticks: number): void => watch(battle, ticks);

const fling = (
  battle: Battle,
  at: number,
  monsters: Roster,
  champion?: { t: number; l: number; pl?: number },
  t = 0,
) =>
  battle.apply({
    kind: "fling",
    t,
    x: at,
    y: at,
    r: 100,
    monsters,
    ...(champion ? { champion } : {}),
  });

const championOf = (battle: Battle, friendly: boolean): CreepSnapshot | undefined =>
  battle.creeps().find((creep) => creep.champion && creep.friendly === friendly);

describe("a champion's building (`ChampionBase.findTarget`)", () => {
  const context = { bunkerInUse: () => false };
  // A Hatchery (13) right by the champion, a Cannon Tower a little further,
  // a harvester further still.
  const yard = () =>
    yardOf({
      "1": { id: 1, t: 13, l: 1, X: 20, Y: 20 },
      "2": { id: 2, t: 20, l: 1, X: 300, Y: 300 },
      "3": { id: 3, t: 1, l: 1, X: 600, Y: 600, st: 5000 },
    });

  it("takes the closest harvester, store, Town Hall, outpost, tower or bunker in use", () => {
    // The Hatchery is a `special` none of the three lists holds.
    expect(findChampionTarget(yard(), 0, 0, context, false)?.id).toBe(2);
  });

  it("takes any main building only when those lists are empty", () => {
    const hatcheryOnly = yardOf({ "1": { id: 1, t: 13, l: 1, X: 20, Y: 20 } });
    expect(findChampionTarget(hatcheryOnly, 0, 0, context, false)?.id).toBe(1);
  });

  it("sends Krallen to loot first, past a closer tower (`Krallen.as:88-103`)", () => {
    expect(findChampionTarget(yard(), 0, 0, context, true)?.id).toBe(3);
  });

  it("counts storage as never drained, and a drained harvester only after towers", () => {
    const drained = yardOf({
      "2": { id: 2, t: 20, l: 1, X: 300, Y: 300 },
      "3": { id: 3, t: 1, l: 1, X: 50, Y: 50 },
      "4": { id: 4, t: 6, l: 1, X: 900, Y: 900 },
    });
    // The harvester holds nothing, so it is drained; the silo never is.
    expect(findChampionTarget(drained, 0, 0, context, true)?.id).toBe(4);
    const noStore = yardOf({
      "2": { id: 2, t: 20, l: 1, X: 300, Y: 300 },
      "3": { id: 3, t: 1, l: 1, X: 50, Y: 50 },
    });
    expect(findChampionTarget(noStore, 0, 0, context, true)?.id).toBe(2);
    const noTower = yardOf({ "3": { id: 3, t: 1, l: 1, X: 50, Y: 50 } });
    expect(findChampionTarget(noTower, 0, 0, context, true)?.id).toBe(3);
  });
});

describe("Korath (issue #222)", () => {
  /** A Champion Cage with a Town Hall beside it for the attackers to go for. */
  const cageYard = () =>
    yardOf({
      "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 14, l: 10, X: 120, Y: 120 },
    });

  const korathHits = (battle: Battle, ticks: number) => {
    const hits: Array<{ tick: number; amount: number; target: number }> = [];
    const hurts: Array<{ tick: number; amount: number; creep: number }> = [];
    const quakes: Array<{ tick: number; radius: number }> = [];
    watch(battle, ticks, (event, current) => {
      const korath = championOf(current, true) ?? championOf(current, false);
      if (event.kind === "hit" && event.creepId === korath?.id) {
        hits.push({ tick: event.tick, amount: event.amount, target: event.creepTargetId });
      }
      if (event.kind === "hurt") {
        hurts.push({ tick: event.tick, amount: event.amount, creep: event.creepId });
      }
      if (event.kind === "quake") quakes.push({ tick: event.tick, radius: event.radius });
    });
    return { hits, hurts, quakes };
  };

  it("fireballs a flyer for a quarter of his damage from power level 2 at level 4, and it burns", () => {
    const battle = createBattle(cageYard(), {
      seed: 5,
      defenderChampion: { t: 4, l: 4, hp: 200_000, pl: 2 },
    });
    fling(battle, 140, { C14: 3 });
    const { hits, hurts } = korathHits(battle, 1200);
    const damage = championStatWithPower("G4", "damage", 4, 2);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.amount).toBeLessThanOrEqual(Math.trunc(damage / 4));
    expect(hits[0]?.amount).toBe(Math.trunc(damage / 4));
    // The flame: a tenth of his damage every 40 ticks, from the first fireball on.
    const first = hits[0]!;
    const flame = hurts.filter(
      (hurt) => hurt.creep === first.target && hurt.amount === damage * 0.1,
    );
    expect(flame.length).toBeGreaterThan(0);
    expect(flame[0]!.tick - first.tick).toBe(FLAME_INTERVAL);
  });

  it("cannot touch a flyer without the fireball", () => {
    const battle = createBattle(cageYard(), {
      seed: 5,
      defenderChampion: { t: 4, l: 4, hp: 200_000, pl: 1 },
    });
    fling(battle, 140, { C14: 3 });
    expect(korathHits(battle, 1200).hits).toEqual([]);
  });

  it("quakes after three blows, 48 frames after he stops, from power level 3 at level 5", () => {
    const battle = createBattle(cageYard(), {
      seed: 5,
      levels: { C6: 10 },
      defenderChampion: { t: 4, l: 5, hp: 500_000, pl: 3 },
    });
    fling(battle, 140, { C6: 30 });
    const { hits, quakes } = korathHits(battle, 1500);
    const range = championStatWithPower("G4", "range", 5, 3);
    expect(quakes.length).toBeGreaterThan(0);
    expect(quakes[0]!.radius).toBe(range * 2.5);
    // Three blows, then the stand: nothing lands until the quake, 48 frames in.
    const before = hits.filter((hit) => hit.tick < quakes[0]!.tick);
    expect(before.length).toBe(3);
    expect(quakes[0]!.tick - before[2]!.tick).toBeGreaterThanOrEqual(QUAKE_STRIKE_FRAME);
  });

  it("never quakes a power level short", () => {
    const battle = createBattle(cageYard(), {
      seed: 5,
      levels: { C6: 10 },
      defenderChampion: { t: 4, l: 5, hp: 500_000, pl: 2 },
    });
    fling(battle, 140, { C6: 30 });
    expect(korathHits(battle, 1500).quakes).toEqual([]);
  });

  it("quakes buildings too when he attacks, walls included, looting at 1", () => {
    // A Town Hall ringed by walls; Korath swings at the hall and then stomps.
    const buildings: Record<string, CombatBuildingDataMap[string]> = {
      "1": { id: 1, t: 14, l: 10, X: 0, Y: 0 },
    };
    for (let index = 0; index < 6; index += 1) {
      const id = 10 + index;
      buildings[String(id)] = { id, t: 17, l: 1, X: -40 + index * 20, Y: 140 };
    }
    const yard = yardOf(buildings);
    const battle = createBattle(yard, { seed: 9 });
    fling(battle, 160, {}, { t: 4, l: 6, pl: 3 });
    const { quakes } = korathHits(battle, 1200);
    expect(quakes.length).toBeGreaterThan(0);
    const walls = yard.buildings.filter((building) => building.type === 17);
    expect(walls.some((wall) => wall.hp < wall.maxHp)).toBe(true);
  });

  it("deals the linear blast of `DealLinearAEDamage`", () => {
    // Radius 162.5, full inside 97.5, a fifth at least.
    expect(linearAreaDamage(6000, 162.5, 97.5, 50)).toBe(6000);
    expect(linearAreaDamage(6000, 162.5, 97.5, 120.9)).toBe(Math.trunc((6000 / 162.5) * 42.5));
    expect(linearAreaDamage(6000, 162.5, 97.5, 160)).toBe(1200);
    expect(linearAreaDamage(6000, 162.5, 97.5, 163)).toBeUndefined();
  });
});

describe("Fomor (issue #222)", () => {
  it("enrages its own side within 250: faster, and a hit costs them a quarter at buff 0.75", () => {
    // A Cannon Tower (20 a shot, 30 splash) beside a harvester.
    const yard = yardOf({
      "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 100_000 },
      "2": { id: 2, t: 20, l: 1, X: 100, Y: 0 },
    });
    const battle = createBattle(yard, { seed: 4 });
    fling(battle, -60, { C1: 6 }, { t: 3, l: 6, pl: 3 });
    expect(fomorBuff(6, 3)).toBeCloseTo(0.75, 12);
    const fomorId = championOf(battle, false)!.id;
    const shotsOnEnraged: number[] = [];
    watch(battle, 600, (event, current) => {
      if (event.kind !== "hurt" || event.creepId === fomorId) return;
      const creep = current.creeps().find((one) => one.id === event.creepId);
      if (creep?.enraged) shotsOnEnraged.push(event.amount);
    });
    expect(shotsOnEnraged.length).toBeGreaterThan(0);
    // 20 a shot, 6 of splash at least, each cut to a quarter.
    for (const amount of shotsOnEnraged) expect(amount).toBeLessThanOrEqual(5);
  });

  it("enrages nothing before its aura first looks, 30 ticks in", () => {
    const yard = yardOf({ "1": { id: 1, t: 14, l: 10, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 4 });
    fling(battle, -60, { C1: 6 }, { t: 3, l: 6, pl: 3 });
    run(battle, ENRAGE_INTERVAL - 1);
    expect(battle.creeps().some((creep) => creep.enraged)).toBe(false);
    run(battle, 1);
    expect(battle.creeps().filter((creep) => creep.enraged).length).toBeGreaterThan(0);
    expect(championOf(battle, false)?.enraged).toBe(false);
  });

  it("enrages a bunker's defenders when it defends from the cage", () => {
    const yard = yardOf({
      "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 22, l: 1, X: 120, Y: 0 },
      "3": { id: 3, t: 1, l: 1, X: 120, Y: 120, st: 100_000 },
    });
    const battle = createBattle(yard, {
      seed: 4,
      bunkers: { 2: { C1: 8 } },
      defenderChampion: { t: 3, l: 6, hp: 40_000, pl: 3 },
    });
    fling(battle, 140, { C1: 10 });
    let enragedDefender = false;
    watch(battle, 400, (_event, current) => {
      if (current.creeps().some((creep) => creep.friendly && !creep.champion && creep.enraged)) {
        enragedDefender = true;
      }
    });
    expect(enragedDefender).toBe(true);
  });

  it("follows a wounded ally and takes on the building it is on", () => {
    // Fomor lands by harvester A; a Pokey pack lands by harvester B, under a tower.
    const yard = yardOf({
      "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 100_000 },
      "2": { id: 2, t: 1, l: 1, X: 700, Y: 700, st: 100_000 },
      "3": { id: 3, t: 20, l: 1, X: 800, Y: 700 },
    });
    const battle = createBattle(yard, { seed: 8, levels: { C6: 10 } });
    fling(battle, -40, {}, { t: 3, l: 3 });
    fling(battle, 660, { C6: 3 });
    run(battle, 20);
    expect(championOf(battle, false)?.targetBuilding).toBe(1);
    let followed = false;
    watch(battle, 600, (_event, current) => {
      if (championOf(current, false)?.targetBuilding === 2) followed = true;
    });
    expect(followed).toBe(true);
  });
});

describe("Krallen (issue #222)", () => {
  const lootWith = (pl: number) => {
    const yard = yardOf({ "1": { id: 1, t: 14, l: 10, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 6 });
    fling(battle, -60, { C1: 6 }, { t: 5, l: 5, pl });
    let boosted = false;
    watch(battle, 600, (_event, current) => {
      if (current.creeps().some((creep) => creep.lootBoosted)) boosted = true;
    });
    return { loot: battle.state().loot.r1, boosted };
  };

  it("raises the looting of the creeps around her from power level 2", () => {
    const aura = lootWith(2);
    const none = lootWith(1);
    expect(aura.boosted).toBe(true);
    expect(none.boosted).toBe(false);
    expect(aura.loot).toBeGreaterThan(none.loot);
  });

  it("keeps her aura on until she has walked off, not the moment she is called back", () => {
    const yard = yardOf({ "1": { id: 1, t: 14, l: 10, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 6 });
    // Flung far from the harvester, so her walk back is a long one.
    battle.apply({
      kind: "fling",
      t: 0,
      x: -400,
      y: -400,
      r: 100,
      monsters: { C1: 6 },
      champion: { t: 5, l: 5, pl: 2 },
    });
    run(battle, 500);
    expect(battle.creeps().some((creep) => creep.lootBoosted)).toBe(true);
    const hp = championOf(battle, false)!.hp;
    battle.apply({ kind: "championRetreat", t: battle.tick, c: 5 });
    run(battle, 1);
    expect(championOf(battle, false)).toBeUndefined();
    expect(battle.state().championsHp["G5"]).toBe(hp);
    expect(battle.creeps().some((creep) => creep.lootBoosted)).toBe(true);
    run(battle, 1500);
    expect(battle.creeps().some((creep) => creep.lootBoosted)).toBe(false);
  });
});

describe("the Retreat champion button (issue #222)", () => {
  it("calls one champion back with its health, and the attack goes on", () => {
    const yard = yardOf({
      "1": { id: 1, t: 14, l: 10, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 1, X: 150, Y: 0 },
    });
    const battle = createBattle(yard, { seed: 2 });
    fling(battle, -80, { C1: 20 }, { t: 1, l: 4 });
    run(battle, 400);
    const gorgo = championOf(battle, false)!;
    expect(gorgo.hp).toBeGreaterThan(0);
    battle.apply({ kind: "championRetreat", t: battle.tick, c: 1 });
    run(battle, 1);
    expect(championOf(battle, false)).toBeUndefined();
    expect(battle.state().championsHp["G1"]).toBe(gorgo.hp);
    expect(battle.state().creepsAlive).toBeGreaterThan(0);
    expect(battle.over()).toBe(false);
  });

  it("does nothing for a champion that is not on the field", () => {
    const yard = yardOf({ "1": { id: 1, t: 14, l: 10, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 2 });
    fling(battle, -80, { C1: 5 });
    run(battle, 10);
    const before = battle.checkpoint();
    battle.apply({ kind: "championRetreat", t: battle.tick, c: 3 });
    expect(battle.checkpoint()).toEqual(before);
  });
});

describe("a champion's start frame (issue #222)", () => {
  it("draws one number for a champion on foot and two for a flyer", () => {
    const draws = (champion: { t: number; l: number }) => {
      const yard = yardOf({ "1": { id: 1, t: 14, l: 10, X: 0, Y: 0 } });
      const battle = createBattle(yard, { seed: 11 });
      const before = battle.state().rngDraws;
      fling(battle, -80, {}, champion);
      const after = battle.state().rngDraws;
      // The drop point's own draws, the same for the same seed and spot.
      const bare = createBattle(yardOf({ "1": { id: 1, t: 14, l: 10, X: 0, Y: 0 } }), { seed: 11 });
      fling(bare, -80, { C1: 1 });
      return after - before - bare.state().rngDraws;
    };
    expect(draws({ t: 1, l: 1 })).toBe(1);
    // Fomor flies from level 3 (`CHAMPIONCAGE.as:160`).
    expect(draws({ t: 3, l: 3 })).toBe(2);
  });
});
