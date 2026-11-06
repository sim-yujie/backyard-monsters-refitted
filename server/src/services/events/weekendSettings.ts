import type { EntityManager } from "@mikro-orm/postgresql";

import { Env } from "../../enums/Env.js";
import {
  DEFAULT_WEEKEND_SETTINGS,
  WEEKEND_EVENT_IDS,
  WEEKEND_LIMITS,
  isWeekendEventId,
  type ForcedWeekendEvent,
  type WeekendEventId,
  type WeekendOverride,
  type WeekendSettings,
} from "../../game-data/events/weekendEvents.js";
import { logger } from "../../utils/logger.js";
import { dayOfDate, isSaturday } from "./weekendSchedule.js";

/**
 * The live weekend-event settings: kept in `bym.game_setting` under
 * {@link SETTING_KEY} (migration `20261109_CreateGameSettingTable.ts`),
 * changed from the owner's dashboard (`controllers/admin/weekend.ts`), and
 * held in memory so every yard action can read them without a query.
 *
 * The copy in memory is read again every {@link REFRESH_MS} (a second server
 * on the same database picks up a dashboard change within a minute) and at
 * once on the server that made the change. Until the first read, and if the
 * row is missing or unreadable, the defaults hold
 * (`game-data/events/weekendEvents.ts`).
 *
 * Locally, `WEEKEND_FORCE=<builders|plunder|study|hatch>` in `server/.env`
 * runs that event now, for pictures and tests; it is ignored on production.
 */

export const SETTING_KEY = "weekend_events";

/** How often the copy in memory is read again. */
export const REFRESH_MS = 60_000;

/** A whole number within `[min, max]`, or null. */
const intIn = (raw: unknown, min: number, max: number): number | null => {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
};

const plainObject = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

/**
 * Settings read from storage, every field checked and any bad or missing one
 * left at its default: a broken row never stops the game.
 */
export const readSettings = (raw: unknown): WeekendSettings => {
  const row = plainObject(raw) ?? {};
  const d = DEFAULT_WEEKEND_SETTINGS;

  const rotation = Array.isArray(row.rotation) ? row.rotation.filter(isWeekendEventId) : null;

  const percentRow = plainObject(row.percent) ?? {};
  const percent = Object.fromEntries(
    WEEKEND_EVENT_IDS.map((id) => [
      id,
      intIn(percentRow[id], WEEKEND_LIMITS.minPercent, WEEKEND_LIMITS.maxPercent) ?? d.percent[id],
    ])
  ) as Record<WeekendEventId, number>;

  const overrides: Record<string, WeekendOverride> = {};
  for (const [key, value] of Object.entries(plainObject(row.overrides) ?? {})) {
    if (isSaturday(key) && (value === "skip" || isWeekendEventId(value))) overrides[key] = value;
  }

  const forcedRow = plainObject(row.forced);
  const forced: ForcedWeekendEvent | null =
    forcedRow &&
    isWeekendEventId(forcedRow.id) &&
    Number.isSafeInteger(forcedRow.since) &&
    Number.isSafeInteger(forcedRow.until) &&
    (forcedRow.until as number) > (forcedRow.since as number)
      ? { id: forcedRow.id, since: forcedRow.since as number, until: forcedRow.until as number }
      : null;

  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : d.enabled,
    rotation: rotation ?? d.rotation,
    percent,
    firstWeekend: typeof row.firstWeekend === "string" && isSaturday(row.firstWeekend) ? row.firstWeekend : d.firstWeekend,
    utcOffsetMinutes:
      intIn(row.utcOffsetMinutes, WEEKEND_LIMITS.minOffsetMinutes, WEEKEND_LIMITS.maxOffsetMinutes) ?? d.utcOffsetMinutes,
    lengthHours: intIn(row.lengthHours, WEEKEND_LIMITS.minLengthHours, WEEKEND_LIMITS.maxLengthHours) ?? d.lengthHours,
    announceHours: intIn(row.announceHours, 0, WEEKEND_LIMITS.maxAnnounceHours) ?? d.announceHours,
    overrides,
    forced,
  };
};

/** One change from the dashboard (`POST /api/v1/admin/weekend`). */
export type WeekendChange =
  | {
      readonly action: "settings";
      readonly enabled?: boolean;
      readonly rotation?: readonly WeekendEventId[];
      readonly percent?: Partial<Record<WeekendEventId, number>>;
      readonly firstWeekend?: string;
      readonly utcOffsetMinutes?: number;
      readonly lengthHours?: number;
      readonly announceHours?: number;
    }
  /** One weekend: another event, "skip", or null to go back to the rotation. */
  | { readonly action: "weekend"; readonly weekend: string; readonly event: WeekendOverride | null }
  /** Run an event now for `hours`. */
  | { readonly action: "force"; readonly event: WeekendEventId; readonly hours: number }
  /** End the forced run. */
  | { readonly action: "stopForce" }
  /** Back to the defaults (the overrides and any forced run go too). */
  | { readonly action: "reset" };

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const bad = (message: string): Parsed<never> => ({ ok: false, message });

/** Checks a dashboard change; the message is the dashboard's to show. */
export const parseWeekendChange = (body: unknown): Parsed<WeekendChange> => {
  const row = plainObject(body);
  if (!row) return bad("Nothing to change.");
  switch (row.action) {
    case "settings": {
      const change: { -readonly [K in keyof Extract<WeekendChange, { action: "settings" }>]: unknown } = {
        action: "settings",
      };
      if (row.enabled !== undefined) {
        if (typeof row.enabled !== "boolean") return bad("On/off must be true or false.");
        change.enabled = row.enabled;
      }
      if (row.rotation !== undefined) {
        if (!Array.isArray(row.rotation) || !row.rotation.every(isWeekendEventId)) {
          return bad("The rotation lists unknown events.");
        }
        if (row.rotation.length === 0) return bad("The rotation needs at least one event (or switch weekend events off).");
        if (row.rotation.length > 12) return bad("The rotation can hold at most 12 weekends.");
        change.rotation = row.rotation;
      }
      if (row.percent !== undefined) {
        const percent = plainObject(row.percent);
        if (!percent) return bad("Percentages are missing.");
        const out: Partial<Record<WeekendEventId, number>> = {};
        for (const [id, value] of Object.entries(percent)) {
          if (!isWeekendEventId(id)) return bad(`Unknown event "${id}".`);
          const n = intIn(value, WEEKEND_LIMITS.minPercent, WEEKEND_LIMITS.maxPercent);
          if (n === null) {
            return bad(`Percentages must be whole numbers from ${WEEKEND_LIMITS.minPercent} to ${WEEKEND_LIMITS.maxPercent}.`);
          }
          out[id] = n;
        }
        change.percent = out;
      }
      if (row.firstWeekend !== undefined) {
        if (typeof row.firstWeekend !== "string" || !isSaturday(row.firstWeekend)) {
          return bad("The rotation's first weekend must be a Saturday (YYYY-MM-DD).");
        }
        change.firstWeekend = row.firstWeekend;
      }
      if (row.utcOffsetMinutes !== undefined) {
        const n = intIn(row.utcOffsetMinutes, WEEKEND_LIMITS.minOffsetMinutes, WEEKEND_LIMITS.maxOffsetMinutes);
        if (n === null) return bad("The time zone must be between UTC-12 and UTC+14.");
        change.utcOffsetMinutes = n;
      }
      if (row.lengthHours !== undefined) {
        const n = intIn(row.lengthHours, WEEKEND_LIMITS.minLengthHours, WEEKEND_LIMITS.maxLengthHours);
        if (n === null) return bad(`The length must be ${WEEKEND_LIMITS.minLengthHours} to ${WEEKEND_LIMITS.maxLengthHours} hours.`);
        change.lengthHours = n;
      }
      if (row.announceHours !== undefined) {
        const n = intIn(row.announceHours, 0, WEEKEND_LIMITS.maxAnnounceHours);
        if (n === null) return bad(`The pop-up must come 0 to ${WEEKEND_LIMITS.maxAnnounceHours} hours before.`);
        change.announceHours = n;
      }
      return { ok: true, value: change as WeekendChange };
    }
    case "weekend": {
      if (typeof row.weekend !== "string" || !isSaturday(row.weekend)) return bad("Pick a weekend by its Saturday.");
      const event = row.event;
      if (event !== null && event !== "skip" && !isWeekendEventId(event)) return bad("Unknown event.");
      return { ok: true, value: { action: "weekend", weekend: row.weekend, event } };
    }
    case "force": {
      if (!isWeekendEventId(row.event)) return bad("Pick an event to run.");
      const hours = intIn(row.hours, 1, WEEKEND_LIMITS.maxForceHours);
      if (hours === null) return bad(`Run it for 1 to ${WEEKEND_LIMITS.maxForceHours} hours.`);
      return { ok: true, value: { action: "force", event: row.event, hours } };
    }
    case "stopForce":
      return { ok: true, value: { action: "stopForce" } };
    case "reset":
      return { ok: true, value: { action: "reset" } };
    default:
      return bad("Unknown change.");
  }
};

/** The settings after one change, at `now` (unix seconds). Old weekends' overrides are dropped. */
export const applyWeekendChange = (settings: WeekendSettings, change: WeekendChange, now: number): WeekendSettings => {
  const keepFrom = Math.floor(now / 86_400) - WEEKEND_LIMITS.keepOverrideDays;
  const recent = (overrides: Readonly<Record<string, WeekendOverride>>) =>
    Object.fromEntries(Object.entries(overrides).filter(([key]) => (dayOfDate(key) ?? 0) >= keepFrom));

  switch (change.action) {
    case "settings": {
      const { action: _action, percent, ...rest } = change;
      const enabled = change.enabled ?? settings.enabled;
      return {
        ...settings,
        ...rest,
        percent: { ...settings.percent, ...percent },
        overrides: recent(settings.overrides),
        // Switching off ends a forced run too.
        forced: enabled ? settings.forced : null,
      };
    }
    case "weekend": {
      const overrides = { ...recent(settings.overrides) };
      if (change.event === null) delete overrides[change.weekend];
      else overrides[change.weekend] = change.event;
      return { ...settings, overrides };
    }
    case "force":
      return {
        ...settings,
        enabled: true,
        overrides: recent(settings.overrides),
        forced: { id: change.event, since: Math.floor(now), until: Math.floor(now) + change.hours * 3600 },
      };
    case "stopForce":
      return { ...settings, forced: null };
    case "reset":
      return DEFAULT_WEEKEND_SETTINGS;
  }
};

/* ── The copy in memory ─────────────────────────────────────────────── */

let stored: WeekendSettings = DEFAULT_WEEKEND_SETTINGS;
/** Who changed them last and when, for the dashboard. */
let storedMeta: { updatedAt: string | null; updatedBy: number | null } = { updatedAt: null, updatedBy: null };

/**
 * `WEEKEND_FORCE` from the environment, off production: that event forced on
 * from the start of time to far ahead.
 */
export const envForced = (env: Record<string, string | undefined>): ForcedWeekendEvent | null => {
  if (env.ENV === Env.PROD) return null;
  const id = env.WEEKEND_FORCE?.trim();
  return isWeekendEventId(id) ? { id, since: 0, until: 4_102_444_800 } : null;
};

/** The settings every effect reads: what is stored, with `WEEKEND_FORCE` on top locally. */
export const weekendSettings = (env: Record<string, string | undefined> = process.env): WeekendSettings => {
  const forced = envForced(env);
  return forced ? { ...stored, enabled: true, forced } : stored;
};

/** What is stored, without the local `WEEKEND_FORCE`: the dashboard's form. */
export const storedWeekendSettings = (): { settings: WeekendSettings; updatedAt: string | null; updatedBy: number | null } => ({
  settings: stored,
  ...storedMeta,
});

/** Replaces the copy in memory: tests, and after a read or a write. */
export const setWeekendSettings = (settings: WeekendSettings): void => {
  stored = settings;
};

/** Reads the row into memory. A failed read keeps what was there. */
export const loadWeekendSettings = async (em: EntityManager): Promise<WeekendSettings> => {
  try {
    const [row] = await em.execute<{ value: unknown; updated_at: Date | string | null; updated_by: number | null }[]>(
      `SELECT value, updated_at, updated_by FROM bym.game_setting WHERE key = ?`,
      [SETTING_KEY]
    );
    stored = row ? readSettings(row.value) : DEFAULT_WEEKEND_SETTINGS;
    storedMeta = {
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedBy: row?.updated_by ?? null,
    };
  } catch (error) {
    logger.warn("Weekend event settings not read, keeping the last ones: {error}", { error: String(error) });
  }
  return stored;
};

/** Writes the settings and takes them into memory at once. */
export const saveWeekendSettings = async (
  em: EntityManager,
  settings: WeekendSettings,
  by: number
): Promise<void> => {
  await em.execute(
    `INSERT INTO bym.game_setting (key, value, updated_at, updated_by) VALUES (?, ?::jsonb, now(), ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTING_KEY, JSON.stringify(settings), by]
  );
  stored = settings;
  storedMeta = { updatedAt: new Date().toISOString(), updatedBy: by };
};

let timer: ReturnType<typeof setInterval> | null = null;

/** Reads the settings now and every {@link REFRESH_MS}. */
export const startWeekendSettingsRefresh = (em: () => EntityManager): void => {
  void loadWeekendSettings(em());
  if (timer) return;
  timer = setInterval(() => void loadWeekendSettings(em()), REFRESH_MS);
  timer.unref?.();
};
