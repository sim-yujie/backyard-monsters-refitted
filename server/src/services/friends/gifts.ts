import type { EntityManager } from "@mikro-orm/postgresql";

import { utcDayStart, secondsOf } from "./friendRules.js";
import { CARD_COLUMNS, CARD_JOIN, cardOf, placeholders, type CardRow } from "./friendViews.js";
import type { GiftResource } from "./giftRules.js";
import { friendsSince, helpDayOf } from "./helpFacts.js";

/**
 * What the gift rules read from and write to `bym.friend_gift`
 * (`docs/design/friends.md` §5 and §6, issue #375). The rules are in
 * `giftRules.ts`; the routes are `controllers/friends/gift.ts`.
 *
 * A gift is **waiting** while it is not collected and has not lapsed
 * (`expires_at` still ahead). A block lapses the blocked player's waiting
 * gifts to the blocker at once ({@link dropWaitingGifts}), keeping the row for
 * the audit trail and the one-a-day key.
 */

const dateOf = (seconds: number): Date => new Date(seconds * 1000);

/** One waiting gift, as `GET /bm/friends/gifts` sends it; the player is the sender. */
export interface GiftView {
  giftid: number;
  userid: number;
  username: string;
  pic: string | null;
  level: number;
  resource: GiftResource;
  amount: number;
  /** Unix seconds. */
  createdAt: number;
  expiresAt: number;
  /** Still friends with the sender and no gift sent them today: "Send one back" can be pressed. */
  canSendBack: boolean;
}

/** Of `others`, the players `from` has already sent a gift today (UTC). */
export const giftedToday = async (
  em: EntityManager,
  from: number,
  others: readonly number[],
  now: number
): Promise<Set<number>> => {
  if (others.length === 0) return new Set();
  const rows = await em.execute<{ to_userid: number | string }[]>(
    `SELECT to_userid FROM bym.friend_gift WHERE from_userid = ? AND gift_day = ?::date AND to_userid IN (${placeholders(others)})`,
    [from, helpDayOf(now), ...others]
  );
  return new Set(rows.map((row) => Number(row.to_userid)));
};

/** Gifts waiting for the player. */
export const countWaitingGifts = async (em: EntityManager, to: number, now: number): Promise<number> => {
  const [row] = await em.execute<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM bym.friend_gift WHERE to_userid = ? AND collected_at IS NULL AND expires_at > ?`,
    [to, dateOf(now)]
  );
  return Number(row?.n ?? 0);
};

/** Gifts the player has collected in the UTC day `now` falls in. */
export const collectedToday = async (em: EntityManager, to: number, now: number): Promise<number> => {
  const [row] = await em.execute<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM bym.friend_gift WHERE to_userid = ? AND collected_at >= ?`,
    [to, dateOf(utcDayStart(now))]
  );
  return Number(row?.n ?? 0);
};

interface GiftRow extends CardRow {
  id: number | string;
  resource: GiftResource;
  amount: number | string;
  created_at: Date;
  expires_at: Date;
}

/** The player's waiting gifts, oldest first (the first to lapse). */
export const listWaitingGifts = async (em: EntityManager, to: number, now: number): Promise<GiftView[]> => {
  const rows = await em.execute<GiftRow[]>(
    `SELECT g.id, g.resource, g.amount, g.created_at, g.expires_at, ${CARD_COLUMNS}
       FROM bym.friend_gift g JOIN ${CARD_JOIN} ON u.userid = g.from_userid
      WHERE g.to_userid = ? AND g.collected_at IS NULL AND g.expires_at > ?
      ORDER BY g.created_at, g.id`,
    [to, dateOf(now)]
  );
  const senders = [...new Set(rows.map((row) => Number(row.userid)))];
  const [since, gifted] = await Promise.all([friendsSince(em, to, senders), giftedToday(em, to, senders, now)]);
  return rows.map((row) => {
    const card = cardOf(row);
    return {
      giftid: Number(row.id),
      ...card,
      resource: row.resource,
      amount: Number(row.amount),
      createdAt: secondsOf(row.created_at) ?? now,
      expiresAt: secondsOf(row.expires_at) ?? now,
      canSendBack: since.has(card.userid) && !gifted.has(card.userid),
    };
  });
};

/** A gift just written, as the sender's answer gives it. */
export interface SentGift {
  giftid: number;
  resource: GiftResource;
  amount: number;
  createdAt: number;
  expiresAt: number;
}

/**
 * Writes one gift, or answers null when `from` has already sent `to` one
 * today: the unique key on sender, receiver and day decides, so two sends at
 * once give one gift.
 */
export const insertGift = async (
  tx: EntityManager,
  gift: { from: number; to: number; resource: GiftResource; amount: number; now: number; expiresAt: number }
): Promise<SentGift | null> => {
  const [row] = await tx.execute<{ id: number | string }[]>(
    `INSERT INTO bym.friend_gift (from_userid, to_userid, resource, amount, gift_day, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?::date, ?, ?)
     ON CONFLICT ON CONSTRAINT friend_gift_once_a_day DO NOTHING
     RETURNING id`,
    [gift.from, gift.to, gift.resource, gift.amount, helpDayOf(gift.now), dateOf(gift.now), dateOf(gift.expiresAt)]
  );
  if (!row) return null;
  return { giftid: Number(row.id), resource: gift.resource, amount: gift.amount, createdAt: gift.now, expiresAt: gift.expiresAt };
};

/** A waiting gift as the collect reads it. */
export interface WaitingGift {
  id: number;
  resource: GiftResource;
  amount: number;
}

/**
 * The player's waiting gifts, oldest first, locked `FOR UPDATE`: one by id,
 * or all of them. Run inside the collect's transaction.
 */
export const lockWaitingGifts = async (
  tx: EntityManager,
  to: number,
  giftid: number | null,
  now: number
): Promise<WaitingGift[]> => {
  const rows = await tx.execute<{ id: number | string; resource: GiftResource; amount: number | string }[]>(
    `SELECT id, resource, amount FROM bym.friend_gift
      WHERE to_userid = ? AND collected_at IS NULL AND expires_at > ?${giftid === null ? "" : " AND id = ?"}
      ORDER BY created_at, id
      FOR UPDATE`,
    giftid === null ? [to, dateOf(now)] : [to, dateOf(now), giftid]
  );
  return rows.map((row) => ({ id: Number(row.id), resource: row.resource, amount: Number(row.amount) }));
};

/** Marks gifts collected. */
export const markCollected = async (tx: EntityManager, ids: readonly number[], now: number): Promise<void> => {
  if (ids.length === 0) return;
  await tx.execute(`UPDATE bym.friend_gift SET collected_at = ? WHERE id IN (${placeholders(ids)})`, [dateOf(now), ...ids]);
};

/**
 * Lapses every gift `from` sent `to` that is still waiting (a block, §3.6).
 * The rows stay, so the one-a-day key still holds and the audit keeps them.
 */
export const dropWaitingGifts = async (tx: EntityManager, from: number, to: number, now: number): Promise<void> => {
  await tx.execute(
    `UPDATE bym.friend_gift SET expires_at = ? WHERE from_userid = ? AND to_userid = ? AND collected_at IS NULL AND expires_at > ?`,
    [dateOf(now), from, to, dateOf(now)]
  );
};
