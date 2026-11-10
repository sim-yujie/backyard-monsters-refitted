import { describe, expect, it } from "vitest";

import { linearAreaDamage } from "./champions.js";
import { createBattle, type BattleOptions, type BattleVisualEvent } from "./engine.js";
import { monsterStat } from "./stats.js";
import { buildEngineYard, distanceSquared, rangePointOf, screenDistanceSquared } from "./yard.js";
import type { CombatBuildingDataMap, CombatTargetKind } from "./types.js";

/**
 * Eye-ra's blast on monsters (patch 6.15), against Flash's `CreepBase.as`:
 * an attacking Eye-ra's blast hurts the defenders round it as well as the
 * buildings (`explode`, `:786-833`), and a defending one blows up on the
 * attacker it reaches, or where it falls, and is used up (`tickBDefend`,
 * `:995-1044`, `:1122-1163`).
 */

const yardOf = (buildings: CombatBuildingDataMap, kind: CombatTargetKind = "main") =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
    kind,
  });

type Battle = ReturnType<typeof createBattle>;

const run = (battle: Battle, ticks: number): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) battle.step();
};

/** Steps `ticks` (or to the end), keeping every visual event once. */
const eventsOf = (battle: Battle, ticks: number): BattleVisualEvent[] => {
  const seen: BattleVisualEvent[] = [];
  let since = -1;
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    battle.step();
    for (const event of battle.recentEvents(since)) {
      seen.push(event);
      since = Math.max(since, event.tick);
    }
  }
  return seen;
};

type Hurt = Extract<BattleVisualEvent, { kind: "hurt" }>;
type Splash = Extract<BattleVisualEvent, { kind: "splash" }>;
type Death = Extract<BattleVisualEvent, { kind: "death" }>;
const hurts = (events: BattleVisualEvent[]): Hurt[] =>
  events.filter((event): event is Hurt => event.kind === "hurt");
/** The blast ring of the first Eye-ra of that side to die. */
const blastOf = (events: BattleVisualEvent[], friendly: boolean): Splash | undefined => {
  const eyeras = new Set(
    events
      .filter((event): event is Death => event.kind === "death")
      .filter((event) => event.monsterId === "C5" && event.friendly === friendly)
      .map((event) => event.creepId),
  );
  return events.find(
    (event): event is Splash => event.kind === "splash" && eyeras.has(event.creepId),
  );
};
const deathOf = (events: BattleVisualEvent[], creepId: number): Death | undefined =>
  events.find((event): event is Death => event.kind === "death" && event.creepId === creepId);
const takenBy = (events: BattleVisualEvent[], creepId: number): number =>
  hurts(events)
    .filter((hurt) => hurt.creepId === creepId)
    .reduce((sum, hurt) => sum + hurt.amount, 0);

/** The cartesian distance the engine's creep index measures between two yard points. */
const cartesian = (one: { ix: number; iy: number }, other: { ix: number; iy: number }): number => {
  const a = rangePointOf(one.ix, one.iy);
  const b = rangePointOf(other.ix, other.iy);
  return Math.sqrt(distanceSquared(a.x, a.y, b.x, b.y));
};

describe("a defending Eye-ra (`CreepBase.as:1122-1163`)", () => {
  /** A Monster Bunker holding one Eye-ra, and an attacking Gorgo (40,000 health) by it. */
  const bunkerBattle = (extra: Partial<BattleOptions> = {}, flyer = false) => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 600, Y: 600 },
    });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C5: 1 } }, ...extra });
    battle.apply({
      kind: "fling",
      t: 0,
      x: 200,
      y: 200,
      r: 0,
      monsters: flyer ? { C14: 1 } : {},
      champion: { t: 1, l: 1 },
    });
    return battle;
  };
  /** What the attackers other than `skip` took on `tick`. */
  const attackersHurtOn = (events: BattleVisualEvent[], tick: number, skip: number) =>
    hurts(events).filter((hurt) => hurt.tick === tick && !hurt.friendly && hurt.creepId !== skip);

  it("blows up on the attacker it reaches, hurting it by distance, and is used up", () => {
    // A level 6 Eye-ra (2,400 health) outlives Gorgo's blows on the way in.
    const battle = bunkerBattle({ defenderLevels: { C5: 6 } });
    const events = eventsOf(battle, 600);
    const blast = blastOf(events, true)!;
    expect(blast).toMatchObject({ moveId: "C5", radius: Math.round(90 * Math.SQRT2), hits: 1 });
    const eyera = deathOf(events, blast.creepId)!;
    expect(eyera.tick).toBe(blast.tick);
    // It was not killed: what it took before it blew is short of its health.
    expect(takenBy(events, eyera.creepId)).toBeLessThan(monsterStat("C5", "health", 6));

    // Gorgo took `DealLinearAEDamage`'s share at its cartesian distance.
    const [gorgo] = attackersHurtOn(events, blast.tick, eyera.creepId);
    const damage = monsterStat("C5", "damage", 6);
    expect(gorgo!.amount).toBe(linearAreaDamage(damage, 90, 0, cartesian(eyera, gorgo!)));
    expect(gorgo!.amount).toBeLessThanOrEqual(damage);
    expect(gorgo!.amount).toBeGreaterThanOrEqual(Math.trunc(damage / 5));

    // Used up: counted against its bunker, and never back in it.
    run(battle, 600);
    expect(battle.state().bunkerLosses[1]).toEqual({ C5: 1 });
    expect(battle.bunkerPools()[1]?.C5 ?? 0).toBe(0);
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(0);
  });

  it("leaves a flyer by its target alone", () => {
    const battle = bunkerBattle({ defenderLevels: { C5: 6 } }, true);
    const events = eventsOf(battle, 600);
    const blast = blastOf(events, true)!;
    expect(blast).toBeDefined();
    const eyera = deathOf(events, blast.creepId)!;
    const flyer = battle.creeps().find((creep) => creep.monsterId === "C14")!;
    expect(cartesian(eyera, flyer)).toBeLessThan(90);
    expect(flyer.hp).toBe(flyer.maxHp);
    expect(hurts(events).some((hurt) => hurt.creepId === flyer.id)).toBe(false);
  });

  it("blows up where it falls when it is killed first (`:995-1044`)", () => {
    // A level 1 Eye-ra (600 health) falls to Gorgo's second blow.
    const battle = bunkerBattle();
    const events = eventsOf(battle, 600);
    const blast = blastOf(events, true)!;
    expect(blast).toBeDefined();
    const eyera = deathOf(events, blast.creepId)!;
    expect(takenBy(events, eyera.creepId)).toBe(monsterStat("C5", "health", 1));
    const [gorgo] = attackersHurtOn(events, blast.tick, eyera.creepId);
    const damage = monsterStat("C5", "damage", 1);
    expect(gorgo!.amount).toBe(linearAreaDamage(damage, 90, 0, cartesian(eyera, gorgo!)));
    expect(battle.state().bunkerLosses[1]).toEqual({ C5: 1 });
  });

  it("airbursts when ranked: more on the ground, a little on a flyer", () => {
    const battle = bunkerBattle({ defenderLevels: { C5: 6 }, defenderRanks: { C5: 1 } }, true);
    const events = eventsOf(battle, 600);
    const blast = blastOf(events, true)!;
    expect(blast).toBeDefined();
    // Rank 1: 120% of the swing, over 108 on the ground.
    expect(blast.radius).toBe(Math.round(108 * Math.SQRT2));
    const atBlast = attackersHurtOn(events, blast.tick, blast.creepId);
    const flyer = events.find(
      (event): event is Death => event.kind === "death" && event.monsterId === "C14",
    );
    const onFlyer = atBlast.find((hurt) => hurt.creepId === flyer?.creepId);
    const onGorgo = atBlast.find((hurt) => hurt.creepId !== flyer?.creepId);
    // Gorgo is the nearest on the ground: the whole 120%.
    const damage = monsterStat("C5", "damage", 6);
    expect(onGorgo!.amount).toBe(damage * 1.2);
    // The flyer, the only one in the air, takes 0.2 of that at rank 1
    // (5,760): more than a level 1 Wasp's 1,600 health.
    expect(flyer?.tick).toBe(blast.tick);
    expect(onFlyer!.amount).toBe(monsterStat("C14", "health", 1));
    expect(blast.hits).toBe(2);
  });
});

describe("an attacking Eye-ra's blast on defenders (`CreepBase.as:804-827`)", () => {
  it("hurts the bunker's monsters round it, but not its flyer", () => {
    // Its Pokeys and a Wasp come out after a level 6 Eye-ra walking to a wall by the bunker.
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 900, Y: 900 },
      "3": { id: 3, t: 17, X: 80, Y: 80 },
    });
    const battle = createBattle(yard, {
      seed: 3,
      bunkers: { 1: { C1: 3, C14: 1 } },
      levels: { C5: 6 },
    });
    battle.apply({ kind: "fling", t: 0, x: 330, y: 330, r: 0, monsters: { C5: 1 } });
    // Each step's events, and the Wasp as it was on the step the blast went off.
    const events: BattleVisualEvent[] = [];
    let wasp: ReturnType<Battle["creeps"]>[number] | undefined;
    for (let step = 0; step < 400 && !battle.over() && !wasp; step += 1) {
      battle.step();
      const now = battle.recentEvents(battle.tick - 1).filter((e) => e.tick === battle.tick);
      events.push(...now);
      if (now.some((event) => event.kind === "splash")) {
        wasp = battle.creeps().find((creep) => creep.monsterId === "C14");
      }
    }
    const blast = blastOf(events, false)!;
    expect(blast).toBeDefined();
    const eyera = deathOf(events, blast.creepId)!;
    const onDefenders = hurts(events).filter((hurt) => hurt.tick === blast.tick && hurt.friendly);
    // Every Pokey within 90 on screen took its share (enough to kill them all).
    expect(onDefenders).toHaveLength(3);
    const damage = monsterStat("C5", "damage", 6);
    for (const hurt of onDefenders) {
      const squared = screenDistanceSquared(eyera.ix, eyera.iy, hurt.ix, hurt.iy);
      expect(squared).toBeLessThan(8100);
      const share = Math.trunc((damage * (8100 - squared)) / 8100);
      expect(hurt.amount).toBe(Math.min(share, monsterStat("C1", "health", 1)));
    }
    // The wall and three Pokeys.
    expect(blast.hits).toBe(4);
    expect(battle.state().bunkerLosses[1]).toEqual({ C1: 3 });
    // The Wasp was inside the circle and flies: untouched.
    expect(screenDistanceSquared(eyera.ix, eyera.iy, wasp!.ix, wasp!.iy)).toBeLessThan(8100);
    expect(wasp!.hp).toBe(wasp!.maxHp);
  });

  it("hurts the yard's champion within 60, falling off with distance", () => {
    // An attacking Gorgo holds the caged one in a fight by a wall; an Eye-ra
    // flung once they are at it walks to the wall and blows up beside them.
    const yard = yardOf({
      "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 14, l: 3, X: 250, Y: 250 },
      "3": { id: 3, t: 1, l: 1, X: 1200, Y: 1200 },
      "4": { id: 4, t: 17, X: 300, Y: 350 },
    });
    const battle = createBattle(yard, {
      seed: 3,
      defenderChampions: [{ t: 1, l: 2, hp: 80000, pl: 1 }],
    });
    battle.apply({
      kind: "fling",
      t: 0,
      x: 400,
      y: 400,
      r: 0,
      monsters: {},
      champion: { t: 1, l: 1 },
    });
    const events: BattleVisualEvent[] = [];
    let flung = false;
    for (let step = 0; step < 1200 && !battle.over(); step += 1) {
      battle.step();
      events.push(...battle.recentEvents(battle.tick - 1).filter((e) => e.tick === battle.tick));
      const guard = battle.creeps().find((creep) => creep.champion && creep.friendly);
      const foe = battle.creeps().find((creep) => creep.champion && !creep.friendly);
      if (!flung && guard && foe && Math.hypot(guard.ix - foe.ix, guard.iy - foe.iy) < 80) {
        battle.apply({ kind: "fling", t: battle.tick, x: 400, y: 400, r: 0, monsters: { C5: 1 } });
        flung = true;
      }
    }
    const blast = blastOf(events, false)!;
    expect(blast).toBeDefined();
    const eyera = deathOf(events, blast.creepId)!;
    const guardId = battle.creeps().find((creep) => creep.champion && creep.friendly)!.id;
    const onGuard = hurts(events).filter(
      (hurt) => hurt.tick === blast.tick && hurt.creepId === guardId,
    );
    const squared = screenDistanceSquared(eyera.ix, eyera.iy, onGuard[0]!.ix, onGuard[0]!.iy);
    expect(squared).toBeLessThan(3600);
    const damage = monsterStat("C5", "damage", 1);
    const share = Math.trunc((damage * (3600 - squared)) / 3600);
    // Its foe's blow may land on the same tick; the blast's is the one that matches.
    expect(onGuard.map((hurt) => hurt.amount)).toContain(share);
    expect(share).toBeLessThan(damage);
    // The wall and the champion.
    expect(blast.hits).toBe(2);
  });
});

describe("an attacking Eye-ra's aim", () => {
  it("goes for a wall before a nearer building (target group 2)", () => {
    const yard = yardOf({
      "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: -240, Y: -240 },
      "3": { id: 3, t: 17, X: 300, Y: 300 },
    });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -300, y: -300, r: 20, monsters: { C5: 2 } });
    battle.step();
    const aims = battle
      .creeps()
      .filter((creep) => creep.monsterId === "C5")
      .map((creep) => creep.targetBuilding);
    expect(aims).toEqual([3, 3]);
  });
});

describe("Eye-ras in the Descent (Inferno WP 1.21)", () => {
  /** An Inferno Housing Bunker, a wall by it and a far Town Hall, on an Inferno yard. */
  const infernoBattle = (
    garrison: Record<string, number>,
    descentYard: number | undefined,
    extra: Partial<BattleOptions> = {},
  ) => {
    const yard = yardOf(
      {
        "1": { id: 1, t: 128, l: 1, X: 0, Y: 0 },
        "2": { id: 2, t: 14, l: 1, X: 900, Y: 900 },
        "3": { id: 3, t: 17, X: 40, Y: 150 },
      },
      "inferno",
    );
    return createBattle(yard, {
      seed: 5,
      bunkers: { 1: garrison },
      levels: { C5: 6 },
      ...(descentYard === undefined ? {} : { descentYard }),
      ...extra,
    });
  };

  it("blasts the wall and the defenders round it", () => {
    const battle = infernoBattle({ IC1: 3 }, 3);
    battle.apply({ kind: "fling", t: 0, x: 120, y: 420, r: 0, monsters: { C5: 1 } });
    const events = eventsOf(battle, 800);
    const blast = blastOf(events, false)!;
    expect(blast).toBeDefined();
    const wall = events.find(
      (event) => event.kind === "hit" && event.buildingId === 3 && event.tick === blast.tick,
    );
    expect(wall).toBeDefined();
    const onDefenders = hurts(events).filter((hurt) => hurt.tick === blast.tick && hurt.friendly);
    expect(onDefenders.length).toBeGreaterThan(0);
    expect(blast.hits).toBe(1 + onDefenders.length);
  });

  it("lets a killed bunker Eye-ra blow up in the Descent, not on an Inferno yard", () => {
    const killed = (descentYard: number | undefined) => {
      // A level 1 Eye-ra (600 health) falls to Gorgo's first blow.
      const battle = infernoBattle({ C5: 1 }, descentYard, { defenderLevels: { C5: 1 } });
      battle.apply({
        kind: "fling",
        t: 0,
        x: 200,
        y: 200,
        r: 0,
        monsters: {},
        champion: { t: 1, l: 1 },
      });
      const events = eventsOf(battle, 600);
      const death = events.find(
        (event): event is Death =>
          event.kind === "death" && event.monsterId === "C5" && event.friendly,
      );
      const taken = death ? takenBy(events, death.creepId) : 0;
      return { death, taken, blast: blastOf(events, true) };
    };
    const inDescent = killed(3);
    expect(inDescent.taken).toBe(monsterStat("C5", "health", 1));
    expect(inDescent.blast).toBeDefined();
    // Flash pens a bunker's dead monster on an Inferno yard before it can blow (`:1004-1010`).
    const onInferno = killed(undefined);
    expect(onInferno.taken).toBe(monsterStat("C5", "health", 1));
    expect(onInferno.blast).toBeUndefined();
  });
});
