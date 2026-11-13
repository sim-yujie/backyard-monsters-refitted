/**
 * The mini weekend event: one 30% boost each weekend, Saturday 00:00 to
 * Sunday 23:59 server time (`server/src/services/events/weekendSchedule.ts`).
 *
 * The server decides which event runs and enforces every effect; the client
 * only shows the same numbers. The yard hears the state from `/base/load`'s
 * `weekend` and from `GET /bm/weekend` (`game/yard/plugins/weekend.ts`), through
 * {@link setWeekend}. The arithmetic below mirrors
 * `server/src/services/events/weekendBoosts.ts` exactly, so a price or a time
 * shown here is the one the server charges.
 */

export type WeekendEventId = "builders" | "plunder" | "study" | "hatch";

export const WEEKEND_EVENT_IDS: readonly WeekendEventId[] = ["builders", "plunder", "study", "hatch"];

/** One weekend event's run, as the server sends it. */
export interface WeekendRun {
  readonly id: WeekendEventId;
  readonly title: string;
  /** "Upgrades cost 30% less". */
  readonly line: string;
  readonly percent: number;
  /** `YYYY-MM-DD` of its Saturday; `forced-<since>` for a run switched on by hand. */
  readonly key: string;
  readonly startsAt: number;
  readonly endsAt: number;
  /** When the Friday pop-up starts announcing it. */
  readonly announceAt: number;
  readonly forced: boolean;
}

export interface WeekendState {
  readonly active: WeekendRun | null;
  readonly next: WeekendRun | null;
}

const EMPTY: WeekendState = { active: null, next: null };

const isId = (raw: unknown): raw is WeekendEventId =>
  typeof raw === "string" && (WEEKEND_EVENT_IDS as readonly string[]).includes(raw);

const num = (raw: unknown): number => (typeof raw === "number" && Number.isFinite(raw) ? raw : 0);

/** One run from the wire, or null when it is not one. */
export const readRun = (raw: unknown): WeekendRun | null => {
  if (!raw || typeof raw !== "object") return null;
  const run = raw as Record<string, unknown>;
  if (!isId(run.id)) return null;
  const percent = num(run.percent);
  const startsAt = num(run.startsAt);
  const endsAt = num(run.endsAt);
  if (percent <= 0 || endsAt <= startsAt) return null;
  return {
    id: run.id,
    title: typeof run.title === "string" ? run.title : run.id,
    line: typeof run.line === "string" ? run.line : "",
    percent,
    key: typeof run.key === "string" ? run.key : String(startsAt),
    startsAt,
    endsAt,
    announceAt: num(run.announceAt) || startsAt,
    forced: run.forced === true,
  };
};

/** `{ active, next }` from the wire; anything malformed reads as no event. */
export const readWeekendState = (raw: unknown): WeekendState => {
  if (!raw || typeof raw !== "object") return EMPTY;
  const state = raw as Record<string, unknown>;
  return { active: readRun(state.active), next: readRun(state.next) };
};

/**
 * The player's daily check-in for the run on now (owner, 13 Nov 2026: 50
 * Glimmers each event day; `server/src/services/events/weekendCoins.ts`).
 * An event day is each 24 h from the run's start: Saturday, then Sunday.
 */
export interface WeekendCheckin {
  /** The run it belongs to. */
  readonly key: string;
  /** Glimmers one check-in pays. */
  readonly amount: number;
  /** Today's day of the run, 1-based. */
  readonly day: number;
  readonly days: number;
  readonly claimedToday: boolean;
  /** The days to draw (every day; for a long test run, yesterday and today). */
  readonly marks: readonly { readonly day: number; readonly claimed: boolean }[];
  /** When the next day starts, or null on the last day. */
  readonly nextAt: number | null;
}

/** A check-in from the wire, or null when it is not one. */
export const readCheckin = (raw: unknown): WeekendCheckin | null => {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const day = num(c.day);
  const amount = num(c.amount);
  if (typeof c.key !== "string" || day < 1 || amount <= 0) return null;
  const marks = Array.isArray(c.marks)
    ? c.marks.flatMap((mark: unknown) => {
        if (!mark || typeof mark !== "object") return [];
        const m = mark as Record<string, unknown>;
        return num(m.day) >= 1 ? [{ day: num(m.day), claimed: m.claimed === true }] : [];
      })
    : [];
  return {
    key: c.key,
    amount,
    day,
    days: Math.max(day, num(c.days)),
    claimedToday: c.claimedToday === true,
    marks,
    nextAt: typeof c.nextAt === "number" && c.nextAt > 0 ? c.nextAt : null,
  };
};

const DAY = 86_400;

/**
 * `checkin` as it stands at `t`: once its next day has begun (the page left
 * open over midnight) that day is today and not checked in, until the
 * server's next answer says more.
 */
export const checkinAt = (checkin: WeekendCheckin, t: number): WeekendCheckin => {
  let now = checkin;
  while (now.nextAt !== null && t >= now.nextAt) {
    const day = now.day + 1;
    const marks = now.marks.some((mark) => mark.day === day)
      ? now.marks
      : [...now.marks.slice(-1), { day, claimed: false }];
    now = {
      ...now,
      day,
      claimedToday: false,
      marks,
      nextAt: day < now.days ? now.nextAt + DAY : null,
    };
  }
  return now;
};

type Listener = (state: WeekendState) => void;

let current: WeekendState = EMPTY;
let checkin: WeekendCheckin | null = null;
/** Server clock minus the browser's, seconds. */
let offset = 0;
const listeners = new Set<Listener>();

const browserNow = (): number => Math.floor(Date.now() / 1000);

/** The server's clock now, unix seconds, as best the client knows it. */
export const weekendNow = (): number => browserNow() + offset;

/** The last state the server sent. */
export const currentWeekend = (): WeekendState => current;

const sameRun = (a: WeekendRun | null, b: WeekendRun | null): boolean =>
  a === b ||
  (!!a && !!b && a.key === b.key && a.id === b.id && a.percent === b.percent && a.endsAt === b.endsAt);

/**
 * Takes the server's state (and its clock, to read times against). Listeners
 * hear only a change.
 */
export const setWeekend = (state: WeekendState, serverNow?: number): void => {
  if (typeof serverNow === "number" && Number.isFinite(serverNow) && serverNow > 0) {
    offset = serverNow - browserNow();
  }
  if (sameRun(state.active, current.active) && sameRun(state.next, current.next)) return;
  current = state;
  for (const listener of listeners) listener(state);
};

/** Takes the player's check-in (the yard load, `GET /bm/weekend`, a check-in's answer); listeners hear it. */
export const setWeekendCheckin = (next: WeekendCheckin | null): void => {
  checkin = next;
  for (const listener of listeners) listener(current);
};

/**
 * The player's check-in for `run` at `t`, or null when the client holds
 * none for that run (an older server, a read that failed).
 */
export const weekendCheckin = (run: Pick<WeekendRun, "key"> | null, t: number = weekendNow()): WeekendCheckin | null =>
  run && checkin && checkin.key === run.key ? checkinAt(checkin, t) : null;

/** Whether a check-in waits for the player at `t`: a run is on and today is not checked in. */
export const checkinWaiting = (t: number = weekendNow()): boolean => {
  const state = weekendCheckin(runningWeekend(t), t);
  return !!state && !state.claimedToday;
};

/** Calls `listener` on every change. Returns the unsubscribe. */
export const onWeekendChange = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** For tests: back to no event and the browser's clock. */
export const resetWeekend = (): void => {
  current = EMPTY;
  checkin = null;
  offset = 0;
  listeners.clear();
};

const runsAt = (run: WeekendRun | null, t: number): boolean => !!run && run.startsAt <= t && t < run.endsAt;

/**
 * The event running at `t` (server seconds): the active one, or the next once
 * its Saturday has come (so the yard flips at midnight without asking).
 */
export const runningWeekend = (t: number = weekendNow(), state: WeekendState = current): WeekendRun | null =>
  runsAt(state.active, t) ? state.active : runsAt(state.next, t) ? state.next : null;

/** The coming event being announced at `t` (Friday): announced, not started yet. */
export const announcedWeekend = (t: number = weekendNow(), state: WeekendState = current): WeekendRun | null => {
  const next = state.next;
  if (!next || runningWeekend(t, state)) return null;
  return next.announceAt <= t && t < next.startsAt ? next : null;
};

/** The percentage of `id` running at `t`, or 0. */
export const weekendPercent = (id: WeekendEventId, t: number = weekendNow()): number => {
  const run = runningWeekend(t);
  return run && run.id === id ? run.percent : 0;
};

/* ── The server's arithmetic (`weekendBoosts.ts`) ─────────────────────── */

/** `amount` less `percent`%, rounded up. */
export const lessByPercent = (amount: number, percent: number): number =>
  percent > 0 && amount > 0 ? Math.ceil((amount * (100 - percent)) / 100) : amount;

/** `amount` plus `percent`%, rounded down. */
export const moreByPercent = (amount: number, percent: number): number =>
  percent > 0 && amount > 0 ? Math.floor((amount * (100 + percent)) / 100) : amount;

/** A timer `percent`% shorter, at least 1 second. */
export const shorterBy = (seconds: number, percent: number): number =>
  percent > 0 && seconds > 0 ? Math.max(1, Math.ceil((seconds * (100 - percent)) / 100)) : seconds;

/** Every resource of a cost less `percent`%. */
export const costLessBy = <T extends { readonly [K in keyof T]: number }>(cost: T, percent: number): T =>
  Object.fromEntries(
    Object.entries(cost).map(([key, value]) => [key, lessByPercent(value as number, percent)]),
  ) as T;
