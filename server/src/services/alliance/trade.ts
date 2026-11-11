import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";

import {
  allianceTradeEnabled,
  TRADE_ASKS_PER_DAY,
  TRADE_CAP_SHARE,
  TRADE_LOSS,
  TRADE_REQUEST_SECONDS,
} from "../../config/AllianceConfig.js";
import { catchUpLockedRow } from "../../controllers/yard/yardAction.js";
import { Save } from "../../database/models/save.model.js";
import { AllianceMessageType } from "../../enums/Alliance.js";
import { BaseType } from "../../enums/Base.js";
import { Status } from "../../enums/StatusCodes.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { logger } from "../../utils/logger.js";
import { builtEvents, recordAchievements } from "../achievements/record.js";
import { RESOURCE_KEYS, noAmounts, storageCap, type StorageCapSave } from "../base/economy/resourceBudget.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { raidFighting } from "../raids/raidLock.js";
import { capOf, creditResources } from "../yard/credit.js";
import { notMainYardErr, yardRaidInProgressErr, yardUnderAttackErr } from "../yard/yardErrors.js";
import type { ResourceAmounts } from "../yardplanner/costs.js";
import { countAfterCommit, progressRefusedErr, say, utcDay } from "./allianceProgress.js";

/**
 * Trading between alliance members (beta 7, design v5 §12a, §12b).
 *
 * - **Request** (owner, 11 Nov 2026): "I give 1,000 Twigs, I want 1,000
 *   Goo", one resource for another, 1:1. What the asker gives leaves their
 *   yard when they post: the request holds it, so a mate who accepts is sure
 *   to get it. Cancel, the 24 hours running out, or leaving the alliance
 *   gives it back in full ({@link refundStaleRequests}). One open per player.
 * - **Accept**: one mate takes the whole request (no part fills). Both send
 *   the amount and both receive 10% less (owner, 10 Nov 2026: "1 : 1
 *   resource trade, with 10% penalty"; the lead's reading: each side gets
 *   90%). Both must have room for what they receive, or the accept is
 *   refused: nothing is ever lost to a full silo in a swap.
 * - **Send**: a direct send to a mate, no request.
 *
 * Every trade: one send and one receive per player per UTC day (the count is
 * the player's, kept across alliances; unique indexes hold it; a swap uses
 * both, for both players), at most 10% of the smaller storage cap leaves per
 * resource, and on a Send whatever the receiver has no room for is lost (as
 * loot past a full silo). Shiny cannot be sent. Both main yards are locked
 * and caught up first; a yard under attack or being raided is refused, as the
 * yard actions are. Amounts are whole numbers.
 */

type Amounts = ResourceAmounts;
export type Key = (typeof RESOURCE_KEYS)[number];

const KEEP = 1 - TRADE_LOSS;
/** Floating-point slack: 10 * 0.9 must stay 9, never 8.999…. */
const EPS = 1e-9;

/** What arrives when `sent` leaves (before the receiver's storage). */
export const arriveFor = (sent: number): number => Math.floor(Math.max(0, sent) * KEEP + EPS);

/** The least that must leave for `arrive` to arrive. */
export const sentFor = (arrive: number): number => {
  if (arrive <= 0) return 0;
  let sent = Math.ceil(arrive / KEEP - EPS);
  while (arriveFor(sent) < arrive) sent += 1;
  return sent;
};

/** The most one trade carries, per resource, between yards of these caps (what LEAVES). */
export const carryCap = (capA: number, capB: number): number =>
  Math.max(0, Math.floor(TRADE_CAP_SHARE * Math.min(capA, capB)));

/** The most that can leave so that all of it fits `room` after the 10%. */
export const fitSent = (room: number): number => (room >= 1 ? sentFor(Math.floor(room) + 1) - 1 : 0);

/**
 * The most a member can put in a request: what they hold of the resource they
 * give, what one trade carries, and what still fits their free room of the
 * resource they want after the 10%.
 */
export const postCapOf = (cap: number, heldGive: number, heldWant: number): number =>
  Math.max(0, Math.min(Math.floor(heldGive), fitSent(cap - heldWant), carryCap(cap, cap)));

/** Seconds to the next UTC midnight. */
export const newDayIn = (now: number): number => 86_400 - (now % 86_400);

export const isTradeKey = (raw: unknown): raw is Key => RESOURCE_KEYS.includes(raw as Key);

const heldOf = (resources: JsonObject | null | undefined, key: string): number => {
  const value = Number(resources?.[key]);
  return Number.isFinite(value) ? Math.floor(value) : 0;
};

const amountsOf = (raw: Partial<Record<string, unknown>> | null | undefined): Amounts => {
  const out = noAmounts();
  for (const key of RESOURCE_KEYS) {
    const value = Number(raw?.[key]);
    out[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return out;
};

const anyOf = (amounts: Amounts) => RESOURCE_KEYS.some((key) => amounts[key] > 0);

/** Only the resources with something in them, as the feed and the window store them. */
const nonZero = (amounts: Amounts): Partial<Amounts> =>
  Object.fromEntries(RESOURCE_KEYS.filter((key) => amounts[key] > 0).map((key) => [key, amounts[key]]));

const one = (key: Key, amount: number): Partial<Amounts> => (amount > 0 ? { [key]: amount } : {});

const parseJson = <T>(raw: unknown): T => ((typeof raw === "string" ? JSON.parse(raw) : raw) ?? {}) as T;

const refused = (reason: string, message: string, status = Status.CONFLICT) => progressRefusedErr(reason, message, status);

const amountText = (amount: number) => amount.toLocaleString("en-US");

interface MemberRow {
  userid: number;
  username: string;
  alliance_id: number | null;
  basesaveid: number | null;
}

/** Members' rows, locked in userid order so two trades between the same pair cannot deadlock. */
const lockMembers = async (tx: EntityManager, userids: number[]): Promise<Map<number, MemberRow>> => {
  const sorted = [...new Set(userids)].sort((a, b) => a - b);
  const rows = await tx.execute<{ userid: number | string; username: string; alliance_id: number | null; basesaveid: number | null }[]>(
    `SELECT userid, username, alliance_id, save_basesaveid AS basesaveid FROM bym."user"
      WHERE userid IN (${sorted.map(() => "?").join(", ")}) ORDER BY userid FOR UPDATE`,
    sorted
  );
  return new Map(
    rows.map((row) => [
      Number(row.userid),
      {
        userid: Number(row.userid),
        username: row.username,
        alliance_id: row.alliance_id === null ? null : Number(row.alliance_id),
        basesaveid: row.basesaveid === null ? null : Number(row.basesaveid),
      },
    ])
  );
};

const lockSave = (tx: EntityManager, basesaveid: number) =>
  tx.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

/** Catches a locked main yard up (production, finished jobs) before resources move. */
const catchUp = async (tx: EntityManager, save: Save, now: number) => {
  const completed = await catchUpLockedRow(tx, save, now);
  await recordAchievements(tx, save, now, builtEvents(completed));
};

/** Whether the player has sent / received a trade this UTC day. */
const usedToday = async (em: EntityManager, userid: number, now: number) => {
  const [row] = await em.execute<{ sent: number | string; received: number | string }[]>(
    `SELECT count(*) FILTER (WHERE from_userid = ?) AS sent, count(*) FILTER (WHERE to_userid = ?) AS received
       FROM bym.alliance_trade WHERE day = ?::date AND (from_userid = ? OR to_userid = ?)`,
    [userid, userid, utcDay(now), userid, userid]
  );
  return { sent: Number(row?.sent ?? 0) > 0, received: Number(row?.received ?? 0) > 0 };
};

/** Of these players, those who already sent or received a trade this UTC day. */
const tradedToday = async (em: EntityManager, userids: number[], now: number): Promise<Set<number>> => {
  if (userids.length === 0) return new Set();
  const marks = userids.map(() => "?").join(", ");
  const rows = await em.execute<{ from_userid: number | string; to_userid: number | string }[]>(
    `SELECT from_userid, to_userid FROM bym.alliance_trade
      WHERE day = ?::date AND (from_userid IN (${marks}) OR to_userid IN (${marks}))`,
    [utcDay(now), ...userids, ...userids]
  );
  return new Set(rows.flatMap((row) => [Number(row.from_userid), Number(row.to_userid)]));
};

const isUniqueViolation = (err: unknown) => String((err as { code?: string })?.code) === "23505" || /unique/i.test(String(err));

// ---------------------------------------------------------------------------
// Giving held resources back
// ---------------------------------------------------------------------------

/**
 * Closes a player's open request(s) and gives back what they hold, in full
 * (even past the storage cap: the player put it up, they never lose it).
 * `stale`: only requests that ran out or belong to an alliance the player is
 * no longer in, and skipped quietly while their yard is fought over (tried
 * again on the next load or view). `cancel`: their open request, whatever
 * its state; refused while the yard is fought over.
 *
 * @returns How many requests closed, and the player's resources after (null when none did).
 */
const giveBack = (em: EntityManager, userid: number, now: number, mode: "stale" | "cancel") =>
  countAfterCommit(() =>
    em.transactional(async (tx) => {
      const me = (await lockMembers(tx, [userid])).get(userid);
      if (!me) return { closed: 0, resources: null };
      const rows = await tx.execute<{ id: number; alliance_id: number | null; give_key: string; amount: number; expires_at: number }[]>(
        `SELECT id, alliance_id, give_key, amount, expires_at FROM bym.alliance_trade_request
          WHERE userid = ? AND status = 'open' FOR UPDATE`,
        [userid]
      );
      // While trading is switched off (`ALLIANCE_TRADE_ENABLED`), every open request is stale.
      const tradeOff = !allianceTradeEnabled();
      const closing = rows.filter(
        (row) =>
          mode === "cancel" ||
          tradeOff ||
          Number(row.expires_at) <= now ||
          row.alliance_id === null ||
          Number(row.alliance_id) !== me.alliance_id
      );
      if (closing.length === 0) return { closed: 0, resources: null };

      const save = me.basesaveid ? await lockSave(tx, me.basesaveid) : null;
      if (!save || save.type !== BaseType.MAIN || save.userid !== userid) {
        if (mode === "cancel") throw notMainYardErr();
        return { closed: 0, resources: null };
      }
      if (isAttackActive(save) || raidFighting(save, now)) {
        if (mode === "stale") return { closed: 0, resources: null };
        throw isAttackActive(save) ? yardUnderAttackErr() : yardRaidInProgressErr();
      }
      await catchUp(tx, save, now);

      const resources = { ...(save.resources ?? {}) };
      for (const row of closing) {
        if (!isTradeKey(row.give_key)) continue;
        resources[row.give_key] = heldOf(resources, row.give_key) + Math.max(0, Math.floor(Number(row.amount)));
      }
      save.resources = resources;
      save.savetime = now;
      await tx.flush();
      await tx.execute(
        `UPDATE bym.alliance_trade_request SET status = ?, closed_at = ?
          WHERE id IN (${closing.map(() => "?").join(", ")})`,
        [mode === "cancel" ? "cancelled" : "expired", now, ...closing.map((row) => Number(row.id))]
      );
      const after = noAmounts();
      for (const key of RESOURCE_KEYS) after[key] = heldOf(save.resources, key);
      return { closed: closing.length, resources: after };
    })
  );

/**
 * Gives back what a player's request holds when it ran out or their alliance
 * is gone or changed (left, kicked, disbanded, moved world), or every open
 * one while trading is switched off (`ALLIANCE_TRADE_ENABLED`). Called on the
 * owner's yard load and on the Trade tab; a cheap look first, so a load with
 * nothing to give back costs one indexed query. Never throws.
 */
export const refundStaleRequests = async (em: EntityManager, userid: number, now: number): Promise<number> => {
  try {
    const [stale] = await em.execute<{ id: number }[]>(
      `SELECT r.id FROM bym.alliance_trade_request r JOIN bym."user" u ON u.userid = r.userid
        WHERE r.userid = ? AND r.status = 'open'
          AND (? OR r.expires_at <= ? OR r.alliance_id IS NULL OR r.alliance_id IS DISTINCT FROM u.alliance_id)
        LIMIT 1`,
      [userid, !allianceTradeEnabled(), now]
    );
    if (!stale) return 0;
    return (await giveBack(em, userid, now, "stale")).closed;
  } catch (err) {
    logger.error(`Alliance trade refund for ${userid} failed: ${err}`);
    return 0;
  }
};

// ---------------------------------------------------------------------------
// The Trade tab
// ---------------------------------------------------------------------------

export interface StorageView {
  held: Amounts;
  cap: number;
}

export interface TradeRequestView {
  id: number;
  userid: number;
  username: string;
  role: string | null;
  /** What the asker gives (the accepter gets 10% less). */
  give: Key;
  /** What the asker wants (they get 10% less). */
  want: Key;
  /** What each side sends. */
  amount: number;
  /** What each side receives: the amount less 10%. */
  gets: number;
  created_at: number;
  expires_at: number;
  status: "open" | "done";
  /** Who accepted it (done requests). */
  taken_by: string | null;
  /** The asker's storage, for the room check (open requests only). */
  storage: StorageView | null;
  /** False when the asker already traded today: it can be accepted from the next UTC day. */
  ready: boolean;
}

const storageOfRow = (row: StorageCapSave & { resources?: JsonObject | null }): StorageView => {
  const held = noAmounts();
  for (const key of RESOURCE_KEYS) held[key] = heldOf(row.resources, key);
  return { held, cap: storageCap(row) };
};

/** Main-yard storage of some players, by userid (read only, not caught up: a preview). */
const readStorage = async (em: EntityManager, userids: number[]): Promise<Map<number, StorageView>> => {
  if (userids.length === 0) return new Map();
  const rows = await em.execute<
    (StorageCapSave & { userid: number | string; resources: JsonObject | null })[]
  >(
    `SELECT u.userid, s.resources, s.buildingdata, s.storedata, s.outposts
       FROM bym."user" u JOIN bym.save s ON s.basesaveid = u.save_basesaveid
      WHERE u.userid IN (${userids.map(() => "?").join(", ")})`,
    userids
  );
  return new Map(rows.map((row) => [Number(row.userid), storageOfRow({ ...row, resources: parseJson<JsonObject>(row.resources) })]));
};

/**
 * `GET /alliance/trade[?to=]`: the Trade tab. Today's sends / receives left,
 * the caller's open request, mates' open requests (and those done today,
 * greyed), the last 2 trades, the caller's storage, and with `to` that mate's
 * storage for the Send sheet. Gives back what run-out requests in the
 * alliance hold first.
 */
export const tradeView = async (em: EntityManager, userid: number, now: number, to?: number) => {
  const [me] = await em.execute<{ alliance_id: number | null }[]>(`SELECT alliance_id FROM bym."user" WHERE userid = ?`, [userid]);
  const allianceId = me?.alliance_id ? Number(me.alliance_id) : null;
  if (!allianceId) throw refused("notMember", "You are not in an alliance.", Status.FORBIDDEN);

  await refundStaleRequests(em, userid, now);
  const lapsed = await em.execute<{ userid: number }[]>(
    `SELECT DISTINCT userid FROM bym.alliance_trade_request WHERE alliance_id = ? AND status = 'open' AND expires_at <= ? LIMIT 10`,
    [allianceId, now]
  );
  for (const row of lapsed) await refundStaleRequests(em, Number(row.userid), now);

  const dayStart = now - (now % 86_400);
  const rows = await em.execute<
    {
      id: number;
      userid: number;
      username: string;
      alliance_role: string | null;
      give_key: string;
      want_key: string;
      amount: number;
      created_at: number;
      expires_at: number;
      status: string;
      taker: string | null;
    }[]
  >(
    `SELECT r.id, r.userid, u.username, u.alliance_role, r.give_key, r.want_key, r.amount, r.created_at, r.expires_at, r.status,
            g.username AS taker
       FROM bym.alliance_trade_request r
       JOIN bym."user" u ON u.userid = r.userid AND u.alliance_id = r.alliance_id
       LEFT JOIN bym."user" g ON g.userid = r.given_by
      WHERE r.alliance_id = ?
        AND ((r.status = 'open' AND r.expires_at > ?) OR (r.status = 'done' AND r.closed_at >= ?))
      ORDER BY (r.status = 'open') DESC, r.created_at DESC
      LIMIT 50`,
    [allianceId, now, dayStart]
  );
  const askers = [...new Set(rows.filter((row) => row.status === "open").map((row) => Number(row.userid)))];
  const storage = await readStorage(em, [...new Set([userid, ...askers, ...(to ? [to] : [])])]);
  const traded = await tradedToday(em, askers, now);

  const requests: TradeRequestView[] = rows
    .filter((row) => isTradeKey(row.give_key) && isTradeKey(row.want_key))
    .map((row) => {
      const open = row.status === "open";
      const amount = Number(row.amount);
      return {
        id: Number(row.id),
        userid: Number(row.userid),
        username: row.username,
        role: row.alliance_role,
        give: row.give_key as Key,
        want: row.want_key as Key,
        amount,
        gets: arriveFor(amount),
        created_at: Number(row.created_at),
        expires_at: Number(row.expires_at),
        status: open ? "open" : "done",
        taken_by: row.taker,
        storage: open ? (storage.get(Number(row.userid)) ?? null) : null,
        ready: open && !traded.has(Number(row.userid)),
      };
    });
  const mine = requests.find((row) => row.userid === userid && row.status === "open") ?? null;

  const recent = await em.execute<{ from_name: string; to_name: string; arrived: unknown; created_at: number }[]>(
    `SELECT f.username AS from_name, t.username AS to_name, tr.arrived, tr.created_at
       FROM bym.alliance_trade tr
       JOIN bym."user" f ON f.userid = tr.from_userid
       JOIN bym."user" t ON t.userid = tr.to_userid
      WHERE tr.alliance_id = ? ORDER BY tr.created_at DESC, tr.id DESC LIMIT 2`,
    [allianceId]
  );

  let mate: { userid: number; username: string; storage: StorageView | null } | null = null;
  if (to) {
    const [row] = await em.execute<{ username: string; alliance_id: number | null }[]>(
      `SELECT username, alliance_id FROM bym."user" WHERE userid = ?`,
      [to]
    );
    if (row && Number(row.alliance_id) === allianceId && to !== userid) {
      mate = { userid: to, username: row.username, storage: storage.get(to) ?? null };
    }
  }

  const used = await usedToday(em, userid, now);
  const [posts] = await em.execute<{ n: number | string }[]>(
    `SELECT count(*) AS n FROM bym.alliance_trade_request WHERE userid = ? AND created_at >= ?`,
    [userid, dayStart]
  );
  return {
    error: 0,
    today: {
      sendsLeft: used.sent ? 0 : 1,
      receivesLeft: used.received ? 0 : 1,
      postsLeft: Math.max(0, TRADE_ASKS_PER_DAY - Number(posts?.n ?? 0)),
      newDayIn: newDayIn(now),
    },
    rules: { loss: TRADE_LOSS, capShare: TRADE_CAP_SHARE, requestSeconds: TRADE_REQUEST_SECONDS },
    me: storage.get(userid) ?? null,
    myRequest: mine,
    requests: requests.filter((row) => row !== mine),
    recent: recent.map((row) => ({
      from: row.from_name,
      to: row.to_name,
      arrived: nonZero(amountsOf(parseJson(row.arrived))),
      at: Number(row.created_at),
    })),
    mate,
  };
};

// ---------------------------------------------------------------------------
// Post and cancel
// ---------------------------------------------------------------------------

/**
 * `POST /alliance/trade/post`: "I give `amount` of `give`, I want `amount`
 * of `want`". What is given leaves the asker's yard now; the request holds it.
 */
export const postRequest = async (em: EntityManager, userid: number, give: string, want: string, rawAmount: number, now: number) => {
  if (!isTradeKey(give) || !isTradeKey(want) || give === want) {
    throw refused("badPair", "Pick one resource to give and another to get.", Status.BAD_REQUEST);
  }
  const amount = Math.floor(Number(rawAmount));
  if (!Number.isFinite(amount) || amount < 1) throw refused("nothingAsked", "Pick an amount.", Status.BAD_REQUEST);
  await refundStaleRequests(em, userid, now);

  const posted = await countAfterCommit(() =>
    em.transactional(async (tx) => {
      const me = (await lockMembers(tx, [userid])).get(userid);
      if (!me?.alliance_id) throw refused("notMember", "You are not in an alliance.", Status.FORBIDDEN);
      if (!me.basesaveid) throw notMainYardErr();

      const used = await usedToday(tx, userid, now);
      if (used.sent || used.received) throw refused("tradedToday", "You traded today. Post again tomorrow.");
      const dayStart = now - (now % 86_400);
      const [posts] = await tx.execute<{ n: number | string }[]>(
        `SELECT count(*) AS n FROM bym.alliance_trade_request WHERE userid = ? AND created_at >= ?`,
        [userid, dayStart]
      );
      if (Number(posts?.n ?? 0) >= TRADE_ASKS_PER_DAY) throw refused("asksToday", `Up to ${TRADE_ASKS_PER_DAY} requests a day.`);
      const [open] = await tx.execute<{ id: number }[]>(
        `SELECT id FROM bym.alliance_trade_request WHERE userid = ? AND status = 'open'`,
        [userid]
      );
      if (open) throw refused("requestOpen", "You already have a request up.");

      const save = await lockSave(tx, me.basesaveid);
      if (!save || save.type !== BaseType.MAIN || save.userid !== userid) throw notMainYardErr();
      if (isAttackActive(save)) throw yardUnderAttackErr();
      if (raidFighting(save, now)) throw yardRaidInProgressErr();
      await catchUp(tx, save, now);

      const cap = capOf(save);
      const held = heldOf(save.resources, give);
      if (held < amount) throw refused("notEnough", `You have ${amountText(held)}.`);
      const carry = carryCap(cap, cap);
      if (amount > carry) throw refused("overCap", `One trade carries up to ${amountText(carry)}.`);
      const fits = fitSent(cap - heldOf(save.resources, want));
      if (amount > fits) throw refused("overRoom", `Your storage takes a request of up to ${amountText(fits)}.`);

      save.resources = { ...(save.resources ?? {}), [give]: held - amount };
      save.savetime = now;
      await tx.flush();

      try {
        const [row] = await tx.execute<{ id: number }[]>(
          `INSERT INTO bym.alliance_trade_request (alliance_id, userid, give_key, want_key, amount, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'open', ?, ?) RETURNING id`,
          [me.alliance_id, userid, give, want, amount, now, now + TRADE_REQUEST_SECONDS]
        );
        const resources = noAmounts();
        for (const key of RESOURCE_KEYS) resources[key] = heldOf(save.resources, key);
        return { id: Number(row.id), allianceId: me.alliance_id, resources };
      } catch (err) {
        if (isUniqueViolation(err)) throw refused("requestOpen", "You already have a request up.");
        throw err;
      }
    })
  );

  void say(posted.allianceId, userid, AllianceMessageType.TRADE_ASK, { request: posted.id, give, want, amount });
  return {
    id: posted.id,
    give,
    want,
    amount,
    gets: arriveFor(amount),
    expires_at: now + TRADE_REQUEST_SECONDS,
    resources: posted.resources,
  };
};

/** `POST /alliance/trade/cancel`: takes the caller's open request down and gives back what it holds. */
export const cancelRequest = async (em: EntityManager, userid: number, now: number) => {
  const done = await giveBack(em, userid, now, "cancel");
  return { cancelled: done.closed, resources: done.resources };
};

// ---------------------------------------------------------------------------
// Accept: the swap
// ---------------------------------------------------------------------------

export interface SwapResult {
  /** What left the accepter. */
  gave: Partial<Amounts>;
  /** What landed in the accepter's storage. */
  got: Partial<Amounts>;
  /** The accepter's resources after. */
  resources: Amounts;
  with: { userid: number; username: string };
}

/**
 * `POST /alliance/trade/accept`: takes a mate's request whole. The accepter
 * sends `amount` of what the asker wants; each side receives the amount
 * less 10%. Refused unless both have room for what they receive, the
 * accepter holds the amount, it is within what one trade carries between the
 * two yards, and neither has traded today.
 */
export const acceptRequest = async (em: EntityManager, userid: number, requestId: number, now: number): Promise<SwapResult> => {
  const [peek] = await em.execute<{ userid: number }[]>(`SELECT userid FROM bym.alliance_trade_request WHERE id = ?`, [requestId]);
  if (!peek) throw refused("requestGone", "That request is no longer open.");
  const askerId = Number(peek.userid);
  if (askerId === userid) throw refused("self", "That is your own request.", Status.BAD_REQUEST);

  const done = await countAfterCommit(() =>
    em.transactional(async (tx) => {
      const members = await lockMembers(tx, [userid, askerId]);
      const taker = members.get(userid);
      const asker = members.get(askerId);
      if (!taker?.alliance_id) throw refused("notMember", "You are not in an alliance.", Status.FORBIDDEN);
      if (!taker.basesaveid) throw notMainYardErr();

      const [request] = await tx.execute<
        { userid: number; alliance_id: number | null; status: string; expires_at: number; give_key: string; want_key: string; amount: number }[]
      >(
        `SELECT userid, alliance_id, status, expires_at, give_key, want_key, amount
           FROM bym.alliance_trade_request WHERE id = ? FOR UPDATE`,
        [requestId]
      );
      if (
        !request ||
        request.status !== "open" ||
        Number(request.expires_at) <= now ||
        Number(request.userid) !== askerId ||
        Number(request.alliance_id) !== taker.alliance_id ||
        !asker ||
        asker.alliance_id !== taker.alliance_id ||
        !asker.basesaveid ||
        !isTradeKey(request.give_key) ||
        !isTradeKey(request.want_key)
      ) {
        throw refused("requestGone", "That request is no longer open.");
      }
      const give: Key = request.give_key;
      const want: Key = request.want_key;
      const amount = Number(request.amount);
      const arrive = arriveFor(amount);

      const takerUsed = await usedToday(tx, userid, now);
      if (takerUsed.sent || takerUsed.received) throw refused("tradedToday", "You traded today. New day at 00:00 UTC.");
      const askerUsed = await usedToday(tx, askerId, now);
      if (askerUsed.sent || askerUsed.received) throw refused("mateTradedToday", `${asker.username} traded today. Try tomorrow.`);

      // Both main yards, locked in save order, refused while fought over, caught up.
      const order = [taker.basesaveid, asker.basesaveid].sort((a, b) => a - b);
      const locked = new Map<number, Save>();
      for (const id of order) {
        const save = await lockSave(tx, id);
        if (save) locked.set(id, save);
      }
      const mine = locked.get(taker.basesaveid);
      const theirs = locked.get(asker.basesaveid);
      if (!mine || mine.type !== BaseType.MAIN || mine.userid !== userid) throw notMainYardErr();
      if (!theirs || theirs.type !== BaseType.MAIN || theirs.userid !== askerId) throw refused("requestGone", "That request is no longer open.");
      if (isAttackActive(mine)) throw yardUnderAttackErr();
      if (raidFighting(mine, now)) throw yardRaidInProgressErr();
      if (isAttackActive(theirs) || raidFighting(theirs, now)) {
        throw refused("mateUnderAttack", `${asker.username}'s yard is under attack. Try again later.`);
      }
      for (const save of [mine, theirs]) await catchUp(tx, save, now);

      const limit = carryCap(capOf(mine), capOf(theirs));
      if (amount > limit) throw refused("overCap", `One trade carries up to ${amountText(limit)} between your yards.`);
      const held = heldOf(mine.resources, want);
      if (held < amount) throw refused("notEnough", `You have ${amountText(held)}.`);
      if (capOf(mine) - heldOf(mine.resources, give) < arrive) throw refused("noRoom", "Your storage is too full for it.");
      if (capOf(theirs) - heldOf(theirs.resources, want) < arrive) {
        throw refused("mateNoRoom", `${asker.username}'s storage is too full for it.`);
      }

      mine.resources = { ...(mine.resources ?? {}), [want]: held - amount };
      const intoMine = creditResources(mine, one(give, arrive));
      const intoTheirs = creditResources(theirs, one(want, arrive));
      mine.savetime = now;
      theirs.savetime = now;
      await tx.flush();

      try {
        const day = utcDay(now);
        const insert = `INSERT INTO bym.alliance_trade (alliance_id, from_userid, to_userid, request_id, sent, arrived, lost_full, day, created_at)
                        VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::date, ?)`;
        await tx.execute(insert, [
          taker.alliance_id, askerId, userid, requestId,
          JSON.stringify(one(give, amount)), JSON.stringify(nonZero(intoMine.credited)), JSON.stringify(nonZero(intoMine.overflow)),
          day, now,
        ]);
        await tx.execute(insert, [
          taker.alliance_id, userid, askerId, requestId,
          JSON.stringify(one(want, amount)), JSON.stringify(nonZero(intoTheirs.credited)), JSON.stringify(nonZero(intoTheirs.overflow)),
          day, now,
        ]);
      } catch (err) {
        if (isUniqueViolation(err)) throw refused("tradedToday", "One trade a day each.");
        throw err;
      }
      await tx.execute(
        `UPDATE bym.alliance_trade_request SET status = 'done', given_by = ?, closed_at = ? WHERE id = ?`,
        [userid, now, requestId]
      );

      const after = noAmounts();
      for (const key of RESOURCE_KEYS) after[key] = heldOf(mine.resources, key);
      return {
        allianceId: taker.alliance_id,
        asker: asker.username,
        give,
        want,
        arrive,
        result: {
          gave: one(want, amount),
          got: nonZero(intoMine.credited),
          resources: after,
          with: { userid: askerId, username: asker.username },
        },
      };
    })
  );

  void say(done.allianceId, userid, AllianceMessageType.TRADE_DONE, {
    with: done.asker,
    gave: one(done.want, done.arrive),
    got: one(done.give, done.arrive),
  });
  return done.result;
};

// ---------------------------------------------------------------------------
// Send: one direct trade
// ---------------------------------------------------------------------------

export interface TradeResult {
  /** What left the giver. */
  sent: Partial<Amounts>;
  /** What landed in the receiver's storage. */
  arrived: Partial<Amounts>;
  /** What arrived but had no room (lost). */
  lostFull: Partial<Amounts>;
  /** The giver's resources after. */
  resources: Amounts;
  to: { userid: number; username: string };
}

/**
 * `POST /alliance/trade/send`: a direct send; `sent` is what LEAVES. Both in
 * the same alliance; all the §12a rules; refusals as `progressRefusedErr`
 * (reason in `data.reason`).
 */
export const sendToMate = async (
  em: EntityManager,
  from: number,
  to: number,
  raw: Partial<Record<Key, number>>,
  now: number
): Promise<TradeResult> => {
  const sent = amountsOf(raw);
  if (from === to) throw refused("self", "You can't trade with yourself.", Status.BAD_REQUEST);
  if (!anyOf(sent)) throw refused("nothingSent", "Pick a resource and an amount.", Status.BAD_REQUEST);

  const done = await countAfterCommit(() =>
    em.transactional(async (tx) => {
      const members = await lockMembers(tx, [from, to]);
      const giver = members.get(from);
      const taker = members.get(to);
      if (!giver?.alliance_id) throw refused("notMember", "You are not in an alliance.", Status.FORBIDDEN);
      if (!taker || taker.alliance_id !== giver.alliance_id) throw refused("notMate", "They are not in your alliance.");
      if (!giver.basesaveid) throw notMainYardErr();
      if (!taker.basesaveid) throw refused("notMate", "They are not in your alliance.");

      if ((await usedToday(tx, from, now)).sent) throw refused("sentToday", "You already sent a trade today.");
      if ((await usedToday(tx, to, now)).received) throw refused("receivedToday", `${taker.username} already got a trade today.`);

      // Both main yards, locked in save order, refused while fought over, caught up.
      const order = [giver.basesaveid, taker.basesaveid].sort((a, b) => a - b);
      const locked = new Map<number, Save>();
      for (const id of order) {
        const save = await lockSave(tx, id);
        if (save) locked.set(id, save);
      }
      const mine = locked.get(giver.basesaveid);
      const theirs = locked.get(taker.basesaveid);
      if (!mine || mine.type !== BaseType.MAIN || mine.userid !== from) throw notMainYardErr();
      if (!theirs || theirs.type !== BaseType.MAIN || theirs.userid !== to) throw refused("notMate", "They are not in your alliance.");
      if (isAttackActive(mine)) throw yardUnderAttackErr();
      if (raidFighting(mine, now)) throw yardRaidInProgressErr();
      if (isAttackActive(theirs) || raidFighting(theirs, now)) {
        throw refused("mateUnderAttack", `${taker.username}'s yard is under attack. Try again later.`);
      }
      for (const save of [mine, theirs]) await catchUp(tx, save, now);

      const limit = carryCap(capOf(mine), capOf(theirs));
      for (const key of RESOURCE_KEYS) {
        if (sent[key] > limit) {
          throw refused("overCap", `One trade carries up to ${amountText(limit)} of each.`);
        }
        if (heldOf(mine.resources, key) < sent[key]) throw refused("notEnough", "You don't have that much.");
      }

      const resources = { ...(mine.resources ?? {}) };
      for (const key of RESOURCE_KEYS) {
        if (sent[key] > 0) resources[key] = heldOf(mine.resources, key) - sent[key];
      }
      mine.resources = resources;
      mine.savetime = now;

      const arriving = noAmounts();
      for (const key of RESOURCE_KEYS) arriving[key] = arriveFor(sent[key]);
      const { credited, overflow } = creditResources(theirs, arriving);
      theirs.savetime = now;
      await tx.flush();

      try {
        await tx.execute(
          `INSERT INTO bym.alliance_trade (alliance_id, from_userid, to_userid, request_id, sent, arrived, lost_full, day, created_at)
           VALUES (?, ?, ?, NULL, ?::jsonb, ?::jsonb, ?::jsonb, ?::date, ?)`,
          [
            giver.alliance_id,
            from,
            to,
            JSON.stringify(nonZero(sent)),
            JSON.stringify(nonZero(credited)),
            JSON.stringify(nonZero(overflow)),
            utcDay(now),
            now,
          ]
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw refused("sentToday", "One send and one receive a day.");
        throw err;
      }

      const after = noAmounts();
      for (const key of RESOURCE_KEYS) after[key] = heldOf(mine.resources, key);
      return {
        allianceId: giver.alliance_id,
        sent: nonZero(sent),
        arrived: nonZero(credited),
        lostFull: nonZero(overflow),
        resources: after,
        to: { userid: to, username: taker.username },
      };
    })
  );

  if (Object.keys(done.arrived).length > 0) {
    void say(done.allianceId, from, AllianceMessageType.TRADE_DONE, { to: done.to.username, arrived: done.arrived });
  }
  const { allianceId: _a, ...result } = done;
  return result;
};
