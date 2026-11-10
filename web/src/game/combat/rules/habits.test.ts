import { describe, expect, it } from "vitest";

import type { ChampionLesson } from "./brain.js";
import { DRULL_ID, FOMOR_ID, GORGO_ID, KORATH_ID, KRALLEN_ID } from "./champions.js";
import { createBattle } from "./engine.js";
import {
  CHAMPION_HABITS,
  HABIT_CAP,
  HYBRID_HABIT_CAP,
  habitCap,
  habitPips,
  habitsOf,
  hasHabits,
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
const KRALLEN = 5;

type Habits = Partial<Record<HabitKey, number>>;

interface Fight {
  readonly t?: number;
  readonly stance: ChampionStance;
  /** The habits flung, with the version; null flings none (today's champion). */
  readonly habits: Habits | null;
  readonly level?: number;
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
    // Fomor picks a building only when no monster is hurt: Aerial Defense alone.
    for (const stance of CHAMPION_STANCES) expect(habitsOf(FOMOR_ID, stance)).toEqual(["aerial"]);
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

  it("drops a full habit with no fresh proof to 0 pips within 15 attacks", () => {
    for (const stance of CHAMPION_STANCES) {
      const short = stance === "offensive" ? "off" : stance === "defensive" ? "def" : "hyb";
      const habit = habitsOf(GORGO_ID, stance)[0]!;
      let book: HabitBook = { [short]: { [habit]: habitCap(stance) } };
      let stats: HabitStats | undefined;
      expect(habitPips(habitCap(stance), stance)).toBe(3);
      for (let attack = 0; attack < 15; attack += 1) {
        const learned = learnHabits(book, stats, lesson(0.5, {}), stance);
        book = learned.book;
        stats = learned.stats;
      }
      expect(habitPips(book[short]?.[habit] ?? 0, stance)).toBe(0);
    }
  });

  it("leaves the other Modes alone", () => {
    const book: HabitBook = { off: { guard: 80 }, def: { near: 60 } };
    const learned = learnHabits(book, undefined, lesson(1, { tower: 10 }), "hybrid");
    expect(learned.book.off).toEqual({ guard: 80 });
    expect(learned.book.def).toEqual({ near: 60 });
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

  it("replays a champion with habits identically", () => {
    const habits = { tower: 150 };
    const one = replay({ t: GORGO, l: 2, s: "hybrid", hv: 1, h: habits });
    const two = replay({ t: GORGO, l: 2, s: "hybrid", hv: 1, h: habits });
    expect(two.digest).toBe(one.digest);
    expect(two.checkpoints).toEqual(one.checkpoints);
    expect(one.digest).not.toBe(replay({ t: GORGO, l: 2, s: "hybrid" }).digest);
  });
});
