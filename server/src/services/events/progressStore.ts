import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import type { JsonObject } from "../../types/JsonObject.js";

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
}

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
    return rows.length > 0 ? Number(rows[0]!.calendar_days) : null;
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
    return Number(rows[0]?.counter) || 0;
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
  };
};
