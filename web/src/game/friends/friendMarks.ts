import { friendsStore } from "./friendsStore";

/**
 * Who on a map or a list is the player's friend (beta 7, owner: "Friend icon /
 * marker on the map / map list (both MR1 and MR2)"): `"pinned"` for a friend
 * pinned to the top of the Friends list (the stronger marker), `"friend"` for
 * any other friend, null for everyone else.
 *
 * The answer comes from data already on hand, never a request per base: the
 * shared friends list (`friendsStore`) once it has loaded, as it is the
 * freshest after the player pins or removes someone; until then, the flags
 * the map routes send with each base (`fr` / `fp` on Map Room 2 cells,
 * `friend` / `friendpinned` on Map Room 1 neighbours).
 */
export type FriendMark = "pinned" | "friend" | null;

/** What a mark reads from the friends list; the shared store, or a test's own. */
export interface FriendMarkSource {
  readonly snapshot: { readonly loaded: boolean };
  isFriend(userid: number): boolean;
  isPinned(userid: number): boolean;
}

/** What the route said about one player. */
export interface FriendFlags {
  readonly friend?: boolean;
  readonly pinned?: boolean;
}

export const friendMarkOf = (
  userid: number,
  flags: FriendFlags = {},
  source: FriendMarkSource = friendsStore,
): FriendMark => {
  if (source.snapshot.loaded) return source.isPinned(userid) ? "pinned" : source.isFriend(userid) ? "friend" : null;
  if (flags.pinned) return "pinned";
  return flags.friend ? "friend" : null;
};

/**
 * Every friend's id and whether they are pinned, as one string: the map
 * redraws its friend markers only when this changes, not on every refresh of
 * the list. Empty until the list has loaded.
 */
export const friendMarksKey = (
  source: { readonly snapshot: { readonly loaded: boolean; readonly friends: readonly { readonly userid: number; readonly pinnedAt: number | null }[] } } = friendsStore,
): string => {
  if (!source.snapshot.loaded) return "";
  return source.snapshot.friends
    .map((friend) => `${friend.userid}${friend.pinnedAt !== null ? "p" : ""}`)
    .sort()
    .join(",");
};
