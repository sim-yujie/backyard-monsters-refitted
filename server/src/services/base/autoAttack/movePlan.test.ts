import { describe, expect, test } from "bun:test";
import { BaseType } from "../../../enums/Base.js";
import { monsterStorage, planMonsterTransfer } from "../../monsters/transferRules.js";
import { movesKey, planMoves, type MovePlan, type PlanYard, type YardMove } from "./movePlan.js";

/**
 * Smart Repeat attack's planner (owner, 16 Nov 2026): which monsters move
 * from which yard into the yards in range before a Repeat attack.
 */

/** Simple sizes, so the housing sums read at a glance. */
const SIZES: Record<string, number> = { C1: 1, C2: 2, C5: 5, C12: 20 };
const sizeOf = (id: string) => SIZES[id] ?? 1;

const yard = (baseid: string, over: Partial<PlanYard> = {}): PlanYard => ({
  baseid,
  main: false,
  reaches: false,
  housed: {},
  capacity: 1_000,
  busy: false,
  ...over,
});

const movesOf = (plan: MovePlan): readonly YardMove[] => {
  if (plan.kind !== "moves") throw new Error(`expected moves, got ${plan.kind}`);
  return plan.moves;
};

describe("planMoves", () => {
  test("the yards in range already hold the army: nothing moves", () => {
    const plan = planMoves(
      { C1: 100, C5: 10 },
      [yard("main", { main: true, housed: { C1: 500 } }), yard("near", { reaches: true, housed: { C1: 100, C5: 10 } })],
      sizeOf,
    );
    expect(plan).toEqual({ kind: "ready" });
  });

  test("one source: only the shortfall moves, in-range monsters used first", () => {
    const plan = planMoves(
      { C1: 100 },
      [yard("main", { main: true, housed: { C1: 500 } }), yard("near", { reaches: true, housed: { C1: 40 } })],
      sizeOf,
    );
    expect(movesOf(plan)).toEqual([{ from: "main", to: "near", monsters: { C1: 60 } }]);
  });

  test("several sources: the one covering the most goes first, and the fewest yards are used", () => {
    const plan = planMoves(
      { C1: 50, C5: 20 },
      [
        yard("main", { main: true, housed: { C1: 10 } }),
        yard("far1", { housed: { C1: 50 } }),
        yard("far2", { housed: { C5: 20, C1: 5 } }),
        yard("near", { reaches: true }),
      ],
      sizeOf,
    );
    // far2 covers 105 space (C5 x20 + C1 x5), far1 then the remaining 45 C1.
    expect(movesOf(plan)).toEqual([
      { from: "far2", to: "near", monsters: { C5: 20, C1: 5 } },
      { from: "far1", to: "near", monsters: { C1: 45 } },
    ]);
  });

  test("one type split across two sources when neither has enough alone", () => {
    const plan = planMoves(
      { C2: 90 },
      [
        yard("main", { main: true, reaches: true, housed: { C2: 10 } }),
        yard("far1", { housed: { C2: 50 } }),
        yard("far2", { housed: { C2: 35 } }),
      ],
      sizeOf,
    );
    expect(movesOf(plan)).toEqual([
      { from: "far1", to: "main", monsters: { C2: 50 } },
      { from: "far2", to: "main", monsters: { C2: 30 } },
    ]);
  });

  test("the main yard is a source when it is out of range", () => {
    const plan = planMoves(
      { C5: 30 },
      [yard("main", { main: true, housed: { C5: 100 } }), yard("near", { reaches: true })],
      sizeOf,
    );
    expect(movesOf(plan)).toEqual([{ from: "main", to: "near", monsters: { C5: 30 } }]);
  });

  test("ties go to the main yard, then the lower base id", () => {
    const plan = planMoves(
      { C1: 10 },
      [
        yard("main", { main: true, housed: { C1: 10 } }),
        yard("a", { housed: { C1: 10 } }),
        yard("near", { reaches: true }),
      ],
      sizeOf,
    );
    expect(movesOf(plan)).toEqual([{ from: "main", to: "near", monsters: { C1: 10 } }]);

    const outposts = planMoves(
      { C1: 10 },
      [yard("main", { main: true }), yard("b", { housed: { C1: 10 } }), yard("a", { housed: { C1: 10 } }), yard("near", { reaches: true })],
      sizeOf,
    );
    expect(movesOf(outposts)).toEqual([{ from: "a", to: "near", monsters: { C1: 10 } }]);
  });

  test("the main yard receives monsters when it is the yard in range", () => {
    const plan = planMoves(
      { C1: 100, C12: 2 },
      [yard("main", { main: true, reaches: true, housed: { C1: 100 } }), yard("far", { housed: { C12: 5 } })],
      sizeOf,
    );
    expect(movesOf(plan)).toEqual([{ from: "far", to: "main", monsters: { C12: 2 } }]);
  });

  test("a load goes whole into the tightest yard in range that fits it", () => {
    const plan = planMoves(
      { C1: 30 },
      [
        yard("main", { main: true, housed: { C1: 30 } }),
        yard("roomy", { reaches: true, capacity: 500 }),
        yard("snug", { reaches: true, capacity: 40 }),
      ],
      sizeOf,
    );
    expect(movesOf(plan)).toEqual([{ from: "main", to: "snug", monsters: { C1: 30 } }]);
  });

  test("a load no single yard fits is split across two yards in range, biggest monsters first", () => {
    const plan = planMoves(
      { C12: 3, C1: 30 },
      [
        yard("main", { main: true, housed: { C12: 3, C1: 30 } }),
        yard("a", { reaches: true, capacity: 50 }),
        yard("b", { reaches: true, capacity: 45 }),
      ],
      sizeOf,
    );
    // 90 space: no yard holds it whole. "a" (50) takes 2 x C12 (40) and 10 x C1; "b" the rest.
    expect(movesOf(plan)).toEqual([
      { from: "main", to: "a", monsters: { C12: 2, C1: 10 } },
      { from: "main", to: "b", monsters: { C12: 1, C1: 20 } },
    ]);
  });

  test("housing that fits by its sum but not by packing is refused", () => {
    // 2 x C12 is 40 space; 60 free in range, but 30 per yard: a 20-space monster fits once in each,
    // and a third would not. Here 3 must move: the sum (60) says yes, the yards say no.
    const plan = planMoves(
      { C12: 3 },
      [
        yard("main", { main: true, housed: { C12: 3 } }),
        yard("a", { reaches: true, capacity: 30 }),
        yard("b", { reaches: true, capacity: 30 }),
      ],
      sizeOf,
    );
    expect(plan).toEqual({
      kind: "housing",
      need: 60,
      free: [
        { baseid: "a", free: 30 },
        { baseid: "b", free: 30 },
      ],
    });
  });

  test("free housing is capacity less what the yard in range houses now", () => {
    const plan = planMoves(
      { C1: 100 },
      [yard("main", { main: true, housed: { C1: 100 } }), yard("near", { reaches: true, capacity: 120, housed: { C5: 10 } })],
      sizeOf,
    );
    expect(plan).toEqual({ kind: "housing", need: 100, free: [{ baseid: "near", free: 70 }] });
  });

  test("a source yard under attack sends nothing; another yard is used", () => {
    const plan = planMoves(
      { C1: 20 },
      [
        yard("main", { main: true, busy: true, housed: { C1: 500 } }),
        yard("far", { housed: { C1: 20 } }),
        yard("near", { reaches: true }),
      ],
      sizeOf,
    );
    expect(movesOf(plan)).toEqual([{ from: "far", to: "near", monsters: { C1: 20 } }]);
  });

  test("a source yard under attack can leave the army short", () => {
    const plan = planMoves(
      { C1: 20 },
      [yard("main", { main: true, busy: true, housed: { C1: 500 } }), yard("near", { reaches: true, housed: { C1: 5 } })],
      sizeOf,
    );
    expect(plan).toEqual({ kind: "short", short: [{ id: "C1", need: 20, have: 5 }] });
  });

  test("a yard in range under attack takes nothing in", () => {
    const plan = planMoves(
      { C1: 20 },
      [
        yard("main", { main: true, housed: { C1: 20 } }),
        yard("busy", { reaches: true, busy: true }),
        yard("near", { reaches: true }),
      ],
      sizeOf,
    );
    expect(movesOf(plan)).toEqual([{ from: "main", to: "near", monsters: { C1: 20 } }]);
  });

  test("not gatherable even from every yard: each short type with what all yards hold", () => {
    const plan = planMoves(
      { C1: 100, C5: 10, C2: 4 },
      [
        yard("main", { main: true, housed: { C1: 30, C2: 4 } }),
        yard("far", { housed: { C1: 20 } }),
        yard("near", { reaches: true, housed: { C1: 38, C5: 3 } }),
      ],
      sizeOf,
    );
    expect(plan).toEqual({
      kind: "short",
      short: [
        { id: "C1", need: 100, have: 88 },
        { id: "C5", need: 10, have: 3 },
      ],
    });
  });

  test("no yard in range: every move would have nowhere to go", () => {
    const plan = planMoves({ C1: 5 }, [yard("main", { main: true, housed: { C1: 5 } })], sizeOf);
    expect(plan).toEqual({ kind: "housing", need: 5, free: [] });
  });

  test("the same yards give the same plan every time", () => {
    const yards = [
      yard("main", { main: true, housed: { C1: 40, C5: 9 } }),
      yard("x", { housed: { C1: 40, C5: 9 } }),
      yard("near1", { reaches: true, capacity: 60 }),
      yard("near2", { reaches: true, capacity: 60 }),
    ];
    const first = planMoves({ C1: 60, C5: 12 }, yards, sizeOf);
    for (let i = 0; i < 5; i += 1) expect(planMoves({ C1: 60, C5: 12 }, [...yards].reverse(), sizeOf)).toEqual(first);
  });
});

describe("planned moves pass the transfer rules", () => {
  // Real sizes and the real transfer rules: every move, applied in turn, is one
  // `POST /worldmapv2/transferassets` would accept.
  const levels = { C1: 3 };
  const realSize = (id: string) => monsterStorage(id, levels);

  test("a busy three-source, two-destination plan", () => {
    const yards: PlanYard[] = [
      yard("main", { main: true, housed: { C1: 300, C5: 30, C12: 4 }, capacity: 9_000 }),
      yard("far1", { housed: { C2: 60, C1: 50 }, capacity: 9_000 }),
      yard("far2", { housed: { C12: 6, C5: 12 }, capacity: 9_000 }),
      yard("near1", { reaches: true, housed: { C1: 20 }, capacity: 4_000 }),
      yard("near2", { reaches: true, capacity: 3_000 }),
    ];
    const plan = planMoves({ C1: 180, C5: 40, C2: 50, C12: 8 }, yards, realSize);
    const moves = movesOf(plan);
    expect(moves.length).toBeGreaterThan(1);

    const housed = new Map(yards.map((one) => [one.baseid, { ...one.housed }]));
    for (const move of moves) {
      const from = yards.find((one) => one.baseid === move.from)!;
      const to = yards.find((one) => one.baseid === move.to)!;
      const verdict = planMonsterTransfer({
        from: { baseid: from.baseid, type: from.main ? BaseType.MAIN : BaseType.OUTPOST, stored: { housed: housed.get(from.baseid) }, capacity: from.capacity },
        to: { baseid: to.baseid, type: to.main ? BaseType.MAIN : BaseType.OUTPOST, stored: { housed: housed.get(to.baseid) }, capacity: to.capacity },
        moved: move.monsters,
        monsterLevels: levels,
      });
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) return;
      housed.set(from.baseid, verdict.fromHoused);
      housed.set(to.baseid, verdict.toHoused);
    }

    // Afterwards the yards in range hold the whole army.
    const inRange: Record<string, number> = {};
    for (const baseid of ["near1", "near2"])
      for (const [id, count] of Object.entries(housed.get(baseid) ?? {})) inRange[id] = (inRange[id] ?? 0) + count;
    for (const [id, need] of Object.entries({ C1: 180, C5: 40, C2: 50, C12: 8 })) expect(inRange[id] ?? 0).toBeGreaterThanOrEqual(need);
  });
});

describe("movesKey", () => {
  test("names the moves whatever their order", () => {
    const one = movesKey([
      { from: "a", to: "n", monsters: { C5: 2, C1: 3 } },
      { from: "b", to: "n", monsters: { C1: 1 } },
    ]);
    const other = movesKey([
      { from: "b", to: "n", monsters: { C1: 1 } },
      { from: "a", to: "n", monsters: { C1: 3, C5: 2 } },
    ]);
    expect(one).toBe(other);
    expect(one).toBe("a>n:C1=3,C5=2;b>n:C1=1");
    expect(movesKey([{ from: "a", to: "n", monsters: { C1: 4 } }])).not.toBe(movesKey([{ from: "a", to: "n", monsters: { C1: 3 } }]));
  });
});
