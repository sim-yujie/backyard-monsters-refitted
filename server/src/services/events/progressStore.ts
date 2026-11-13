import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import type { JsonObject } from "../../types/JsonObject.js";
import { noteEventPlayer } from "../stats/activity.js";

/**
 * A player's progress in each event: one `bym.event_progress` row per player
 * and event (migration `20261020_CreateEventProgressTable.ts`), made the
 * first time it is written. Raw SQL rather than an entity, as the friends
 * tables are, so a server that runs before the migration only fails here.
 *
 * Each write is one atomic statement whose condition is the rule, so a claim
 * can never land twice: two tabs, or a double click, race to the same row
 * and only one statement matches. The calendar and ladder claims run inside
 * a yard action, after the main yard's row lock; anything else that writes
 * here (the counter) must not lock the save afterwards in the same
 * transaction, or two requests could wait on each other.
 */

/** One player's progress in one event. A player with no row has {@link NO_PROGRESS}. */
export interface EventProgress {
  /** Calendar days claimed so far: the next claim is day `calendarDays + 1`. */
  readonly calendarDays: number;
  /** The UTC day (`YYYY-MM-DD`) of the last calendar claim, or null. */
  readonly calendarLast: string | null;
  /** The collection ladder's counter. */
  readonly counter: number;
  /** Ladder tiers claimed, by index. */
  readonly claimedTiers: readonly number[];
  /** Anything else an event needs to keep. */
  readonly data: JsonObject;
}

export const NO_PROGRESS: EventProgress = {
  calendarDays: 0,
  calendarLast: null,
  counter: 0,
  claimedTiers: [],
  data: {},
};

export interface EventProgressStore {
  /** Progress in each of `eventIds`; events with no row are left out. */
  read(em: EntityManager, userid: number, eventIds: readonly string[]): Promise<Map<string, EventProgress>>;
  /**
   * Records a calendar claim on UTC day `today`, unless one is recorded on
   * that day (or later) already or `total` days are claimed. Returns the day
   * number claimed (1-based), or null when refused.
   */
  claimCalendarDay(em: EntityManager, userid: number, eventId: string, today: string, total: number): Promise<number | null>;
  /**
   * Records ladder tier `tier` as claimed, if the counter has reached `need`
   * and it is not claimed yet. Returns whether it was recorded.
   */
  claimTier(em: EntityManager, userid: number, eventId: string, tier: number, need: number): Promise<boolean>;
  /**
   * Adds `amount` (a whole number, may be 0) to the counter; returns the new
   * count. The column is an `integer`, so the count stops at
   * {@link COUNTER_MAX} rather than fail the write that raised it.
   */
  addToCounter(em: EntityManager, userid: number, eventId: string, amount: number): Promise<number>;
  /**
   * Adds `amount` to the counter for the outpost `baseid` taken over, unless
   * that outpost has counted in this event already (`data.taken`, a list of
   * baseids). Returns the new count, or null when it had counted. The count
   * stops at {@link COUNTER_MAX} as {@link addToCounter}'s does.
   */
  addTakeover(em: EntityManager, userid: number, eventId: string, baseid: string, amount: number): Promise<number | null>;
  /**
   * Records the Krallen Hunt's penalty for `eventId` (`data.krallenPenalty`,
   * `krallenPenalty.ts`), not yet told, unless one is recorded already.
   * Returns whether it was recorded: a hunt's penalty lands once.
   */
  recordKrallenPenalty(em: EntityManager, userid: number, eventId: string, from: number, to: number): Promise<boolean>;
  /** Every Krallen penalty not yet told, marked told: each is told once. */
  takeKrallenNotices(em: EntityManager, userid: number): Promise<KrallenPenaltyNotice[]>;
}

/** A Krallen Hunt penalty for the yard's one-time notice: her level before and after (0: lost). */
export interface KrallenPenaltyNotice {
  readonly event: string;
  readonly from: number;
  readonly to: number;
}

/** Ids of the Krallen Hunts (`krallen-<year>-<mm>`), as the store's LIKE matches them. */
const KRALLEN_HUNT_LIKE = "krallen-%";

const noticeOf = (event: string, raw: unknown): KrallenPenaltyNotice | null => {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (value === null || typeof value !== "object") return null;
  const { from, to } = value as { from?: unknown; to?: unknown };
  return { event, from: Number(from) || 0, to: Number(to) || 0 };
};

/** The highest count the `integer` column holds. */
export const COUNTER_MAX = 2_147_483_647;

/** A whole amount to add, 0 to {@link COUNTER_MAX}. */
const addable = (amount: number): number => Math.min(COUNTER_MAX, Math.max(0, Math.floor(amount)) || 0);

interface ProgressRow {
  event_id: string;
  calendar_days: number | string;
  calendar_last: string | null;
  counter: number | string;
  claimed_tiers: unknown;
  data: unknown;
}

const tiersOf = (raw: unknown): number[] => {
  const list = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  return Array.isArray(list) ? list.map(Number).filter(Number.isInteger) : [];
};

const dataOf = (raw: unknown): JsonObject => {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
};

const progressOf = (row: ProgressRow): EventProgress => ({
  calendarDays: Number(row.calendar_days) || 0,
  calendarLast: row.calendar_last ?? null,
  counter: Number(row.counter) || 0,
  claimedTiers: tiersOf(row.claimed_tiers),
  data: dataOf(row.data),
});

/** The yard action hands over the core entity manager; the store needs its SQL. */
const sql = (em: EntityManager): SqlEntityManager => em as SqlEntityManager;

/** The store on `bym.event_progress`. */
export const sqlProgressStore: EventProgressStore = {
  async read(em, userid, eventIds) {
    if (eventIds.length === 0) return new Map();
    // The date as text: a `date` read back as a JS Date moves with the server's time zone.
    const rows = await sql(em).execute<ProgressRow[]>(
      `SELECT event_id, calendar_days, to_char(calendar_last, 'YYYY-MM-DD') AS calendar_last, counter, claimed_tiers, data
         FROM bym.event_progress
        WHERE userid = ? AND event_id IN (${eventIds.map(() => "?").join(", ")})`,
      [userid, ...eventIds]
    );
    return new Map(rows.map((row) => [row.event_id, progressOf(row)]));
  },

  async claimCalendarDay(em, userid, eventId, today, total) {
    if (total < 1) return null;
    const rows = await sql(em).execute<{ calendar_days: number | string }[]>(
      `INSERT INTO bym.event_progress AS p (userid, event_id, calendar_days, calendar_last)
       VALUES (?, ?, 1, ?::date)
       ON CONFLICT (userid, event_id) DO UPDATE
          SET calendar_days = p.calendar_days + 1, calendar_last = EXCLUDED.calendar_last, updated_at = now()
        WHERE (p.calendar_last IS NULL OR p.calendar_last < EXCLUDED.calendar_last)
          AND p.calendar_days < ?
       RETURNING calendar_days`,
      [userid, eventId, today, total]
    );
    if (rows.length === 0) return null;
    noteEventPlayer(eventId, userid);
    return Number(rows[0]!.calendar_days);
  },

  async claimTier(em, userid, eventId, tier, need) {
    const one = JSON.stringify([tier]);
    const rows = await sql(em).execute<{ userid: number }[]>(
      `UPDATE bym.event_progress
          SET claimed_tiers = claimed_tiers || ?::jsonb, updated_at = now()
        WHERE userid = ? AND event_id = ? AND counter >= ? AND NOT (claimed_tiers @> ?::jsonb)
       RETURNING userid`,
      [one, userid, eventId, need, one]
    );
    if (rows.length > 0) noteEventPlayer(eventId, userid);
    return rows.length > 0;
  },

  async addToCounter(em, userid, eventId, amount) {
    const add = addable(amount);
    const rows = await sql(em).execute<{ counter: number | string }[]>(
      `INSERT INTO bym.event_progress AS p (userid, event_id, counter)
       VALUES (?, ?, ?)
       ON CONFLICT (userid, event_id) DO UPDATE
          SET counter = LEAST(p.counter::bigint + EXCLUDED.counter, ?)::integer, updated_at = now()
       RETURNING counter`,
      [userid, eventId, add, COUNTER_MAX]
    );
    if (add > 0) noteEventPlayer(eventId, userid);
    return Number(rows[0]?.counter) || 0;
  },

  async addTakeover(em, userid, eventId, baseid, amount) {
    const add = addable(amount);
    const one = JSON.stringify([String(baseid)]);
    const rows = await sql(em).execute<{ counter: number | string }[]>(
      `INSERT INTO bym.event_progress AS p (userid, event_id, counter, data)
       VALUES (?, ?, ?, jsonb_build_object('taken', ?::jsonb))
       ON CONFLICT (userid, event_id) DO UPDATE
          SET counter = LEAST(p.counter::bigint + EXCLUDED.counter, ?)::integer,
              data = jsonb_set(p.data, '{taken}', COALESCE(p.data->'taken', '[]'::jsonb) || (EXCLUDED.data->'taken')),
              updated_at = now()
        WHERE NOT (COALESCE(p.data->'taken', '[]'::jsonb) @> (EXCLUDED.data->'taken'))
       RETURNING counter`,
      [userid, eventId, add, one, COUNTER_MAX]
    );
    if (rows.length === 0) return null;
    noteEventPlayer(eventId, userid);
    return Number(rows[0]!.counter) || 0;
  },

  async recordKrallenPenalty(em, userid, eventId, from, to) {
    const penalty = JSON.stringify({ from, to, told: false });
    // Not counted as taking part (`noteEventPlayer`): the hunt is over.
    const rows = await sql(em).execute<{ userid: number }[]>(
      `INSERT INTO bym.event_progress AS p (userid, event_id, data)
       VALUES (?, ?, jsonb_build_object('krallenPenalty', ?::jsonb))
       ON CONFLICT (userid, event_id) DO UPDATE
          SET data = p.data || EXCLUDED.data, updated_at = now()
        WHERE p.data->'krallenPenalty' IS NULL
       RETURNING userid`,
      [userid, eventId, penalty]
    );
    return rows.length > 0;
  },

  async takeKrallenNotices(em, userid) {
    const rows = await sql(em).execute<{ event_id: string; penalty: unknown }[]>(
      `UPDATE bym.event_progress
          SET data = jsonb_set(data, '{krallenPenalty,told}', 'true'::jsonb), updated_at = now()
        WHERE userid = ? AND event_id LIKE ? AND data->'krallenPenalty'->>'told' = 'false'
       RETURNING event_id, data->'krallenPenalty' AS penalty`,
      [userid, KRALLEN_HUNT_LIKE]
    );
    return rows
      .map((row) => noticeOf(row.event_id, row.penalty))
      .filter((one): one is KrallenPenaltyNotice => one !== null)
      .sort((a, b) => a.event.localeCompare(b.event));
  },
};

/**
 * The same rules on a Map, for tests and anything else without a database.
 * Single-threaded, so each call is atomic as the SQL statements are.
 */
export const memoryProgressStore = (): EventProgressStore & { rows: Map<string, EventProgress> } => {
  const rows = new Map<string, EventProgress>();
  const key = (userid: number, eventId: string) => `${userid}:${eventId}`;
  const get = (userid: number, eventId: string) => rows.get(key(userid, eventId)) ?? NO_PROGRESS;
  return {
    rows,
    async read(_em, userid, eventIds) {
      const found = new Map<string, EventProgress>();
      for (const id of eventIds) {
        const row = rows.get(key(userid, id));
        if (row) found.set(id, row);
      }
      return found;
    },
    async claimCalendarDay(_em, userid, eventId, today, total) {
      const now = get(userid, eventId);
      if (total < 1 || now.calendarDays >= total) return null;
      if (now.calendarLast !== null && now.calendarLast >= today) return null;
      const next = { ...now, calendarDays: now.calendarDays + 1, calendarLast: today };
      rows.set(key(userid, eventId), next);
      return next.calendarDays;
    },
    async claimTier(_em, userid, eventId, tier, need) {
      const now = rows.get(key(userid, eventId));
      if (!now || now.counter < need || now.claimedTiers.includes(tier)) return false;
      rows.set(key(userid, eventId), { ...now, claimedTiers: [...now.claimedTiers, tier] });
      return true;
    },
    async addToCounter(_em, userid, eventId, amount) {
      const now = get(userid, eventId);
      const next = { ...now, counter: Math.min(COUNTER_MAX, now.counter + addable(amount)) };
      rows.set(key(userid, eventId), next);
      return next.counter;
    },
    async addTakeover(_em, userid, eventId, baseid, amount) {
      const now = get(userid, eventId);
      const taken = Array.isArray(now.data.taken) ? now.data.taken.map(String) : [];
      if (taken.includes(String(baseid))) return null;
      const next = {
        ...now,
        counter: Math.min(COUNTER_MAX, now.counter + addable(amount)),
        data: { ...now.data, taken: [...taken, String(baseid)] },
      };
      rows.set(key(userid, eventId), next);
      return next.counter;
    },
    async recordKrallenPenalty(_em, userid, eventId, from, to) {
      const now = get(userid, eventId);
      if (now.data.krallenPenalty !== undefined) return false;
      rows.set(key(userid, eventId), { ...now, data: { ...now.data, krallenPenalty: { from, to, told: false } } });
      return true;
    },
    async takeKrallenNotices(_em, userid) {
      const told: KrallenPenaltyNotice[] = [];
      for (const [id, row] of rows) {
        const cut = id.indexOf(":");
        const eventId = id.slice(cut + 1);
        const penalty = row.data.krallenPenalty as { from?: unknown; to?: unknown; told?: unknown } | undefined;
        if (id.slice(0, cut) !== String(userid) || !eventId.startsWith("krallen-") || penalty?.told !== false) continue;
        rows.set(id, { ...row, data: { ...row.data, krallenPenalty: { ...penalty, told: true } } });
        told.push(noticeOf(eventId, penalty)!);
      }
      return told.sort((a, b) => a.event.localeCompare(b.event));
    },
  };
};
