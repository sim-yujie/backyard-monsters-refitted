import { describe, expect, it } from "vitest";
import type { MapCell, PlayerCell } from "@/api/types";
import {
  RELOCATE_PRICE,
  clampTransfer,
  cooldownText,
  countsList,
  freeSpace,
  housedOf,
  maxOf,
  partlyMovedText,
  relocateAffordable,
  spaceOf,
  type TransferYard,
} from "./moveYards";

/**
 * Moving between own yards (outposts WP7, #186): the transfer is clamped to
 * the target's free housing, as Flash clamped it (`MapRoom.as:811-849`), and
 * the relocate dialog's price, cooldown and lost-monster list.
 */

/** C1 takes 1, C2 takes 2, C3 takes 5: easy sums. */
const sizeOf = (id: string): number => ({ C1: 1, C2: 2, C3: 5 })[id] ?? 1;

const yard = (housed: Record<string, number>, space: number, baseid = "b"): TransferYard => ({
  baseid,
  housed,
  space,
});

describe("freeSpace", () => {
  it("is the space less every housed monster's size", () => {
    expect(freeSpace(yard({ C1: 10, C2: 5 }, 100), sizeOf)).toBe(80);
    expect(freeSpace(yard({}, 0), sizeOf)).toBe(0);
  });
});

describe("clampTransfer", () => {
  const from = yard({ C1: 30, C2: 10, C3: 4 }, 500, "main");

  it("moves everything picked when the target has room", () => {
    const to = yard({}, 200, "op");
    expect(clampTransfer({ C1: 5, C3: 2 }, from, to, sizeOf)).toEqual({ C1: 5, C3: 2 });
  });

  it("cuts the pick to the target's free housing, in roster order", () => {
    // 12 free: 5 C1 take 5, then 3 C2 would take 6 but only 7 are left: 3 fit
    // (6), then 1 left is not enough for a C3.
    const to = yard({ C1: 8 }, 20, "op");
    expect(clampTransfer({ C1: 5, C2: 3, C3: 1 }, from, to, sizeOf)).toEqual({ C1: 5, C2: 3 });
    // 3 free: 3 of 5 C1.
    const tight = yard({ C1: 17 }, 20, "op");
    expect(clampTransfer({ C1: 5 }, from, tight, sizeOf)).toEqual({ C1: 3 });
  });

  it("never moves more than the source has, nor a negative or fractional count", () => {
    const to = yard({}, 10_000, "op");
    expect(clampTransfer({ C1: 99, C2: -4, C3: 1.7 }, from, to, sizeOf)).toEqual({ C1: 30, C3: 1 });
  });

  it("moves nothing into a yard with no housing", () => {
    expect(clampTransfer({ C1: 5 }, from, yard({}, 0, "op"), sizeOf)).toEqual({});
  });
});

describe("maxOf", () => {
  it("is what the source has, or what fits beside the other picks", () => {
    const from = yard({ C1: 30, C2: 10 }, 500);
    const to = yard({ C1: 8 }, 20);
    expect(maxOf("C1", {}, from, to, sizeOf)).toBe(12);
    expect(maxOf("C1", { C2: 3 }, from, to, sizeOf)).toBe(6);
    expect(maxOf("C2", { C1: 12 }, from, to, sizeOf)).toBe(0);
    expect(maxOf("C2", {}, from, yard({}, 1_000), sizeOf)).toBe(10);
  });
});

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

  it("says Flash's newmap_tr_space when not everything fitted", () => {
    expect(partlyMovedText(3)).toBe(
      "3 monsters successfully transferred.  There was not enough space for all the monsters.",
    );
  });
});
