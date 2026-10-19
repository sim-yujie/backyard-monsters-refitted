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

/** The player's own resources and storage caps, as the yard on screen holds them. */
export interface PlayerPool {
  readonly resources: Readonly<Partial<Record<"r1" | "r2" | "r3" | "r4", number>>>;
  readonly caps: Readonly<Record<"r1" | "r2" | "r3" | "r4", number>> | null;
}

/** How the Gifts tab reads the player's pool before a collect, and asks for it fresh after one. */
export interface PlayerPoolHook {
  read(): PlayerPool | null;
  refresh(): void;
}

let poolHook: PlayerPoolHook | null = null;

/**
 * Sets the pool the Gifts tab warns against and refreshes after a collect
 * (issue #375): the player's own yard registers it while it is on screen.
 * Returns an undo for that hook.
 */
export const setPlayerPool = (hook: PlayerPoolHook | null): (() => void) => {
  poolHook = hook;
  return () => {
    if (poolHook === hook) poolHook = null;
  };
};

/** The pool hook now, or null when no own yard is on screen. */
export const playerPool = (): PlayerPoolHook | null => poolHook;
