/**
 * At most N Telegram messages of one kind an hour (UTC clock hours). The
 * Nth says the rest of the hour is only counted; when the hour ends one
 * message says how many more there were. The count is this server's own,
 * in memory: a restart starts it again, and a server stopped mid-hour never
 * sends that hour's summary.
 */

const HOUR_MS = 60 * 60 * 1000;

/** What to do with one alert. */
export interface CapTurn {
  /** Send this one. */
  readonly send: boolean;
  /** It is the hour's last one: say the rest are only counted. */
  readonly last: boolean;
  /** Start the end-of-hour summary's timer (the hour's first held-back alert). */
  readonly startSummary: boolean;
}

/** One hour's held-back alerts. */
export interface CapSummary {
  /** How many were not sent. */
  readonly count: number;
  /** The hour's start (ms). */
  readonly from: number;
}

export class HourlyCap {
  private hour = -1;
  private sent = 0;
  private held = 0;

  constructor(readonly perHour: number) {}

  /** The turn of one alert at `now` (ms). A held-back count from an earlier hour is left for {@link summary}. */
  take(now: number): CapTurn & { missed: CapSummary | null } {
    const missed = this.roll(now);
    if (this.sent < this.perHour) {
      this.sent++;
      return { send: true, last: this.sent === this.perHour, startSummary: false, missed };
    }
    this.held++;
    return { send: false, last: false, startSummary: this.held === 1, missed };
  }

  /** The held-back count of an hour that has ended by `now`, once; null when there is none. */
  summary(now: number): CapSummary | null {
    return this.roll(now);
  }

  /** For tests: forget everything. */
  reset(): void {
    this.hour = -1;
    this.sent = 0;
    this.held = 0;
  }

  /** Moves to `now`'s hour; returns the ended hour's held-back count, if any. */
  private roll(now: number): CapSummary | null {
    const hour = Math.floor(now / HOUR_MS);
    if (hour === this.hour) return null;
    const missed = this.hour >= 0 && this.held > 0 ? { count: this.held, from: this.hour * HOUR_MS } : null;
    this.hour = hour;
    this.sent = 0;
    this.held = 0;
    return missed;
  }
}

/** Milliseconds from `now` to just after its hour ends. */
export const untilHourEnds = (now: number): number => HOUR_MS - (now % HOUR_MS) + 1000;

/** "14:00-15:00 UTC": the hour starting at `from` (ms). */
export const hourWords = (from: number): string => {
  const hh = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  return `${hh(from)}-${hh(from + HOUR_MS)} UTC`;
};
