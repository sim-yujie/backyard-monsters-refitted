import { afterEach, describe, expect, it } from "vitest";
import type { Friend } from "@/api/friends";
import { consumeViewTarget } from "@/game/attack/attackTarget";
import {
  endFriendRun,
  freezeFriendRun,
  hopFailed,
  hopFriend,
  hopLanded,
  hopView,
  runFriend,
  skippedText,
  startFriendRun,
} from "./friendHop";
import { windowOrder } from "./friendOrder";
import { fixtureFriend } from "./friendsFixture";
import { visitFriend } from "./friendVisit";

/**
 * Prev and Next on a friend's yard (beta 8, owner's grilling 18 Nov 2026):
 * every friend in the Friends window's order, frozen when the run starts;
 * the ends stop; a yard that will not open is skipped; Next counts the
 * friends after this one who can use help.
 */

const helpable = { speedup: true, repair: false };
const ann = fixtureFriend(1, { username: "Ann", help: helpable });
const bob = fixtureFriend(2, { username: "Bob", help: helpable });
const cat = fixtureFriend(3, { username: "Cat", online: "online" });
const dan = fixtureFriend(4, { username: "Dan", level: 9 });
const eve = fixtureFriend(5, { username: "Eve" });
const all: Friend[] = [eve, dan, cat, bob, ann];

const names = (view: ReturnType<typeof hopView>) => ({
  prev: view?.prev?.username ?? null,
  next: view?.next?.username ?? null,
  ahead: view?.ahead,
});

afterEach(() => endFriendRun());

describe("the Friends window's order", () => {
  it("lists the three groups top to bottom: can use help, online, everyone else", () => {
    expect(windowOrder(all).map((friend) => friend.username)).toEqual([
      "Ann",
      "Bob",
      "Cat",
      "Dan",
      "Eve",
    ]);
  });

  it("puts a pinned friend who cannot use help in their group, as the window shows them", () => {
    const pinned = fixtureFriend(6, { username: "Pin", pinnedAt: 1 });
    expect(windowOrder([...all, pinned]).map((friend) => friend.username)).toEqual([
      "Ann",
      "Bob",
      "Cat",
      "Pin",
      "Dan",
      "Eve",
    ]);
  });
});

describe("a run of friend visits", () => {
  it("steps through every friend and stops at both ends", () => {
    startFriendRun(ann, all);
    expect(names(hopView(1, all))).toEqual({ prev: null, next: "Bob", ahead: 1 });
    expect(hopFriend(1, -1)).toBeNull();
    const seen = ["Ann"];
    let at = 1;
    for (;;) {
      const next = hopFriend(at, 1);
      if (!next) break;
      hopLanded(next.userid);
      seen.push(next.username);
      at = next.userid;
    }
    expect(seen).toEqual(["Ann", "Bob", "Cat", "Dan", "Eve"]);
    expect(names(hopView(5, all))).toEqual({ prev: "Dan", next: null, ahead: 0 });
    expect(hopFriend(5, -1)?.username).toBe("Dan");
  });

  it("greys out both arrows with one friend", () => {
    startFriendRun(ann, [ann]);
    expect(names(hopView(1, [ann]))).toEqual({ prev: null, next: null, ahead: 0 });
  });

  it("keeps the order frozen while the live list changes under it", () => {
    startFriendRun(ann, all);
    // Ann is helped: live, she drops below Cat and Dan; the run keeps her first.
    const helped = all.map((friend) =>
      friend.userid === 1 ? { ...friend, help: null } : friend,
    );
    expect(names(hopView(1, helped))).toEqual({ prev: null, next: "Bob", ahead: 1 });
    expect(hopFriend(1, 1)?.username).toBe("Bob");
    hopLanded(2);
    expect(names(hopView(2, helped))).toEqual({ prev: "Ann", next: "Cat", ahead: 0 });
  });

  it("counts the friends after this one who can use help, from the live list", () => {
    startFriendRun(ann, all);
    expect(hopView(1, all)?.ahead).toBe(1);
    // Bob was helped by someone else: the count drops.
    const bobDone = all.map((friend) =>
      friend.userid === 2 ? { ...friend, help: null } : friend,
    );
    expect(hopView(1, bobDone)?.ahead).toBe(0);
    // Eve can use help now: counted, though the frozen order keeps her last.
    const eveNeeds = all.map((friend) =>
      friend.userid === 5 ? { ...friend, help: helpable } : friend,
    );
    expect(hopView(1, eveNeeds)?.ahead).toBe(2);
  });

  it("starts a new run, in the order as it is now, with a fresh visit", () => {
    startFriendRun(ann, all);
    hopFriend(1, 1);
    hopLanded(2);
    const later = all.map((friend) =>
      friend.userid === 1 ? { ...friend, help: null } : friend,
    );
    visitFriend(cat, undefined, later);
    expect(consumeViewTarget()).toMatchObject({ kind: "friend", friend: 3 });
    expect(runFriend()).toBe(3);
    // Ann, helped, is lower in the new run: Bob, Cat, Dan, Ann, Eve.
    expect(names(hopView(3, later))).toEqual({ prev: "Bob", next: "Dan", ahead: 0 });
    hopFriend(3, 1);
    hopLanded(4);
    expect(names(hopView(4, later))).toEqual({ prev: "Cat", next: "Ann", ahead: 0 });
  });

  it("freezes the order once the list loads when the run began without it", () => {
    startFriendRun(cat, null);
    expect(names(hopView(3, []))).toEqual({ prev: null, next: null, ahead: 0 });
    freezeFriendRun(all);
    expect(names(hopView(3, all))).toEqual({ prev: "Bob", next: "Dan", ahead: 0 });
    // Frozen once: a later list does not change it.
    freezeFriendRun([cat]);
    expect(names(hopView(3, all)).next).toBe("Dan");
  });

  it("greys both out for a friend not in the list", () => {
    startFriendRun(fixtureFriend(99), all);
    expect(names(hopView(99, all))).toEqual({ prev: null, next: null, ahead: 0 });
    expect(hopFriend(99, 1)).toBeNull();
  });

  it("shows nothing for a yard the run is not on", () => {
    startFriendRun(ann, all);
    expect(hopView(2, all)).toBeNull();
  });
});

describe("a yard that will not open", () => {
  it("is skipped: the hop goes on the same way, and the next yard says whom it skipped", () => {
    startFriendRun(ann, all);
    expect(hopFriend(1, 1)?.username).toBe("Bob");
    // Bob's yard fails: on to Cat.
    expect(hopFailed(2, "Bob")?.username).toBe("Cat");
    expect(hopLanded(3)).toEqual(["Bob"]);
    // From now on the run steps over Bob both ways, and does not count him.
    expect(names(hopView(3, all))).toEqual({ prev: "Ann", next: "Dan", ahead: 0 });
    expect(hopView(1, all)).toBeNull();
  });

  it("skips several in a row, going backwards too", () => {
    startFriendRun(eve, all);
    expect(hopFriend(5, -1)?.username).toBe("Dan");
    expect(hopFailed(4, "Dan")?.username).toBe("Cat");
    expect(hopFailed(3, "Cat")?.username).toBe("Bob");
    expect(hopLanded(2)).toEqual(["Dan", "Cat"]);
    expect(skippedText(["Dan", "Cat"])).toBe("Couldn't open 2 yards");
    expect(skippedText(["Dan"])).toBe("Couldn't open Dan's yard");
  });

  it("goes back to the yard the hop started from when nobody is left that way", () => {
    startFriendRun(dan, all);
    expect(hopFriend(4, 1)?.username).toBe("Eve");
    expect(hopFailed(5, "Eve")?.username).toBe("Dan");
    expect(hopLanded(4)).toEqual(["Eve"]);
    // Eve is stepped over now: Dan is the end.
    expect(names(hopView(4, all)).next).toBeNull();
  });

  it("goes home (null) when the way back fails too, or on a fresh visit", () => {
    startFriendRun(dan, all);
    hopFriend(4, 1);
    expect(hopFailed(5, "Eve")?.username).toBe("Dan");
    expect(hopFailed(4, "Dan")).toBeNull();
    // A fresh visit's yard failing goes home as before.
    startFriendRun(ann, all);
    expect(hopFailed(1, "Ann")).toBeNull();
  });
});
