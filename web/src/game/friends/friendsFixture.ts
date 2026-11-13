import type { Friend, FriendRequest, FriendsApi, FriendsList, Gift, GiftAllResult, PlayerResult } from "@/api/friends";

/**
 * Friends in the §6.2 contract's shapes (issue #370), for the tests: a
 * friend, a list, a request, a search result, and an API that answers from
 * them and keeps a log of what was asked.
 */

export const fixtureFriend = (userid: number, extra: Partial<Friend> = {}): Friend => ({
  userid,
  username: `Player ${userid}`,
  pic: null,
  level: 5,
  online: null,
  since: null,
  giftSentToday: false,
  canGiftFrom: null,
  help: null,
  wishes: [],
  pinnedAt: null,
  otherWorld: null,
  ...extra,
});

export const fixtureList = (friends: Friend[], extra: Partial<FriendsList> = {}): FriendsList => ({
  friends,
  max: 100,
  maxPinned: 10,
  requestsIn: 0,
  giftsWaiting: 0,
  helpsLeft: 20,
  ...extra,
});

export const fixtureRequest = (id: number, userid: number, extra: Partial<FriendRequest> = {}): FriendRequest => ({
  id,
  userid,
  username: `Player ${userid}`,
  pic: null,
  level: 4,
  status: "pending",
  createdAt: null,
  expiresAt: null,
  ...extra,
});

export const fixturePlayer = (userid: number, relation: PlayerResult["relation"], extra: Partial<PlayerResult> = {}): PlayerResult => ({
  userid,
  username: `Player ${userid}`,
  pic: null,
  level: 3,
  relation,
  ...extra,
});

/** How many friends a {@link bigFriendList} has in each of the Friends window's groups. */
export interface BigFriendCounts {
  /** Friends the player can help today (some of them online too). */
  readonly help: number;
  /** Friends online who cannot use help. */
  readonly online: number;
  /** Everyone, these included. */
  readonly total: number;
}

/** The lead's busy case (9 Nov): 90 can use help, 20 more online, 150 in all. */
export const BIG_FRIENDS: BigFriendCounts = { help: 90, online: 20, total: 150 };

/**
 * A long list for the Friends window: `help` who can use help (every fourth
 * of them online), then `online` more online, then the rest offline, up to
 * `total`. The first three are pinned, and every third has had a gift today.
 * Names are numbered by group ("Helper 7", "Online 3", "Friend 12") so a
 * picture says which group a row belongs to. Ids start at 900001.
 */
export const bigFriendList = (counts: BigFriendCounts = BIG_FRIENDS): Friend[] => {
  const help = Math.max(0, Math.floor(counts.help));
  const online = Math.max(0, Math.floor(counts.online));
  const total = Math.max(help + online, Math.floor(counts.total));
  return Array.from({ length: total }, (_, i) => {
    const group = i < help ? "help" : i < help + online ? "online" : "rest";
    const n = group === "help" ? i + 1 : group === "online" ? i - help + 1 : i - help - online + 1;
    const name = group === "help" ? "Helper" : group === "online" ? "Online" : "Friend";
    return fixtureFriend(900_001 + i, {
      username: `${name} ${n}`,
      level: 5 + ((i * 7) % 40),
      online: group === "online" || (group === "help" && n % 4 === 0) ? "online" : group === "rest" && n % 2 === 0 ? "week" : "today",
      help: group === "help" ? { speedup: n % 3 !== 0, repair: n % 3 === 0 } : { speedup: false, repair: false },
      giftSentToday: i % 3 === 2,
      pinnedAt: i < 3 ? 1_000 + i : null,
    });
  });
};

/** One call the fake API took: the method and its arguments. */
/** One gift waiting, from `userid`. */
export const fixtureGift = (id: number, userid: number, extra: Partial<Gift> = {}): Gift => ({
  id,
  userid,
  username: `Player ${userid}`,
  pic: null,
  level: 6,
  resource: "r1",
  amount: 300,
  createdAt: null,
  expiresAt: null,
  canSendBack: true,
  ...extra,
});

/** A Gift all that sends nothing. */
export const NO_GIFT_ALL: GiftAllResult = {
  fallback: "r1",
  gifts: [],
  skipped: [],
  cost: { r1: 0, r2: 0, r3: 0, r4: 0 },
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
};

type FriendsApiWishes = Parameters<FriendsApi["setWishes"]>[0];

export type FixtureCall = readonly [method: keyof FriendsApi, ...args: unknown[]];

/**
 * An API answering from `answers` (a method left out resolves to nothing
 * useful), every call logged. A method given an `Error` rejects with it.
 */
export const fixtureApi = (
  answers: { [K in keyof FriendsApi]?: Awaited<ReturnType<FriendsApi[K]>> | Error } = {},
): { api: FriendsApi; calls: FixtureCall[] } => {
  const calls: FixtureCall[] = [];
  const answer =
    <K extends keyof FriendsApi>(method: K, fallback: Awaited<ReturnType<FriendsApi[K]>>) =>
    (...args: unknown[]): Promise<Awaited<ReturnType<FriendsApi[K]>>> => {
      calls.push([method, ...args]);
      const value = method in answers ? answers[method] : fallback;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value as Awaited<ReturnType<FriendsApi[K]>>);
    };
  const api: FriendsApi = {
    list: answer("list", fixtureList([])),
    requests: answer("requests", { incoming: [], outgoing: [] }),
    request: answer("request", { request: null, friend: null }),
    answer: answer("answer", null),
    cancel: answer("cancel", undefined),
    remove: answer("remove", undefined),
    pin: answer("pin", { pinned: true, pinnedCount: 1 }),
    search: answer("search", []),
    suggestions: answer("suggestions", []),
    sendGift: answer("sendGift", null),
    giftCost: answer("giftCost", { amount: 0, resources: { r1: 0, r2: 0, r3: 0, r4: 0 } }),
    giftAllPlan: answer("giftAllPlan", NO_GIFT_ALL),
    giftAll: answer("giftAll", NO_GIFT_ALL),
    gifts: answer("gifts", { gifts: [], collectsLeft: 10, wishes: [] }),
    // Left out of `answers`, it stores what it was asked, like the server.
    setWishes: (...args: unknown[]) =>
      "setWishes" in answers
        ? answer("setWishes", [])(...args)
        : (calls.push(["setWishes", ...args]), Promise.resolve([...(args[0] as FriendsApiWishes)])),
    collect: answer("collect", { collected: 0, resources: {}, collectsLeft: 10, giftsWaiting: 0 }),
    deleteGifts: answer("deleteGifts", { deleted: 0, collectsLeft: 10, giftsWaiting: 0 }),
    help: answer("help", { reward: {}, helpsLeft: 0, building: null }),
    loadHelpYard: answer("loadHelpYard", { error: 0 } as Awaited<ReturnType<FriendsApi["loadHelpYard"]>>),
    setPrivacy: answer("setPrivacy", { hideOnline: false, friendRequests: true }),
    blocked: answer("blocked", []),
    block: answer("block", undefined),
    unblock: answer("unblock", undefined),
    muted: answer("muted", []),
    unmute: answer("unmute", undefined),
  };
  return { api, calls };
};
