import { describe, expect, it } from "vitest";

import {
  hasFireball,
  hasQuake,
  KRAMPUS_AURA_INTERVAL,
  KRAMPUS_BLIZZARD_SLOW,
  KRAMPUS_ID,
  krampusAuraRadius,
  krampusAuraSlow,
  krampusFreezeChance,
  krampusFreezeTicks,
  krampusSightCut,
  krampusSlowPercent,
} from "./champions.js";
import {
  createBattle,
  type BattleVisualEvent,
  type CreepSnapshot,
} from "./engine.js";
import {
  championByType,
  championIds,
  championStat,
  isWildChampion,
} from "./stats.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap, Roster } from "./types.js";

/**
 * Krampus, the frost tribe's champion (beta 10, owner 27 Nov 2026): a wild
 * champion no player owns, whose frost aura (invisible, owner 28 Nov 2026)
 * cuts how far the towers near it see and slows the defending monsters.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
  });

type Battle = ReturnType<typeof createBattle>;

const watch = (
  battle: Battle,
  ticks: number,
  seen: (event: BattleVisualEvent) => void = () => {},
): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    const before = battle.tick;
    battle.step();
    for (const event of battle.recentEvents(before)) seen(event);
  }
};

const fling = (
  battle: Battle,
  at: number,
  monsters: Roster,
  champion?: { t: number; l: number },
) =>
  battle.apply({
    kind: "fling",
    t: battle.tick,
    x: at,
    y: at,
    r: 100,
    monsters,
    ...(champion ? { champion } : {}),
  });

const krampusOf = (battle: Battle): CreepSnapshot | undefined =>
  battle.creeps().find((creep) => creep.monsterId === KRAMPUS_ID);

/** A Cannon Tower (2) and a bunker of Pokeys (3) by a well-stocked harvester (1). */
const frostYard = () =>
  yardOf({
    "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 1_000_000 },
    "2": { id: 2, t: 20, l: 1, X: 100, Y: 0 },
    "3": { id: 3, t: 22, l: 1, X: 0, Y: 120 },
  });

describe("Krampus's numbers (proposed, wildChampions.ts)", () => {
  it("is champion type 6, G6, a wild one the ownable list leaves out", () => {
    expect(championByType(6)).toBe(KRAMPUS_ID);
    expect(isWildChampion(KRAMPUS_ID)).toBe(true);
    expect(isWildChampion("G1")).toBe(false);
    expect(championIds()).not.toContain(KRAMPUS_ID);
  });

  it("grows from level 1 to 6", () => {
    expect(
      [1, 6].map((level) => championStat(KRAMPUS_ID, "health", level)),
    ).toEqual([17_000, 62_000]);
    expect(
      [1, 6].map((level) => championStat(KRAMPUS_ID, "damage", level)),
    ).toEqual([800, 1_700]);
    expect(
      [1, 6].map((level) => championStat(KRAMPUS_ID, "speed", level)),
    ).toEqual([1.3, 2.4]);
    expect([1, 6].map(krampusAuraSlow)).toEqual([0.15, 0.4]);
    expect([1, 6].map(krampusAuraRadius)).toEqual([200, 300]);
    expect([1, 3, 6].map(krampusSlowPercent)).toEqual([15, 25, 40]);
    expect([1, 3, 6].map(krampusSightCut)).toEqual([10, 14, 20]);
    expect([1, 3, 6].map(krampusFreezeChance)).toEqual([10, 14, 20]);
    // 80 ticks a second: 1.5 s, 2 s, 2.5 s.
    expect([1, 3, 6].map(krampusFreezeTicks)).toEqual([120, 160, 200]);
    // Owner, 28 Nov 2026: Blizzard Stomp "reduce to 30%".
    expect(KRAMPUS_BLIZZARD_SLOW).toBe(30);
  });
});

describe("Krampus in a fight", () => {
  it("is never brought on by an ordinary fling log (no player owns one)", () => {
    const battle = createBattle(frostYard(), { seed: 3 });
    fling(battle, -60, { C1: 2 }, { t: 6, l: 3 });
    watch(battle, 5);
    expect(krampusOf(battle)).toBeUndefined();
  });

  it("holds towers (shorter sight) and chills defenders in its aura from its first look, never its own side", () => {
    const battle = createBattle(frostYard(), {
      seed: 3,
      wildChampions: true,
      bunkers: { 3: { C1: 6 } },
    });
    fling(battle, 40, { C2: 3 }, { t: 6, l: 6 });
    expect(krampusOf(battle)).toBeDefined();
    watch(battle, KRAMPUS_AURA_INTERVAL - 1);
    expect(battle.blindedTowers()).toEqual([]);
    watch(battle, 1);
    expect(battle.blindedTowers()).toEqual([2]);
    // The aura no longer slows a tower (owner, 28 Nov 2026): it is not "Slowed".
    expect(battle.chilledTowers()).toEqual([]);
    let chilledDefender = false;
    watch(battle, 300, () => {
      if (battle.creeps().some((creep) => creep.friendly && creep.chilled))
        chilledDefender = true;
      // Its own side, the attackers, never.
      expect(
        battle.creeps().some((creep) => !creep.friendly && creep.chilled),
      ).toBe(false);
    });
    expect(chilledDefender).toBe(true);
  });

  /**
   * A level 10 Cannon Tower (range 250) 230 to the side of a harvester the
   * attackers swarm: in its sight without Krampus; past a level 6 Krampus's
   * cut sight (250 less 20% = 200) with him there, though inside his aura (300).
   */
  const sideTower = (krampusLevel: number | null) => {
    const yard = yardOf({
      "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 1_000_000 },
      "2": { id: 2, t: 20, l: 10, X: 0, Y: 230 },
    });
    const battle = createBattle(yard, { seed: 5, wildChampions: true });
    fling(
      battle,
      -40,
      { C6: 40 },
      krampusLevel === null ? undefined : { t: 6, l: krampusLevel },
    );
    return battle;
  };

  it("makes a tower in its aura see less far: it opens fire only once they come closer", () => {
    /** The tick of the tower's first shot, and how far from it that target stood. */
    const firstShot = (krampusLevel: number | null) => {
      const battle = sideTower(krampusLevel);
      let first: { tick: number; far: number } | null = null;
      watch(battle, 900, (event) => {
        if (first || event.kind !== "shot" || event.towerId !== 2) return;
        first = { tick: event.tick, far: Math.hypot(event.ix, event.iy - 230) };
      });
      expect(first).not.toBeNull();
      return first as unknown as { tick: number; far: number };
    };
    const plain = firstShot(null);
    const held = firstShot(6);
    // Without him it shoots the swarm at the harvester; with him it waits till
    // they walk well inside its cut sight (its scan point is its middle).
    expect(held.tick).toBeGreaterThan(plain.tick + 80);
    expect(held.far).toBeLessThan(plain.far - 30);
  });

  it("no longer slows a tower that still sees its target", () => {
    /** The median ticks between the Cannon Tower's shots, the swarm well inside its cut sight. */
    const meanGap = (krampusLevel: number | null): number => {
      const yard = yardOf({
        "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 1_000_000 },
        "2": { id: 2, t: 20, l: 10, X: 0, Y: 110 },
      });
      const battle = createBattle(yard, { seed: 5, wildChampions: true });
      fling(battle, -40, { C6: 40 }, krampusLevel === null ? undefined : { t: 6, l: krampusLevel });
      const ticks: number[] = [];
      watch(battle, 900, (event) => {
        if (event.kind === "shot" && event.towerId === 2 && event.tick > KRAMPUS_AURA_INTERVAL * 2)
          ticks.push(event.tick);
      });
      expect(ticks.length).toBeGreaterThan(4);
      const gaps = ticks.slice(1).map((at, n) => at - (ticks[n] ?? 0)).sort((a, b) => a - b);
      return gaps[Math.floor(gaps.length / 2)] ?? 0;
    };
    // Level 4: the aura alone (his Blizzard Stomp, from level 5, slows towers).
    // The median gap: his blows' freezes make a few long ones.
    expect(meanGap(4)).toBe(meanGap(null));
  });

  it("slows a chilled defender's walk to its level's share", () => {
    /** Mean step of the bunker's walking Pokeys, the chilled ones only when `chilledOnly`. */
    const meanStep = (
      champion: { t: number; l: number },
      chilledOnly: boolean,
    ): number => {
      const battle = createBattle(frostYard(), {
        seed: 3,
        wildChampions: true,
        bunkers: { 3: { C1: 6 } },
      });
      fling(battle, 40, { C2: 3 }, champion);
      const last = new Map<number, CreepSnapshot>();
      const steps: number[] = [];
      watch(battle, 400, () => {
        for (const creep of battle.creeps()) {
          const before = last.get(creep.id);
          last.set(creep.id, creep);
          if (
            !creep.friendly ||
            creep.champion ||
            creep.state !== "walking" ||
            !before
          )
            continue;
          if (
            before.state !== "walking" ||
            (chilledOnly && !(creep.chilled && before.chilled))
          )
            continue;
          const step = Math.hypot(creep.ix - before.ix, creep.iy - before.iy);
          if (step > 0) steps.push(step);
        }
      });
      expect(steps.length).toBeGreaterThan(10);
      return steps.reduce((sum, one) => sum + one, 0) / steps.length;
    };
    // Beside a Gorgo nothing is chilled; beside a level 6 Krampus they walk 40% slower.
    const ratio =
      meanStep({ t: 6, l: 6 }, true) / meanStep({ t: 1, l: 6 }, false);
    expect(ratio).toBeGreaterThan(0.5);
    // About 0.6; his own blows (Korath's, beta 10's abilities) move the Pokeys' paths a little.
    expect(ratio).toBeLessThan(0.75);
  });

  it("thaws everything when it falls", () => {
    // Six level 10 Cannon Towers round a harvester: a level 1 Krampus (20,000 health) falls.
    const yard = yardOf({
      "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 1_000_000 },
      ...Object.fromEntries(
        [
          [200, 0],
          [-200, 0],
          [0, 200],
          [0, -200],
          [150, 150],
          [-150, -150],
        ].map(([x, y], n) => [
          String(n + 2),
          { id: n + 2, t: 20, l: 10, X: x, Y: y },
        ]),
      ),
    });
    const battle = createBattle(yard, { seed: 3, wildChampions: true });
    fling(battle, -20, {}, { t: 6, l: 1 });
    let heldWhileAlive = 0;
    watch(battle, 8000, () => {
      if ((krampusOf(battle)?.hp ?? 0) > 0)
        heldWhileAlive = Math.max(heldWhileAlive, battle.blindedTowers().length);
    });
    expect(heldWhileAlive).toBeGreaterThan(0);
    expect(krampusOf(battle)?.hp ?? 0).toBeLessThanOrEqual(0);
    expect(battle.blindedTowers()).toEqual([]);
  });

  it("lets everything go when it is called back", () => {
    const battle = createBattle(frostYard(), {
      seed: 3,
      wildChampions: true,
      bunkers: { 3: { C1: 6 } },
    });
    fling(battle, 40, { C2: 3 }, { t: 6, l: 6 });
    watch(battle, KRAMPUS_AURA_INTERVAL + 1);
    expect(battle.blindedTowers()).toEqual([2]);
    battle.apply({ kind: "championRetreat", t: battle.tick, c: 6 });
    watch(battle, KRAMPUS_AURA_INTERVAL * 2 + 1);
    expect(battle.blindedTowers()).toEqual([]);
    expect(battle.creeps().some((creep) => creep.chilled)).toBe(false);
  });

  it("is the same fight twice from the same seed (its freeze draws come from the seed)", () => {
    const play = (): string => {
      const battle = createBattle(frostYard(), {
        seed: 9,
        wildChampions: true,
        bunkers: { 3: { C1: 6 } },
      });
      fling(battle, 40, { C2: 3 }, { t: 6, l: 4 });
      watch(battle, 600);
      return JSON.stringify(
        battle
          .creeps()
          .map((creep) => [creep.id, creep.ix, creep.iy, creep.hp]),
      );
    };
    expect(play()).toBe(play());
  });
});

describe("Krampus's three abilities (beta 10, level-gated, champions.ts)", () => {
  it("throws ice shards at flyers from level 4 and stomps from level 5, whatever his power", () => {
    expect([3, 4, 6].map((level) => hasFireball(KRAMPUS_ID, level, 0))).toEqual([false, true, true]);
    expect([4, 5, 6].map((level) => hasQuake(KRAMPUS_ID, level, 0))).toEqual([false, true, true]);
    // Korath's own gates are untouched.
    expect(hasFireball("G4", 6, 0)).toBe(false);
    expect(hasQuake("G4", 6, 2)).toBe(false);
  });

  const lone = () => yardOf({ "1": { id: 1, t: 1, l: 10, X: 0, Y: 0, st: 1_000_000 } });

  it("frostbites what he hits (Frostbite, every level): a building loses more than his blows", () => {
    const battle = createBattle(lone(), { seed: 3, wildChampions: true });
    fling(battle, -60, {}, { t: 6, l: 1 });
    let blows = 0;
    watch(battle, 20 * 80, (event) => {
      if (event.kind === "hit" && event.buildingId === 1) blows += event.amount;
    });
    const full = lone().buildings.find((building) => building.id === 1)?.hp;
    const left = battle.state().health["1"] ?? 0;
    expect(blows).toBeGreaterThan(0);
    expect((full ?? 0) - left).toBeGreaterThan(blows);
  });

  const stomps = (level: number): number => {
    const battle = createBattle(frostYard(), { seed: 3, wildChampions: true });
    fling(battle, -60, {}, { t: 6, l: level });
    let quakes = 0;
    watch(battle, 40 * 80, (event) => {
      if (event.kind === "quake") quakes += 1;
    });
    return quakes;
  };

  it("stomps (Blizzard Stomp) only from level 5", () => {
    expect(stomps(4)).toBe(0);
    expect(stomps(5)).toBeGreaterThan(0);
  });

  it("slows the towers in his Blizzard Stomp (30%)", () => {
    const yard = yardOf({
      "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 1_000_000 },
      "2": { id: 2, t: 20, l: 10, X: 100, Y: 0 },
    });
    const battle = createBattle(yard, { seed: 3, wildChampions: true });
    fling(battle, -60, {}, { t: 6, l: 5 });
    let chilledAfterQuake = false;
    let quaked = false;
    watch(battle, 40 * 80, (event) => {
      if (event.kind === "quake") quaked = true;
      if (quaked && battle.chilledTowers().includes(2)) chilledAfterQuake = true;
    });
    expect(quaked).toBe(true);
    expect(chilledAfterQuake).toBe(true);
  });

  /** A level 6 Krampus on a lone level 10 Cannon Tower: the ticks it was frozen, and its shots then. */
  const freezes = (seed: number) => {
    const yard = () =>
      yardOf({
        "1": { id: 1, t: 1, l: 1, X: -300, Y: -300, st: 1_000_000 },
        "2": { id: 2, t: 20, l: 10, X: 0, Y: 0 },
      });
    const battle = createBattle(yard(), { seed, wildChampions: true });
    fling(battle, 60, {}, { t: 6, l: 6 });
    let frozenTicks = 0;
    let shotsWhileFrozen = 0;
    let longest = 0;
    let run = 0;
    watch(battle, 30 * 80, (event) => {
      if (event.kind === "shot" && event.towerId === 2 && battle.frozenTowers().includes(2))
        shotsWhileFrozen += 1;
    });
    // Count the frozen ticks over a second run, tick by tick.
    const again = createBattle(yard(), { seed, wildChampions: true });
    fling(again, 60, {}, { t: 6, l: 6 });
    for (let step = 0; step < 30 * 80 && !again.over(); step += 1) {
      again.step();
      if (again.frozenTowers().includes(2)) {
        frozenTicks += 1;
        run += 1;
        longest = Math.max(longest, run);
      } else run = 0;
    }
    return { frozenTicks, shotsWhileFrozen, longest };
  };

  it("freezes a tower he hits solid now and then (Frostbite's freeze): it fires nothing till it thaws", () => {
    let frozen = 0;
    for (const seed of [1, 2, 3, 4]) {
      const run = freezes(seed);
      frozen += run.frozenTicks;
      expect(run.shotsWhileFrozen).toBe(0);
      // One freeze is level 6's 2.5 s; a fresh one while frozen runs on from the blow.
      if (run.frozenTicks > 0) expect(run.longest).toBeGreaterThanOrEqual(krampusFreezeTicks(6) - 1);
    }
    expect(frozen).toBeGreaterThan(0);
  });
});
