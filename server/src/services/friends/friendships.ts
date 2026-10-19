import type { EntityManager } from "@mikro-orm/postgresql";

import { friendRefusedErr } from "../../errors/errors.js";
import { bookFriendDecline } from "../bots/friendDecline.js";
import { notifyFriend, type FriendNotice } from "./friendNotifications.js";
import { askAgainAt, blockedIdsOf, FRIEND_LIMITS, lapseCutoff, secondsOf, utcDayStart } from "./friendRules.js";
import { friendView, requestView, type FriendView, type RequestView } from "./friendViews.js";

/**
 * Friendship itself (`docs/design/friends.md` §3.1, §3.6 and §6.2, issue
 * #368): requests, answers, removing a friend, and blocking.
 *
 * Every change runs in one transaction that first locks both players' `user`
 * rows `FOR UPDATE`, lower user id first, so two players acting on each other
 * at once take turns and the limits are counted on settled rows. Refusals
 * throw `friendRefusedErr` (409 with a stable `reason`) before anything is
 * written. Notifications are written once the transaction has committed.
 *
 * `friendcount` is recounted from `bym.friend` whenever a friendship starts
 * or ends, so it always equals the real count.
 *
 * A pending request older than 14 days has lapsed: it is marked `expired`
 * when a change touches the pair, and every read leaves it out.
 */

/** Who a request is for: an id, or a username matched without case. */
export interface FriendTarget {
  userid?: number;
  username?: string;
}

interface LockedUser {
  userid: number;
  username: string;
  blocked_users: unknown;
  friend_requests_off: boolean;
  banned: boolean;
}

const dateOf = (seconds: number): Date => new Date(seconds * 1000);

/** The player a request names, or `noSuchPlayer`. */
export const resolvePlayer = async (em: EntityManager, target: FriendTarget): Promise<number> => {
  const [row] =
    target.userid !== undefined
      ? await em.execute<{ userid: number }[]>(`SELECT userid FROM bym."user" WHERE userid = ?`, [target.userid])
      : await em.execute<{ userid: number }[]>(`SELECT userid FROM bym."user" WHERE lower(username) = lower(?) LIMIT 1`, [
          (target.username ?? "").trim(),
        ]);
  if (!row) throw friendRefusedErr("noSuchPlayer");
  return Number(row.userid);
};

/** Locks both players' rows, lower id first; `noSuchPlayer` if either is gone. */
const lockPair = async (tx: EntityManager, a: number, b: number): Promise<[LockedUser, LockedUser]> => {
  const rows = await tx.execute<LockedUser[]>(
    `SELECT userid, username, blocked_users, friend_requests_off, banned FROM bym."user"
      WHERE userid IN (?, ?) ORDER BY userid FOR UPDATE`,
    [a, b]
  );
  const find = (id: number) => rows.find((row) => Number(row.userid) === id);
  const first = find(a);
  const second = find(b);
  if (!first || !second) throw friendRefusedErr("noSuchPlayer");
  return [first, second];
};

/** A block either way, or either account banned: the neutral `cannotSend`. */
const cannotReach = (a: LockedUser, b: LockedUser): boolean =>
  a.banned ||
  b.banned ||
  blockedIdsOf(a.blocked_users).includes(Number(b.userid)) ||
  blockedIdsOf(b.blocked_users).includes(Number(a.userid));

/** Marks the pair's lapsed requests, both ways, `expired`. */
const lapsePair = (tx: EntityManager, a: number, b: number, now: number) =>
  tx.execute(
    `UPDATE bym.friend_request SET status = 'expired', answered_at = created_at + interval '${FRIEND_LIMITS.requestLapseDays} days'
      WHERE status = 'pending' AND created_at < ?
        AND ((from_userid = ? AND to_userid = ?) OR (from_userid = ? AND to_userid = ?))`,
    [dateOf(lapseCutoff(now)), a, b, b, a]
  );

const friendCount = async (tx: EntityManager, userid: number): Promise<number> => {
  const [row] = await tx.execute<{ n: number }[]>(`SELECT count(*)::int AS n FROM bym.friend WHERE userid = ?`, [userid]);
  return Number(row?.n ?? 0);
};

const areFriends = async (tx: EntityManager, a: number, b: number): Promise<boolean> =>
  (await tx.execute(`SELECT 1 FROM bym.friend WHERE userid = ? AND friend_userid = ?`, [a, b])).length > 0;

const recountFriends = (tx: EntityManager, a: number, b: number) =>
  tx.execute(
    `UPDATE bym."user" u SET friendcount = (SELECT count(*) FROM bym.friend f WHERE f.userid = u.userid)
      WHERE u.userid IN (?, ?)`,
    [a, b]
  );

/** Refuses when either player is at the friend limit; `me` is the one acting. */
const checkFriendLimits = async (tx: EntityManager, me: number, other: number): Promise<void> => {
  if ((await friendCount(tx, me)) >= FRIEND_LIMITS.maxFriends) throw friendRefusedErr("friendLimit");
  if ((await friendCount(tx, other)) >= FRIEND_LIMITS.maxFriends) throw friendRefusedErr("theirFriendLimit");
};

/** Writes the friendship's two rows and recounts both players. */
const makeFriends = async (tx: EntityManager, a: number, b: number, now: number): Promise<void> => {
  const since = dateOf(now);
  await tx.execute(
    `INSERT INTO bym.friend (userid, friend_userid, created_at) VALUES (?, ?, ?), (?, ?, ?) ON CONFLICT DO NOTHING`,
    [a, b, since, b, a, since]
  );
  await recountFriends(tx, a, b);
};

/** Ends the friendship both ways; true when there was one. */
const unfriend = async (tx: EntityManager, a: number, b: number): Promise<boolean> => {
  const gone = await tx.execute(
    `DELETE FROM bym.friend WHERE (userid = ? AND friend_userid = ?) OR (userid = ? AND friend_userid = ?) RETURNING 1`,
    [a, b, b, a]
  );
  if (gone.length > 0) await recountFriends(tx, a, b);
  return gone.length > 0;
};

const sendNotices = async (em: EntityManager, notices: { userid: number; notice: FriendNotice }[]) => {
  for (const { userid, notice } of notices) await notifyFriend(em, userid, notice);
};

const acceptedBoth = (a: LockedUser, b: LockedUser) => [
  { userid: Number(a.userid), notice: { event: "accepted", userid: Number(b.userid), username: b.username } as FriendNotice },
  { userid: Number(b.userid), notice: { event: "accepted", userid: Number(a.userid), username: a.username } as FriendNotice },
];

/** What `POST /bm/friends/request` answers. */
export interface RequestOutcome {
  request: RequestView;
  /** Set when the other player had already asked: the request both ways accepted theirs. */
  friend?: FriendView;
}

/**
 * Asks a player to be friends (§3.1). Refused, in this order: `self`,
 * `noSuchPlayer`, `cannotSend` (a block either way, or either account banned), `alreadyFriends`,
 * `alreadyRequested`; then, unless the other player had already asked (which
 * accepts their request, `friendLimit`/`theirFriendLimit` permitting),
 * `requestsOff`, `friendLimit`, `theirFriendLimit`, `requestLimit` (30
 * waiting), `dailyCap` (30 sent today) and `declinedRecently` (with `from`,
 * when asking is possible again).
 *
 * A request to an account covered by the §6.2 rule is stored and answered
 * like any other, and its decline booked (`bookFriendDecline`).
 *
 * @param {number} now - Unix seconds
 */
export const sendFriendRequest = async (
  em: EntityManager,
  me: number,
  target: FriendTarget,
  now: number
): Promise<RequestOutcome> => {
  if (target.userid === me) throw friendRefusedErr("self");
  const other = await resolvePlayer(em, target);
  if (other === me) throw friendRefusedErr("self");

  const { requestid, accepted, notices } = await em.transactional(async (tx) => {
    const [mine, theirs] = await lockPair(tx, me, other);
    if (cannotReach(mine, theirs)) throw friendRefusedErr("cannotSend");
    await lapsePair(tx, me, other, now);
    if (await areFriends(tx, me, other)) throw friendRefusedErr("alreadyFriends");

    const pending = await tx.execute<{ id: number; from_userid: number }[]>(
      `SELECT id, from_userid FROM bym.friend_request
        WHERE status = 'pending' AND ((from_userid = ? AND to_userid = ?) OR (from_userid = ? AND to_userid = ?))`,
      [me, other, other, me]
    );
    if (pending.some((row) => Number(row.from_userid) === me)) throw friendRefusedErr("alreadyRequested");

    const theirRequest = pending.find((row) => Number(row.from_userid) === other);
    if (theirRequest) {
      // A request both ways: this one accepts theirs.
      await checkFriendLimits(tx, me, other);
      await tx.execute(`UPDATE bym.friend_request SET status = 'accepted', answered_at = ? WHERE id = ?`, [
        dateOf(now),
        theirRequest.id,
      ]);
      await makeFriends(tx, me, other, now);
      return { requestid: Number(theirRequest.id), accepted: true, notices: acceptedBoth(mine, theirs) };
    }

    if (theirs.friend_requests_off) throw friendRefusedErr("requestsOff");
    await checkFriendLimits(tx, me, other);

    const [counts] = await tx.execute<{ open: number; today: number }[]>(
      `SELECT count(*) FILTER (WHERE status = 'pending' AND created_at >= ?)::int AS open,
              count(*) FILTER (WHERE created_at >= ?)::int AS today
         FROM bym.friend_request WHERE from_userid = ? AND created_at >= ?`,
      [dateOf(lapseCutoff(now)), dateOf(utcDayStart(now)), me, dateOf(Math.min(lapseCutoff(now), utcDayStart(now)))]
    );
    if (Number(counts?.open ?? 0) >= FRIEND_LIMITS.maxOpenRequests) throw friendRefusedErr("requestLimit");
    if (Number(counts?.today ?? 0) >= FRIEND_LIMITS.maxRequestsPerDay) throw friendRefusedErr("dailyCap");

    const [declined] = await tx.execute<{ at: Date | null }[]>(
      `SELECT max(answered_at) AS at FROM bym.friend_request
        WHERE from_userid = ? AND to_userid = ? AND status = 'declined' AND answered_at > ?`,
      [me, other, dateOf(now - FRIEND_LIMITS.declineWaitDays * 24 * 60 * 60)]
    );
    const declinedAt = secondsOf(declined?.at);
    if (declinedAt !== null) throw friendRefusedErr("declinedRecently", { from: askAgainAt(declinedAt) });

    const [row] = await tx.execute<{ id: number }[]>(
      `INSERT INTO bym.friend_request (from_userid, to_userid, status, created_at) VALUES (?, ?, 'pending', ?) RETURNING id`,
      [me, other, dateOf(now)]
    );
    const id = Number(row!.id);
    await bookFriendDecline(tx, { id, from_userid: me, to_userid: other }, now);
    const notice: FriendNotice = { event: "request", userid: me, username: mine.username };
    return { requestid: id, accepted: false, notices: [{ userid: other, notice }] };
  });

  await sendNotices(em, notices);
  const request = (await requestView(em, requestid, me))!;
  if (!accepted) return { request };
  const friend = await friendView(em, me, other, now);
  return friend ? { request, friend } : { request };
};

/**
 * Answers a request sent to the caller (§3.1): `accept` makes the friendship
 * (`cannotSend` if a block came between, `friendLimit`/`theirFriendLimit`)
 * and tells both players; a decline is silent. `noSuchRequest` when it is not
 * theirs to answer, already answered, cancelled or lapsed.
 *
 * @returns {Promise<{ friend?: FriendView }>} The new friend, on accept
 */
export const answerFriendRequest = async (
  em: EntityManager,
  me: number,
  requestid: number,
  accept: boolean,
  now: number
): Promise<{ friend?: FriendView }> => {
  const [request] = await em.execute<{ from_userid: number }[]>(
    `SELECT from_userid FROM bym.friend_request WHERE id = ? AND to_userid = ?`,
    [requestid, me]
  );
  if (!request) throw friendRefusedErr("noSuchRequest");
  const other = Number(request.from_userid);

  const notices = await em.transactional(async (tx) => {
    const [mine, theirs] = await lockPair(tx, me, other);
    await lapsePair(tx, me, other, now);
    const [open] = await tx.execute(
      `SELECT 1 FROM bym.friend_request WHERE id = ? AND to_userid = ? AND status = 'pending' FOR UPDATE`,
      [requestid, me]
    );
    if (!open) throw friendRefusedErr("noSuchRequest");

    if (!accept) {
      await tx.execute(`UPDATE bym.friend_request SET status = 'declined', answered_at = ? WHERE id = ?`, [dateOf(now), requestid]);
      return [];
    }

    if (cannotReach(mine, theirs)) throw friendRefusedErr("cannotSend");
    if (await areFriends(tx, me, other)) {
      await tx.execute(`UPDATE bym.friend_request SET status = 'accepted', answered_at = ? WHERE id = ?`, [dateOf(now), requestid]);
      return [];
    }
    await checkFriendLimits(tx, me, other);
    await tx.execute(`UPDATE bym.friend_request SET status = 'accepted', answered_at = ? WHERE id = ?`, [dateOf(now), requestid]);
    await makeFriends(tx, me, other, now);
    return acceptedBoth(mine, theirs);
  });

  await sendNotices(em, notices);
  if (!accept) return {};
  const friend = await friendView(em, me, other, now);
  return friend ? { friend } : {};
};

/** Takes back a request the caller sent; `noSuchRequest` when it is not waiting any more. */
export const cancelFriendRequest = async (em: EntityManager, me: number, requestid: number, now: number): Promise<void> => {
  const rows = await em.execute(
    `UPDATE bym.friend_request SET status = 'cancelled', answered_at = ?
      WHERE id = ? AND from_userid = ? AND status = 'pending' AND created_at >= ?
      RETURNING 1`,
    [dateOf(now), requestid, me, dateOf(lapseCutoff(now))]
  );
  if (rows.length === 0) throw friendRefusedErr("noSuchRequest");
};

/** Ends a friendship at once for both, silently (§3.1); `notFriends` when there is none. */
export const removeFriend = async (em: EntityManager, me: number, other: number): Promise<void> => {
  if (other === me) throw friendRefusedErr("self");
  await em.transactional(async (tx) => {
    await lockPair(tx, me, other);
    if (!(await unfriend(tx, me, other))) throw friendRefusedErr("notFriends");
  });
};

/**
 * Blocks a player (§3.6): adds them to the caller's `blockedUsers` (which
 * already stops mail and truce requests both ways), ends any friendship and
 * cancels any waiting request between them, both ways. They are not told.
 * Blocking someone already blocked still clears what is between them.
 */
export const blockPlayer = async (em: EntityManager, me: number, other: number, now: number): Promise<void> => {
  if (other === me) throw friendRefusedErr("self");
  await em.transactional(async (tx) => {
    await lockPair(tx, me, other);
    await tx.execute(
      `UPDATE bym."user" SET blocked_users = coalesce(blocked_users, '[]'::jsonb) || jsonb_build_array(?::int)
        WHERE userid = ? AND NOT coalesce(blocked_users, '[]'::jsonb) @> jsonb_build_array(?::int)`,
      [other, me, other]
    );
    await clearBetween(tx, me, other, now);
  });
};

/**
 * Ends any friendship and cancels any waiting request between two players:
 * what a block does besides the block itself. Also called where blocking
 * already happened before friends existed (reporting a mail thread).
 * Expects to run in the caller's transaction.
 */
export const clearBetween = async (tx: EntityManager, a: number, b: number, now: number): Promise<void> => {
  await unfriend(tx, a, b);
  await tx.execute(
    `UPDATE bym.friend_request SET status = 'cancelled', answered_at = ?
      WHERE status = 'pending' AND ((from_userid = ? AND to_userid = ?) OR (from_userid = ? AND to_userid = ?))`,
    [dateOf(now), a, b, b, a]
  );
};

/** Takes a player off the caller's blocked list; nothing happens if they are not on it. */
export const unblockPlayer = async (em: EntityManager, me: number, other: number): Promise<void> => {
  await em.execute(
    `UPDATE bym."user"
        SET blocked_users = (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(blocked_users) e WHERE e <> to_jsonb(?::int))
      WHERE userid = ? AND blocked_users @> jsonb_build_array(?::int)`,
    [other, me, other]
  );
};
