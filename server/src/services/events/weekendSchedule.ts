import {
  WEEKEND_EVENT_INFO,
  weekendLine,
  type WeekendEventId,
  type WeekendSettings,
} from "../../game-data/events/weekendEvents.js";

/**
 * When each weekend event runs (`game-data/events/weekendEvents.ts`). Pure:
 * the settings and the clock are passed in; times are unix seconds.
 *
 * A weekend is named by its Saturday, `YYYY-MM-DD` in the settings' time
 * zone. It runs from that Saturday 00:00 for `lengthHours` (48: to the end
 * of Sunday) and is announced `announceHours` before (24: from Friday
 * 00:00). Its event is the dashboard's override for that Saturday if there
 * is one ("skip" for none), else the rotation's: `rotation[n mod length]`,
 * `n` the number of weeks since `firstWeekend` (negative before it).
 *
 * A forced event (the dashboard's "Run now") runs from `since` to `until`
 * whatever the day, ahead of the schedule. Switching weekend events off
 * stops both.
 */

const DAY = 86_400;
/** 1970-01-01 was a Thursday: day 0 is weekday 4 (Sunday = 0). */
const EPOCH_WEEKDAY = 4;
const SATURDAY = 6;

/** One weekend event's run. */
export interface WeekendRun {
  readonly id: WeekendEventId;
  readonly title: string;
  /** "Upgrades cost 30% less". */
  readonly line: string;
  readonly percent: number;
  /** `YYYY-MM-DD` of its Saturday; `forced-<since>` for a forced run. */
  readonly key: string;
  readonly startsAt: number;
  readonly endsAt: number;
  /** When the Friday pop-up starts announcing it. */
  readonly announceAt: number;
  /** Switched on by hand from the dashboard. */
  readonly forced: boolean;
}

/** What is on now and what comes next. */
export interface WeekendState {
  /** The event running now, or null. */
  readonly active: WeekendRun | null;
  /** The next scheduled one (not running yet), or null when there is none in the next 8 weeks. */
  readonly next: WeekendRun | null;
}

/** `YYYY-MM-DD` of day number `day` since 1970-01-01. */
const dateOfDay = (day: number): string => new Date(day * DAY * 1000).toISOString().slice(0, 10);

/** Day number of a `YYYY-MM-DD`, or null when it is not a date. */
export const dayOfDate = (date: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 1000 / DAY) : null;
};

/** Whether a `YYYY-MM-DD` is a Saturday. */
export const isSaturday = (date: string): boolean => {
  const day = dayOfDate(date);
  return day !== null && (((day + EPOCH_WEEKDAY) % 7) + 7) % 7 === SATURDAY;
};

/**
 * The weekend `t` belongs to: the one running at `t`, else the next one.
 * Returns its Saturday's day number in the settings' zone.
 */
const weekendDayAt = (settings: WeekendSettings, t: number): number => {
  const offset = settings.utcOffsetMinutes * 60;
  const localDay = Math.floor((t + offset) / DAY);
  const weekday = (((localDay + EPOCH_WEEKDAY) % 7) + 7) % 7;
  const lastSaturday = localDay - ((weekday - SATURDAY + 7) % 7);
  const startsAt = lastSaturday * DAY - offset;
  // Still running: this one. Over: next week's.
  return t < startsAt + settings.lengthHours * 3600 ? lastSaturday : lastSaturday + 7;
};

/** The event the schedule gives the weekend of Saturday `day`, or null (skipped, off, empty rotation). */
export const scheduledEvent = (settings: WeekendSettings, day: number): WeekendEventId | null => {
  if (!settings.enabled) return null;
  const override = settings.overrides[dateOfDay(day)];
  if (override === "skip") return null;
  if (override) return override;
  const first = dayOfDate(settings.firstWeekend);
  const rotation = settings.rotation;
  if (first === null || rotation.length === 0) return null;
  const weeks = Math.floor((day - first) / 7);
  return rotation[((weeks % rotation.length) + rotation.length) % rotation.length] ?? null;
};

/** The run of the weekend of Saturday `day`, or null when it has no event. */
export const weekendRun = (settings: WeekendSettings, day: number): WeekendRun | null => {
  const id = scheduledEvent(settings, day);
  if (!id) return null;
  const percent = settings.percent[id] ?? 0;
  if (!(percent > 0)) return null;
  const startsAt = day * DAY - settings.utcOffsetMinutes * 60;
  return {
    id,
    title: WEEKEND_EVENT_INFO[id].title,
    line: weekendLine(id, percent),
    percent,
    key: dateOfDay(day),
    startsAt,
    endsAt: startsAt + settings.lengthHours * 3600,
    announceAt: startsAt - settings.announceHours * 3600,
    forced: false,
  };
};

/** The forced run, if one is set and has not ended by `now`. */
const forcedRun = (settings: WeekendSettings, now: number): WeekendRun | null => {
  const forced = settings.forced;
  if (!settings.enabled || !forced || now >= forced.until) return null;
  const percent = settings.percent[forced.id] ?? 0;
  if (!(percent > 0)) return null;
  return {
    id: forced.id,
    title: WEEKEND_EVENT_INFO[forced.id].title,
    line: weekendLine(forced.id, percent),
    percent,
    key: `forced-${forced.since}`,
    startsAt: forced.since,
    endsAt: forced.until,
    announceAt: forced.since,
    forced: true,
  };
};

/** How many weekends ahead {@link weekendState} looks for the next event. */
const LOOK_AHEAD_WEEKS = 8;

/** The run on at `t` (a forced one first), or null. */
export const activeRun = (settings: WeekendSettings, t: number): WeekendRun | null => {
  const forced = forcedRun(settings, t);
  if (forced) return forced;
  const current = weekendRun(settings, weekendDayAt(settings, t));
  return current && current.startsAt <= t && t < current.endsAt ? current : null;
};

/** What is on at `now`, and the next scheduled event. */
export const weekendState = (settings: WeekendSettings, now: number): WeekendState => {
  const day = weekendDayAt(settings, now);

  let next: WeekendRun | null = null;
  for (let week = 0; week <= LOOK_AHEAD_WEEKS && !next; week++) {
    const run = weekendRun(settings, day + week * 7);
    if (run && run.startsAt > now) next = run;
  }
  return { active: activeRun(settings, now), next };
};

/** The upcoming weekends for the dashboard: Saturday, what the rotation says, what will run. */
export interface WeekendPlanRow {
  readonly key: string;
  readonly startsAt: number;
  /** What the rotation alone gives. */
  readonly rotation: WeekendEventId | null;
  /** The dashboard's override for that weekend, if any. */
  readonly override: WeekendEventId | "skip" | null;
  /** What will actually run (null: nothing). */
  readonly runs: WeekendEventId | null;
}

/** `weeks` weekends from the one running at (or next after) `now`. */
export const weekendPlan = (settings: WeekendSettings, now: number, weeks = 8): WeekendPlanRow[] => {
  const first = weekendDayAt(settings, now);
  const rows: WeekendPlanRow[] = [];
  for (let week = 0; week < weeks; week++) {
    const day = first + week * 7;
    const key = dateOfDay(day);
    rows.push({
      key,
      startsAt: day * DAY - settings.utcOffsetMinutes * 60,
      rotation: scheduledEvent({ ...settings, enabled: true, overrides: {} }, day),
      override: settings.overrides[key] ?? null,
      runs: weekendRun(settings, day)?.id ?? null,
    });
  }
  return rows;
};

/**
 * The percentage of event `id` running at `t`, or 0. What every effect reads:
 * a cost, a timer or a loot credit takes the boost of the moment it is
 * started or lands.
 */
export const boostAt = (settings: WeekendSettings, id: WeekendEventId, t: number): number => {
  const active = activeRun(settings, t);
  return active && active.id === id ? active.percent : 0;
};
