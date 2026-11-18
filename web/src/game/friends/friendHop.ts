import type { Friend } from "@/api/friends";
import { windowOrder } from "./friendOrder";
import { canHelp } from "./friendText";

/**
 * Next and Previous friend on a friend's yard (beta 8; players on Discord,
 * owner's grilling 18 Nov 2026): the arrows on the visit bar step through
 * every friend, one yard after another, without going home and back into
 * the Friends window each time.
 *
 * - **A run** starts with every visit made the usual way (the Friends
 *   window, the map): `visitFriend` calls {@link startFriendRun}. The order
 *   is the Friends window's, top to bottom (`windowOrder`: can use help,
 *   online, everyone else), and it is **frozen** when the run starts, so a
 *   friend you just helped does not drop down the list under you. Only a
 *   fresh visit starts a new run; the arrows keep the frozen one.
 * - **The ends stop**: no Next on the last friend, no Previous on the first.
 * - **A yard that will not open** is skipped: the hop goes on the same way
 *   to the friend after; with nobody left that way it goes back to the yard
 *   the hop started from. Either way the next yard says whom it skipped.
 * - **The count** on Next: how many friends after this one can still use
 *   your help today, read from the live list (it drops as they are helped).
 *
 * Kept here, outside the yard scene, because every hop rebuilds the scene.
 */

/** Which way a hop goes along the frozen order. */
export type HopDirection = 1 | -1;

/** Who a hop opens. */
export interface HopFriend {
  readonly userid: number;
  readonly username: string;
}

/** What the arrows show: the friend each one opens (null greys it out) and the count on Next. */
export interface HopView {
  readonly prev: HopFriend | null;
  readonly next: HopFriend | null;
  /** Friends after this one, in the frozen order, who can use help today. */
  readonly ahead: number;
}

interface FriendRun {
  /** The frozen order; null until the friends list has loaded. */
  order: HopFriend[] | null;
  /** The friend whose yard is open, or being opened. */
  current: number;
  /** While a hop is on its way: which way it goes; null for a fresh visit or the way back. */
  direction: HopDirection | null;
  /** The friend a hop started from. */
  from: HopFriend | null;
  /** Friends whose yard would not open in this run: stepped over from now on. */
  readonly failed: Set<number>;
  /** Names skipped on the way to the current friend. */
  skipped: string[];
}

let run: FriendRun | null = null;

const freeze = (friends: readonly Friend[]): HopFriend[] =>
  windowOrder(friends).map(({ userid, username }) => ({ userid, username }));

/**
 * A fresh visit: a new run, with the order frozen from `friends` (the
 * shared list as it is now), or later by {@link freezeFriendRun} when the
 * list has not loaded yet.
 */
export const startFriendRun = (
  current: Pick<Friend, "userid">,
  friends: readonly Friend[] | null,
): void => {
  run = {
    order: friends && friends.length > 0 ? freeze(friends) : null,
    current: current.userid,
    direction: null,
    from: null,
    failed: new Set(),
    skipped: [],
  };
};

/** Freezes the order now if the run began before the friends list had loaded. */
export const freezeFriendRun = (friends: readonly Friend[]): void => {
  if (run && !run.order && friends.length > 0) run.order = freeze(friends);
};

/** Ends the run (a sign-out, a test). */
export const endFriendRun = (): void => {
  run = null;
};

/** The friend the run is on, or null without a run. */
export const runFriend = (): number | null => run?.current ?? null;

const indexIn = (order: readonly HopFriend[], userid: number): number =>
  order.findIndex((friend) => friend.userid === userid);

/** The first friend from `index` this way whose yard has not failed, or null at the end. */
const step = (current: FriendRun, index: number, direction: HopDirection): HopFriend | null => {
  const order = current.order;
  if (!order || index < 0) return null;
  for (let at = index + direction; at >= 0 && at < order.length; at += direction) {
    const friend = order[at];
    if (friend && !current.failed.has(friend.userid)) return friend;
  }
  return null;
};

/**
 * What the arrows show on `userid`'s yard, with `live` the friends list as
 * it is now (for the count). Null when no run is on that friend.
 */
export const hopView = (userid: number, live: readonly Friend[]): HopView | null => {
  if (!run || run.current !== userid) return null;
  const order = run.order;
  const index = order ? indexIn(order, userid) : -1;
  if (!order || index < 0) return { prev: null, next: null, ahead: 0 };
  const helpable = new Set(live.filter(canHelp).map((friend) => friend.userid));
  let ahead = 0;
  for (const friend of order.slice(index + 1)) {
    if (helpable.has(friend.userid) && !run.failed.has(friend.userid)) ahead += 1;
  }
  return { prev: step(run, index, -1), next: step(run, index, 1), ahead };
};

/**
 * An arrow was pressed on `userid`'s yard: the friend to open, or null when
 * that arrow is at the end (or no run is on that friend).
 */
export const hopFriend = (userid: number, direction: HopDirection): HopFriend | null => {
  if (!run || run.current !== userid || !run.order) return null;
  const order = run.order;
  const target = step(run, indexIn(order, userid), direction);
  if (!target) return null;
  run.from = order[indexIn(order, userid)] ?? null;
  run.direction = direction;
  run.current = target.userid;
  run.skipped = [];
  return target;
};

/**
 * The yard a hop opened would not load (`name`'s): the friend to open
 * instead, on the same way past it, or the friend the hop started from when
 * nobody is left that way. Null when this was not a hop (a fresh visit, or
 * already the way back): the yard goes home, as before.
 */
export const hopFailed = (userid: number, name: string): HopFriend | null => {
  if (!run || run.current !== userid || run.direction === null || !run.order) return null;
  run.failed.add(userid);
  run.skipped.push(name);
  const order = run.order;
  const onward = step(run, indexIn(order, userid), run.direction);
  if (onward) {
    run.current = onward.userid;
    return onward;
  }
  const back = run.from;
  run.direction = null;
  if (!back) return null;
  run.current = back.userid;
  return back;
};

/**
 * `userid`'s yard opened: the hop is over. Returns the names skipped on the
 * way, for a short line on the yard (empty for none).
 */
export const hopLanded = (userid: number): string[] => {
  if (!run || run.current !== userid) return [];
  run.direction = null;
  run.from = null;
  const skipped = run.skipped;
  run.skipped = [];
  return skipped;
};

/** The short line for friends skipped on the way: "Couldn't open Bob's yard". */
export const skippedText = (names: readonly string[]): string =>
  names.length === 1
    ? `Couldn't open ${names[0]}'s yard`
    : `Couldn't open ${names.length} yards`;
