import { describe, expect, test } from "bun:test";

import { pinRefusal } from "./friendPins.js";
import { FRIEND_LIMITS } from "./friendRules.js";

/** The pin rule on its own (beta 7: up to 10 pinned friends); the database test runs the route. */
describe("pinRefusal", () => {
  const friend = { friends: true, pinned: false, pinnedCount: 0 };

  test("a friend can be pinned while fewer than 10 are", () => {
    expect(pinRefusal(friend, true)).toBeNull();
    expect(pinRefusal({ ...friend, pinnedCount: FRIEND_LIMITS.maxPinned - 1 }, true)).toBeNull();
  });

  test("the 11th pin is refused with pinLimit", () => {
    expect(FRIEND_LIMITS.maxPinned).toBe(10);
    expect(pinRefusal({ ...friend, pinnedCount: 10 }, true)).toBe("pinLimit");
  });

  test("pinning one already pinned is not refused at the limit; unpinning never is", () => {
    expect(pinRefusal({ friends: true, pinned: true, pinnedCount: 10 }, true)).toBeNull();
    expect(pinRefusal({ friends: true, pinned: true, pinnedCount: 10 }, false)).toBeNull();
    expect(pinRefusal({ ...friend, pinnedCount: 10 }, false)).toBeNull();
  });

  test("someone who is not a friend can be neither pinned nor unpinned", () => {
    expect(pinRefusal({ friends: false, pinned: false, pinnedCount: 0 }, true)).toBe("notFriends");
    expect(pinRefusal({ friends: false, pinned: false, pinnedCount: 0 }, false)).toBe("notFriends");
  });
});
