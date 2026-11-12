import type { FriendsApi } from "@/api/friends";
import { BIG_FRIENDS, bigFriendList, fixtureList, type BigFriendCounts } from "./friendsFixture";

/**
 * A dev build's long friends list, to see the Friends window busy without
 * 150 real accounts (lead, 9 Nov): open the game with `?bigfriends` for 90
 * who can use help, 20 more online and 150 in all, or `?bigfriends=H,O,T`
 * for other counts. Only the list is made up; everything else (gifts,
 * requests, a visit) still asks the server, which knows none of these
 * friends, so pressing Visit or Send gift on one fails.
 */

/** The counts `?bigfriends` asks for, or null when it is not there. */
export const devBigFriends = (search: string): BigFriendCounts | null => {
  const params = new URLSearchParams(search);
  if (!params.has("bigfriends")) return null;
  const parts = (params.get("bigfriends") ?? "").split(",").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return BIG_FRIENDS;
  const [help, online, total] = parts as [number, number, number];
  return { help, online, total };
};

/** `api`, with `list` answering the made-up list of `counts`. */
export const withBigList = (api: FriendsApi, counts: BigFriendCounts): FriendsApi => {
  const friends = bigFriendList(counts);
  return {
    ...api,
    list: () => Promise.resolve(fixtureList(friends, { max: Math.max(100, friends.length), requestsIn: 2, giftsWaiting: 3 })),
  };
};
