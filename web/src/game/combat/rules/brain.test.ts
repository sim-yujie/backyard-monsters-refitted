import { describe, expect, it } from "vitest";

import {
  BASELINE_RATE,
  BRAIN_BOUND,
  BRAIN_RATE,
  BRAIN_STEP,
  ZERO_BRAIN,
  brainBase,
  isZeroBrain,
  learnFromLesson,
  lessonScore,
  parseBrain,
  parseBrainStats,
  type ChampionLesson,
} from "./brain";
import { stanceWeights } from "./stance";

/** A lesson: by default four picks, all leaning to towers, half the potential dealt, half the health kept. */
const lesson = (over: Partial<ChampionLesson> = {}): ChampionLesson => ({
  t: 1,
  picks: 4,
  credit: { tower: 2, loot: -2, finish: 0, focus: 0.8, threat: 0.4 },
  dealt: 500,
  potential: 1000,
  startHp: 1000,
  endHp: 500,
  ...over,
});

describe("parseBrain", () => {
  it("reads the five weights, rounded and clamped to the bound", () => {
    expect(parseBrain({ tower: 12.6, loot: -999, finish: 999, focus: -3.4, threat: 0 })).toEqual({
      tower: 13,
      loot: -BRAIN_BOUND,
      finish: BRAIN_BOUND,
      focus: -3,
      threat: 0,
    });
  });

  it("makes anything missing or malformed a zero, which is today's champion", () => {
    expect(parseBrain(undefined)).toEqual(ZERO_BRAIN);
    expect(parseBrain("loot")).toEqual(ZERO_BRAIN);
    expect(parseBrain([1, 2])).toEqual(ZERO_BRAIN);
    expect(parseBrain({ tower: "200", loot: Number.NaN, finish: Infinity, extra: 50 })).toEqual(ZERO_BRAIN);
    expect(isZeroBrain(parseBrain({ focus: 0.4 }))).toBe(true);
  });

  it("a zero brain under Hybrid is still the Flash champion; a brain is the base its Mode tilts", () => {
    expect(stanceWeights("hybrid", brainBase(undefined))).toBeNull();
    expect(stanceWeights("hybrid", brainBase({ loot: 80 }))).toMatchObject({ loot: 80, tower: 0 });
    expect(stanceWeights("offensive", brainBase({ tower: 150 }))).toMatchObject({ tower: 350 });
  });
});

describe("parseBrainStats", () => {
  it("keeps a whole count and baselines between 0 and 1", () => {
    expect(parseBrainStats({ n: 3, off: 0.4, hyb: 2, def: -1 })).toEqual({ n: 3, off: 0.4 });
    expect(parseBrainStats({ n: 1.5 })).toEqual({ n: 0 });
    expect(parseBrainStats(null)).toEqual({ n: 0 });
  });
});

describe("lessonScore", () => {
  it("judges each Mode by its goal", () => {
    const one = lesson({ dealt: 800, potential: 1000, endHp: 250, startHp: 1000 });
    expect(lessonScore(one, "offensive")).toBeCloseTo(0.8);
    expect(lessonScore(one, "defensive")).toBeCloseTo(0.25);
    expect(lessonScore(one, "hybrid")).toBeCloseTo(0.525);
  });

  it("stays within 0 to 1, a death or no time on the field included", () => {
    expect(lessonScore(lesson({ dealt: 5000 }), "offensive")).toBe(1);
    expect(lessonScore(lesson({ potential: 0 }), "offensive")).toBe(0);
    expect(lessonScore(lesson({ endHp: 0 }), "defensive")).toBe(0);
  });
});

describe("learnFromLesson", () => {
  it("only sets the baseline on a Mode's first attack", () => {
    const { brain, stats } = learnFromLesson(undefined, undefined, lesson(), "offensive");
    expect(brain).toEqual(ZERO_BRAIN);
    expect(stats).toEqual({ n: 1, off: 0.5 });
  });

  it("leans toward what it did when the attack beat its usual score", () => {
    // Usual 0.49, this one 0.5: advantage 0.01; mean credits 0.5, 0.2 and 0.1.
    const { brain, stats } = learnFromLesson(undefined, { n: 5, off: 0.49 }, lesson(), "offensive");
    expect(brain.tower).toBe(Math.round(BRAIN_RATE * 0.01 * 0.5));
    expect(brain.tower).toBeGreaterThan(0);
    expect(brain.loot).toBe(-brain.tower);
    expect(brain.focus).toBe(Math.round(BRAIN_RATE * 0.01 * 0.2));
    // Threat is a penalty: leaning into fire that paid off lowers its weight.
    expect(brain.threat).toBe(Math.round(-BRAIN_RATE * 0.01 * 0.1));
    expect(brain.finish).toBe(0);
    expect(stats.n).toBe(6);
    expect(stats.off).toBeCloseTo(0.49 + BASELINE_RATE * 0.01);
  });

  it("leans away from it when the attack fell short", () => {
    const { brain } = learnFromLesson(undefined, { n: 5, off: 0.6 }, lesson(), "offensive");
    expect(brain.tower).toBeLessThan(0);
    expect(brain.loot).toBeGreaterThan(0);
    expect(brain.threat).toBeGreaterThan(0);
  });

  it("judges each Mode against its own baseline", () => {
    const stats = { n: 4, off: 0.9, def: 0.1 };
    // Offensive: 0.5 against 0.9 is worse; Defensive: 0.5 against 0.1 is better.
    expect(learnFromLesson(undefined, stats, lesson(), "offensive").brain.tower).toBeLessThan(0);
    expect(learnFromLesson(undefined, stats, lesson(), "defensive").brain.tower).toBeGreaterThan(0);
    // Hybrid has none yet, so it only sets one.
    const hybrid = learnFromLesson(undefined, stats, lesson(), "hybrid");
    expect(hybrid.brain).toEqual(ZERO_BRAIN);
    expect(hybrid.stats).toMatchObject({ off: 0.9, def: 0.1, hyb: 0.5 });
  });

  it("moves no weight more than a step in one attack, and never past the bound", () => {
    const big = lesson({ dealt: 1000, credit: { tower: 4, loot: -4, finish: 4, focus: 4, threat: -4 } });
    const once = learnFromLesson(undefined, { n: 1, off: 0 }, big, "offensive").brain;
    expect(once).toEqual({
      tower: BRAIN_STEP,
      loot: -BRAIN_STEP,
      finish: BRAIN_STEP,
      focus: BRAIN_STEP,
      threat: BRAIN_STEP,
    });
    let brain: unknown = undefined;
    for (let attack = 0; attack < 20; attack += 1) {
      brain = learnFromLesson(brain, { n: 1, off: 0 }, big, "offensive").brain;
    }
    expect(brain).toEqual({
      tower: BRAIN_BOUND,
      loot: -BRAIN_BOUND,
      finish: BRAIN_BOUND,
      focus: BRAIN_BOUND,
      threat: BRAIN_BOUND,
    });
  });

  it("takes at least seven attacks to go from nothing to the bound", () => {
    expect(Math.ceil(BRAIN_BOUND / BRAIN_STEP)).toBeGreaterThanOrEqual(7);
  });

  it("learns nothing from an attack where it never had a choice, but still counts it", () => {
    const { brain, stats } = learnFromLesson({ loot: 40 }, { n: 2, off: 0.1 }, lesson({ picks: 0 }), "offensive");
    expect(brain).toEqual({ ...ZERO_BRAIN, loot: 40 });
    expect(stats.n).toBe(3);
  });

  it("makes a forged or broken brain safe before learning on it", () => {
    const { brain } = learnFromLesson({ tower: 1e9, loot: "x" }, "junk", lesson(), "offensive");
    expect(brain).toEqual({ ...ZERO_BRAIN, tower: BRAIN_BOUND });
  });
});
