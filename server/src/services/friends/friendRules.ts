/**
 * The friends limits and the small rules the routes share
 * (`docs/design/friends.md` §3.1, §6.2 and §7; owner-approved 2026-10-19).
 * Every daily limit turns over at 00:00 UTC (Q2).
 */

import { seenStepOf, type SeenStep } from "../user/seenStep.js";

export const FRIEND_LIMITS = {
  /** Friends a player can have (owner decision 2). */
  maxFriends: 100,
  /** Friends a player can pin to the top of their list (owner, beta 7). */
  maxPinned: 10,
  /** Requests a player can have waiting for an answer at once (Q9). */
  maxOpenRequests: 30,
  /** New requests a player can send in a UTC day (Q9). */
  maxRequestsPerDay: 30,
  /** A request nobody answered lapses after this many days (Q9). */
  requestLapseDays: 14,
  /** After a decline, the sender waits this many days to ask that player again (Q9). */
  declineWaitDays: 7,
  /** Gifts and help need this many hours of friendship (Q7; 12 since owner 2026-10-29, was 24); `canGiftFrom` reports it. */
  friendshipAgeHours: 12,
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

/**
 * How a friend's presence shows to their friends (Q12): coarse on purpose.
 * The five "last seen" steps (beta 9, `services/user/seenStep.ts`).
 */
export type OnlineStatus = SeenStep;

/**
 * A friend's presence as their friends see it (§6.2, Q12; beta 9 "last
 * seen"): online, today, this week, 1-4 weeks or over a month; a friend who
 * hides it shows only the last two ({@link seenStepOf}). `last_seen_at` is
 * never sent itself.
 */
export const onlineStatusOf = seenStepOf;

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
