import { describe, expect, test } from "bun:test";
import { learnFromLesson, type ChampionLesson, type FlingLog } from "../../../game-rules/combat/index.js";
import { ChampionListSchema } from "../../../schemas/ChampionSchema.js";
import type { ChampionData } from "../../../schemas/ChampionSchema.js";
import { championsAfterAttack } from "./attackerRow.js";
import { championsAfterLessons, withStoredBrains } from "./championBrain.js";

/**
 * Where a champion's brain is updated after an attack lands (issue #219), and
 * that nothing a client sends ever becomes one.
 */

const lesson = (t: number, over: Partial<ChampionLesson> = {}): ChampionLesson => ({
  t,
  picks: 4,
  credit: { tower: 2, loot: -2, finish: 0, focus: 0.8, threat: 0.4 },
  dealt: 500,
  potential: 1000,
  startHp: 1000,
  endHp: 500,
  ...over,
});

const champion = (t: number, extra: Partial<ChampionData> = {}): ChampionData => ({
  t,
  hp: 1000,
  l: 4,
  ft: 0,
  fd: 0,
  fb: 0,
  pl: 0,
  status: 0,
  ...extra,
});

const logFlinging = (...champions: { t: number; s?: "offensive" | "hybrid" | "defensive" }[]): FlingLog => ({
  v: 1,
  seed: 1,
  events: champions.map((one, at) => ({
    kind: "fling" as const,
    t: 100 + at,
    x: 0,
    y: 0,
    r: 300,
    monsters: {},
    champion: { t: one.t, l: 4, ...(one.s && { s: one.s }) },
  })),
});

describe("championsAfterLessons", () => {
  test("each champion that fought learns by the Mode the log flung it in", () => {
    const stored = [champion(1, { bs: { n: 2, off: 0.45 } }), champion(5, { bs: { n: 2, def: 0.9 } })];
    const after = championsAfterLessons(stored, [lesson(1), lesson(5)], logFlinging({ t: 1, s: "offensive" }, { t: 5, s: "defensive" }))!;
    expect(after[0]).toMatchObject(
      (() => {
        const learned = learnFromLesson(undefined, { n: 2, off: 0.45 }, lesson(1), "offensive");
        return { b: learned.brain, bs: learned.stats };
      })()
    );
    // Offensive did better than usual: it leans to towers. Defensive did worse: away.
    expect(after[0]!.b!.tower).toBeGreaterThan(0);
    expect(after[1]!.b!.tower).toBeLessThan(0);
    expect(after[1]!.bs).toMatchObject({ n: 3 });
  });

  test("a champion flung with no Mode learns as Hybrid", () => {
    const after = championsAfterLessons([champion(1, { bs: { n: 1, hyb: 0.1 } })], [lesson(1)], logFlinging({ t: 1 }))!;
    expect(after[0]!.bs).toMatchObject({ n: 2 });
    expect(after[0]!.bs!.hyb).toBeGreaterThan(0.1);
  });

  test("a champion that did not fight, and every other field, is left as it was", () => {
    const stored = [champion(1, { nm: "Bruno", s: "offensive", hp: 400 }), champion(3, { b: { tower: 9, loot: 0, finish: 0, focus: 0, threat: 0 } })];
    const after = championsAfterLessons(stored, [lesson(1)], logFlinging({ t: 1 }))!;
    expect(after[1]).toBe(stored[1]!);
    expect(after[0]).toMatchObject({ nm: "Bruno", s: "offensive", hp: 400, l: 4 });
    expect(after[0]!.bs).toEqual({ n: 1, hyb: 0.5 });
  });

  test("no lessons, no change: a defence never teaches the attacker's champions anything", () => {
    const stored = [champion(2)];
    expect(championsAfterLessons(stored, [], logFlinging())).toBe(stored);
    expect(championsAfterLessons(stored, undefined, logFlinging())).toBe(stored);
    expect(championsAfterLessons(null, [lesson(2)], logFlinging({ t: 2 }))).toBeNull();
  });

  test("a stored brain past its bounds is made safe before it learns", () => {
    const stored = [champion(1, { b: { tower: 1e9, loot: Number.NaN } as never, bs: "junk" as never })];
    const after = championsAfterLessons(stored, [lesson(1)], logFlinging({ t: 1 }))!;
    expect(after[0]!.b).toEqual({ tower: 200, loot: 0, finish: 0, focus: 0, threat: 0 });
  });
});

describe("no client can send a brain (issue #219)", () => {
  const forged = { b: { tower: 200, loot: 200, finish: 200, focus: 200, threat: 200 }, bs: { n: 999 } };

  test("the save's champion lists drop b and bs", () => {
    const parsed = ChampionListSchema.parse(JSON.stringify([{ ...champion(1), ...forged }]))!;
    expect(parsed[0]).not.toHaveProperty("b");
    expect(parsed[0]).not.toHaveProperty("bs");
  });

  test("an attack save takes the champion's health and nothing else, its brain included", () => {
    const stored = [champion(1, { b: { tower: 10, loot: 0, finish: 0, focus: 0, threat: 0 }, bs: { n: 3 } })];
    const sent = ChampionListSchema.parse(JSON.stringify([{ ...champion(1, { hp: 200 }), ...forged }]))!;
    const after = championsAfterAttack(stored, sent, logFlinging({ t: 1 }));
    expect(after[0]).toMatchObject({ hp: 200, b: stored[0]!.b, bs: { n: 3 } });
  });

  test("a wholesale champion list keeps the stored brains, never the sent ones", () => {
    const stored = [champion(1, { b: { tower: 10, loot: 0, finish: 0, focus: 0, threat: 0 }, bs: { n: 3 } })];
    const sent = [{ ...champion(1, { hp: 5 }), ...forged }, { ...champion(2), ...forged }] as ChampionData[];
    const kept = withStoredBrains(stored, sent);
    expect(kept[0]).toMatchObject({ hp: 5, b: stored[0]!.b, bs: { n: 3 } });
    expect(kept[1]).not.toHaveProperty("b");
    expect(kept[1]).not.toHaveProperty("bs");
  });
});
