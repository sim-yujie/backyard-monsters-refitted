import { describe, expect, it } from "vitest";
import { friendMarkOf, friendMarksKey, type FriendMarkSource } from "./friendMarks";

/** Who on a map or list is a friend (beta 7): the shared list once loaded, else the route's flags. */

const source = (loaded: boolean, friends: { userid: number; pinnedAt: number | null }[] = []) => {
  const one: FriendMarkSource & { snapshot: { loaded: boolean; friends: typeof friends } } = {
    snapshot: { loaded, friends },
    isFriend: (userid) => friends.some((friend) => friend.userid === userid),
    isPinned: (userid) => friends.some((friend) => friend.userid === userid && friend.pinnedAt !== null),
  };
  return one;
};

describe("friendMarkOf", () => {
  it("reads the route's flags until the list has loaded", () => {
    const empty = source(false);
    expect(friendMarkOf(7, {}, empty)).toBeNull();
    expect(friendMarkOf(7, { friend: true }, empty)).toBe("friend");
    expect(friendMarkOf(7, { friend: true, pinned: true }, empty)).toBe("pinned");
    expect(friendMarkOf(7, { pinned: true }, empty)).toBe("pinned");
  });

  it("prefers the loaded list over stale flags", () => {
    const list = source(true, [
      { userid: 7, pinnedAt: null },
      { userid: 9, pinnedAt: 100 },
    ]);
    expect(friendMarkOf(7, { friend: true, pinned: true }, list)).toBe("friend");
    expect(friendMarkOf(9, {}, list)).toBe("pinned");
    // Removed since the map loaded: the flag says friend, the list says not.
    expect(friendMarkOf(11, { friend: true }, list)).toBeNull();
  });
});

describe("friendMarksKey", () => {
  it("is empty until loaded", () => {
    expect(friendMarksKey(source(false, [{ userid: 7, pinnedAt: null }]))).toBe("");
  });

  it("changes when a friend is pinned, added or removed, not when the order does", () => {
    const a = friendMarksKey(source(true, [{ userid: 7, pinnedAt: null }, { userid: 9, pinnedAt: null }]));
    const reordered = friendMarksKey(source(true, [{ userid: 9, pinnedAt: null }, { userid: 7, pinnedAt: null }]));
    const pinned = friendMarksKey(source(true, [{ userid: 7, pinnedAt: 5 }, { userid: 9, pinnedAt: null }]));
    const removed = friendMarksKey(source(true, [{ userid: 9, pinnedAt: null }]));
    expect(reordered).toBe(a);
    expect(pinned).not.toBe(a);
    expect(removed).not.toBe(a);
  });
});
