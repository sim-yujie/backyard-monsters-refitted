import { describe, expect, it } from "vitest";

import { loadNeighbours, neighbourBonusLine, neighbourBonusView } from "./neighbourBonus";

describe("neighbourBonusView", () => {
  it("shows nothing with no count (switch off) or no friend", () => {
    expect(neighbourBonusView(undefined)).toBeNull();
    expect(neighbourBonusView(0)).toBeNull();
  });

  it("reads the battle's own ladder: +5, 9, 11, 13, 14, 15%", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => neighbourBonusView(n)?.percent)).toEqual([5, 9, 11, 13, 14, 15]);
  });

  it("says what it does in one line", () => {
    expect(neighbourBonusLine({ count: 3, percent: 11 })).toBe(
      "3 friendly neighbours: buildings +11% health, towers +11% damage.",
    );
    expect(neighbourBonusLine({ count: 1, percent: 5 })).toContain("1 friendly neighbour:");
  });
});

describe("loadNeighbours", () => {
  const forces = { bunkers: {}, defenderLevels: {}, defenderChampions: [] };
  it("reads the count the attack load froze, and nothing without one", () => {
    expect(loadNeighbours({ defenderforces: { ...forces, neighbours: 3 } })).toBe(3);
    expect(loadNeighbours({ defenderforces: forces })).toBeUndefined();
    expect(loadNeighbours(null)).toBeUndefined();
  });
});
