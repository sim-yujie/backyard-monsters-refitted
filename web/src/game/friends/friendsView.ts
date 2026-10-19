/**
 * The way to the Friends screen from elsewhere (`docs/design/friends.md` §8,
 * issue #370): the friends bar's "+" and the card's "Friends list" (WP4),
 * the Add-friend buttons (WP11). The screen's door registers how to open it
 * while it can be opened, and clears it when it goes, as the achievements
 * screen does.
 */

/** A tab to open on: "friends", "requests", "gifts" or "find". */
export type FriendsOpenTab = "friends" | "requests" | "gifts" | "find";

let opener: ((tab?: FriendsOpenTab) => void) | null = null;

/** Sets how to open the screen; null when it cannot be opened. Returns an undo for that opener. */
export const setFriendsOpener = (open: ((tab?: FriendsOpenTab) => void) | null): (() => void) => {
  opener = open;
  return () => {
    if (opener === open) opener = null;
  };
};

/** How to open the screen now, or null. */
export const friendsOpener = (): ((tab?: FriendsOpenTab) => void) | null => opener;
