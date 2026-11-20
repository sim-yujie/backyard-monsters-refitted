import { describe, expect, it } from "vitest";

import type { ChampionLesson } from "./brain.js";
import { FOMOR_ID, GORGO_ID } from "./champions.js";
import {
  HABIT_LEARNING_VERSION,
  HABIT_RULES,
  activeWeight,
  bookOfLearning,
  checkHabit,
  forgetHabits,
  habitBookOf,
  habitLearningOf,
  hasLearned,
  learnHabits,
  migrateHabits,
  parseHabitLearning,
  type HabitLearning,
  type HabitStats,
} from "./habits.js";
import type { ChampionStance, HabitKey } from "./stance.js";

/**
 * The owner's pick B (desk, 19 Nov 2026): a habit is Active at one fixed
 * weight or Unproven at 0. Eight useful observations open the gate, three
 * checks in a row one way make it Active, eight in a row against it make it
 * Unproven again.
 */

const GORGO = 1;
const FOMOR = 3;

/**
 * A Gorgo lesson scoring `score` (Offensive: dealt / potential), with every
 * habit's credit `credit` over 10 looks.
 */
const lesson = (score: number, credit: Partial<Record<HabitKey, number>>): ChampionLesson => ({
  t: GORGO,
  picks: 10,
  credit: { tower: 0, loot: 0, finish: 0, focus: 0, threat: 0, ...credit },
  dealt: score * 100,
  potential: 100,
  startHp: 100,
  endHp: 100,
});

/** Runs lessons through B in one Mode, carrying everything forward as the server does. */
const run = (
  stance: ChampionStance,
  lessons: readonly ChampionLesson[],
  start: { learning?: HabitLearning; stats?: HabitStats } = {},
) => {
  let book: unknown = undefined;
  let stats: unknown = start.stats;
  let learning: unknown = start.learning;
  const steps: ReturnType<typeof learnHabits>[] = [];
  for (const one of lessons) {
    const learned = learnHabits(book, stats, one, stance, undefined, learning);
    book = learned.book;
    stats = learned.stats;
    learning = learned.learning;
    steps.push(learned);
  }
  return steps;
};

/** A usual score of 0.5 on players' yards, so each lesson's way is the sign of (score - 0.5) × credit. */
const usualHalf = (stance: ChampionStance, n = 0): HabitStats => {
  const short = stance === "offensive" ? "off" : stance === "defensive" ? "def" : "hyb";
  return { n, [short]: { n, u: { main: 0.5 } } };
};

/** Gorgo Offensive: "guard" is one-ended, "gun" two-ended. */
const good = (habit: HabitKey) => lesson(0.6, { [habit]: 5 });
const bad = (habit: HabitKey) => lesson(0.4, { [habit]: 5 });

describe("B: the evidence gate, then three checks in a row", () => {
  it("turns a habit Active only on the 11th useful attack: 8 to pass the gate, then 3 checks", () => {
    const steps = run("offensive", Array.from({ length: 11 }, () => good("guard")), {
      stats: usualHalf("offensive"),
    });
    for (const [index, step] of steps.slice(0, 10).entries()) {
      expect(step.book.off?.guard, `attack ${index + 1}`).toBeUndefined();
      expect(step.learning.r).toBeUndefined();
    }
    const last = steps[10]!;
    expect(last.book.off).toEqual({ guard: HABIT_RULES.weight });
    expect(last.learning.off?.guard).toEqual({ o: 8, d: 1 });
    expect(last.learning.r).toEqual({ m: "off", n: 11, e: { guard: "learned" } });
  });

  it("fights an Active habit at 50, or 75 in Hybrid", () => {
    expect(activeWeight("offensive")).toBe(50);
    expect(activeWeight("defensive")).toBe(50);
    expect(activeWeight("hybrid")).toBe(75);
    const learning: HabitLearning = {
      v: 1,
      off: { gun: { o: 8, d: -1 } },
      hyb: { tower: { o: 8, d: 1 }, loot: { o: 8, d: -1 }, hall: { o: 3 } },
    };
    expect(bookOfLearning(learning, GORGO_ID)).toEqual({
      off: { gun: -50 },
      hyb: { tower: 75, loot: -75 },
    });
  });

  it("starts the count over when a check goes the other way", () => {
    const after = { o: 8 };
    expect(checkHabit(after, 1, "gun").track).toEqual({ o: 8, c: 1, s: 1 });
    expect(checkHabit({ o: 8, c: 1, s: 2 }, -1, "gun").track).toEqual({ o: 8, c: -1, s: 1 });
    expect(checkHabit({ o: 8, c: -1, s: 2 }, -1, "gun")).toEqual({ track: { o: 8, d: -1 }, event: "learned" });
  });

  it("never lets a one-ended habit lean the other way", () => {
    const steps = run("offensive", Array.from({ length: 30 }, () => bad("guard")), {
      stats: usualHalf("offensive"),
    });
    for (const step of steps) expect(step.book.off?.guard).toBeUndefined();
    expect(steps.at(-1)!.learning.off?.guard).toEqual({ o: 8 });
  });

  it("lets a two-ended habit be learned either way", () => {
    const steps = run("offensive", Array.from({ length: 11 }, () => bad("gun")), {
      stats: usualHalf("offensive"),
    });
    expect(steps.at(-1)!.book.off).toEqual({ gun: -50 });
  });

  it("counts nothing from an attack with no score, no usual, no looks or no credit", () => {
    const track = { o: 8, c: 1 as const, s: 2 };
    expect(checkHabit(track, 0, "guard")).toEqual({ track });
    // The very first attack in a Mode only sets the usual score.
    const first = run("offensive", [good("guard")]);
    expect(first[0]!.learning.off).toBeUndefined();
    // No credit: the habit made no difference to the picks.
    const flat = run("offensive", [lesson(0.9, {})], { stats: usualHalf("offensive") });
    expect(flat[0]!.learning.off).toBeUndefined();
    // No looks to choose between.
    const none = run("offensive", [{ ...good("guard"), picks: 0 }], { stats: usualHalf("offensive") });
    expect(none[0]!.learning.off).toBeUndefined();
  });
});

describe("B: an Active habit fades only after eight checks in a row against it", () => {
  const active: HabitLearning = { v: 1, off: { guard: { o: 8, d: 1 } } };

  it("stays Active through seven, and one check for it starts the count over", () => {
    const seven = run("offensive", Array.from({ length: 7 }, () => bad("guard")), {
      learning: active,
      stats: usualHalf("offensive", 20),
    });
    expect(seven.at(-1)!.book.off).toEqual({ guard: 50 });
    expect(seven.at(-1)!.learning.off?.guard).toEqual({ o: 8, d: 1, f: 7 });
    const reset = run("offensive", [good("guard")], {
      learning: seven.at(-1)!.learning,
      stats: seven.at(-1)!.stats,
    });
    expect(reset[0]!.learning.off?.guard).toEqual({ o: 8, d: 1 });
  });

  it("turns Unproven on the eighth, with a Faded receipt", () => {
    const steps = run("offensive", Array.from({ length: 8 }, () => bad("guard")), {
      learning: active,
      stats: usualHalf("offensive", 20),
    });
    const last = steps.at(-1)!;
    expect(last.book.off).toBeUndefined();
    expect(last.learning.off?.guard).toEqual({ o: 8 });
    expect(last.learning.r).toEqual({ m: "off", n: 28, e: { guard: "faded" } });
  });

  it("keeps an Active habit through attacks that say nothing about it (no fade)", () => {
    const steps = run("offensive", Array.from({ length: 50 }, () => lesson(0.9, {})), {
      learning: active,
      stats: usualHalf("offensive", 20),
    });
    expect(steps.at(-1)!.book.off).toEqual({ guard: 50 });
  });

  it("drops the last attack's receipt at the next attack with no change", () => {
    const steps = run("offensive", [...Array.from({ length: 8 }, () => bad("guard")), lesson(0.9, {})], {
      learning: active,
      stats: usualHalf("offensive", 20),
    });
    expect(steps[7]!.learning.r).toBeDefined();
    expect(steps[8]!.learning.r).toBeUndefined();
  });

  it("judges Fomor's monster habits on its looks at hurt monsters", () => {
    const fomor = (ring: number): ChampionLesson => ({
      t: FOMOR,
      picks: 0,
      allyPicks: 3,
      credit: { tower: 0, loot: 0, finish: 0, focus: 0, threat: 0, big: 3 },
      dealt: 0,
      potential: 0,
      startHp: 1,
      endHp: 1,
      army: 1000,
      ring,
    });
    // The first sets the usual (0.5), then 8 for the gate and 3 checks.
    const steps = run("offensive", [fomor(500), ...Array.from({ length: 11 }, () => fomor(700))]);
    expect(steps.at(-1)!.book.off).toEqual({ big: 50 });
    expect(steps.at(-2)!.book.off).toBeUndefined();
  });
});

describe("B: Forget", () => {
  const entry = {
    t: GORGO,
    hs: { n: 30, off: { n: 20, u: { main: 0.5 } }, def: { n: 10, u: { main: 0.7 } } },
    hl: {
      v: 1,
      off: { guard: { o: 8, d: 1 }, gun: { o: 8, c: -1, s: 2 } },
      def: { near: { o: 8, d: 1 } },
      r: { m: "off", n: 30, e: { guard: "learned" } },
    },
  };

  it("wipes the Mode's tracks and its receipt, and keeps the other Modes", () => {
    const { book, learning } = forgetHabits(entry, GORGO_ID, "offensive");
    expect(learning.off).toBeUndefined();
    expect(learning.r).toBeUndefined();
    expect(learning.def).toEqual({ near: { o: 8, d: 1 } });
    expect(book).toEqual({ def: { near: 50 } });
    expect(hasLearned(learning, "offensive")).toBe(false);
    expect(hasLearned(learning, "defensive")).toBe(true);
  });

  it("keeps the receipt when another Mode is forgotten", () => {
    const { learning } = forgetHabits(entry, GORGO_ID, "defensive");
    expect(learning.r).toEqual(entry.hl.r);
  });

  it("then starts that Mode from nothing: the gate again", () => {
    const { learning } = forgetHabits(entry, GORGO_ID, "offensive");
    const steps = run("offensive", Array.from({ length: 10 }, () => good("guard")), {
      learning,
      stats: entry.hs as HabitStats,
    });
    expect(steps.at(-1)!.book.off).toBeUndefined();
  });
});

describe("B: the migration from weights", () => {
  it("starts a habit at 2+ pips (its weight at least B's) Active that way, the rest Unproven", () => {
    const migrated = migrateHabits(
      { off: { big: 60, aerial: 20 }, def: { big: -50, aerial: 49 }, hyb: { crowd: -75, big: 74, aerial: 120 } },
      { n: 73, off: { n: 23, u: {} }, def: { n: 5, u: {} }, hyb: { n: 41, u: {} } },
      FOMOR_ID,
    );
    expect(migrated).toEqual({
      v: HABIT_LEARNING_VERSION,
      off: { big: { o: 8, d: 1 }, aerial: { o: 8 } },
      def: { big: { o: 8, d: -1 }, aerial: { o: 5 } },
      hyb: { crowd: { o: 8, d: -1 }, big: { o: 8 }, aerial: { o: 8, d: 1 } },
    });
    expect(bookOfLearning(migrated, FOMOR_ID)).toEqual({
      off: { big: 50 },
      def: { big: -50 },
      hyb: { crowd: -75, aerial: 75 },
    });
  });

  it("gives a champion with no habits and no attacks nothing", () => {
    expect(migrateHabits(undefined, undefined, GORGO_ID)).toEqual({ v: 1 });
  });

  it("is read the same by the freeze, the cage and the learning, and only once", () => {
    const old = { h: { off: { guard: 30 } }, hs: { n: 4, off: { n: 4, u: { main: 0.5 } } } };
    // The old 30 no longer fights: the freeze reads the migrated book.
    expect(habitBookOf(old, GORGO_ID)).toEqual({});
    expect(habitLearningOf(old, GORGO_ID).off).toEqual({ guard: { o: 4 }, gun: { o: 4 }, aerial: { o: 4 } });
    // Once `hl` is written, `h` is never read for it again.
    const written = { ...old, h: { off: { guard: 100 } }, hl: { v: 1 } };
    expect(habitBookOf(written, GORGO_ID)).toEqual({});
  });
});

describe("B: `hl` made safe", () => {
  it("drops habits outside the row, a - way on a one-ended habit, junk and other versions", () => {
    expect(parseHabitLearning({ v: 2, off: { guard: { o: 8, d: 1 } } }, GORGO_ID)).toBeNull();
    expect(parseHabitLearning("junk", GORGO_ID)).toBeNull();
    const parsed = parseHabitLearning(
      {
        v: 1,
        off: { guard: { o: 8, d: -1 }, gun: { o: 8, d: -1, f: 3 }, big: { o: 8, d: 1 }, aerial: { o: -2 } },
        r: { m: "off", n: 4, e: { gun: "learned", big: "faded", aerial: "won" } },
      },
      GORGO_ID,
    );
    expect(parsed).toEqual({
      v: 1,
      off: { guard: { o: 8 }, gun: { o: 8, d: -1, f: 3 } },
      r: { m: "off", n: 4, e: { gun: "learned" } },
    });
  });
});
