import type { EntityManager } from "@mikro-orm/postgresql";

import { isAdminUser } from "../../config/AdminConfig.js";
import { logger } from "../../utils/logger.js";

/**
 * The maintenance switch (owner, 22 Nov 2026): the owner turns it on from
 * the dashboard (`controllers/admin/maintenance.ts`) before a server
 * downtime.
 *
 * - From the moment it is on, nobody but the owner (`isAdminUser`, live has
 *   exactly one) can sign in, with a password or a saved token
 *   (`controllers/auth/login.ts`), or make an account.
 * - Players already in the game get a countdown (1, 5, 10 or 15 minutes)
 *   over the chat connection and the game's light check
 *   (`GET /api/:apiVersion/maintenance`). At zero, the cut-off, every
 *   request a non-owner makes with a session is refused
 *   (`middleware/auth.ts`), the chat gateway closes their connections, and
 *   the game shows the sign-in screen with the owner's message.
 * - It stays on until the owner turns it off; the "back at" time is only
 *   shown to players. Off during the countdown cancels it.
 *
 * Kept in `bym.game_setting` under {@link SETTING_KEY} so a restart (the
 * usual reason for maintenance) keeps it on, and held in memory so every
 * request can ask without a query. The copy in memory is read again every
 * {@link REFRESH_MS} and at once on the server that made the change.
 */

export const SETTING_KEY = "maintenance";

/** How often the copy in memory is read again: a second server learns of a change within seconds. */
export const REFRESH_MS = 10_000;

/** The countdowns the dashboard offers, in minutes. */
export const COUNTDOWN_MINUTES = [1, 5, 10, 15] as const;
export const DEFAULT_COUNTDOWN_MINUTES = 5;

/** What players read when the owner leaves the message empty. */
export const DEFAULT_MESSAGE = "Server maintenance. Back soon!";

/** The longest message the dashboard takes. */
export const MESSAGE_MAX = 140;

/** How far ahead the "back at" time may be. */
export const BACK_AT_MAX_MS = 7 * 24 * 3_600_000;

export interface MaintenanceState {
  readonly on: boolean;
  /** What players are told; never empty while on. */
  readonly message: string;
  /** When the owner expects the game back (ms), display only; null for none given. */
  readonly backAt: number | null;
  /** When the owner pressed On (ms). */
  readonly startedAt: number;
  /** The end of the countdown (ms): from then on non-owners are cut off. */
  readonly cutoffAt: number;
}

export const MAINTENANCE_OFF: MaintenanceState = { on: false, message: "", backAt: null, startedAt: 0, cutoffAt: 0 };

const plainObject = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

const wholeMs = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;

/** Text a player may read: one line, trimmed, at most {@link MESSAGE_MAX} characters. */
const cleanMessage = (raw: unknown): string =>
  typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX) : "";

/** The stored row, checked; anything broken reads as off, so a bad row never locks the game. */
export const readMaintenance = (raw: unknown): MaintenanceState => {
  const row = plainObject(raw);
  if (!row || row.on !== true) return MAINTENANCE_OFF;
  const startedAt = wholeMs(row.startedAt);
  const cutoffAt = wholeMs(row.cutoffAt);
  if (startedAt === null || cutoffAt === null || cutoffAt < startedAt) return MAINTENANCE_OFF;
  return {
    on: true,
    message: cleanMessage(row.message) || DEFAULT_MESSAGE,
    backAt: wholeMs(row.backAt),
    startedAt,
    cutoffAt,
  };
};

/** One change from the dashboard (`POST /api/v1/admin/maintenance`). */
export type MaintenanceChange =
  | {
      readonly action: "on";
      readonly message: string;
      readonly backAt: number | null;
      readonly minutes: (typeof COUNTDOWN_MINUTES)[number];
    }
  | { readonly action: "off" };

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const bad = (message: string): Parsed<never> => ({ ok: false, message });

/** The "back at" time as sent: ms, or an ISO date; empty for none. */
const sentTime = (raw: unknown): number | null | undefined => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const asNumber = Number(raw);
  if (/^\d+$/.test(raw.trim()) && Number.isSafeInteger(asNumber)) return asNumber;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Checks a dashboard change at `now` (ms); the message is the dashboard's to show. */
export const parseMaintenanceChange = (body: unknown, now: number): Parsed<MaintenanceChange> => {
  const row = plainObject(body);
  if (!row) return bad("Nothing to change.");
  if (row.action === "off") return { ok: true, value: { action: "off" } };
  if (row.action !== "on") return bad("Unknown change.");

  if (row.message !== undefined && typeof row.message !== "string") return bad("The message must be text.");
  if (typeof row.message === "string" && row.message.trim().length > MESSAGE_MAX) {
    return bad(`The message can be at most ${MESSAGE_MAX} characters.`);
  }

  const minutesRaw = row.minutes === undefined || row.minutes === "" ? DEFAULT_COUNTDOWN_MINUTES : Number(row.minutes);
  const minutes = COUNTDOWN_MINUTES.find((m) => m === minutesRaw);
  if (minutes === undefined) return bad(`The countdown must be ${COUNTDOWN_MINUTES.join(", ")} minutes.`);

  const backAt = sentTime(row.backAt);
  if (backAt === undefined) return bad("The back-at time is not a time.");
  if (backAt !== null && backAt <= now) return bad("The back-at time must be in the future.");
  if (backAt !== null && backAt > now + BACK_AT_MAX_MS) return bad("The back-at time must be within 7 days.");

  return {
    ok: true,
    value: { action: "on", message: cleanMessage(row.message) || DEFAULT_MESSAGE, backAt, minutes },
  };
};

/**
 * The state after one change at `now` (ms). On while already on changes the
 * message and back-at time only: the countdown (or the cut-off already
 * reached) stays as it was.
 */
export const applyMaintenanceChange = (state: MaintenanceState, change: MaintenanceChange, now: number): MaintenanceState => {
  if (change.action === "off") return MAINTENANCE_OFF;
  if (state.on) return { ...state, message: change.message, backAt: change.backAt };
  return {
    on: true,
    message: change.message,
    backAt: change.backAt,
    startedAt: now,
    cutoffAt: now + change.minutes * 60_000,
  };
};

/* ── The copy in memory ─────────────────────────────────────────────── */

let stored: MaintenanceState = MAINTENANCE_OFF;
let storedMeta: { updatedAt: string | null; updatedBy: number | null } = { updatedAt: null, updatedBy: null };

type Listener = (state: MaintenanceState) => void;
const listeners = new Set<Listener>();

const same = (a: MaintenanceState, b: MaintenanceState): boolean =>
  a.on === b.on && a.message === b.message && a.backAt === b.backAt && a.startedAt === b.startedAt && a.cutoffAt === b.cutoffAt;

/**
 * Hears every change of the state in memory, whichever way it came (a
 * dashboard change, a refresh, a chat control message). The chat gateway
 * uses it to tell every open connection and to arm the cut-off. Returns the
 * unsubscribe.
 */
export const onMaintenanceChange = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Replaces the copy in memory (tests, a read, a write, a control message) and tells the listeners when it changed. */
export const setMaintenance = (state: MaintenanceState): void => {
  if (same(stored, state)) return;
  stored = state;
  for (const listener of [...listeners]) {
    try {
      listener(state);
    } catch (error) {
      logger.warn("Maintenance listener failed: {error}", { error: String(error) });
    }
  }
};

export const maintenanceState = (): MaintenanceState => stored;

export const storedMaintenance = (): { state: MaintenanceState; updatedAt: string | null; updatedBy: number | null } => ({
  state: stored,
  ...storedMeta,
});

/** Whether the countdown is over at `now` (ms): non-owners are cut off. */
export const isCutOff = (state: MaintenanceState, now: number): boolean => state.on && now >= state.cutoffAt;

/** Whether this player may not sign in now: maintenance is on and they are not the owner. */
export const signInBlocked = (userid: unknown, state: MaintenanceState = stored): boolean =>
  state.on && !isAdminUser(userid);

/** Whether this player's requests are refused now: past the cut-off and not the owner. */
export const requestBlocked = (userid: unknown, now: number = Date.now(), state: MaintenanceState = stored): boolean =>
  isCutOff(state, now) && !isAdminUser(userid);

/**
 * What the game is told (the light check, the chat connection, a refusal):
 * the time left rather than the clock time, so a player's wrong clock does
 * not move their countdown. `exempt` is the owner, who is never cut off.
 */
export interface MaintenanceNotice {
  on: boolean;
  message: string;
  /** ISO, for the player's own time zone; null for none. */
  backAt: string | null;
  /** Until the cut-off; 0 once it is reached. */
  remainingMs: number;
  exempt: boolean;
}

export const maintenanceNotice = (state: MaintenanceState, now: number, exempt = false): MaintenanceNotice => ({
  on: state.on,
  message: state.on ? state.message : "",
  backAt: state.on && state.backAt ? new Date(state.backAt).toISOString() : null,
  remainingMs: state.on ? Math.max(0, state.cutoffAt - now) : 0,
  exempt: state.on && exempt,
});

/** Reads the row into memory. A failed read keeps what was there. */
export const loadMaintenance = async (em: EntityManager): Promise<MaintenanceState> => {
  try {
    const [row] = await em.execute<{ value: unknown; updated_at: Date | string | null; updated_by: number | null }[]>(
      `SELECT value, updated_at, updated_by FROM bym.game_setting WHERE key = ?`,
      [SETTING_KEY]
    );
    storedMeta = {
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedBy: row?.updated_by ?? null,
    };
    setMaintenance(row ? readMaintenance(row.value) : MAINTENANCE_OFF);
  } catch (error) {
    logger.warn("Maintenance switch not read, keeping the last state: {error}", { error: String(error) });
  }
  return stored;
};

/** Writes the state and takes it into memory at once. */
export const saveMaintenance = async (em: EntityManager, state: MaintenanceState, by: number): Promise<void> => {
  await em.execute(
    `INSERT INTO bym.game_setting (key, value, updated_at, updated_by) VALUES (?, ?::jsonb, now(), ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTING_KEY, JSON.stringify(state), by]
  );
  storedMeta = { updatedAt: new Date().toISOString(), updatedBy: by };
  setMaintenance(state);
};

let timer: ReturnType<typeof setInterval> | null = null;

/** Reads the state now and every {@link REFRESH_MS}. */
export const startMaintenanceRefresh = (em: () => EntityManager): Promise<MaintenanceState> => {
  const first = loadMaintenance(em());
  if (!timer) {
    timer = setInterval(() => void loadMaintenance(em()), REFRESH_MS);
    timer.unref?.();
  }
  return first;
};
