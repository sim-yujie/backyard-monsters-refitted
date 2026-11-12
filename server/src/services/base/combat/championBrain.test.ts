import { describe, expect, test } from "bun:test";
import { learnHabits, type ChampionLesson, type FlingLog } from "../../../game-rules/combat/index.js";
import { ChampionListSchema } from "../../../schemas/ChampionSchema.js";
import type { ChampionData } from "../../../schemas/ChampionSchema.js";
import { championsAfterAttack } from "./attackerRow.js";
import { championsAfterLessons } from "./championBrain.js";

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
    const stored = [
      champion(1, { hs: { n: 2, off: { n: 1, u: { main: 0.45 } } } }),
      champion(5, { bs: { n: 2, def: 0.9 } }),
    ];
    const lessons = [lesson(1, { credit: { ...lesson(1).credit, guard: 2, gun: -1 } }), lesson(5)];
    const after = championsAfterLessons(stored, lessons, logFlinging({ t: 1, s: "offensive" }, { t: 5, s: "defensive" }))!;
    // Gorgo learns its Offensive habits (champion modes round 2).
    expect(after[0]).toMatchObject(
      (() => {
        const learned = learnHabits(undefined, stored[0]!.hs, lessons[0]!, "offensive");
        return { h: learned.book, hs: learned.stats };
      })()
    );
    // Offensive did better than usual: it leans to guarding, and to the smaller gun.
    expect(after[0]!.h!.off!.guard).toBeGreaterThan(0);
    expect(after[0]!.h!.off!.gun).toBeLessThan(0);
    expect(after[0]!.hs).toMatchObject({ n: 3, off: { n: 2 } });
    // Krallen keeps today's brain (owner, 10 Nov): Defensive did worse, away from towers.
    expect(after[1]!.b!.tower).toBeLessThan(0);
    expect(after[1]!.bs).toMatchObject({ n: 3 });
    expect(after[1]).not.toHaveProperty("h");
  });

  test("a champion flung with no Mode learns as Hybrid", () => {
    const stored = [champion(1, { hs: { n: 1, hyb: { n: 1, u: { main: 0.1 } } } })];
    const after = championsAfterLessons(stored, [lesson(1)], logFlinging({ t: 1 }))!;
    expect(after[0]!.hs).toMatchObject({ n: 2, hyb: { n: 2 } });
    expect(after[0]!.hs!.hyb!.u.main).toBeGreaterThan(0.1);
  });

  test("a champion with an old brain starts its habits fresh and keeps its attack count", () => {
    const stored = [champion(2, { b: { tower: 200, loot: 0, finish: 0, focus: -200, threat: 0 }, bs: { n: 30, off: 0.2 } })];
    const after = championsAfterLessons(stored, [lesson(2)], logFlinging({ t: 2, s: "offensive" }))!;
    expect(after[0]).not.toHaveProperty("b");
    expect(after[0]).not.toHaveProperty("bs");
    expect(after[0]!.h).toEqual({});
    expect(after[0]!.hs).toEqual({ n: 31, off: { n: 1, u: { main: 0.5 } } });
  });

  test("a champion that did not fight, and every other field, is left as it was", () => {
    const stored = [champion(1, { nm: "Bruno", s: "offensive", hp: 400 }), champion(3, { h: { hyb: { aerial: 9 } } })];
    const after = championsAfterLessons(stored, [lesson(1, { k: "outpost" })], logFlinging({ t: 1 }))!;
    expect(after[1]).toBe(stored[1]!);
    expect(after[0]).toMatchObject({ nm: "Bruno", s: "offensive", hp: 400, l: 4 });
    // Its usual score is kept per kind of yard.
    expect(after[0]!.hs).toEqual({ n: 1, hyb: { n: 1, u: { outpost: 0.5 } } });
  });

  test("no lessons, no change: a defence never teaches the attacker's champions anything", () => {
    const stored = [champion(2)];
    expect(championsAfterLessons(stored, [], logFlinging())).toBe(stored);
    expect(championsAfterLessons(stored, undefined, logFlinging())).toBe(stored);
    expect(championsAfterLessons(null, [lesson(2)], logFlinging({ t: 2 }))).toBeNull();
  });

  test("a stored brain or book past its bounds is made safe before it learns", () => {
    const stored = [
      champion(5, { b: { tower: 1e9, loot: Number.NaN } as never, bs: "junk" as never }),
      champion(1, { h: { hyb: { tower: 1e9, quake: 50, near: -40 } } as never, hs: "junk" as never }),
    ];
    const after = championsAfterLessons(stored, [lesson(5), lesson(1)], logFlinging({ t: 5 }, { t: 1 }))!;
    expect(after[0]!.b).toEqual({ tower: 200, loot: 0, finish: 0, focus: 0, threat: 0 });
    // Faded once (150 to 135); no quake on Gorgo, and "Stays close" cannot go below 0.
    expect(after[1]!.h).toEqual({ hyb: { tower: 135 } });
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

});

describe("no attacker's list can add, raise or hatch a champion", () => {
  const egg = (t: number, ft = 2_000_000_000) => champion(t, { status: 3, ft, hp: 12_000 });

  test("an old or new client's list parses an egg (status 3) like any entry", () => {
    const parsed = ChampionListSchema.parse(JSON.stringify([egg(2), champion(5)]))!;
    expect(parsed.map((one) => one.status)).toEqual([3, champion(5).status]);
  });

  test("a Krallen the attacker does not own is ignored, flung or not", () => {
    const stored = [champion(1)];
    const sent = ChampionListSchema.parse(JSON.stringify([champion(1), champion(5, { l: 5, pl: 2 })]))!;
    expect(championsAfterAttack(stored, sent, logFlinging({ t: 5 }))).toEqual(stored);
    // Nor does a player with no champion at all get one.
    expect(championsAfterAttack([], sent, logFlinging({ t: 5 }))).toEqual([]);
  });

  test("a level, power level, food bonus or status the list claims is never taken", () => {
    const stored = [champion(5, { l: 1, pl: 0 }), egg(2)];
    const sent = ChampionListSchema.parse(
      JSON.stringify([champion(5, { l: 5, pl: 2, fb: 3, hp: 900 }), champion(2, { status: 0, ft: 1 })])
    )!;
    const after = championsAfterAttack(stored, sent, logFlinging({ t: 5 }, { t: 2 }));
    expect(after[0]).toEqual({ ...stored[0]!, hp: 900 });
    expect(after[1]).toEqual(stored[1]!);
  });
});
