import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";

import {
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
import { builtEvents, recordAchievements } from "../achievements/record.js";
import { RESOURCE_KEYS, noAmounts, storageCap, type StorageCapSave } from "../base/economy/resourceBudget.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { raidFighting } from "../raids/raidLock.js";
import { capOf, creditResources } from "../yard/credit.js";
import { notMainYardErr, yardRaidInProgressErr, yardUnderAttackErr } from "../yard/yardErrors.js";
import type { ResourceAmounts } from "../yardplanner/costs.js";
import { countAfterCommit, progressRefusedErr, say, utcDay } from "./allianceProgress.js";
import { isTradeChoice, parseTradeFor, tradeChoicesOf, tradeForText, type TradeChoices, type TradeFor } from "./tradeFor.js";

/**
 * Trading between alliance members (beta 7, design v5 §12a, §12b).
 *
 * - **Ask**: a member posts what a mate should GIVE (one or more of Twigs,
 *   Pebbles, Putty, Goo; they get 10% less), optionally what for: a building's
 *   next level or one of their monsters (`tradeFor.ts`). Open 24 hours, one
 *   open per player, only while their receive of the day is unused, each
 *   amount within the most one trade carries and what fits their free room
 *   after the 10%. A line goes to the alliance chat with Give.
 * - **Give**: one mate fills a request 1:1: exactly what was asked leaves,
 *   10% is lost on the way (owner, 10 Nov 2026: no all / half / other). A
 *   giver short of it, or past the carry cap, is refused. The request closes,
 *   as it used the asker's one receive.
 * - **Send**: a direct send to a mate, no request.
 *
 * Every trade: one send and one receive per player per UTC day (the count is
 * the player's, kept across alliances; unique indexes hold it), 10% lost on
 * the way, at most 10% of the smaller storage cap leaves per resource, and
 * whatever the receiver has no room for is lost (as loot past a full silo).
 * Shiny cannot be sent. Both main yards are locked and caught up first; a
 * yard under attack or being raided is refused, as the yard actions are.
 * Amounts are whole numbers.
 */

type Amounts = ResourceAmounts;
type Key = (typeof RESOURCE_KEYS)[number];

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
 * The most a member can ask for (what a mate gives), per resource: what one
 * trade carries, and what still fits their free room after the 10%.
 */
export const askCapOf = (cap: number, held: number): number =>
  Math.max(0, Math.min(fitSent(cap - held), carryCap(cap, cap)));

/** Seconds to the next UTC midnight. */
export const newDayIn = (now: number): number => 86_400 - (now % 86_400);

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

const parseJson = <T>(raw: unknown): T => ((typeof raw === "string" ? JSON.parse(raw) : raw) ?? {}) as T;

const refused = (reason: string, message: string, status = Status.CONFLICT) => progressRefusedErr(reason, message, status);

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

/** Whether the player has sent / received a trade this UTC day. */
const usedToday = async (em: EntityManager, userid: number, now: number) => {
  const [row] = await em.execute<{ sent: number | string; received: number | string }[]>(
    `SELECT count(*) FILTER (WHERE from_userid = ?) AS sent, count(*) FILTER (WHERE to_userid = ?) AS received
       FROM bym.alliance_trade WHERE day = ?::date AND (from_userid = ? OR to_userid = ?)`,
    [userid, userid, utcDay(now), userid, userid]
  );
  return { sent: Number(row?.sent ?? 0) > 0, received: Number(row?.received ?? 0) > 0 };
};

/** Closes the player's open requests that ran out or belong to an alliance they left. */
const expireStale = async (em: EntityManager, userid: number, allianceId: number | null, now: number) =>
  em.execute(
    `UPDATE bym.alliance_trade_request SET status = 'expired', closed_at = ?
      WHERE userid = ? AND status = 'open' AND (expires_at <= ? OR alliance_id IS DISTINCT FROM ?)`,
    [now, userid, now, allianceId]
  );

const isUniqueViolation = (err: unknown) => String((err as { code?: string })?.code) === "23505" || /unique/i.test(String(err));

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
  /** What a mate gives (the asker gets 10% less). */
  amounts: Partial<Amounts>;
  /** What for: a building's next level or a monster; null for none. */
  for: TradeFor | null;
  created_at: number;
  expires_at: number;
  status: "open" | "given";
  given_by: string | null;
  /** The asker's storage, for the Give sheet's bars (open requests only). */
  storage: StorageView | null;
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

/** What the player's main yard can ask for (`tradeFor.ts`). */
const readChoices = async (em: EntityManager, userid: number): Promise<TradeChoices> => {
  const [row] = await em.execute<{ buildingdata: unknown; lockerdata: unknown }[]>(
    `SELECT s.buildingdata, s.lockerdata FROM bym."user" u JOIN bym.save s ON s.basesaveid = u.save_basesaveid WHERE u.userid = ?`,
    [userid]
  );
  return row
    ? tradeChoicesOf({ buildingdata: parseJson(row.buildingdata), lockerdata: parseJson(row.lockerdata) })
    : { buildings: [], monsters: [] };
};

/**
 * `GET /alliance/trade[?to=]`: the Trade tab. Today's sends / receives left,
 * the caller's open request, mates' open requests (and those given today,
 * greyed), the last 2 trades, the caller's storage, and with `to` that mate's
 * storage for the Send sheet.
 */
export const tradeView = async (em: EntityManager, userid: number, now: number, to?: number) => {
  const [me] = await em.execute<{ alliance_id: number | null }[]>(`SELECT alliance_id FROM bym."user" WHERE userid = ?`, [userid]);
  const allianceId = me?.alliance_id ? Number(me.alliance_id) : null;
  if (!allianceId) throw refused("notMember", "You are not in an alliance.", Status.FORBIDDEN);
  await expireStale(em, userid, allianceId, now);

  const dayStart = now - (now % 86_400);
  const rows = await em.execute<
    {
      id: number;
      userid: number;
      username: string;
      alliance_role: string | null;
      amounts: unknown;
      reason: string | null;
      created_at: number;
      expires_at: number;
      status: string;
      giver: string | null;
    }[]
  >(
    `SELECT r.id, r.userid, u.username, u.alliance_role, r.amounts, r.reason, r.created_at, r.expires_at, r.status, g.username AS giver
       FROM bym.alliance_trade_request r
       JOIN bym."user" u ON u.userid = r.userid AND u.alliance_id = r.alliance_id
       LEFT JOIN bym."user" g ON g.userid = r.given_by
      WHERE r.alliance_id = ?
        AND ((r.status = 'open' AND r.expires_at > ?) OR (r.status = 'given' AND r.closed_at >= ?))
      ORDER BY (r.status = 'open') DESC, r.created_at DESC
      LIMIT 50`,
    [allianceId, now, dayStart]
  );
  const askers = rows.filter((row) => row.status === "open").map((row) => Number(row.userid));
  const storage = await readStorage(em, [...new Set([userid, ...askers, ...(to ? [to] : [])])]);

  const requests: TradeRequestView[] = rows.map((row) => ({
    id: Number(row.id),
    userid: Number(row.userid),
    username: row.username,
    role: row.alliance_role,
    amounts: nonZero(amountsOf(parseJson(row.amounts))),
    for: parseTradeFor(row.reason),
    created_at: Number(row.created_at),
    expires_at: Number(row.expires_at),
    status: row.status === "open" ? "open" : "given",
    given_by: row.giver,
    storage: row.status === "open" ? (storage.get(Number(row.userid)) ?? null) : null,
  }));
  const mine = requests.find((row) => row.userid === userid && row.status === "open") ?? null;

  const recent = await em.execute<{ from_name: string; to_name: string; arrived: unknown; created_at: number }[]>(
    `SELECT f.username AS from_name, t.username AS to_name, tr.arrived, tr.created_at
       FROM bym.alliance_trade tr
       JOIN bym."user" f ON f.userid = tr.from_userid
       JOIN bym."user" t ON t.userid = tr.to_userid
      WHERE tr.alliance_id = ? ORDER BY tr.created_at DESC LIMIT 2`,
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
  const [asks] = await em.execute<{ n: number | string }[]>(
    `SELECT count(*) AS n FROM bym.alliance_trade_request WHERE userid = ? AND created_at >= ?`,
    [userid, dayStart]
  );
  return {
    error: 0,
    today: {
      sendsLeft: used.sent ? 0 : 1,
      receivesLeft: used.received ? 0 : 1,
      asksLeft: Math.max(0, TRADE_ASKS_PER_DAY - Number(asks?.n ?? 0)),
      newDayIn: newDayIn(now),
    },
    rules: { loss: TRADE_LOSS, capShare: TRADE_CAP_SHARE, requestSeconds: TRADE_REQUEST_SECONDS },
    me: storage.get(userid) ?? null,
    /** What the caller can pick on Ask's "For". */
    choices: await readChoices(em, userid),
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
// Ask and cancel
// ---------------------------------------------------------------------------

/** `POST /alliance/trade/ask`: posts a request (what a mate gives; `forText` = what for, `tradeFor.ts`). */
export const askForResources = async (
  em: EntityManager,
  userid: number,
  wanted: Partial<Record<Key, number>>,
  forText: string | null,
  now: number
) => {
  const amounts = amountsOf(wanted);
  if (!anyOf(amounts)) throw refused("nothingAsked", "Pick a resource and an amount.", Status.BAD_REQUEST);
  const forWhat = forText ? parseTradeFor(forText) : null;
  if (forText && !forWhat) throw refused("badFor", "Pick a building or monster of yours.", Status.BAD_REQUEST);
  const reason = forWhat ? tradeForText(forWhat) : null;

  const posted = await em.transactional(async (tx) => {
    const members = await lockMembers(tx, [userid]);
    const me = members.get(userid);
    if (!me?.alliance_id) throw refused("notMember", "You are not in an alliance.", Status.FORBIDDEN);
    if (!me.basesaveid) throw notMainYardErr();
    await expireStale(tx, userid, me.alliance_id, now);

    if ((await usedToday(tx, userid, now)).received) throw refused("receivedToday", "You already got a trade today.");
    const dayStart = now - (now % 86_400);
    const [asks] = await tx.execute<{ n: number | string }[]>(
      `SELECT count(*) AS n FROM bym.alliance_trade_request WHERE userid = ? AND created_at >= ?`,
      [userid, dayStart]
    );
    if (Number(asks?.n ?? 0) >= TRADE_ASKS_PER_DAY) throw refused("asksToday", `Up to ${TRADE_ASKS_PER_DAY} requests a day.`);

    const storage = (await readStorage(tx, [userid])).get(userid);
    if (!storage) throw notMainYardErr();
    if (forWhat && !isTradeChoice(forWhat, await readChoices(tx, userid))) {
      throw refused("badFor", "Pick a building or monster of yours.", Status.BAD_REQUEST);
    }
    for (const key of RESOURCE_KEYS) {
      const most = askCapOf(storage.cap, storage.held[key]);
      if (amounts[key] > most) {
        throw refused("overRoom", `You can ask for up to ${most.toLocaleString("en-US")} of that.`, Status.CONFLICT);
      }
    }

    try {
      const [row] = await tx.execute<{ id: number }[]>(
        `INSERT INTO bym.alliance_trade_request (alliance_id, userid, amounts, reason, status, created_at, expires_at)
         VALUES (?, ?, ?::jsonb, ?, 'open', ?, ?) RETURNING id`,
        [me.alliance_id, userid, JSON.stringify(nonZero(amounts)), reason, now, now + TRADE_REQUEST_SECONDS]
      );
      return { id: Number(row.id), allianceId: me.alliance_id };
    } catch (err) {
      if (isUniqueViolation(err)) throw refused("requestOpen", "You already have a request up.");
      throw err;
    }
  });

  void say(posted.allianceId, userid, AllianceMessageType.TRADE_ASK, {
    request: posted.id,
    amounts: nonZero(amounts),
    for: reason,
  });
  return { id: posted.id, amounts: nonZero(amounts), for: forWhat, expires_at: now + TRADE_REQUEST_SECONDS };
};

/** `POST /alliance/trade/cancel`: takes the caller's open request down. */
export const cancelRequest = async (em: EntityManager, userid: number, now: number) => {
  const rows = await em.execute<{ id: number }[]>(
    `UPDATE bym.alliance_trade_request SET status = 'cancelled', closed_at = ? WHERE userid = ? AND status = 'open' RETURNING id`,
    [now, userid]
  );
  return { cancelled: rows.length };
};

// ---------------------------------------------------------------------------
// Give and send: one trade
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
 * Moves `sent` (what leaves) from `from` to `to`, both in the same alliance,
 * filling `requestId` when given. All the §12a rules; refusals as
 * `progressRefusedErr` (reason in `data.reason`).
 */
const trade = async (
  em: EntityManager,
  from: number,
  to: number,
  sent: Amounts,
  requestId: number | null,
  now: number
): Promise<TradeResult & { allianceId: number; giverName: string }> => {
  if (from === to) throw refused("self", "You can't trade with yourself.", Status.BAD_REQUEST);
  if (!anyOf(sent)) throw refused("nothingSent", "Pick a resource and an amount.", Status.BAD_REQUEST);

  return countAfterCommit(() =>
    em.transactional(async (tx) => {
      const members = await lockMembers(tx, [from, to]);
      const giver = members.get(from);
      const taker = members.get(to);
      if (!giver?.alliance_id) throw refused("notMember", "You are not in an alliance.", Status.FORBIDDEN);
      if (!taker || taker.alliance_id !== giver.alliance_id) throw refused("notMate", "They are not in your alliance.");
      if (!giver.basesaveid) throw notMainYardErr();
      if (!taker.basesaveid) throw refused("notMate", "They are not in your alliance.");

      if (requestId !== null) {
        const [request] = await tx.execute<{ userid: number; alliance_id: number; status: string; expires_at: number }[]>(
          `SELECT userid, alliance_id, status, expires_at FROM bym.alliance_trade_request WHERE id = ? FOR UPDATE`,
          [requestId]
        );
        if (
          !request ||
          request.status !== "open" ||
          Number(request.expires_at) <= now ||
          Number(request.userid) !== to ||
          Number(request.alliance_id) !== giver.alliance_id
        ) {
          throw refused("requestGone", "That request is no longer open.");
        }
      }

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
      for (const save of [mine, theirs]) {
        const completed = await catchUpLockedRow(tx, save, now);
        await recordAchievements(tx, save, now, builtEvents(completed));
      }

      const limit = carryCap(capOf(mine), capOf(theirs));
      for (const key of RESOURCE_KEYS) {
        if (sent[key] > limit) {
          throw refused("overCap", `One trade carries up to ${limit.toLocaleString("en-US")} of each.`);
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
           VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::date, ?)`,
          [
            giver.alliance_id,
            from,
            to,
            requestId,
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

      // The receive of the day is used: the request it filled is given, any other one of theirs closes.
      await tx.execute(
        `UPDATE bym.alliance_trade_request
            SET status = CASE WHEN id = ? THEN 'given' ELSE 'superseded' END, given_by = CASE WHEN id = ? THEN ? END, closed_at = ?
          WHERE userid = ? AND status = 'open'`,
        [requestId ?? 0, requestId ?? 0, from, now, to]
      );

      const after = noAmounts();
      for (const key of RESOURCE_KEYS) after[key] = heldOf(mine.resources, key);
      return {
        allianceId: giver.alliance_id,
        giverName: giver.username,
        sent: nonZero(sent),
        arrived: nonZero(credited),
        lostFull: nonZero(overflow),
        resources: after,
        to: { userid: to, username: taker.username },
      };
    })
  );
};

const announce = (done: { allianceId: number; to: { username: string }; arrived: Partial<Amounts> }, from: number) => {
  if (Object.keys(done.arrived).length === 0) return;
  void say(done.allianceId, from, AllianceMessageType.TRADE_DONE, { to: done.to.username, arrived: done.arrived });
};

/**
 * `POST /alliance/trade/give`: fills a mate's request 1:1. Exactly what they
 * asked leaves the giver; they get it less 10% (and less what their storage
 * has no room for). No other amount (owner, 10 Nov 2026).
 */
export const giveToRequest = async (em: EntityManager, userid: number, requestId: number, now: number): Promise<TradeResult> => {
  const [request] = await em.execute<{ userid: number; amounts: unknown; status: string }[]>(
    `SELECT userid, amounts, status FROM bym.alliance_trade_request WHERE id = ?`,
    [requestId]
  );
  if (!request || request.status !== "open") throw refused("requestGone", "That request is no longer open.");
  const asked = amountsOf(parseJson(request.amounts));
  const done = await trade(em, userid, Number(request.userid), asked, requestId, now);
  announce(done, userid);
  const { allianceId: _a, giverName: _g, ...result } = done;
  return result;
};

/** `POST /alliance/trade/send`: a direct send; `sent` is what LEAVES. */
export const sendToMate = async (
  em: EntityManager,
  userid: number,
  to: number,
  sent: Partial<Record<Key, number>>,
  now: number
): Promise<TradeResult> => {
  const done = await trade(em, userid, to, amountsOf(sent), null, now);
  announce(done, userid);
  const { allianceId: _a, giverName: _g, ...result } = done;
  return result;
};
