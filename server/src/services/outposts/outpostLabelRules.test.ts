import { describe, expect, test } from "bun:test";

import { makeWordFilter } from "../chat/badWords.js";
import {
  baseidOf,
  checkOutpostName,
  OUTPOST_NAME_MAX,
  OUTPOST_PINS_MAX,
  outpostPinRefusal,
} from "./outpostLabelRules.js";

/** Outpost names and pins (beta 7): the checks the routes run before the database. */

const filter = makeWordFilter({});

describe("checkOutpostName", () => {
  test("trims, squeezes spaces and drops control characters", () => {
    expect(checkOutpostName("  Gold \t  mine​\n ", filter)).toEqual({ ok: true, name: "Gold mine" });
  });

  test("empty, missing or not text is no name", () => {
    expect(checkOutpostName("   ", filter)).toEqual({ ok: true, name: "" });
    expect(checkOutpostName(undefined, filter)).toEqual({ ok: true, name: "" });
    expect(checkOutpostName(42, filter)).toEqual({ ok: true, name: "" });
  });

  test(`up to ${OUTPOST_NAME_MAX} letters`, () => {
    expect(checkOutpostName("a".repeat(OUTPOST_NAME_MAX), filter)).toEqual({ ok: true, name: "a".repeat(24) });
    expect(checkOutpostName("a".repeat(OUTPOST_NAME_MAX + 1), filter)).toEqual({ ok: false, reason: "tooLong" });
    // Counted in characters, not UTF-16 units: an emoji is one.
    expect(checkOutpostName("🏰".repeat(OUTPOST_NAME_MAX), filter).ok).toBe(true);
  });

  test("refuses a name the chat word filter catches", () => {
    expect(checkOutpostName("fuck base", filter)).toEqual({ ok: false, reason: "badWords" });
  });
});

describe("baseidOf", () => {
  test("digits only, never the main yard's 0", () => {
    expect(baseidOf("2000242209")).toBe("2000242209");
    expect(baseidOf(2000242209)).toBe("2000242209");
    expect(baseidOf("0")).toBeNull();
    expect(baseidOf("12; DROP")).toBeNull();
    expect(baseidOf("")).toBeNull();
    expect(baseidOf(null)).toBeNull();
    expect(baseidOf("1".repeat(21))).toBeNull();
  });
});

describe("outpostPinRefusal", () => {
  test(`at most ${OUTPOST_PINS_MAX} pins`, () => {
    expect(outpostPinRefusal({ pinned: false, pinnedCount: OUTPOST_PINS_MAX - 1 }, true)).toBeNull();
    expect(outpostPinRefusal({ pinned: false, pinnedCount: OUTPOST_PINS_MAX }, true)).toBe("pinLimit");
  });

  test("re-pinning and unpinning are never refused", () => {
    expect(outpostPinRefusal({ pinned: true, pinnedCount: OUTPOST_PINS_MAX }, true)).toBeNull();
    expect(outpostPinRefusal({ pinned: true, pinnedCount: OUTPOST_PINS_MAX }, false)).toBeNull();
  });
});
