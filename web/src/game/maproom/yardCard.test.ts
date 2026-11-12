import { describe, expect, it } from "vitest";
import type { PlayerCell } from "@/api/types";
import { housingPercent, kitSummary, storageOf, yardCardFacts } from "./yardCard";

/** The yard info card's facts (beta 7, design B), all from the own cell the map loads. */

const own = (overrides: Partial<PlayerCell> = {}): PlayerCell => ({
  uid: 2503,
  b: 3,
  i: 150,
  bid: "22913802240208",
  aid: null,
  n: "yardtester",
  l: 30,
  v: 1,
  dm: 0,
  d: 0,
  lo: 0,
  p: 0,
  mine: 1,
  pic_square: null,
  pi: 0,
  fr: 0,
  ...overrides,
});

const sizeOf = (id: string): number => ({ C1: 1, C6: 5, C14: 20 })[id] ?? 1;

describe("yardCardFacts", () => {
  it("counts the housed monsters in roster order and the housing they take", () => {
    const facts = yardCardFacts(own({ m: { housed: { C14: 4, C6: 39, C1: 0 }, space: 540 } }), sizeOf);
    expect(facts.housed).toEqual([
      { id: "C6", count: 39 },
      { id: "C14", count: 4 },
    ]);
    expect(facts.monsters).toBe(43);
    expect(facts.used).toBe(39 * 5 + 4 * 20);
    expect(facts.capacity).toBe(540);
  });

  it("names an outpost's Starter Kit, and none for a main yard", () => {
    expect(yardCardFacts(own({ kit: 3 }), sizeOf).kit?.name).toBe("Ultra Kit");
    expect(yardCardFacts(own({ kit: 2 }), sizeOf).kit?.name).toBe("Mega Kit");
    expect(yardCardFacts(own({ kit: 1 }), sizeOf).kit?.name).toBe("Regular Kit");
    expect(yardCardFacts(own({ kit: 0 }), sizeOf).kit).toBeNull();
    expect(yardCardFacts(own({ b: 2 }), sizeOf).kit).toBeNull();
    expect(kitSummary(9)).toBeNull();
  });

  it("reads an outpost's worker, building before idle, and none on the main yard", () => {
    expect(yardCardFacts(own({ wi: 1 }), sizeOf).worker).toBe("idle");
    expect(yardCardFacts(own({ wb: 1, wi: 1 }), sizeOf).worker).toBe("busy");
    expect(yardCardFacts(own(), sizeOf).worker).toBeNull();
    expect(yardCardFacts(own({ b: 2, wi: 1 }), sizeOf).worker).toBeNull();
  });

  it("gives the main yard its stores as a share of their caps; an outpost has none", () => {
    const r = { r1: 50, r1max: 100, r2: 100, r2max: 100, r3: 0, r3max: 100, r4: 999, r4max: 1000 };
    expect(yardCardFacts(own({ b: 2, r }), sizeOf).storage).toEqual([
      { key: "r1", percent: 50 },
      { key: "r2", percent: 100 },
      { key: "r3", percent: 0 },
      { key: "r4", percent: 99 },
    ]);
    expect(yardCardFacts(own({ r }), sizeOf).storage).toBeNull();
    expect(storageOf(own({ b: 2, r: { r1: 5 } }))).toBeNull();
  });
});

describe("housingPercent", () => {
  it("is the share used, capped at 100, and full when anything sits in no room", () => {
    expect(housingPercent({ used: 118, capacity: 500 })).toBe(24);
    expect(housingPercent({ used: 600, capacity: 500 })).toBe(100);
    expect(housingPercent({ used: 0, capacity: 0 })).toBe(0);
    expect(housingPercent({ used: 3, capacity: 0 })).toBe(100);
  });
});
