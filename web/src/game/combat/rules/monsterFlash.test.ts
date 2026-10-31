import { describe, expect, it } from "vitest";

import { createBattle, HOP_TICKS, HOP_UP_TICKS } from "./engine.js";
import type { BattleVisualEvent, CreepSnapshot } from "./engine.js";
import { monsterStat } from "./stats.js";
import { buildEngineYard, screenPointOf } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * Monsters against the Flash numbers (battle audit, monsters, items 2, 5-7
 * and 10): the look while walking, Balthazar's hunt and reach, Malphus's hop
 * and the plain shots of Rezghul and Teratorn.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

type Battle = ReturnType<typeof createBattle>;

const flung = (
  buildings: CombatBuildingDataMap,
  monsters: Record<string, number>,
  at: { x: number; y: number },
  options: Partial<Parameters<typeof createBattle>[1]> = {},
) => {
  const yard = yardOf(buildings);
  const battle = createBattle(yard, { seed: 7, ...options });
  battle.apply({ kind: "fling", t: 0, x: at.x, y: at.y, r: 0, monsters });
  return { battle, yard };
};

const attacker = (battle: Battle): CreepSnapshot | undefined =>
  battle.creeps().find((creep) => !creep.friendly);

/** Runs `ticks` steps, handing each new visual event and the attacker after it. */
const watch = (
  battle: Battle,
  ticks: number,
  seen: (event: BattleVisualEvent | null, creep: CreepSnapshot | undefined) => void,
): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    battle.step();
    for (const event of battle.recentEvents(battle.tick - 1)) {
      if (event.tick === battle.tick) seen(event, attacker(battle));
    }
    seen(null, attacker(battle));
  }
};

/** Every building the attacker set out for, in order, with the tick it did. */
const targetsOf = (battle: Battle, ticks: number) => {
  const targets: { tick: number; id: number }[] = [];
  watch(battle, ticks, (event, creep) => {
    if (event || !creep) return;
    if (targets.at(-1)?.id !== creep.targetBuilding) {
      targets.push({ tick: battle.tick, id: creep.targetBuilding });
    }
  });
  return targets;
};

/** Walls 20 apart, the ids from `from` on. */
const walls = (points: readonly [number, number][], from: number): CombatBuildingDataMap =>
  Object.fromEntries(
    points.map(([X, Y], at) => [String(from + at), { id: from + at, t: 17, l: 1, X, Y }]),
  );

const line = (x: number, fromY: number, toY: number): [number, number][] => {
  const points: [number, number][] = [];
  for (let y = fromY; y <= toY; y += 20) points.push([x, y]);
  return points;
};

describe("the look while walking keeps the course (`MonsterBase.as:1255-1270`)", () => {
  // A Pokey (any building) flung at the origin sets out for harvester 1; a wall
  // line sends it north round the line's end, past harvester 2, which is then
  // the nearer of the two when it looks again.
  const yard = (second: { X: number; Y: number }, extra: CombatBuildingDataMap = {}) => ({
    "1": { id: 1, t: 1, l: 9, X: 280, Y: 0 },
    "2": { id: 2, t: 1, l: 9, ...second },
    ...walls(line(150, -400, 100), 10),
    ...extra,
  });
  const origin = { x: 0, y: 0 };

  it("walks on when the nearer building's route has no fewer waypoints", () => {
    const { battle } = flung(yard({ X: 150, Y: 250 }), { C1: 1 }, origin);
    expect(targetsOf(battle, 1600)).toEqual([{ tick: 1, id: 1 }]);
  });

  it("never turns aside mid-walk onto a route that ends at a wall", () => {
    // Harvester 2 is now walled in: the route there is cut by its ring.
    const ring = walls(
      [
        ...[90, 110, 130, 150, 170, 190, 210].flatMap((x): [number, number][] => [
          [x, 190],
          [x, 310],
        ]),
        ...[210, 230, 250, 270, 290].flatMap((y): [number, number][] => [
          [90, y],
          [210, y],
        ]),
      ],
      100,
    );
    const { battle } = flung(yard({ X: 150, Y: 250 }, ring), { C1: 1 }, origin);
    expect(targetsOf(battle, 1600)).toEqual([{ tick: 1, id: 1 }]);
  });

  it("takes the new route when it is shorter", () => {
    // A longer line: the way round to harvester 1 is long, the one to 2 short.
    const { battle } = flung(
      {
        "1": { id: 1, t: 1, l: 9, X: 240, Y: 0 },
        "2": { id: 2, t: 1, l: 9, X: 40, Y: 260 },
        ...walls(line(150, -400, 200), 10),
      },
      { C1: 1 },
      origin,
    );
    const targets = targetsOf(battle, 1600);
    expect(targets.map((target) => target.id)).toEqual([1, 2]);
    // Mid-walk: well before it could have reached harvester 1.
    expect(targets[1]!.tick).toBeLessThan(800);
  });
});

describe("IC5 Balthazar hunts (`MonsterBase.findHuntingTargets`, `CreepBase.as:884-886`)", () => {
  const damage = monsterStat("IC5", "damage", 1);

  it("strikes a building only from under 50 screen px (`MonsterBase.as:1128-1143`)", () => {
    // Flung 140 px off a lone harvester: it used to swing from there at once.
    const { battle, yard } = flung(
      { "1": { id: 1, t: 1, l: 9, X: 0, Y: 0 } },
      { IC5: 1 },
      {
        x: 140,
        y: 140,
      },
    );
    const building = yard.buildings[0]!;
    let first: { tick: number; away: number } | null = null;
    watch(battle, 600, (event) => {
      if (first || event?.kind !== "hit" || event.buildingId !== 1) return;
      const at = screenPointOf(event.ix, event.iy);
      first = { tick: event.tick, away: Math.hypot(at.x - building.sx, at.y - building.sy) };
    });
    expect(first).not.toBeNull();
    expect(first!.tick).toBeGreaterThan(1);
    expect(first!.away).toBeLessThan(50);
  });

  it("goes for the defenders out of a Housing Bunker before the building beside it", () => {
    // Two Pokeys draw the bunker's monsters out; Balthazar is flung by a
    // harvester across the yard.
    const yard = yardOf({
      "1": { id: 1, t: 128, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 9, X: 700, Y: 700 },
    });
    const battle = createBattle(yard, { seed: 5, bunkers: { 1: { C1: 4 } } });
    battle.apply({ kind: "fling", t: 0, x: 80, y: 80, r: 0, monsters: { C1: 2 } });
    battle.apply({ kind: "fling", t: 0, x: 680, y: 680, r: 0, monsters: { IC5: 1 } });
    const defenders = new Set<number>();
    let first: { buildingId: number; creepTargetId: number } | null = null;
    watch(battle, 1500, (event) => {
      for (const creep of battle.creeps()) if (creep.friendly) defenders.add(creep.id);
      if (first || event?.kind !== "hit") return;
      const balthazar = battle.creeps().find((creep) => creep.monsterId === "IC5");
      if (event.creepId !== balthazar?.id) return;
      first = { buildingId: event.buildingId, creepTargetId: event.creepTargetId };
    });
    expect(first).not.toBeNull();
    expect(first!.buildingId).toBe(-1);
    expect(defenders.has(first!.creepTargetId)).toBe(true);
  });

  it("goes for the champion in its cage before the building beside it, at triple damage", () => {
    const { battle } = flung(
      {
        "1": { id: 1, t: 114, l: 1, X: -400, Y: -400 },
        "2": { id: 2, t: 1, l: 9, X: -150, Y: -150 },
      },
      { IC5: 1 },
      { x: -130, y: -130 },
      { defenderChampions: [{ t: 1, l: 1, hp: 200_000 }] },
    );
    const hits: { buildingId: number; creepTargetId: number; amount: number }[] = [];
    let balthazar = -1;
    watch(battle, 1500, (event, creep) => {
      if (creep && !creep.champion) balthazar = creep.id;
      if (event?.kind !== "hit" || event.creepId !== balthazar) return;
      hits.push({
        buildingId: event.buildingId,
        creepTargetId: event.creepTargetId,
        amount: event.amount,
      });
    });
    expect(hits.length).toBeGreaterThan(1);
    // Its first blow lands in the cage, not on the harvester it was flung by.
    expect(hits[0]).toEqual({ buildingId: -1, creepTargetId: -1, amount: damage * 3 });
    // The champion comes out at it, and the blows at it out there are triple too.
    const out = hits.filter((hit) => hit.creepTargetId >= 0);
    expect(out.length).toBeGreaterThan(0);
    for (const hit of out) expect(hit.amount).toBe(damage * 3);
    expect(hits.some((hit) => hit.buildingId === 2)).toBe(false);
  });
});

describe("IC3 Malphus hops over walls (`CreepBase.as:1471-1478`, `:1505-1526`)", () => {
  // Malphus (resources) flung west of a wall line, its harvester east of it.
  const across = (wall: boolean) =>
    flung(
      {
        "1": { id: 1, t: 1, l: 9, X: 300, Y: 0 },
        ...(wall ? walls(line(150, -200, 200), 10) : {}),
      },
      { IC3: 1 },
      { x: 0, y: 0 },
    );

  const hops = (battle: Battle) => {
    const seen: { tick: number; hop: number; ix: number; iy: number }[] = [];
    watch(battle, 1200, (event, creep) => {
      if (event || !creep) return;
      seen.push({ tick: battle.tick, hop: creep.hop ?? -1, ix: creep.ix, iy: creep.iy });
    });
    return seen;
  };

  it("takes off when its next waypoint is on a wall, for 0.8 s", () => {
    const seen = hops(across(true).battle);
    const inAir = seen.filter((at) => at.hop >= 0);
    expect(inAir.length).toBe(HOP_TICKS);
    expect(inAir.map((at) => at.hop)).toEqual(Array.from({ length: HOP_TICKS }, (_, at) => at));
  });

  it("goes three times as fast on the way up, twice on the way down", () => {
    const seen = hops(across(true).battle);
    const start = seen.findIndex((at) => at.hop === 0);
    const span = (from: number, length: number) => {
      // On screen: `move()` steps screen px (`CreepBase.as:1456`).
      const a = screenPointOf(seen[from]!.ix, seen[from]!.iy);
      const b = screenPointOf(seen[from + length]!.ix, seen[from + length]!.iy);
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    const walking = span(start - 20, 10);
    expect(span(start + 4, 10) / walking).toBeCloseTo(3, 1);
    expect(span(start + HOP_UP_TICKS + 4, 10) / walking).toBeCloseTo(2, 1);
  });

  it("does not hop with no wall in the way: every other building is walked through", () => {
    expect(hops(across(false).battle).some((at) => at.hop >= 0)).toBe(false);
  });
});

describe("a monster's shot is plain damage and loots at 1 (`CreepBase.as:886-920`)", () => {
  it("C19 Rezghul hits a tower once over, not twice", () => {
    const { battle } = flung(
      { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 }, "2": { id: 2, t: 1, l: 1, X: 400, Y: 400 } },
      { C19: 1 },
      { x: 120, y: 120 },
    );
    let first = -1;
    watch(battle, 900, (event) => {
      if (first < 0 && event?.kind === "hit" && event.buildingId === 1) first = event.amount;
    });
    expect(first).toBe(monsterStat("C19", "damage", 1));
  });

  for (const monster of ["C14", "C19"]) {
    it(`${monster} loots a harvester for all it deals, not half`, () => {
      const { battle } = flung(
        { "1": { id: 1, t: 1, l: 9, X: 0, Y: 0, st: 1_000_000 } },
        { [monster]: 1 },
        {
          x: 120,
          y: 120,
        },
        { playerLevel: 20 },
      );
      let dealt = 0;
      watch(battle, 900, (event) => {
        if (event?.kind === "hit" && event.buildingId === 1) dealt += event.amount;
      });
      expect(dealt).toBeGreaterThan(0);
      expect(battle.state().loot.r1).toBe(dealt);
    });
  }
});
