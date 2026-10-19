import type { EntityManager } from "@mikro-orm/postgresql";

import type { FriendRequestStatus } from "../../database/models/friendrequest.model.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { onlinePlayers } from "../user/online.js";
import {
  escapeLike,
  FRIEND_LIMITS,
  lapseCutoff,
  lapsesAt,
  onlineStatusOf,
  secondsOf,
  type OnlineStatus,
} from "./friendRules.js";

/**
 * What the friends routes send about other players (`docs/design/friends.md`
 * §6.2, issue #368), read with plain SQL. Nothing here sends an email,
 * `last_seen_at` itself, or anything that tells one kind of account from
 * another: every player is described by the same columns.
 */

/** One friend in `GET /bm/friends`. */
export interface FriendView {
  userid: number;
  username: string;
  pic: string | null;
  level: number;
  /** Null when they hide it (§3.6). */
  online: OnlineStatus | null;
  /** Friends since, unix seconds. */
  since: number;
  /** Gifts arrive with WP8; false until then. */
  giftSentToday: boolean;
  /** When the 24-hour friendship rule clears, unix seconds; null once it has. */
  canGiftFrom: number | null;
  /** Whether you could help them now; null when the help gates refuse (`GET /bm/friends` fills it, WP6). */
  help: { speedup: boolean; repair: boolean } | null;
}

/** One friend request, as both lists and the request routes send it; the player is the other side. */
export interface RequestView {
  requestid: number;
  userid: number;
  username: string;
  pic: string | null;
  level: number;
  status: FriendRequestStatus;
  /** When it was made, unix seconds. */
  at: number;
  /** When it lapses if nobody answers, unix seconds. */
  expires: number;
}

/** How a player stands to the caller: in search results and suggestions. */
export type Relation = "self" | "friend" | "requested" | "asked" | "none";

/** One player in search results or suggestions. */
export interface PlayerResult {
  userid: number;
  username: string;
  pic: string | null;
  level: number;
  relation: Relation;
}

/** The columns every player description reads: the account and its main save's level. */
export const CARD_COLUMNS = `u.userid, u.username, u.pic_square, s.points, s.basevalue`;
export const CARD_JOIN = `bym."user" u LEFT JOIN bym.save s ON s.basesaveid = u.save_basesaveid`;

export interface CardRow {
  userid: number | string;
  username: string;
  pic_square: string | null;
  points: string | null;
  basevalue: string | null;
}

const levelOf = (row: CardRow): number =>
  row.points === null && row.basevalue === null ? 1 : calculateBaseLevel(row.points ?? "0", row.basevalue ?? "0");

export const cardOf = (row: CardRow) => ({
  userid: Number(row.userid),
  username: row.username,
  pic: row.pic_square ?? null,
  level: levelOf(row),
});

/** `?, ?, ?` for a list of values. */
export const placeholders = (values: readonly unknown[]): string => values.map(() => "?").join(", ");

const dateOf = (seconds: number): Date => new Date(seconds * 1000);

/**
 * The caller's friends, in name order (the bar orders them itself).
 *
 * @param {number} now - Unix seconds
 */
export const listFriends = async (em: EntityManager, userid: number, now: number): Promise<FriendView[]> => {
  const rows = await em.execute<(CardRow & { since: Date; hide_online: boolean; last_seen_at: Date | null })[]>(
    `SELECT ${CARD_COLUMNS}, f.created_at AS since, u.hide_online, u.last_seen_at
       FROM bym.friend f JOIN ${CARD_JOIN} ON u.userid = f.friend_userid
      WHERE f.userid = ?
      ORDER BY lower(u.username), u.userid`,
    [userid]
  );
  const online = await onlinePlayers(rows.map((row) => Number(row.userid)), now);
  const ageGate = FRIEND_LIMITS.friendshipAgeHours * 60 * 60;
  return rows.map((row) => {
    const card = cardOf(row);
    const since = secondsOf(row.since) ?? now;
    return {
      ...card,
      online: onlineStatusOf(!!row.hide_online, online.has(card.userid), secondsOf(row.last_seen_at), now),
      since,
      giftSentToday: false,
      canGiftFrom: since + ageGate > now ? since + ageGate : null,
      help: null,
    };
  });
};

/** One friend's view, or null when they are not (or no longer) friends. */
export const friendView = async (em: EntityManager, userid: number, friendUserid: number, now: number): Promise<FriendView | null> =>
  (await listFriends(em, userid, now)).find((friend) => friend.userid === friendUserid) ?? null;

interface RequestRow extends CardRow {
  id: number | string;
  status: FriendRequestStatus;
  created_at: Date;
}

const requestOf = (row: RequestRow): RequestView => {
  const at = secondsOf(row.created_at) ?? 0;
  return { requestid: Number(row.id), ...cardOf(row), status: row.status, at, expires: lapsesAt(at) };
};

/** One request by id, described from `viewer`'s side (the other player on it). */
export const requestView = async (em: EntityManager, requestid: number, viewer: number): Promise<RequestView | null> => {
  const [row] = await em.execute<RequestRow[]>(
    `SELECT r.id, r.status, r.created_at, ${CARD_COLUMNS}
       FROM bym.friend_request r
       JOIN ${CARD_JOIN} ON u.userid = CASE WHEN r.from_userid = ? THEN r.to_userid ELSE r.from_userid END
      WHERE r.id = ?`,
    [viewer, requestid]
  );
  return row ? requestOf(row) : null;
};

/**
 * The caller's waiting requests: the ones sent to them and the ones they
 * sent, newest first. A lapsed one is left out, as if gone.
 */
export const listRequests = async (
  em: EntityManager,
  userid: number,
  now: number
): Promise<{ incoming: RequestView[]; outgoing: RequestView[] }> => {
  const read = (mine: "to_userid" | "from_userid", other: "from_userid" | "to_userid") =>
    em.execute<RequestRow[]>(
      `SELECT r.id, r.status, r.created_at, ${CARD_COLUMNS}
         FROM bym.friend_request r JOIN ${CARD_JOIN} ON u.userid = r.${other}
        WHERE r.${mine} = ? AND r.status = 'pending' AND r.created_at >= ?
        ORDER BY r.created_at DESC, r.id DESC`,
      [userid, dateOf(lapseCutoff(now))]
    );
  const [incoming, outgoing] = await Promise.all([read("to_userid", "from_userid"), read("from_userid", "to_userid")]);
  return { incoming: incoming.map(requestOf), outgoing: outgoing.map(requestOf) };
};

/** How many requests wait for the caller's answer. */
export const countIncoming = async (em: EntityManager, userid: number, now: number): Promise<number> => {
  const [row] = await em.execute<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM bym.friend_request WHERE to_userid = ? AND status = 'pending' AND created_at >= ?`,
    [userid, dateOf(lapseCutoff(now))]
  );
  return Number(row?.n ?? 0);
};

/**
 * How each of these players stands to the caller (§6.2): `self`, `friend`,
 * `requested` (the caller asked), `asked` (they asked the caller), or `none`.
 * A player who blocked the caller, or whom the caller blocked, is `none`
 * whatever else is true, so a block never shows.
 */
export const relationsOf = async (
  em: EntityManager,
  userid: number,
  others: readonly number[],
  now: number
): Promise<Map<number, Relation>> => {
  const relations = new Map<number, Relation>(others.map((other) => [other, other === userid ? "self" : "none"]));
  const ids = others.filter((other) => other !== userid);
  if (ids.length === 0) return relations;

  const list = placeholders(ids);
  const [friends, requests, blocks] = await Promise.all([
    em.execute<{ other: number }[]>(`SELECT friend_userid AS other FROM bym.friend WHERE userid = ? AND friend_userid IN (${list})`, [
      userid,
      ...ids,
    ]),
    em.execute<{ from_userid: number; to_userid: number }[]>(
      `SELECT from_userid, to_userid FROM bym.friend_request
        WHERE status = 'pending' AND created_at >= ?
          AND ((from_userid = ? AND to_userid IN (${list})) OR (to_userid = ? AND from_userid IN (${list})))`,
      [dateOf(lapseCutoff(now)), userid, ...ids, userid, ...ids]
    ),
    em.execute<{ other: number }[]>(
      `SELECT u.userid AS other FROM bym."user" u, bym."user" me
        WHERE me.userid = ? AND u.userid IN (${list})
          AND (coalesce(u.blocked_users, '[]'::jsonb) @> jsonb_build_array(me.userid)
               OR coalesce(me.blocked_users, '[]'::jsonb) @> jsonb_build_array(u.userid))`,
      [userid, ...ids]
    ),
  ]);

  for (const { from_userid, to_userid } of requests) {
    if (Number(from_userid) === userid) relations.set(Number(to_userid), "requested");
    else relations.set(Number(from_userid), "asked");
  }
  for (const { other } of friends) relations.set(Number(other), "friend");
  for (const { other } of blocks) relations.set(Number(other), "none");
  return relations;
};

const withRelations = async (em: EntityManager, userid: number, rows: CardRow[], now: number): Promise<PlayerResult[]> => {
  const cards = rows.map(cardOf);
  const relations = await relationsOf(em, userid, cards.map((card) => card.userid), now);
  return cards.map((card) => ({ ...card, relation: relations.get(card.userid) ?? "none" }));
};

/** Search results a query gives at most. */
export const SEARCH_LIMIT = 10;

/**
 * Players whose username contains `query`, without case (§6.2): at most
 * {@link SEARCH_LIMIT}, the exact match first, then names that start with
 * it, then the rest, shorter names first. Banned accounts are left out.
 *
 * @param {string} query - At least 3 characters (the route checks)
 */
export const searchPlayers = async (em: EntityManager, userid: number, query: string, now: number): Promise<PlayerResult[]> => {
  const text = query.trim().toLowerCase();
  const escaped = escapeLike(text);
  const rows = await em.execute<CardRow[]>(
    `SELECT ${CARD_COLUMNS}
       FROM ${CARD_JOIN}
      WHERE lower(u.username) LIKE ? AND NOT u.banned
      ORDER BY (lower(u.username) = ?) DESC, (lower(u.username) LIKE ?) DESC, length(u.username), lower(u.username), u.userid
      LIMIT ?`,
    [`%${escaped}%`, text, `${escaped}%`, SEARCH_LIMIT]
  );
  return withRelations(em, userid, rows, now);
};

/** Suggestions a list gives at most. */
export const SUGGESTION_LIMIT = 50;

/**
 * Alliance mates who are not yet friends (§6.2, Q8), in name order; empty
 * outside an alliance.
 */
export const allianceSuggestions = async (em: EntityManager, userid: number, now: number): Promise<PlayerResult[]> => {
  const rows = await em.execute<CardRow[]>(
    `SELECT ${CARD_COLUMNS}
       FROM ${CARD_JOIN}, bym."user" me
      WHERE me.userid = ? AND me.alliance_id IS NOT NULL AND u.alliance_id = me.alliance_id
        AND u.userid <> me.userid AND NOT u.banned
        AND NOT EXISTS (SELECT 1 FROM bym.friend f WHERE f.userid = me.userid AND f.friend_userid = u.userid)
      ORDER BY lower(u.username), u.userid
      LIMIT ?`,
    [userid, SUGGESTION_LIMIT]
  );
  return withRelations(em, userid, rows, now);
};

/** The caller's blocked players with their names, in name order; ids with no account left out. */
export const listBlocked = async (em: EntityManager, userid: number): Promise<{ userid: number; username: string }[]> => {
  const rows = await em.execute<{ userid: number; username: string }[]>(
    `SELECT u.userid, u.username
       FROM bym."user" u
      WHERE u.userid IN (
              SELECT e.value::int
                FROM bym."user" me, jsonb_array_elements_text(coalesce(me.blocked_users, '[]'::jsonb)) AS e(value)
               WHERE me.userid = ?
            )
      ORDER BY lower(u.username), u.userid`,
    [userid]
  );
  return rows.map((row) => ({ userid: Number(row.userid), username: row.username }));
};
