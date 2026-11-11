import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { MapRoomVersion } from "../../enums/MapRoom.js";
import { logger } from "../../utils/logger.js";

/**
 * "New to Map Room 2" (owner, 9 Nov 2026, beta 7): each player gets a pass of
 * {@link MR2_WELCOME_DAYS} days (7, owner 11 Nov 2026; it was 10), once
 * ever, with two rewards:
 *
 * - the first wild monster camp they take over costs 10% of its full base
 *   price in resources (no next-to-yard half or Conquest on top; the Shiny
 *   price is the normal one): `takeoverCost.ts` `quoteTakeover`;
 * - one free Regular Starter Kit on any outpost, built as the resource path
 *   builds (prefabs, no worker): `services/yard/starterKit.ts`.
 *
 * **When the pass starts.** A player who joins Map Room 2 after this ships
 * starts on joining ({@link recordMr2Join}, from `setMapVersion` and
 * `joinMapRoom2`). A player already on Map Room 2 when it ships has no row,
 * so the first read for them writes one starting at the launch time: the
 * first time any server with this feature started, kept once in
 * `bym.game_setting` under {@link LAUNCH_SETTING_KEY} ({@link launchTime}).
 *
 * **How long it lasts.** Only the start is kept; the end is always
 * `start + MR2_WELCOME_SECONDS`, so changing {@link MR2_WELCOME_DAYS} changes
 * every pass, ones already running included (a pass started 8 days ago when
 * the length went from 10 to 7 is over at once).
 *
 * **Where it is kept.** One `bym.event_progress` row (`userid`,
 * `event_id = 'mr2-welcome'`), its `data` holding `start` (unix seconds),
 * `takeoverUsed` and `kitUsed`, and when each was used (`takeoverAt`,
 * `kitAt`, unix seconds; absent on rows used before they were kept). Each
 * reward is claimed by one conditional UPDATE, so it can never be used twice.
 *
 * The takeover counts as used on the first wild camp taken over in the
 * pass, however it was paid for: a player who pays Shiny for it does not get
 * the cheap price later.
 */

export const MR2_WELCOME_EVENT_ID = "mr2-welcome";

/** The pass's length in days (owner, 11 Nov 2026: 7 for beta 7; it was 10). */
export const MR2_WELCOME_DAYS = 7;

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
  readonly takeoverUsed: boolean;
  readonly kitUsed: boolean;
  /** When the takeover was used (unix seconds), if known. */
  readonly takeoverAt?: number | null;
  /** When the kit was used (unix seconds), if known. */
  readonly kitAt?: number | null;
}

export type WelcomeReward = "takeover" | "kit";

/** What the client is told (`GET /bm/events` `mr2Welcome`). */
export interface WelcomeStatus {
  /** Unix seconds. */
  startsAt: number;
  endsAt: number;
  /** Whole days left, rounded up: {@link MR2_WELCOME_DAYS} on the first day, 1 on the last. */
  daysLeft: number;
  /** The cheap takeover can still be used. */
  takeover: boolean;
  /** The free Regular kit can still be used. */
  kit: boolean;
  /** When the takeover was used (unix seconds); null when not used or not known. */
  takeoverUsedAt: number | null;
  /** When the kit was used (unix seconds); null when not used or not known. */
  kitUsedAt: number | null;
}

/** Whether the window runs at `now`. */
export const welcomeOpen = (state: WelcomeState | null, now: number): state is WelcomeState =>
  state !== null && now >= state.start && now < state.start + MR2_WELCOME_SECONDS;

/** Whether `reward` can be used at `now`. */
export const welcomeReady = (state: WelcomeState | null, reward: WelcomeReward, now: number): boolean =>
  welcomeOpen(state, now) && !(reward === "takeover" ? state.takeoverUsed : state.kitUsed);

/**
 * The card's status: null only when the window is not running. The card stays
 * on the Events page for all the pass days, a used reward showing Used (owner,
 * 9 Nov 2026: it left once both were used).
 */
export const welcomeStatus = (state: WelcomeState | null, now: number): WelcomeStatus | null => {
  if (!welcomeOpen(state, now)) return null;
  const endsAt = state.start + MR2_WELCOME_SECONDS;
  return {
    startsAt: state.start,
    endsAt,
    daysLeft: Math.max(1, Math.ceil((endsAt - now) / DAY)),
    takeover: !state.takeoverUsed,
    kit: !state.kitUsed,
    takeoverUsedAt: state.takeoverUsed ? (state.takeoverAt ?? null) : null,
    kitUsedAt: state.kitUsed ? (state.kitAt ?? null) : null,
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

const stateOf = (raw: unknown): WelcomeState | null => {
  const data = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (data === null || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const start = Number(record.start);
  if (!Number.isFinite(start)) return null;
  const at = (value: unknown): number | null => {
    const seconds = Number(value);
    return value !== undefined && value !== null && Number.isFinite(seconds) ? seconds : null;
  };
  return {
    start,
    takeoverUsed: record.takeoverUsed === true,
    kitUsed: record.kitUsed === true,
    takeoverAt: at(record.takeoverAt),
    kitAt: at(record.kitAt),
  };
};

const USED_FIELD: Record<WelcomeReward, string> = { takeover: "takeoverUsed", kit: "kitUsed" };
const AT_FIELD: Record<WelcomeReward, string> = { takeover: "takeoverAt", kit: "kitAt" };

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
       VALUES (?, ?, jsonb_build_object('start', ?::bigint, 'takeoverUsed', false, 'kitUsed', false))
       ON CONFLICT (userid, event_id) DO NOTHING`,
      [userid, MR2_WELCOME_EVENT_ID, Math.floor(start)]
    );
  },

  async claim(em, userid, reward, now) {
    const field = USED_FIELD[reward];
    const atField = AT_FIELD[reward];
    const rows = await sql(em).execute<{ userid: number }[]>(
      `UPDATE bym.event_progress
          SET data = data || jsonb_build_object('${field}', true, '${atField}', ?::bigint), updated_at = now()
        WHERE userid = ? AND event_id = ?
          AND COALESCE((data->>'${field}')::boolean, false) = false
          AND (data->>'start')::bigint <= ?
          AND (data->>'start')::bigint + ? > ?
       RETURNING userid`,
      [Math.floor(now), userid, MR2_WELCOME_EVENT_ID, now, MR2_WELCOME_SECONDS, now]
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
      if (!store.rows.has(userid)) store.rows.set(userid, { start: Math.floor(start), takeoverUsed: false, kitUsed: false });
    },
    async claim(_em: EntityManager, userid: number, reward: WelcomeReward, now: number) {
      const state = store.rows.get(userid) ?? null;
      if (!welcomeReady(state, reward, now)) return false;
      const at = Math.floor(now);
      store.rows.set(userid, {
        ...state!,
        ...(reward === "takeover" ? { takeoverUsed: true, takeoverAt: at } : { kitUsed: true, kitAt: at }),
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

/** Marks a reward used if it is ready; whether it was. */
export const claimWelcome = (em: EntityManager, userid: number, reward: WelcomeReward, now: number): Promise<boolean> =>
  welcomeStore().claim(em, userid, reward, now);

/**
 * Fixes the launch time at server start, so players already on Map Room 2
 * get their pass from the moment the feature went live rather than from
 * their next visit. Forgiving: the first read does the same later.
 */
export const ensureWelcomeLaunch = async (em: EntityManager, now: number): Promise<void> => {
  try {
    await welcomeStore().launchTime(em, now);
  } catch (error) {
    logger.warn("Could not fix the Map Room 2 welcome launch time: {error}", { error: String(error) });
  }
};
