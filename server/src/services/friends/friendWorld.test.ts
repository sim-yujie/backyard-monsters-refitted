import { describe, expect, test } from "bun:test";

import { otherWorldOf } from "./friendViews.js";

/**
 * "Ann is in world 3" on a friend row (beta 7): an alliance is one Map Room 2
 * world, so the row names a friend's world only when it is not the player's.
 */
describe("otherWorldOf", () => {
  const numbers = new Map([
    ["w-a", 1],
    ["w-b", 2],
  ]);

  test("names the friend's world when it is not the player's", () => {
    expect(otherWorldOf("w-a", "w-b", numbers)).toBe(2);
    expect(otherWorldOf("w-b", "w-a", numbers)).toBe(1);
  });

  test("says nothing when they share a world", () => {
    expect(otherWorldOf("w-a", "w-a", numbers)).toBeNull();
  });

  test("says nothing when either has no Map Room 2 world", () => {
    expect(otherWorldOf(null, "w-b", numbers)).toBeNull();
    expect(otherWorldOf("w-a", null, numbers)).toBeNull();
    // A Map Room 1 world is not numbered: no alliance there to explain.
    expect(otherWorldOf("w-old", "w-b", numbers)).toBeNull();
    expect(otherWorldOf("w-a", "w-old", numbers)).toBeNull();
  });
});
