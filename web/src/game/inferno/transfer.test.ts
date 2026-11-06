import { describe, expect, it } from "vitest";
import { ascendedText, compoundRows, housingBar, maxPick, pickedSpace } from "./transfer";

/** The cave's monster transfer (Inferno WP 2.6, `INFERNO_ASCENSION_POPUP.as`). */

const sizes: Record<string, number> = { IC1: 15, IC2: 40, IC10: 50 };
const sizeOf = (id: string) => sizes[id] ?? 0;

describe("compoundRows", () => {
  it("lists only Inferno monsters with some in the Compound, by their number as Flash sorted them", () => {
    expect(compoundRows({ IC5: 1, C1: 4, IC1: 3, IC2: 0, IC3: "2", ICX: 1 })).toEqual([
      { id: "IC1", count: 3 },
      { id: "IC3", count: 2 },
      { id: "IC5", count: 1 },
    ]);
    expect(compoundRows(null)).toEqual([]);
  });
});

describe("maxPick", () => {
  const rows = [
    { id: "IC1", count: 10 },
    { id: "IC2", count: 3 },
  ];

  it("is what the Compound holds while the Housing has room", () => {
    expect(maxPick("IC1", {}, rows, { used: 0, capacity: 1_000 }, sizeOf)).toBe(10);
  });

  it("is cut to what still fits, the other picks counted", () => {
    // 200 places, 100 used, 2 IC2 picked (80): 20 left, one Spurtz (15).
    expect(maxPick("IC1", { IC2: 2 }, rows, { used: 100, capacity: 200 }, sizeOf)).toBe(1);
    // The type's own picks are not counted twice.
    expect(maxPick("IC2", { IC2: 2 }, rows, { used: 100, capacity: 200 }, sizeOf)).toBe(2);
  });

  it("is 0 for a full Housing, or one already over", () => {
    expect(maxPick("IC1", {}, rows, { used: 200, capacity: 200 }, sizeOf)).toBe(0);
    expect(maxPick("IC1", {}, rows, { used: 260, capacity: 200 }, sizeOf)).toBe(0);
    expect(maxPick("IC9", {}, rows, { used: 0, capacity: 200 }, sizeOf)).toBe(0);
  });
});

describe("housingBar", () => {
  it("shows the housed share, the picks after it, and Flash's label", () => {
    expect(pickedSpace({ IC1: 2, IC2: 1 }, sizeOf)).toBe(70);
    expect(housingBar({ used: 100, capacity: 400 }, 70)).toEqual({
      stored: 0.25,
      queued: 0.175,
      label: "170 / 400 (42%)",
    });
    expect(housingBar({ used: 0, capacity: 0 }, 0)).toEqual({ stored: 0, queued: 0, label: "0 / 0 (0%)" });
  });
});

describe("ascendedText", () => {
  it("counts the monsters", () => {
    expect(ascendedText(1)).toBe("1 Inferno monster came up to your yard.");
    expect(ascendedText(4)).toBe("4 Inferno monsters came up to your yard.");
  });
});
