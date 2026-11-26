import { describe, expect, test } from "bun:test";
import { BaseType } from "../../enums/Base.js";
import { MAX_BATCH_PAIRS, planBatchTransfer, readBatchPairs, type BatchPair } from "./transferBatch.js";
import type { TransferYard } from "./transferRules.js";

/**
 * The world map's move tray (beta 9 #7): one move, several pairs of yards.
 * Each pair is checked against what the pairs before it left; one refused
 * pair refuses the whole move. C1 (Pokey) takes 10 at Academy level 1, D.A.V.E.
 * (C12) 160.
 */

const MAIN = "main";
const yard = (baseid: string, housed: Record<string, number>, capacity: number, type: string = BaseType.OUTPOST): TransferYard => ({
  baseid,
  type,
  stored: { housed },
  capacity,
});

const yardsOf = (...list: TransferYard[]) => new Map(list.map((y) => [y.baseid, y]));
const pair = (from: string, to: string, moved: Record<string, unknown>): BatchPair => ({ from, to, moved });

describe("planBatchTransfer", () => {
  const main = () => yard(MAIN, { C1: 50, C12: 2 }, 2160, BaseType.MAIN);

  test("the main yard fills three outposts in one move", () => {
    const verdict = planBatchTransfer({
      yards: yardsOf(main(), yard("a", {}, 540), yard("b", { C1: 4 }, 540), yard("c", {}, 540)),
      pairs: [pair(MAIN, "a", { C1: 20 }), pair(MAIN, "b", { C1: 10 }), pair(MAIN, "c", { C12: 2 })],
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.housed).toEqual({ main: { C1: 20 }, a: { C1: 20 }, b: { C1: 14 }, c: { C12: 2 } });
    expect(verdict.total).toBe(32);
  });

  test("every outpost home in one move", () => {
    const verdict = planBatchTransfer({
      yards: yardsOf(yard(MAIN, {}, 2160, BaseType.MAIN), yard("a", { C1: 5 }, 540), yard("b", { C1: 3, C12: 1 }, 540)),
      pairs: [pair("a", MAIN, { C1: 5 }), pair("b", MAIN, { C1: 3, C12: 1 })],
    });
    expect(verdict.ok && verdict.housed).toEqual({ main: { C1: 8, C12: 1 }, a: {}, b: {} });
  });

  test("a source cannot send the same monsters twice across pairs (holdings)", () => {
    const verdict = planBatchTransfer({
      yards: yardsOf(main(), yard("a", {}, 540), yard("b", {}, 540)),
      pairs: [pair(MAIN, "a", { C1: 30 }), pair(MAIN, "b", { C1: 30 })],
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.rule).toBe("holdings");
    expect(verdict.pair).toBe(1);
    expect(verdict.detail).toMatchObject({ monster: "C1", claimed: 30, held: 20 });
  });

  test("an outpost's room counts what it already houses: 540 holds 54 Pokeys, not 55", () => {
    const fits = planBatchTransfer({
      yards: yardsOf(yard(MAIN, { C1: 100 }, 2160, BaseType.MAIN), yard("a", { C1: 4 }, 540)),
      pairs: [pair(MAIN, "a", { C1: 50 })],
    });
    expect(fits.ok).toBe(true);
    const over = planBatchTransfer({
      yards: yardsOf(yard(MAIN, { C1: 100 }, 2160, BaseType.MAIN), yard("a", { C1: 4 }, 540)),
      pairs: [pair(MAIN, "a", { C1: 51 })],
    });
    expect(!over.ok && over.rule).toBe("capacity");
  });

  test("the boosted outpost (675) takes what a plain one (540) cannot", () => {
    const pairs = [pair(MAIN, "a", { C1: 60 })];
    expect(planBatchTransfer({ yards: yardsOf(yard(MAIN, { C1: 60 }, 2160, BaseType.MAIN), yard("a", {}, 540)), pairs }).ok).toBe(false);
    expect(planBatchTransfer({ yards: yardsOf(yard(MAIN, { C1: 60 }, 2160, BaseType.MAIN), yard("a", {}, 675)), pairs }).ok).toBe(true);
  });

  test("Academy levels shrink a Pokey: 77 fit in 540 at level 6", () => {
    const verdict = planBatchTransfer({
      yards: yardsOf(yard(MAIN, { C1: 100 }, 2160, BaseType.MAIN), yard("a", {}, 540)),
      pairs: [pair(MAIN, "a", { C1: 77 })],
      monsterLevels: { C1: 6 },
    });
    expect(verdict.ok).toBe(true);
  });

  test("the main yard's room is checked when two outposts send home", () => {
    const verdict = planBatchTransfer({
      yards: yardsOf(yard(MAIN, { C1: 200 }, 2160, BaseType.MAIN), yard("a", { C1: 10 }, 540), yard("b", { C1: 10 }, 540)),
      pairs: [pair("a", MAIN, { C1: 10 }), pair("b", MAIN, { C1: 10 })],
    });
    expect(!verdict.ok && [verdict.rule, verdict.pair]).toEqual(["capacity", 1]);
  });

  test("a yard that is not the caller's (not in the loaded set) refuses the whole move", () => {
    const verdict = planBatchTransfer({
      yards: yardsOf(main(), yard("a", {}, 540)),
      pairs: [pair(MAIN, "a", { C1: 1 }), pair(MAIN, "stranger", { C1: 1 })],
    });
    expect(!verdict.ok && [verdict.rule, verdict.pair, verdict.detail]).toEqual(["endpoints", 1, { baseid: "stranger" }]);
  });

  test("outpost to outpost is fine; main to main, a yard to itself or the Inferno is not", () => {
    const yards = yardsOf(
      main(),
      yard("main2", {}, 2160, BaseType.MAIN),
      yard("a", { C1: 5 }, 540),
      yard("b", {}, 540),
      yard("hell", {}, 1820, BaseType.INFERNO)
    );
    expect(planBatchTransfer({ yards, pairs: [pair("a", "b", { C1: 5 })] }).ok).toBe(true);
    for (const bad of [pair(MAIN, "main2", { C1: 1 }), pair("a", "a", { C1: 1 }), pair(MAIN, "hell", { C1: 1 })]) {
      const verdict = planBatchTransfer({ yards, pairs: [bad] });
      expect(!verdict.ok && verdict.rule).toBe("endpoints");
    }
  });

  test("counts must be whole and not negative; an empty pair is refused", () => {
    const yards = yardsOf(main(), yard("a", {}, 540));
    for (const moved of [{ C1: -5 }, { C1: 1.5 }, { C1: "lots" }, {}]) {
      const verdict = planBatchTransfer({ yards, pairs: [pair(MAIN, "a", moved)] });
      expect(!verdict.ok && verdict.rule).toBe("quantities");
    }
  });

  test("a negative count cannot be used to pull monsters the other way", () => {
    const verdict = planBatchTransfer({
      yards: yardsOf(yard(MAIN, {}, 2160, BaseType.MAIN), yard("a", { C1: 50 }, 540)),
      pairs: [pair(MAIN, "a", { C1: -50 })],
    });
    expect(!verdict.ok && verdict.rule).toBe("quantities");
  });

  test("the same two yards twice is refused", () => {
    const verdict = planBatchTransfer({
      yards: yardsOf(main(), yard("a", {}, 540)),
      pairs: [pair(MAIN, "a", { C1: 1 }), pair(MAIN, "a", { C1: 1 })],
    });
    expect(!verdict.ok && verdict.rule).toBe("batch");
  });

  test("a move longer than the cap is refused", () => {
    const pairs = Array.from({ length: MAX_BATCH_PAIRS + 1 }, (_, i) => pair(MAIN, `o${i}`, { C1: 1 }));
    expect(planBatchTransfer({ yards: yardsOf(main()), pairs }).ok).toBe(false);
  });

  test("Inferno monsters housed on the main yard can move, as they could before", () => {
    const verdict = planBatchTransfer({
      yards: yardsOf(yard(MAIN, { IC1: 5 }, 2160, BaseType.MAIN), yard("a", {}, 540)),
      pairs: [pair(MAIN, "a", { IC1: 5 })],
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("readBatchPairs", () => {
  test("reads pairs and refuses anything else", () => {
    expect(readBatchPairs([{ from: "1", to: 2, moved: { C1: 1 } }])).toEqual({ pairs: [{ from: "1", to: "2", moved: { C1: 1 } }] });
    expect("refused" in readBatchPairs("nope")).toBe(true);
    expect("refused" in readBatchPairs([])).toBe(true);
    expect("refused" in readBatchPairs([{ from: "1" }])).toBe(true);
    expect("refused" in readBatchPairs([null])).toBe(true);
    expect("refused" in readBatchPairs(Array.from({ length: MAX_BATCH_PAIRS + 1 }, () => ({ from: "1", to: "2" })))).toBe(true);
  });
});
