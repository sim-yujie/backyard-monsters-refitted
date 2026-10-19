/**
 * The friends limits and the small rules the routes share
 * (`docs/design/friends.md` §3.1, §6.2 and §7; owner-approved 2026-10-19).
 * Every daily limit turns over at 00:00 UTC (Q2).
 */

export const FRIEND_LIMITS = {
  /** Friends a player can have (owner decision 2). */
  maxFriends: 100,
  /** Requests a player can have waiting for an answer at once (Q9). */
  maxOpenRequests: 30,
  /** New requests a player can send in a UTC day (Q9). */
  maxRequestsPerDay: 30,
  /** A request nobody answered lapses after this many days (Q9). */
  requestLapseDays: 14,
  /** After a decline, the sender waits this many days to ask that player again (Q9). */
  declineWaitDays: 7,
  /** Gifts and help need this many hours of friendship (Q7); `canGiftFrom` reports it. */
  friendshipAgeHours: 24,
  /** Helps a player can give in a UTC day (Q1); the help engine counts them (`services/friends/helpConfig.ts`). */
  dailyHelps: 20,
} as const;

const DAY_SECONDS = 24 * 60 * 60;

/** The start of the UTC day `now` falls in, unix seconds. */
export const utcDayStart = (now: number): number => now - (((now % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS);

/** A pending request made before this moment (unix seconds) has lapsed. */
export const lapseCutoff = (now: number): number => now - FRIEND_LIMITS.requestLapseDays * DAY_SECONDS;

/** When a request made at `createdAt` lapses, unix seconds. */
export const lapsesAt = (createdAt: number): number => createdAt + FRIEND_LIMITS.requestLapseDays * DAY_SECONDS;

/** When a sender declined at `declinedAt` may ask that player again, unix seconds. */
export const askAgainAt = (declinedAt: number): number => declinedAt + FRIEND_LIMITS.declineWaitDays * DAY_SECONDS;

/** How a friend's presence shows to their friends (Q12): coarse on purpose. */
export type OnlineStatus = "online" | "today" | "week" | "away";

/**
 * A friend's presence as their friends see it (§6.2, Q12): `null` when they
 * hide it; `online` when the server counts them online (`onlinePlayers`, the
 * same dot the maps show); otherwise how long ago they last opened their yard
 * (`last_seen_at`, never sent itself): within a day, within a week, or longer.
 *
 * @param {boolean} hidden - The friend turned "Show when I'm online" off
 * @param {boolean} online - The server counts them online now
 * @param {number | null} lastSeen - Their `last_seen_at`, unix seconds, or null
 * @param {number} now - Unix seconds
 */
export const onlineStatusOf = (hidden: boolean, online: boolean, lastSeen: number | null, now: number): OnlineStatus | null => {
  if (hidden) return null;
  if (online) return "online";
  if (lastSeen === null) return "away";
  const ago = now - lastSeen;
  if (ago < DAY_SECONDS) return "today";
  if (ago < 7 * DAY_SECONDS) return "week";
  return "away";
};

/** Unix seconds of a timestamp column as `pg` hands it back (a Date, or text for some drivers). */
export const secondsOf = (value: Date | string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/** A blocked list read from the `blocked_users` jsonb column: whole numbers only. */
export const blockedIdsOf = (value: unknown): number[] =>
  Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id)) : [];

/** Search text as a `LIKE` pattern's literal part: `%`, `_` and `\` matched as themselves. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);
