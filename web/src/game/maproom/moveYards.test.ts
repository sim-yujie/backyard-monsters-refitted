import { describe, expect, it } from "vitest";
import type { MapCell, PlayerCell } from "@/api/types";
import {
  RELOCATE_PRICE,
  cooldownText,
  countsList,
  housedOf,
  relocateAffordable,
  spaceOf,
} from "./moveYards";

/**
 * Moving between own yards (outposts WP7, #186): reading an own cell's
 * monsters, and the relocate dialog's price, cooldown and lost-monster list.
 */

describe("reading an own cell", () => {
  const own = (m: Record<string, unknown> | undefined): MapCell =>
    ({ uid: 1, b: 3, i: 150, bid: "op", n: "me", l: 1, mine: 1, m }) as PlayerCell;

  it("reads the housed roster and the space the server keeps", () => {
    const cell = own({ housed: { C2: 3, C1: 5, C9: 0, X: "junk" }, space: 540 });
    expect(housedOf(cell)).toEqual({ C1: 5, C2: 3 });
    expect(spaceOf(cell)).toBe(540);
    expect(countsList(housedOf(cell))).toEqual([
      { id: "C1", count: 5 },
      { id: "C2", count: 3 },
    ]);
  });

  it("reads nothing from a camp, water or a cell without monsters", () => {
    expect(housedOf(own(undefined))).toEqual({});
    expect(spaceOf(own({}))).toBe(0);
    expect(housedOf({ i: 50 } as MapCell)).toEqual({});
    expect(housedOf(undefined)).toEqual({});
  });

  it("lists C10 after C9, not after C1", () => {
    expect(countsList({ C10: 1, C9: 1, C1: 1 }).map((row) => row.id)).toEqual(["C1", "C9", "C10"]);
  });
});

describe("the relocate price and cooldown", () => {
  it("keeps Flash's price", () => {
    expect(RELOCATE_PRICE).toEqual({ resources: 30_000_000, shiny: 1_500, cooldownSeconds: 86_400 });
  });

  it("covers either price only with enough of all four resources, or the Shiny", () => {
    const rich = { r1: 30_000_000, r2: 30_000_000, r3: 30_000_000, r4: 30_000_000 };
    expect(relocateAffordable(rich, 1_500)).toEqual({ resources: true, shiny: true });
    expect(relocateAffordable({ ...rich, r4: 29_999_999 }, 1_499)).toEqual({
      resources: false,
      shiny: false,
    });
    expect(relocateAffordable(null, undefined)).toEqual({ resources: false, shiny: false });
  });

  it("says Flash's movebase_warning with the time left", () => {
    expect(cooldownText(1_000 + 3 * 3_600 + 5 * 60, 1_000)).toBe(
      "You have already moved your main yard. Try again in 3h 5m",
    );
  });
});
