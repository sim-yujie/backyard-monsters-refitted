import { afterEach, describe, expect, it } from "vitest";
import { isMonsterMadness, takeoverScores, takeoverScoresOf, takeoverScoreText } from "./takeoverScores";

afterEach(() => void takeoverScores.take());

describe("takeover scores (Monster Madness)", () => {
  it("reads the answer's eventPoints and drops what is not a score", () => {
    expect(
      takeoverScoresOf([
        { event: "monster-madness-1762819200", points: 2_134_567.8, total: 45_000_000 },
        { event: "", points: 5, total: 5 },
        { event: "x", points: 0, total: 5 },
        { event: "x", points: "5", total: 5 },
        null,
      ]),
    ).toEqual([{ event: "monster-madness-1762819200", points: 2_134_567, total: 45_000_000 }]);
    expect(takeoverScoresOf(undefined)).toEqual([]);
    expect(takeoverScoresOf({ event: "x" })).toEqual([]);
  });

  it("keeps the last takeover's scores until the yard takes them, once", () => {
    takeoverScores.set([{ event: "monster-madness-1", points: 1_000_000, total: 1_000_000 }]);
    takeoverScores.set([{ event: "monster-madness-1", points: 2_000_000, total: 3_000_000 }]);
    expect(takeoverScores.take()).toEqual([{ event: "monster-madness-1", points: 2_000_000, total: 3_000_000 }]);
    expect(takeoverScores.take()).toEqual([]);
    takeoverScores.set([{ event: "monster-madness-1", points: 1, total: 1 }]);
    takeoverScores.set(undefined);
    expect(takeoverScores.take()).toEqual([]);
  });

  it("says a score in words", () => {
    expect(isMonsterMadness("monster-madness-1762819200")).toBe(true);
    expect(isMonsterMadness("krallen-2026-11")).toBe(false);
    expect(takeoverScoreText({ event: "monster-madness-1", points: 2_100_000, total: 45_000_000 })).toBe(
      "+2.1M Monster Madness points, 45M in all",
    );
    expect(takeoverScoreText({ event: "other", points: 3_000, total: 9_000 })).toBe("+3K Event points, 9K in all");
  });
});
