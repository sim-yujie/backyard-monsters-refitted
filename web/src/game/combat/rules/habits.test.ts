import { describe, expect, it } from "vitest";

import type { ChampionLesson } from "./brain.js";
import { DRULL_ID, FOMOR_ID, GORGO_ID, KORATH_ID, KRALLEN_ID } from "./champions.js";
import { createBattle } from "./engine.js";
import {
  CHAMPION_HABITS,
  FOMOR_JUDGE,
  flungStance,
  HABIT_CAP,
  HYBRID_HABIT_CAP,
  habitCap,
  habitScore,
  habitsOf,
  hasHabits,
  hasMode,
  learnHabits,
  type HabitBook,
  type HabitStats,
} from "./habits.js";
import { replayAttack } from "./replay.js";
import {
  CHAMPION_STANCES,
  HABIT_KEYS,
  STANCE_TILTS,
  type ChampionStance,
  type HabitKey,
} from "./stance.js";
import type { CombatBuildingDataMap, FlingLog } from "./types.js";
import { buildEngineYard } from "./yard.js";

/**
 * Champion modes round 2, option B "Instincts and Habits" (`habits.ts`):
 * the per-champion table, one small battle per habit (on, it changes the
 * pick; asleep, the pick is weight 0's), the lock-in guards, and Krallen and
 * habit-less champions fighting exactly as before.
 */

const RESOURCES = { r1: 1_000_000, r2: 0, r3: 0, r4: 0 };
const GORGO = 1;
const DRULL = 2;
const FOMOR = 3;
const KORATH = 4;
const KRALLEN = 5;

type Habits = Partial<Record<HabitKey, number>>;

interface Fight {
  readonly t?: number;
  readonly stance: ChampionStance;
  /** The habits flung, with the version; null flings none (today's champion). */
  readonly habits: Habits | null;
  readonly level?: number;
  /** Its power level, `pl` (Korath's quake needs 3). */
  readonly power?: number;
  readonly hp?: number;
  /** Monsters flung first, elsewhere, so a tower is busy with them. */
  readonly army?: { readonly x: number; readonly y: number; readonly monsters: Record<string, number> };
  /** Frames between the army and the champion. */
  readonly wait?: number;
}

/** The buildings a champion walks to in turn, the first four. */
const picks = (buildings: CombatBuildingDataMap, fight: Fight): number[] => {
  const yard = buildEngineYard({ buildingdata: buildings, buildinghealthdata: {}, resources: RESOURCES });
  const battle = createBattle(yard, { seed: 22001, levels: {} });
  const wait = fight.wait ?? 0;
  if (fight.army) battle.apply({ kind: "fling", t: 0, r: 50, ...fight.army });
  for (let frame = 0; frame < wait; frame += 1) battle.step();
  battle.apply({
    kind: "fling",
    t: wait,
    x: 0,
    y: 0,
    r: 100,
    monsters: {},
    champion: {
      t: fight.t ?? GORGO,
      l: fight.level ?? 1,
      ...(fight.power ? { pl: fight.power } : {}),
      s: fight.stance,
      ...(fight.habits ? { hv: 1, h: fight.habits } : {}),
      ...(fight.hp ? { hp: fight.hp } : {}),
    },
  });
  const seen: number[] = [];
  for (let frame = 0; frame < 4000 && !battle.over(); frame += 1) {
    battle.step();
    const champion = battle.creeps().find((creep) => creep.champion);
    if (champion && champion.targetBuilding >= 0 && seen.at(-1) !== champion.targetBuilding) {
      seen.push(champion.targetBuilding);
    }
  }
  return seen.slice(0, 4);
};

const first = (buildings: CombatBuildingDataMap, fight: Fight): number | undefined => picks(buildings, fight)[0];

/** Asleep: the habit's weight changes nothing, the picks are weight 0's. */
const sameAsNone = (buildings: CombatBuildingDataMap, fight: Fight): void => {
  expect(picks(buildings, fight)).toEqual(picks(buildings, { ...fight, habits: null }));
};

const harvester = (id: number, x: number, y: number) => ({ id, t: 1, l: 5, X: x, Y: y, st: 5000 });
const sniper = (id: number, x: number, y: number, l = 1) => ({ id, t: 21, l, X: x, Y: y });

describe("the per-champion habit table", () => {
  it("gives Gorgo, Drull, Korath and Fomor habits, and Krallen none (owner, 10 Nov)", () => {
    expect(Object.keys(CHAMPION_HABITS).sort()).toEqual([GORGO_ID, DRULL_ID, FOMOR_ID, KORATH_ID].sort());
    expect(hasHabits(KRALLEN_ID)).toBe(false);
    for (const stance of CHAMPION_STANCES) expect(habitsOf(KRALLEN_ID, stance)).toEqual([]);
  });

  it("holds only known habits, each once per Mode", () => {
    for (const row of Object.values(CHAMPION_HABITS)) {
      for (const stance of CHAMPION_STANCES) {
        const habits = row[stance];
        expect(new Set(habits).size).toBe(habits.length);
        for (const habit of habits) expect(HABIT_KEYS).toContain(habit);
      }
    }
  });

  it("never gives a champion a habit outside its row", () => {
    // "Quakes the crowd" is Korath's alone, and none outside wave 2's row.
    for (const [id, row] of Object.entries(CHAMPION_HABITS)) {
      for (const stance of CHAMPION_STANCES) {
        if (id !== KORATH_ID) expect(row[stance]).not.toContain("quake");
      }
    }
    // Fomor's building habit is Aerial Defense alone; its others choose a monster
    // (wave 2), and "crowd" only in Hybrid.
    expect(habitsOf(FOMOR_ID, "offensive")).toEqual(["big", "aerial"]);
    expect(habitsOf(FOMOR_ID, "defensive")).toEqual(["big", "aerial"]);
    expect(habitsOf(FOMOR_ID, "hybrid")).toEqual(["crowd", "big", "aerial"]);
    // Nobody but Fomor has a monster habit.
    for (const [id, row] of Object.entries(CHAMPION_HABITS)) {
      if (id === FOMOR_ID) continue;
      for (const stance of CHAMPION_STANCES) {
        expect(row[stance]).not.toContain("big");
        expect(row[stance]).not.toContain("crowd");
      }
    }
    // Learning only moves the row's habits, whatever the lesson credits.
    const lesson: ChampionLesson = {
      t: GORGO,
      picks: 10,
      credit: { tower: 10, loot: 10, finish: 10, focus: 10, threat: 10, careful: 10, quake: 10, gun: 10 },
      dealt: 100,
      potential: 100,
      startHp: 100,
      endHp: 100,
    };
    let book: HabitBook = {};
    let stats: HabitStats | undefined;
    for (let attack = 0; attack < 5; attack += 1) {
      const learned = learnHabits(book, stats, { ...lesson, dealt: attack % 2 === 0 ? 10 : 100 }, "offensive");
      book = learned.book;
      stats = learned.stats;
    }
    for (const habit of Object.keys(book.off ?? {})) {
      expect(habitsOf(GORGO_ID, "offensive")).toContain(habit);
    }
  });

  it("keeps every habit's cap below the instincts it sits beside", () => {
    const instincts = [
      STANCE_TILTS.offensive.tower,
      STANCE_TILTS.offensive.finish,
      STANCE_TILTS.defensive.focus,
      STANCE_TILTS.defensive.threat,
    ];
    expect(HABIT_CAP).toBeLessThan(Math.min(...instincts));
    expect(habitCap("offensive")).toBe(HABIT_CAP);
    expect(habitCap("defensive")).toBe(HABIT_CAP);
    expect(habitCap("hybrid")).toBe(HYBRID_HABIT_CAP);
  });
});

describe("each habit in battle: on, it changes the pick; asleep, it changes nothing", () => {
  it("Town Hall first (hybrid)", () => {
    const yard = { "1": harvester(1, 200, 200), "2": { id: 2, t: 14, l: 5, X: -330, Y: -330 } };
    expect(first(yard, { stance: "hybrid", habits: null })).toBe(1);
    expect(first(yard, { stance: "hybrid", habits: { hall: 150 } })).toBe(2);
    // No Town Hall: asleep.
    sameAsNone({ "1": harvester(1, 200, 200), "2": harvester(2, -330, -330) }, { stance: "hybrid", habits: { hall: 150 } });
  });

  it("goes for towers, or steers clear of them (hybrid, two-ended)", () => {
    const yard = { "1": sniper(1, -200, -200), "2": harvester(2, 200, 200) };
    expect(first(yard, { stance: "hybrid", habits: null })).toBe(1);
    expect(first(yard, { stance: "hybrid", habits: { tower: -150 } })).toBe(2);
    const far = { "1": { id: 1, t: 14, l: 5, X: 250, Y: 250 }, "2": sniper(2, 400, 300, 5), "3": sniper(3, 300, 400, 5) };
    expect(first(far, { stance: "hybrid", habits: null })).toBe(1);
    expect(first(far, { stance: "hybrid", habits: { tower: 150 } })).toBe(2);
    // No tower: asleep.
    sameAsNone({ "1": harvester(1, -200, -200), "2": harvester(2, 200, 200) }, { stance: "hybrid", habits: { tower: 150 } });
  });

  it("loves loot (hybrid, two-ended)", () => {
    const yard = { "1": sniper(1, -200, -200), "2": harvester(2, 200, 200) };
    expect(first(yard, { stance: "hybrid", habits: { loot: 150 } })).toBe(2);
    // No loot: asleep.
    sameAsNone({ "1": sniper(1, -200, -200), "2": sniper(2, 200, 200) }, { stance: "hybrid", habits: { loot: 150 } });
  });

  it("stays close (hybrid)", () => {
    const yard = { "1": harvester(1, 300, 300), "2": sniper(2, -460, -460) };
    expect(first(yard, { stance: "hybrid", habits: { tower: 150 } })).toBe(2);
    expect(first(yard, { stance: "hybrid", habits: { tower: 150, near: 150 } })).toBe(1);
    // Everything beyond its reach: asleep.
    const far = { "1": harvester(1, 520, 520), "2": sniper(2, -700, -700) };
    expect(picks(far, { stance: "hybrid", habits: { tower: 150, near: 150 } })).toEqual(
      picks(far, { stance: "hybrid", habits: { tower: 150 } }),
    );
  });

  it("biggest gun first (offensive, 3+ towers)", () => {
    const yard = { "1": sniper(1, 250, 250), "2": sniper(2, -250, 250), "3": sniper(3, -290, -290, 5) };
    expect(first(yard, { stance: "offensive", habits: null })).toBe(2);
    expect(first(yard, { stance: "offensive", habits: { gun: 100 } })).toBe(3);
    // Two towers: asleep.
    sameAsNone({ "2": sniper(2, -250, 250), "3": sniper(3, -290, -290, 5) }, { stance: "offensive", habits: { gun: 100 } });
  });

  it("Aerial Defense first (offensive), only with fliers out", () => {
    const yard = { "1": sniper(1, 250, 250), "2": { id: 2, t: 115, l: 1, X: -290, Y: -290 } };
    const fliers = { x: 0, y: 0, monsters: { C14: 5 } };
    expect(first(yard, { stance: "offensive", habits: null, army: fliers })).toBe(1);
    expect(first(yard, { stance: "offensive", habits: { aerial: 100 }, army: fliers })).toBe(2);
    // Walkers only: asleep.
    sameAsNone(yard, { stance: "offensive", habits: { aerial: 100 }, army: { x: 0, y: 0, monsters: { C1: 5 } } });
  });

  it("Aerial Defense first for a flying Fomor", () => {
    const yard = { "1": sniper(1, -250, -250), "2": { id: 2, t: 115, l: 1, X: 180, Y: 180 } };
    expect(first(yard, { t: FOMOR, level: 3, stance: "offensive", habits: null })).toBe(1);
    expect(first(yard, { t: FOMOR, level: 3, stance: "offensive", habits: { aerial: 100 } })).toBe(2);
    sameAsNone({ "1": sniper(1, -250, -250), "2": sniper(2, 180, 180) }, {
      t: FOMOR,
      level: 3,
      stance: "offensive",
      habits: { aerial: 100 },
    });
  });

  it("guards its monsters (offensive)", () => {
    const yard = { "1": sniper(1, -200, -200), "2": sniper(2, 180, 180) };
    const army = { x: 330, y: 330, monsters: { C1: 10 } };
    expect(first(yard, { stance: "offensive", habits: null, army, wait: 200 })).toBe(1);
    expect(first(yard, { stance: "offensive", habits: { guard: 100 }, army, wait: 200 })).toBe(2);
    // No monsters for a tower to shoot: asleep.
    sameAsNone(yard, { stance: "offensive", habits: { guard: 100 }, wait: 200 });
  });

  it("quakes the crowd (Korath, hybrid), once he has his quake", () => {
    const yard = {
      "1": harvester(1, 200, 200),
      "2": harvester(2, -300, -300),
      "3": harvester(3, -390, -300),
      "4": harvester(4, -300, -390),
      "5": harvester(5, -390, -390),
    };
    const korath = { t: KORATH, power: 3 } as const;
    expect(first(yard, { ...korath, level: 5, stance: "hybrid", habits: null })).toBe(1);
    expect(first(yard, { ...korath, level: 5, stance: "hybrid", habits: { quake: 150 } })).toBe(2);
    // Level 4, no quake yet: asleep.
    sameAsNone(yard, { ...korath, level: 4, stance: "hybrid", habits: { quake: 150 } });
  });

  it("careful when hurt (Drull, hybrid)", () => {
    const yard = { "1": { id: 1, t: 14, l: 5, X: 250, Y: 250 }, "2": sniper(2, 400, 300, 5), "3": harvester(3, -380, -380) };
    expect(first(yard, { t: DRULL, stance: "hybrid", habits: null, hp: 1000 })).toBe(1);
    expect(first(yard, { t: DRULL, stance: "hybrid", habits: { careful: 150 }, hp: 1000 })).toBe(3);
    // At full health: asleep.
    sameAsNone(yard, { t: DRULL, stance: "hybrid", habits: { careful: 150 } });
  });
});

describe("learning cannot lock in", () => {
  const lesson = (score: number, credit: Habits): ChampionLesson => ({
    t: GORGO,
    picks: 10,
    credit: { tower: 0, loot: 0, finish: 0, focus: 0, threat: 0, ...credit },
    dealt: score * 100,
    potential: 100,
    startHp: 100,
    endHp: 100,
  });

  it("200 lopsided attacks never push a habit past its Mode's cap", () => {
    for (const stance of CHAMPION_STANCES) {
      const cap = habitCap(stance);
      let book: HabitBook = {};
      let stats: HabitStats | undefined;
      for (let attack = 0; attack < 200; attack += 1) {
        // Every other attack wins big with every habit picked; the rest lose.
        const won = attack % 2 === 1;
        const credit = Object.fromEntries(HABIT_KEYS.map((key) => [key, won ? 10 : -10]));
        const learned = learnHabits(book, stats, lesson(won ? 1 : 0, credit), stance);
        book = learned.book;
        stats = learned.stats;
        for (const weight of Object.values(book[stance === "offensive" ? "off" : stance === "defensive" ? "def" : "hyb"] ?? {})) {
          expect(Math.abs(weight ?? 0)).toBeLessThanOrEqual(cap);
        }
      }
      expect(stats?.n).toBe(200);
    }
  });

  it("leaves the other Modes alone", () => {
    const learning = {
      v: 1,
      off: { guard: { o: 8, d: 1 as const } },
      def: { near: { o: 8, d: 1 as const } },
    };
    const learned = learnHabits({}, undefined, lesson(1, { tower: 10 }), "hybrid", undefined, learning);
    expect(learned.book.off).toEqual({ guard: 50 });
    expect(learned.book.def).toEqual({ near: 50 });
    expect(learned.learning.off).toEqual(learning.off);
    expect(learned.learning.def).toEqual(learning.def);
  });
});

describe("replay safety", () => {
  const YARD: CombatBuildingDataMap = {
    "1": { id: 1, t: 14, l: 5, X: 250, Y: 250 },
    "2": sniper(2, 400, 300, 5),
    "3": sniper(3, 300, 400, 5),
    "4": harvester(4, -350, -350),
  };
  const replay = (champion: NonNullable<Extract<FlingLog["events"][number], { kind: "fling" }>["champion"]>) =>
    replayAttack({
      buildingdata: YARD,
      buildinghealthdata: {},
      resources: RESOURCES,
      kind: "main",
      log: { v: 1, seed: 22001, events: [{ kind: "fling", t: 0, x: 0, y: 0, r: 100, monsters: { C1: 10 }, champion }] },
      levels: {},
      playerLevel: 20,
      tailTicks: 6000,
    });

  it("fights Krallen exactly as before, whatever habits a log claims for her", () => {
    const brain = { tower: 120, loot: -80, finish: 40, focus: 0, threat: 30 };
    for (const stance of CHAMPION_STANCES) {
      const plain = replay({ t: KRALLEN, l: 3, s: stance, b: brain });
      const claimed = replay({ t: KRALLEN, l: 3, s: stance, b: brain, hv: 1, h: { tower: 100, loot: 100 } });
      expect(claimed.digest).toBe(plain.digest);
      expect(claimed.checkpoints).toEqual(plain.checkpoints);
    }
  });

  it("fights a champion with no habit exactly as today's", () => {
    for (const stance of CHAMPION_STANCES) {
      const today = replay({ t: GORGO, l: 2, s: stance });
      const none = replay({ t: GORGO, l: 2, s: stance, hv: 1, h: {} });
      expect(none.digest).toBe(today.digest);
      expect(none.checkpoints).toEqual(today.checkpoints);
    }
  });

  it("ignores a habit outside the champion's row", () => {
    // Gorgo has no "careful": a log claiming it fights as one without.
    const today = replay({ t: GORGO, l: 2, s: "hybrid", hp: 1000 });
    const claimed = replay({ t: GORGO, l: 2, s: "hybrid", hp: 1000, hv: 1, h: { careful: 150 } });
    expect(claimed.digest).toBe(today.digest);
  });

  it("fights a Fomor with no monster habit exactly as today's, and replays one with it identically", () => {
    for (const stance of CHAMPION_STANCES) {
      const today = replay({ t: FOMOR, l: 3, s: stance });
      expect(replay({ t: FOMOR, l: 3, s: stance, hv: 1, h: {} }).digest).toBe(today.digest);
      const big = replay({ t: FOMOR, l: 3, s: stance, hv: 1, h: { big: 100 } });
      expect(replay({ t: FOMOR, l: 3, s: stance, hv: 1, h: { big: 100 } }).digest).toBe(big.digest);
    }
    const crowd = replay({ t: FOMOR, l: 3, s: "hybrid", hv: 1, h: { crowd: -150, big: -150 } });
    expect(replay({ t: FOMOR, l: 3, s: "hybrid", hv: 1, h: { crowd: -150, big: -150 } }).checkpoints).toEqual(
      crowd.checkpoints,
    );
  });

  it("replays a champion with habits identically", () => {
    const habits = { tower: 150 };
    const one = replay({ t: GORGO, l: 2, s: "hybrid", hv: 1, h: habits });
    const two = replay({ t: GORGO, l: 2, s: "hybrid", hv: 1, h: habits });
    expect(two.digest).toBe(one.digest);
    expect(two.checkpoints).toEqual(one.checkpoints);
    expect(one.digest).not.toBe(replay({ t: GORGO, l: 2, s: "hybrid" }).digest);
  });
});

describe("Fomor is judged by the monsters it backs (design note round 2)", () => {
  const fomorLesson = (over: Partial<ChampionLesson>): ChampionLesson => ({
    t: FOMOR,
    picks: 0,
    credit: { tower: 0, loot: 0, finish: 0, focus: 0, threat: 0 },
    // Its own figures: half its damage, all its health. Never read when the
    // monsters' figures are there.
    dealt: 50,
    potential: 100,
    startHp: 100,
    endHp: 100,
    ...over,
  });

  it("scores Offensive by the ring's share of the monsters' damage, Defensive by the backed that lived", () => {
    const lesson = fomorLesson({ army: 1000, ring: 800, backed: 4, backedLived: 1 });
    expect(habitScore(lesson, "offensive")).toBeCloseTo(0.8);
    expect(habitScore(lesson, "defensive")).toBeCloseTo(0.25);
    expect(habitScore(lesson, "hybrid")).toBeCloseTo(0.525);
  });

  it("has no score with nothing to judge it by, and then learns nothing and keeps its usual", () => {
    const blank = fomorLesson({ army: 0, ring: 0, backed: 0, backedLived: 0 });
    for (const stance of CHAMPION_STANCES) expect(habitScore(blank, stance)).toBeNull();
    expect(habitScore(fomorLesson({ army: 100, ring: 50, backed: 0, backedLived: 0 }), "hybrid")).toBeNull();
    const stats: HabitStats = { n: 5, j: FOMOR_JUDGE, off: { n: 5, u: { tribe: 0.4 } } };
    const learned = learnHabits({ off: { big: 40 } }, stats, { ...blank, k: "tribe" }, "offensive");
    // Migrated (40 < 50: Unproven, its 5 attacks counted), then nothing to learn.
    expect(learned.book.off).toBeUndefined();
    expect(learned.learning.off?.big).toEqual({ o: 5 });
    expect(learned.stats.off).toEqual({ n: 6, u: { tribe: 0.4 } });
    expect(learned.stats.n).toBe(6);
  });

  it("restarts a Fomor's usual scores, from its own old figures, the first time it is judged by its monsters", () => {
    const old: HabitStats = { n: 300, off: { n: 40, u: { tribe: 0.9998, main: 0.2 } }, def: { n: 9, u: { tribe: 1 } } };
    const lesson = { ...fomorLesson({ army: 1000, ring: 300, backed: 2, backedLived: 1 }), k: "tribe" as const };
    const first = learnHabits({ off: { big: 20 } }, old, lesson, "offensive");
    // No check against the old scale: the new usual is this score.
    expect(first.learning.off?.big).toEqual({ o: 8 });
    expect(first.stats).toEqual({ n: 301, j: FOMOR_JUDGE, off: { n: 41, u: { tribe: 0.3 } }, def: { n: 9, u: {} } });
    // Once judged so, it is never restarted again.
    const second = learnHabits(first.book, first.stats, { ...lesson, ring: 500 }, "offensive", undefined, first.learning);
    expect(second.stats.off?.u.tribe).toBeCloseTo(0.35);
    // Every other champion keeps its usual scores and gets no mark.
    const gorgo = learnHabits({}, old, { ...fomorLesson({}), t: GORGO, k: "tribe" }, "offensive");
    expect(gorgo.stats.j).toBeUndefined();
    expect(gorgo.stats.off?.u.main).toBe(0.2);
  });

  it("leaves every other champion's score as it was", () => {
    const gorgo = { ...fomorLesson({}), t: GORGO };
    expect(habitScore(gorgo, "offensive")).toBeCloseTo(0.5);
    expect(habitScore(gorgo, "defensive")).toBeCloseTo(1);
  });

  it("judges its monster habits on its looks at monsters, not on building looks", () => {
    // 2 looks at hurt monsters, each picking a bigger one; no building look.
    const lesson = (ring: number) =>
      fomorLesson({ picks: 0, allyPicks: 2, credit: { tower: 0, loot: 0, finish: 0, focus: 0, threat: 0, big: 2, aerial: 1 }, army: 1000, ring });
    const first = learnHabits({}, undefined, lesson(200), "offensive");
    const second = learnHabits(first.book, first.stats, lesson(400), "offensive", undefined, first.learning);
    expect(second.learning.off?.big).toEqual({ o: 1 });
    // A building habit needs building looks.
    expect(second.learning.off?.aerial).toBeUndefined();
  });

  it("records the monsters' figures on a Fomor's lesson, and only watches", () => {
    const YARD: CombatBuildingDataMap = {
      "1": { id: 1, t: 14, l: 5, X: 250, Y: 250 },
      "2": sniper(2, 400, 300, 5),
      "3": sniper(3, 300, 400, 5),
      "4": harvester(4, -350, -350),
    };
    const replay = (t: number, stance: ChampionStance, learn: boolean) =>
      replayAttack({
        buildingdata: YARD,
        buildinghealthdata: {},
        resources: RESOURCES,
        kind: "main",
        log: {
          v: 1,
          seed: 22001,
          events: [{ kind: "fling", t: 0, x: 0, y: 0, r: 100, monsters: { C1: 6, C2: 4 }, champion: { t, l: 3, s: stance } }],
        },
        levels: {},
        playerLevel: 20,
        tailTicks: 6000,
        ...(learn ? { learn: true } : {}),
      });
    for (const stance of CHAMPION_STANCES) {
      const watched = replay(FOMOR, stance, true);
      expect(watched.digest).toBe(replay(FOMOR, stance, false).digest);
      const lesson = watched.lessons?.[0];
      expect(lesson?.t).toBe(FOMOR);
      expect(lesson?.army).toBeGreaterThan(0);
      expect(lesson?.ring).toBeGreaterThanOrEqual(0);
      expect(lesson?.ring).toBeLessThanOrEqual(lesson?.army ?? 0);
      expect(lesson?.backed).toBeGreaterThan(0);
      expect(lesson?.backedLived).toBeLessThanOrEqual(lesson?.backed ?? 0);
      expect(lesson?.allyPicks).toBeGreaterThan(0);
    }
    const gorgo = replay(GORGO, "offensive", true).lessons?.[0];
    expect(gorgo?.army).toBeUndefined();
    expect(gorgo?.allyPicks).toBeUndefined();
  });
});

describe("Fomor's lesson counts only while it is in battle", () => {
  const YARD: CombatBuildingDataMap = {
    "1": { id: 1, t: 14, l: 5, X: 250, Y: 250 },
    "2": sniper(2, 400, 300, 5),
    "3": sniper(3, 300, 400, 5),
    "4": harvester(4, -350, -350),
  };
  const replay = (extra: FlingLog["events"]) =>
    replayAttack({
      buildingdata: YARD,
      buildinghealthdata: {},
      resources: RESOURCES,
      kind: "main",
      log: {
        v: 1,
        seed: 22001,
        events: [
          { kind: "fling", t: 0, x: 0, y: 0, r: 100, monsters: { C1: 6, C2: 4 }, champion: { t: FOMOR, l: 3, s: "offensive" } },
          ...extra,
        ],
      },
      levels: {},
      playerLevel: 20,
      tailTicks: 6000,
      learn: true,
    }).lessons?.[0];

  it("adds nothing from the monsters it enraged once it is called back", () => {
    // Its rage stays on the monsters until the aura's next tick: their blows
    // after the call-back must not count. Everyone called back at the same
    // tick is the yardstick (nobody hits after it).
    const full = replay([]);
    for (const at of [600, 800]) {
      const back = replay([{ kind: "championRetreat", t: at, c: FOMOR }]);
      const all = replay([{ kind: "championRetreat", t: at, c: FOMOR }, { kind: "retreat", t: at }]);
      expect(back?.army).toBeGreaterThan(0);
      expect(back?.army).toBe(all?.army);
      expect(back?.ring).toBe(all?.ring);
      expect(full?.army).toBeGreaterThan(back?.army ?? 0);
    }
  });
});

describe("Krallen has no Mode (owner, 25 Nov 2026, patch 8.7)", () => {
  it("every other champion has one", () => {
    expect(hasMode(KRALLEN_ID)).toBe(false);
    for (const id of [GORGO_ID, DRULL_ID, FOMOR_ID, KORATH_ID]) expect(hasMode(id)).toBe(true);
    expect(hasMode(undefined)).toBe(false);
  });

  it("a new attack's log flings her in none, whatever was picked; the others in theirs", () => {
    for (const stance of ["offensive", "defensive", "hybrid", undefined] as const) {
      expect(flungStance(5, stance)).toBeUndefined();
      expect(flungStance(3, stance)).toBe(stance);
      expect(flungStance(1, stance)).toBe(stance);
    }
  });
});
