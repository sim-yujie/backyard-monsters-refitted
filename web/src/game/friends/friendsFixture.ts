import type { Friend, FriendRequest, FriendsApi, FriendsList, PlayerResult } from "@/api/friends";

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
  ...extra,
});

export const fixtureList = (friends: Friend[], extra: Partial<FriendsList> = {}): FriendsList => ({
  friends,
  max: 100,
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

/** One call the fake API took: the method and its arguments. */
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
    search: answer("search", []),
    suggestions: answer("suggestions", []),
    sendGift: answer("sendGift", null),
    gifts: answer("gifts", { gifts: [], collectsLeft: 5 }),
    collect: answer("collect", { collected: 0, resources: {} }),
    help: answer("help", { reward: {}, helpsLeft: 0, building: null }),
    loadHelpYard: answer("loadHelpYard", { error: 0 } as Awaited<ReturnType<FriendsApi["loadHelpYard"]>>),
    setPrivacy: answer("setPrivacy", { hideOnline: false, friendRequests: true }),
    blocked: answer("blocked", []),
    block: answer("block", undefined),
    unblock: answer("unblock", undefined),
  };
  return { api, calls };
};
