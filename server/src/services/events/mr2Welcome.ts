import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { MapRoomVersion } from "../../enums/MapRoom.js";
import { logger } from "../../utils/logger.js";
import { nextUtcMidnight, utcDay } from "./schedule.js";

/**
 * "New to Map Room 2", the Frontier Pass (owner, 9 Nov 2026, beta 7; seven
 * sets, owner 11 Nov): each player gets {@link MR2_WELCOME_DAYS} days, once
 * ever, with {@link MR2_WELCOME_SETS} sets of two rewards:
 *
 * - a wild monster camp takeover at 10% of its full base price in resources
 *   (no next-to-yard half or Conquest on top; the Shiny price is the normal
 *   one): `takeoverCost.ts` `quoteTakeover`;
 * - a free Regular Starter Kit on any outpost, built as the resource path
 *   builds (prefabs, no worker): `services/yard/starterKit.ts`.
 *
 * **One set a day.** At most one cheap takeover and one free kit a day, the
 * day being the game's daily reset (UTC midnight, `schedule.ts` `utcDay`, as
 * the daily login calendar and the daily quests). The two count apart: a day
 * the kit was used still has its takeover. Days not played lose nothing: any
 * 7 of the 10 days will do (3 spare). The pass is done once 7 of each are
 * used or the 10 days are over.
 *
 * **When the days start.** A player who joins Map Room 2 after this ships
 * starts on joining ({@link recordMr2Join}, from `setMapVersion` and
 * `joinMapRoom2`). A player already on Map Room 2 when it ships has no row,
 * so the first read for them writes one starting at the launch time: the
 * first time any server with this feature started, kept once in
 * `bym.game_setting` under {@link LAUNCH_SETTING_KEY} ({@link launchTime}).
 *
 * **Where it is kept.** One `bym.event_progress` row (`userid`,
 * `event_id = 'mr2-welcome'`), its `data` holding `start` (unix seconds) and,
 * per reward, the uses (`takeoverUses`, `kitUses`: when each was used, unix
 * seconds, null where not known; their count is the number used) and the
 * day of the last use (`takeoverDay`, `kitDay`, `YYYY-MM-DD` UTC). Each use is
 * one conditional UPDATE (fewer than 7 used, none today, inside the days), so
 * no use can be taken twice. Rows from the one-set pass (`takeoverUsed`,
 * `kitUsed`, `takeoverAt`, `kitAt`) are turned into this shape by migration
 * `20261116_Mr2WelcomeSevenSets.ts`, a used reward counting as 1 of 7; until
 * then they read the same way.
 *
 * Only a takeover paid in resources at the cheap price uses the day's
 * takeover. Paying Shiny is the usual price, so it does not count: the cheap
 * takeover stays ready (owner, 11 Nov: "Paying shiny should not count as it
 * is not discounted").
 */

export const MR2_WELCOME_EVENT_ID = "mr2-welcome";

/** The pass's length in days (owner, 11 Nov 2026: 10 days for 7 sets). */
export const MR2_WELCOME_DAYS = 10;

/** How many of each reward the pass gives, one of each a day at most. */
export const MR2_WELCOME_SETS = 7;

const DAY = 86_400;

export const MR2_WELCOME_SECONDS = MR2_WELCOME_DAYS * DAY;

/** `bym.game_setting` key of the launch time (unix seconds). */
export const LAUNCH_SETTING_KEY = "mr2_welcome_launch";

/** The cheap takeover's share of the camp's full base price. */
export const CHEAP_TAKEOVER_SHARE = 0.1;

/** One player's window. */
export interface WelcomeState {
  /** Unix seconds. */
  readonly start: number;
  /** When each cheap takeover was used (unix seconds; null where not known). */
  readonly takeoverUses: readonly (number | null)[];
  /** When each free kit was used (unix seconds; null where not known). */
  readonly kitUses: readonly (number | null)[];
  /** The UTC day (`YYYY-MM-DD`) the takeover was last used, if known. */
  readonly takeoverDay?: string | null;
  /** The UTC day (`YYYY-MM-DD`) the kit was last used, if known. */
  readonly kitDay?: string | null;
}

export type WelcomeReward = "takeover" | "kit";

/** What the client is told (`GET /bm/events` `mr2Welcome`). */
export interface WelcomeStatus {
  /** Unix seconds. */
  startsAt: number;
  endsAt: number;
  /** Whole days left, rounded up: 10 on the first day, 1 on the last. */
  daysLeft: number;
  /** How many of each reward the pass gives ({@link MR2_WELCOME_SETS}). */
  sets: number;
  /** The cheap takeover can be used now. */
  takeover: boolean;
  /** The free Regular kit can be used now. */
  kit: boolean;
  /** Cheap takeovers left of `sets`. */
  takeoverLeft: number;
  /** Free kits left of `sets`. */
  kitLeft: number;
  /** Today's takeover is used (it is back at `nextDayAt` if any are left). */
  takeoverToday: boolean;
  /** Today's kit is used (it is back at `nextDayAt` if any are left). */
  kitToday: boolean;
  /** The next daily reset (unix seconds, UTC midnight). */
  nextDayAt: number;
  /** When each takeover was used (unix seconds), where known. */
  takeoverUses: number[];
  /** When each kit was used (unix seconds), where known. */
  kitUses: number[];
}

/** Whether the window runs at `now`. */
export const welcomeOpen = (state: WelcomeState | null, now: number): state is WelcomeState =>
  state !== null && now >= state.start && now < state.start + MR2_WELCOME_SECONDS;

const usesOf = (state: WelcomeState, reward: WelcomeReward) =>
  reward === "takeover" ? state.takeoverUses : state.kitUses;

/** How many of `reward` are left of {@link MR2_WELCOME_SETS}. */
export const welcomeLeft = (state: WelcomeState, reward: WelcomeReward): number =>
  Math.max(0, MR2_WELCOME_SETS - usesOf(state, reward).length);

/** Whether `reward` was used on the day (daily reset) `now` falls in. */
export const welcomeUsedToday = (state: WelcomeState, reward: WelcomeReward, now: number): boolean => {
  const day = (reward === "takeover" ? state.takeoverDay : state.kitDay) ?? null;
  return day !== null && day >= utcDay(now);
};

/** Whether `reward` can be used at `now`: inside the days, some left, none used today. */
export const welcomeReady = (state: WelcomeState | null, reward: WelcomeReward, now: number): boolean =>
  welcomeOpen(state, now) && welcomeLeft(state, reward) > 0 && !welcomeUsedToday(state, reward, now);

const known = (uses: readonly (number | null)[]): number[] => uses.filter((at): at is number => at !== null);

/**
 * The card's status: null only when the window is not running. The card stays
 * on the Events page for all the days, rewards used or not (owner, 9 Nov
 * 2026: it left once both were used).
 */
export const welcomeStatus = (state: WelcomeState | null, now: number): WelcomeStatus | null => {
  if (!welcomeOpen(state, now)) return null;
  const endsAt = state.start + MR2_WELCOME_SECONDS;
  return {
    startsAt: state.start,
    endsAt,
    daysLeft: Math.max(1, Math.ceil((endsAt - now) / DAY)),
    sets: MR2_WELCOME_SETS,
    takeover: welcomeReady(state, "takeover", now),
    kit: welcomeReady(state, "kit", now),
    takeoverLeft: welcomeLeft(state, "takeover"),
    kitLeft: welcomeLeft(state, "kit"),
    takeoverToday: welcomeUsedToday(state, "takeover", now),
    kitToday: welcomeUsedToday(state, "kit", now),
    nextDayAt: nextUtcMidnight(now),
    takeoverUses: known(state.takeoverUses),
    kitUses: known(state.kitUses),
  };
};

/** The cheap price of each resource: 10% of the camp's full base price. */
export const cheapTakeoverPrice = (fullBase: number): number => Math.round(fullBase * CHEAP_TAKEOVER_SHARE);

/** Whether a main save is on Map Room 2. */
export const onMapRoom2 = (save: { mr2upgraded?: boolean | null; mapversion?: number | null } | null | undefined) =>
  !!save && (!!save.mr2upgraded || save.mapversion === MapRoomVersion.V2);

export interface WelcomeStore {
  /** The player's row, or null. */
  read(em: EntityManager, userid: number): Promise<WelcomeState | null>;
  /** Writes a row starting at `start` unless the player has one (once ever). */
  start(em: EntityManager, userid: number, start: number): Promise<void>;
  /** Marks `reward` used if it is ready at `now`; returns whether it was. */
  claim(em: EntityManager, userid: number, reward: WelcomeReward, now: number): Promise<boolean>;
  /** The launch time, written as `now` the first time it is asked for. */
  launchTime(em: EntityManager, now: number): Promise<number>;
}

const sql = (em: EntityManager): SqlEntityManager => em as SqlEntityManager;

const secondsOrNull = (value: unknown): number | null => {
  const seconds = Number(value);
  return value !== undefined && value !== null && Number.isFinite(seconds) ? seconds : null;
};

/**
 * One reward's uses and last day from a row: the seven-set shape, or a
 * one-set row not yet migrated (used = 1 of 7, on the day it was used).
 */
const usesFrom = (record: Record<string, unknown>, reward: WelcomeReward) => {
  const list = record[`${reward}Uses`];
  if (Array.isArray(list)) {
    const day = record[`${reward}Day`];
    return { uses: list.map(secondsOrNull), day: typeof day === "string" ? day : null };
  }
  if (record[`${reward}Used`] !== true) return { uses: [], day: null };
  const at = secondsOrNull(record[`${reward}At`]);
  return { uses: [at], day: at === null ? null : utcDay(at) };
};

const stateOf = (raw: unknown): WelcomeState | null => {
  const data = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (data === null || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const start = Number(record.start);
  if (!Number.isFinite(start)) return null;
  const takeover = usesFrom(record, "takeover");
  const kit = usesFrom(record, "kit");
  return { start, takeoverUses: takeover.uses, kitUses: kit.uses, takeoverDay: takeover.day, kitDay: kit.day };
};

/** SQL for one reward's uses (a JSON array), a not yet migrated one-set row read as in {@link usesFrom}. */
const usesSql = (reward: WelcomeReward): string =>
  `COALESCE(data->'${reward}Uses', CASE WHEN COALESCE((data->>'${reward}Used')::boolean, false)
     THEN jsonb_build_array(data->'${reward}At') ELSE '[]'::jsonb END)`;

/** SQL for one reward's last day (`YYYY-MM-DD`, '' when none), read as in {@link usesFrom}. */
const daySql = (reward: WelcomeReward): string =>
  `COALESCE(data->>'${reward}Day', CASE WHEN COALESCE((data->>'${reward}Used')::boolean, false) AND data->>'${reward}At' IS NOT NULL
     THEN to_char(to_timestamp((data->>'${reward}At')::bigint) AT TIME ZONE 'UTC', 'YYYY-MM-DD') END, '')`;

let cachedLaunch: number | null = null;

/** Forgets the cached launch time (tests). */
export const forgetLaunchTime = (): void => {
  cachedLaunch = null;
};

/** The store on `bym.event_progress` and `bym.game_setting`. */
export const sqlWelcomeStore: WelcomeStore = {
  async read(em, userid) {
    const [row] = await sql(em).execute<{ data: unknown }[]>(
      `SELECT data FROM bym.event_progress WHERE userid = ? AND event_id = ?`,
      [userid, MR2_WELCOME_EVENT_ID]
    );
    return row ? stateOf(row.data) : null;
  },

  async start(em, userid, start) {
    await sql(em).execute(
      `INSERT INTO bym.event_progress (userid, event_id, data)
       VALUES (?, ?, jsonb_build_object('start', ?::bigint, 'takeoverUses', '[]'::jsonb, 'kitUses', '[]'::jsonb))
       ON CONFLICT (userid, event_id) DO NOTHING`,
      [userid, MR2_WELCOME_EVENT_ID, Math.floor(start)]
    );
  },

  // One conditional UPDATE: inside the days, fewer than 7 used, none today.
  // Two claims at once both wait on the row, and the second sees the first's
  // use (Postgres re-checks the WHERE on the updated row), so it fails.
  async claim(em, userid, reward, now) {
    const at = Math.floor(now);
    const today = utcDay(now);
    const rows = await sql(em).execute<{ userid: number }[]>(
      `UPDATE bym.event_progress
          SET data = (data - '${reward}Used' - '${reward}At')
                     || jsonb_build_object('${reward}Uses', ${usesSql(reward)} || to_jsonb(?::bigint), '${reward}Day', ?::text),
              updated_at = now()
        WHERE userid = ? AND event_id = ?
          AND jsonb_array_length(${usesSql(reward)}) < ?
          AND ${daySql(reward)} < ?
          AND (data->>'start')::bigint <= ?
          AND (data->>'start')::bigint + ? > ?
       RETURNING userid`,
      [at, today, userid, MR2_WELCOME_EVENT_ID, MR2_WELCOME_SETS, today, now, MR2_WELCOME_SECONDS, now]
    );
    return rows.length > 0;
  },


  async launchTime(em, now) {
    if (cachedLaunch !== null) return cachedLaunch;
    await sql(em).execute(
      `INSERT INTO bym.game_setting (key, value, updated_at) VALUES (?, to_jsonb(?::bigint), now())
       ON CONFLICT (key) DO NOTHING`,
      [LAUNCH_SETTING_KEY, Math.floor(now)]
    );
    const [row] = await sql(em).execute<{ value: unknown }[]>(
      `SELECT value FROM bym.game_setting WHERE key = ?`,
      [LAUNCH_SETTING_KEY]
    );
    const value = Number(typeof row?.value === "string" ? JSON.parse(row.value) : row?.value);
    if (!Number.isFinite(value)) return Math.floor(now);
    cachedLaunch = value;
    return value;
  },
};

/** A pass starting at `start` with nothing used. */
export const newWelcome = (start: number): WelcomeState => ({ start, takeoverUses: [], kitUses: [] });

/** The same rules on Maps, for tests. */
export const memoryWelcomeStore = (
  launch: number | null = null
): WelcomeStore & { rows: Map<number, WelcomeState>; launch: number | null } => {
  const store = {
    rows: new Map<number, WelcomeState>(),
    launch,
    async read(_em: EntityManager, userid: number) {
      return store.rows.get(userid) ?? null;
    },
    async start(_em: EntityManager, userid: number, start: number) {
      if (!store.rows.has(userid)) store.rows.set(userid, newWelcome(Math.floor(start)));
    },
    async claim(_em: EntityManager, userid: number, reward: WelcomeReward, now: number) {
      const state = store.rows.get(userid) ?? null;
      if (!welcomeReady(state, reward, now) || !state) return false;
      const at = Math.floor(now);
      const today = utcDay(now);
      store.rows.set(userid, {
        ...state,
        ...(reward === "takeover"
          ? { takeoverUses: [...state.takeoverUses, at], takeoverDay: today }
          : { kitUses: [...state.kitUses, at], kitDay: today }),
      });
      return true;
    },
    async launchTime(_em: EntityManager, now: number) {
      if (store.launch === null) store.launch = Math.floor(now);
      return store.launch;
    },
  };
  return store;
};

let current: WelcomeStore = sqlWelcomeStore;

/** The store the game uses; tests swap it ({@link useWelcomeStore}). */
export const welcomeStore = (): WelcomeStore => current;

/** Swaps the store (tests); returns the one it replaced. */
export const useWelcomeStore = (store: WelcomeStore): WelcomeStore => {
  const previous = current;
  current = store;
  return previous;
};

/**
 * The player's window, writing it first for a player already on Map Room 2
 * with none (they were there at launch: it starts at the launch time).
 * Null for a player not on Map Room 2 who has none.
 *
 * Throws on a database error; {@link readWelcome} is the forgiving form.
 */
export const welcomeState = async (
  em: EntityManager,
  userid: number,
  inMapRoom2: boolean,
  now: number
): Promise<WelcomeState | null> => {
  const store = welcomeStore();
  const found = await store.read(em, userid);
  if (found || !inMapRoom2) return found;
  await store.start(em, userid, await store.launchTime(em, now));
  return store.read(em, userid);
};

/**
 * {@link welcomeState}, or null if it cannot be read: a reward that cannot be
 * looked up is simply not offered. Do not call it inside a transaction whose
 * later writes matter (a failed statement aborts the transaction).
 */
export const readWelcome = async (
  em: EntityManager,
  userid: number,
  inMapRoom2: boolean,
  now: number
): Promise<WelcomeState | null> => {
  try {
    return await welcomeState(em, userid, inMapRoom2, now);
  } catch (error) {
    logger.warn("Could not read the Map Room 2 welcome for {userid}: {error}", { userid, error: String(error) });
    return null;
  }
};

/** Starts a player's pass on joining Map Room 2 (nothing if they ever had one). */
export const recordMr2Join = (em: EntityManager, userid: number, now: number): Promise<void> =>
  welcomeStore().start(em, userid, now);

/** Uses one of `reward` if one is ready today; whether it did. */
export const claimWelcome = (em: EntityManager, userid: number, reward: WelcomeReward, now: number): Promise<boolean> =>
  welcomeStore().claim(em, userid, reward, now);

/**
 * Fixes the launch time at server start, so players already on Map Room 2
 * get their pass days from the moment the feature went live rather than from
 * their next visit. Forgiving: the first read does the same later.
 */
export const ensureWelcomeLaunch = async (em: EntityManager, now: number): Promise<void> => {
  try {
    await welcomeStore().launchTime(em, now);
  } catch (error) {
    logger.warn("Could not fix the Map Room 2 welcome launch time: {error}", { error: String(error) });
  }
};
