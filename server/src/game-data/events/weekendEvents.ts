/**
 * Weekend events (beta 7, owner grill item 26): one small boost each
 * weekend, rotating on its own, Saturday 00:00 to Sunday 23:59 server time.
 * The owner: "30% less, more, faster".
 *
 * - **Builder's Weekend** (`builders`): building upgrades started from the
 *   building panel cost 30% less (`services/yard/upgrade.ts`).
 * - **Tribe Plunder** (`plunder`): attacks on wild tribes bank 30% more loot
 *   (`services/events/weekendBoosts.ts` `withPlunderBonus`).
 * - **Study Weekend** (`study`): Academy training and Monster Lab research
 *   started during it take 30% less time (`services/yard/academy.ts`, `lab.ts`).
 * - **Hatch Rush** (`hatch`): monsters that start hatching during it take 30%
 *   less time (`services/yard/production.ts` `rush`).
 *
 * Everything here is the DEFAULT. The live settings (which event when, the
 * percentages, the rotation, skips and swaps, switching it off) are kept in
 * the database and changed from the owner's dashboard without a release
 * (`services/events/weekendSettings.ts`, `GET/POST /api/v1/admin/weekend`).
 */

export const WEEKEND_EVENT_IDS = ["builders", "plunder", "study", "hatch"] as const;

export type WeekendEventId = (typeof WEEKEND_EVENT_IDS)[number];

export const isWeekendEventId = (raw: unknown): raw is WeekendEventId =>
  typeof raw === "string" && (WEEKEND_EVENT_IDS as readonly string[]).includes(raw);

/** What one weekend event is called and the one line that says what it does. */
export interface WeekendEventInfo {
  readonly id: WeekendEventId;
  readonly title: string;
  /** Short, for the banner: `{p}` is the percentage. */
  readonly line: string;
}

export const WEEKEND_EVENT_INFO: Readonly<Record<WeekendEventId, WeekendEventInfo>> = {
  builders: { id: "builders", title: "Builder's Weekend", line: "Upgrades cost {p}% less" },
  plunder: { id: "plunder", title: "Tribe Plunder", line: "Wild tribes give {p}% more loot" },
  study: { id: "study", title: "Study Weekend", line: "Academy and Lab {p}% faster" },
  hatch: { id: "hatch", title: "Hatch Rush", line: "Hatching {p}% faster" },
};

/** The line with its percentage filled in. */
export const weekendLine = (id: WeekendEventId, percent: number): string =>
  WEEKEND_EVENT_INFO[id].line.replace("{p}", String(percent));

/** A weekend's own choice from the dashboard: another event, or none. */
export type WeekendOverride = WeekendEventId | "skip";

/** An event switched on by hand, now, until `until` (unix seconds). */
export interface ForcedWeekendEvent {
  readonly id: WeekendEventId;
  /** Unix seconds it was switched on. */
  readonly since: number;
  /** Unix seconds it ends. */
  readonly until: number;
}

/**
 * Everything the owner can change from the dashboard. Times are whole
 * minutes or hours so the dashboard's form stays simple.
 */
export interface WeekendSettings {
  /** Off: no weekend event runs and none is announced (a forced one is cleared with it). */
  readonly enabled: boolean;
  /** The events in rotation order; one per weekend, then round again. */
  readonly rotation: readonly WeekendEventId[];
  /** Each event's percentage, 1..90. */
  readonly percent: Readonly<Record<WeekendEventId, number>>;
  /** `YYYY-MM-DD`, a Saturday: the weekend `rotation[0]` runs. */
  readonly firstWeekend: string;
  /**
   * The server time zone the weekend is read in, minutes east of UTC. 0:
   * Saturday 00:00 UTC to Sunday 23:59 UTC (ASSUMED: the game's server clock
   * and every other event run on UTC).
   */
  readonly utcOffsetMinutes: number;
  /** How long a weekend event lasts from Saturday 00:00, hours (48: to Sunday 23:59:59). */
  readonly lengthHours: number;
  /** How long before the start the pop-up announces it, hours (24: Friday 00:00). */
  readonly announceHours: number;
  /** Per weekend (`YYYY-MM-DD` of its Saturday): swap in another event, or skip it. */
  readonly overrides: Readonly<Record<string, WeekendOverride>>;
  /** Switched on by hand now, whatever the day; null when not. */
  readonly forced: ForcedWeekendEvent | null;
}

/**
 * The default: on, the four events in the owner's order, 30% each, the
 * rotation starting with Builder's Weekend on Saturday 14 November 2026
 * (the first weekend after beta 7 is due; ASSUMED).
 */
export const DEFAULT_WEEKEND_SETTINGS: WeekendSettings = {
  enabled: true,
  rotation: ["builders", "plunder", "study", "hatch"],
  percent: { builders: 30, plunder: 30, study: 30, hatch: 30 },
  firstWeekend: "2026-11-14",
  utcOffsetMinutes: 0,
  lengthHours: 48,
  announceHours: 24,
  overrides: {},
  forced: null,
};

/** Limits the dashboard's form is held to. */
export const WEEKEND_LIMITS = {
  minPercent: 1,
  maxPercent: 90,
  /** -12h .. +14h, the world's time zones. */
  minOffsetMinutes: -12 * 60,
  maxOffsetMinutes: 14 * 60,
  minLengthHours: 1,
  maxLengthHours: 72,
  maxAnnounceHours: 72,
  /** The longest a forced event may run, hours. */
  maxForceHours: 72,
  /** Overrides kept: older weekends than this many days ago are dropped on save. */
  keepOverrideDays: 28,
} as const;
