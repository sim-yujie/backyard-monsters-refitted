import type { EventView } from "@/api/events";
import { runningWeekend, type WeekendState } from "@/game/weekend";

/**
 * The reset clock on the yard (beta 8, owner 15 Nov 2026): when the game's
 * resets happen, worked out on the server's clock. Pure, so the clock button, its
 * list and the tests share it.
 *
 * Every time here comes from the server's own rules:
 *
 * - **Daily**, 00:00 UTC: daily quests (`server/src/services/quests/period.ts`
 *   `nextUtcMidnight`), gifts collected (`services/friends/gifts.ts`
 *   `collectedToday`), helps given (`services/friends/helpFacts.ts`
 *   `helpsToday`) and alliance trade asks (`services/alliance/trade.ts`, the
 *   `asksToday` check).
 * - **Weekly**, Monday 00:00 UTC: weekly quests (`period.ts` `nextUtcMonday`)
 *   and alliance goals (`services/alliance/allianceProgress.ts` `weekEndsAt`).
 * - **Weekend event**: the run the server sent (`game/weekend.ts`), whose
 *   times already carry the dashboard's `utcOffsetMinutes`, skipped weekends
 *   and a run switched on by hand (`services/events/weekendSchedule.ts`).
 * - **Krallen Hunt**: the hunt in the events list (`GET /bm/events`), on now
 *   or coming up; the 7 claim days after it are not a reset.
 */

export const DAY_SECONDS = 86_400;
export const WEEK_SECONDS = 7 * DAY_SECONDS;

/** The next 00:00 UTC after `now` (unix seconds); at exactly midnight, the one a day on. */
export const nextDailyReset = (now: number): number => (Math.floor(now / DAY_SECONDS) + 1) * DAY_SECONDS;

/** The Monday 00:00 UTC that starts the week `now` falls in (as `period.ts` `utcWeekStart`). */
export const weekStart = (now: number): number => {
  const dayStart = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;
  // getUTCDay: Sunday 0 .. Saturday 6; days since Monday 0 .. 6.
  const sinceMonday = (new Date(dayStart * 1000).getUTCDay() + 6) % 7;
  return dayStart - sinceMonday * DAY_SECONDS;
};

/** The next Monday 00:00 UTC after `now`; at exactly that time, the one a week on. */
export const nextWeeklyReset = (now: number): number => weekStart(now) + WEEK_SECONDS;

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The daily reset's countdown (the clock button's label, and the list's
 * rows under a day): "18h 01m", or "4m 09s" in the last hour.
 */
export const pillCountdown = (seconds: number): string => {
  const left = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(left / 3_600);
  const minutes = Math.floor((left % 3_600) / 60);
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m ${pad(left % 60)}s`;
};

/** A row's countdown: "5d 18h" a day or more out, else as the daily one. */
export const rowCountdown = (seconds: number): string => {
  const left = Math.max(0, Math.floor(seconds));
  const days = Math.floor(left / DAY_SECONDS);
  if (days > 0) return `${days}d ${Math.floor((left % DAY_SECONDS) / 3_600)}h`;
  return pillCountdown(left);
};

/** "05:59": the server's time of day (UTC). */
export const serverTimeText = (now: number): string => {
  const date = new Date(Math.floor(now) * 1000);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

export type ResetRowId = "daily" | "weekly" | "weekend" | "krallen";

/** A plain reset, or an event's start or end. */
export type ResetPhase = "reset" | "starts" | "ends";

export interface ResetRow {
  readonly id: ResetRowId;
  readonly title: string;
  /** The small line under the title, or null. */
  readonly detail: string | null;
  /** When it happens, unix seconds (server clock). */
  readonly at: number;
  readonly phase: ResetPhase;
}

/** What the rows are read from besides the clock. */
export interface ResetSources {
  /** The weekend event as the server last sent it (`currentWeekend()`). */
  readonly weekend: WeekendState;
  /** The events list, or null before it is read (an outpost never reads it). */
  readonly events: readonly EventView[] | null;
}

/** The Krallen Hunt's kind in the events list (server `game-data/events/events.ts`). */
export const KRALLEN_HUNT_KIND = "krallen";

/** The weekend row: "ends in" while one runs, else "starts in" for the next; none when nothing is scheduled. */
const weekendRow = (now: number, state: WeekendState): ResetRow | null => {
  const on = runningWeekend(now, state);
  if (on) return { id: "weekend", title: "Weekend event", detail: on.title, at: on.endsAt, phase: "ends" };
  const next = state.next;
  if (!next || next.startsAt <= now) return null;
  return { id: "weekend", title: "Weekend event", detail: next.title, at: next.startsAt, phase: "starts" };
};

/** The Krallen Hunt row: the hunt on now ("ends in"), else one coming up ("starts in"). */
const krallenRow = (now: number, events: readonly EventView[] | null): ResetRow | null => {
  const hunts = (events ?? []).filter((event) => event.kind === KRALLEN_HUNT_KIND);
  const on = hunts.find((event) => event.status === "active" && now < event.endsAt);
  if (on) return { id: "krallen", title: on.title, detail: null, at: on.endsAt, phase: "ends" };
  const next = hunts
    .filter((event) => event.status === "upcoming" && now < event.startsAt)
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  return next ? { id: "krallen", title: next.title, detail: null, at: next.startsAt, phase: "starts" } : null;
};

/** Every reset that applies at `now`, in the list's order. */
export const resetRows = (now: number, sources: ResetSources): ResetRow[] => {
  const rows: (ResetRow | null)[] = [
    {
      id: "daily",
      title: "Daily",
      detail: "quests, gifts, help rewards, trade asks",
      at: nextDailyReset(now),
      phase: "reset",
    },
    { id: "weekly", title: "Weekly", detail: "quests, alliance goals", at: nextWeeklyReset(now), phase: "reset" },
    weekendRow(now, sources.weekend),
    krallenRow(now, sources.events),
  ];
  return rows.filter((row): row is ResetRow => row !== null);
};

/** A row's right-hand words: "18h 01m", "starts in 5d 18h", "ends in 15d 18h". */
export const rowTimeText = (row: ResetRow, now: number): string => {
  const left = rowCountdown(row.at - now);
  if (row.phase === "starts") return `starts in ${left}`;
  if (row.phase === "ends") return `ends in ${left}`;
  return left;
};
