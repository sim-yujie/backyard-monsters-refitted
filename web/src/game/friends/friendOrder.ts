import type { Friend } from "@/api/friends";
import { canHelp } from "./friendText";

/**
 * The order the Friends window lists friends in (`ui/friends/FriendsWindow.ts`),
 * here so Prev and Next on a friend's yard (`friendHop.ts`) can walk it
 * without the window.
 */

/**
 * Pinned first (beta 7), in the order they were pinned; then those who can
 * use help, then online, then highest level, then name. Does not change the
 * list given.
 */
export const orderFriends = (friends: readonly Friend[]): Friend[] =>
  [...friends].sort(
    (a, b) =>
      Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) ||
      (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0) ||
      Number(canHelp(b)) - Number(canHelp(a)) ||
      Number(b.online === "online") - Number(a.online === "online") ||
      b.level - a.level ||
      a.username.localeCompare(b.username),
  );

/** The window's three groups, each in {@link orderFriends}' order; a friend is in one only. */
export interface FriendGroups {
  readonly help: Friend[];
  readonly online: Friend[];
  readonly rest: Friend[];
}

export const groupFriends = (friends: readonly Friend[]): FriendGroups => {
  const groups: FriendGroups = { help: [], online: [], rest: [] };
  for (const friend of orderFriends(friends)) {
    if (canHelp(friend)) groups.help.push(friend);
    else if (friend.online === "online") groups.online.push(friend);
    else groups.rest.push(friend);
  }
  return groups;
};

/** Every friend, top to bottom, as the window lists them: the three groups one after another. */
export const windowOrder = (friends: readonly Friend[]): Friend[] => {
  const groups = groupFriends(friends);
  return [...groups.help, ...groups.online, ...groups.rest];
};
