import { describe, expect, it } from "vitest";

import {
  hasFireball,
  hasQuake,
  KRAMPUS_AURA_INTERVAL,
  KRAMPUS_ID,
  krampusAuraRadius,
  krampusAuraSlow,
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
 * champion no player owns, whose frost aura slows the towers and the
 * defending monsters near it.
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
    ).toEqual([21_500, 107_500]);
    expect(
      [1, 6].map((level) => championStat(KRAMPUS_ID, "damage", level)),
    ).toEqual([1_100, 3_600]);
    expect(
      [1, 6].map((level) => championStat(KRAMPUS_ID, "speed", level)),
    ).toEqual([1.3, 2.4]);
    expect([1, 6].map(krampusAuraSlow)).toEqual([0.15, 0.4]);
    expect([1, 6].map(krampusAuraRadius)).toEqual([200, 300]);
    expect([1, 3, 6].map(krampusSlowPercent)).toEqual([15, 25, 40]);
  });
});

describe("Krampus in a fight", () => {
  it("is never brought on by an ordinary fling log (no player owns one)", () => {
    const battle = createBattle(frostYard(), { seed: 3 });
    fling(battle, -60, { C1: 2 }, { t: 6, l: 3 });
    watch(battle, 5);
    expect(krampusOf(battle)).toBeUndefined();
  });

  it("chills towers and defenders in its aura from its first look, never its own side", () => {
    const battle = createBattle(frostYard(), {
      seed: 3,
      wildChampions: true,
      bunkers: { 3: { C1: 6 } },
    });
    fling(battle, 40, { C2: 3 }, { t: 6, l: 6 });
    expect(krampusOf(battle)).toBeDefined();
    watch(battle, KRAMPUS_AURA_INTERVAL - 1);
    expect(battle.chilledTowers()).toEqual([]);
    watch(battle, 1);
    expect(battle.chilledTowers()).toEqual([2]);
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

  it("makes a chilled tower fire slower, by its level's share", () => {
    /** Mean ticks between the Cannon Tower's shots over a fight. */
    const meanGap = (krampusLevel: number | null): number => {
      // The tower stands off to the side, inside the aura, while everything fights the harvester.
      const yard = yardOf({
        "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 1_000_000 },
        "2": { id: 2, t: 20, l: 10, X: 0, Y: 200 },
      });
      const battle = createBattle(yard, { seed: 5, wildChampions: true });
      fling(
        battle,
        -40,
        { C6: 40 },
        krampusLevel === null ? undefined : { t: 6, l: krampusLevel },
      );
      const ticks: number[] = [];
      watch(battle, 900, (event) => {
        if (
          event.kind === "shot" &&
          event.towerId === 2 &&
          event.tick > KRAMPUS_AURA_INTERVAL * 2
        )
          ticks.push(event.tick);
      });
      expect(ticks.length).toBeGreaterThan(4);
      return ((ticks.at(-1) ?? 0) - (ticks[0] ?? 0)) / (ticks.length - 1);
    };
    const plain = meanGap(null);
    // Level 4: the aura alone (his Blizzard Stomp, from level 5, freezes harder).
    const chilled = meanGap(4);
    // 30% of its ticks lost: each gap about 1 / 0.7 of the plain one.
    expect(chilled / plain).toBeGreaterThan(1.3);
    expect(chilled / plain).toBeLessThan(1.6);
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
    let chilledWhileAlive = 0;
    watch(battle, 8000, () => {
      if ((krampusOf(battle)?.hp ?? 0) > 0)
        chilledWhileAlive = Math.max(
          chilledWhileAlive,
          battle.chilledTowers().length,
        );
    });
    expect(chilledWhileAlive).toBeGreaterThan(0);
    expect(krampusOf(battle)?.hp ?? 0).toBeLessThanOrEqual(0);
    expect(battle.chilledTowers()).toEqual([]);
  });

  it("lets everything go when it is called back", () => {
    const battle = createBattle(frostYard(), {
      seed: 3,
      wildChampions: true,
      bunkers: { 3: { C1: 6 } },
    });
    fling(battle, 40, { C2: 3 }, { t: 6, l: 6 });
    watch(battle, KRAMPUS_AURA_INTERVAL + 1);
    expect(battle.chilledTowers()).toEqual([2]);
    battle.apply({ kind: "championRetreat", t: battle.tick, c: 6 });
    watch(battle, KRAMPUS_AURA_INTERVAL * 2 + 1);
    expect(battle.chilledTowers()).toEqual([]);
    expect(battle.creeps().some((creep) => creep.chilled)).toBe(false);
  });

  it("is the same fight twice from the same seed (no random draws of its own)", () => {
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
});
