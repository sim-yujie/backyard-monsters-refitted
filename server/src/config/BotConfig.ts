import { Env } from "../enums/Env.js";

/**
 * The switches for Map Room 1 bot neighbours (issue #235,
 * `docs/design/bot-neighbours.md` §10). All three are off unless set to `on`,
 * so a server that has never heard of bots behaves exactly as before.
 *
 * - `BOTS_FILL`    — `on`: bots fill the Map Room 1 neighbour places real
 *                    players leave empty.
 * - `BOTS_BRAIN`   — `on`: the bot sweep runs (grow, repair, rebalance).
 * - `BOTS_REVENGE` — `on`: an attacked bot may attack back. Off stops new
 *                    revenge and cancels pending jobs.
 * - `BOTS_TOTAL`        — how many active bots to keep (default 500).
 * - `BOTS_PACE_SCALE`   — stretches the growth pace, {@link DAYS_ON_LEVEL}
 *                         (default 1; 0.1 grows ten times as fast, for dev).
 * - `BOTS_QUIET_RATE`   — the chance, each level a bot gains, that it goes
 *                         quiet: stops growing, as a player who quits or slows
 *                         down (default {@link DEFAULT_BOTS_QUIET_RATE}, 0-1).
 * - `BOTS_GROWING_FLOW` — how many growing bots a day pass each level once
 *                         the population settles; a new bot starts quiet
 *                         unless its level needs it growing for that
 *                         (default {@link DEFAULT_BOTS_GROWING_FLOW}). The main
 *                         lever on how many new bots a day are made.
 * - `BOTS_NEW_PER_DAY`  — at most this many new bots a day, made by the daily
 *                         rebalance on levels short of their share (default
 *                         {@link DEFAULT_BOTS_NEW_PER_DAY}).
 * - `BOTS_LEVEL_SLACK`  — how far a level may sit off its share before the
 *                         rebalance acts: more retires its extra bots, fewer
 *                         makes new ones (default {@link DEFAULT_BOTS_LEVEL_SLACK}).
 *
 * Each level's share of the total is {@link LEVEL_WEIGHTS}: even over 1-40.
 *
 * Not a switch: `seeded` is whether the sweep may tend the seeded Map Room 2
 * dev players' yards (issue #233, `services/bots/seededPlayers.ts`), true
 * everywhere but `ENV=production` ({@link seededYardsOn}).
 *
 * Read on each call rather than once at import, so tests can flip them.
 */

export const DEFAULT_BOTS_TOTAL = 500;
/** `[PLACEHOLDER]` defaults, from the population simulation (`population.test.ts`). */
export const DEFAULT_BOTS_QUIET_RATE = 0.1;
export const DEFAULT_BOTS_GROWING_FLOW = 0.3;
export const DEFAULT_BOTS_NEW_PER_DAY = 8;
export const DEFAULT_BOTS_LEVEL_SLACK = 2;

/**
 * Days a bot grows on each level, index 1-40 (index 0 is unused)
 * `[PLACEHOLDER]`: a real player's climb, fast early and slow late, until real
 * player data replaces it (`docs/design/bot-neighbours.md` §4.4). Read off
 * the active players' points, it takes about 1.5 days to reach level 10, 10
 * to reach 20, 90 to reach 30 and 600 to reach 40; a bot that grows through
 * level 40 too retires after about 900 days.
 */
export const DAYS_ON_LEVEL: readonly number[] = Object.freeze([
  0,
  // 1-10
  0.05, 0.07, 0.09, 0.11, 0.13, 0.15, 0.18, 0.21, 0.25, 0.3,
  // 11-20
  0.36, 0.43, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 2,
  // 21-30
  2.4, 3, 3.7, 4.6, 6.1, 7.7, 9.7, 12, 15, 17,
  // 31-40
  21, 26, 32, 39, 50, 62, 76, 94, 120, 290,
]);

/**
 * How much of the total each level 1-40 holds, index 0 is level 1
 * `[PLACEHOLDER]`: even, so every level has neighbours (decision 4).
 */
export const LEVEL_WEIGHTS: readonly number[] = Object.freeze(Array.from({ length: 40 }, () => 1));

/** Days a bot grows on each level: one number for every level (tests), or a table as {@link DAYS_ON_LEVEL}. */
export type Pace = number | readonly number[];

/** Days a bot grows on `level` at `pace`; past the table's end, its last level's. */
export const daysOn = (pace: Pace, level: number): number =>
  typeof pace === "number" ? pace : pace[Math.min(Math.max(1, level), pace.length - 1)]!;

/** Days of the climb from the bottom of `level` up to `position` (a level and the share into it); 0 below it. */
export const daysBetween = (level: number, position: number, pace: Pace): number => {
  if (position <= level) return 0;
  const top = Math.floor(position);
  let days = (position - top) * daysOn(pace, top);
  for (let at = level; at < top; at++) days += daysOn(pace, at);
  return days;
};

export interface BotConfig {
  readonly fill: boolean;
  readonly brain: boolean;
  readonly revenge: boolean;
  readonly total: number;
  readonly pace: Pace;
  /** The chance a bot goes quiet each level it gains, 0-1. */
  readonly quietRate: number;
  /** Growing bots a day passing each level once settled: how many new bots start growing. */
  readonly growingFlow: number;
  /** At most this many new bots a day. */
  readonly newPerDay: number;
  /** Bots a level may sit off its share before the rebalance acts. */
  readonly levelSlack: number;
  /** Seeded Map Room 2 dev players are repaired and grown too; absent reads as false. */
  readonly seeded?: boolean;
}

/** Whether seeded Map Room 2 dev yards may be given or tended with these variables: never on production. */
export const seededYardsOn = (env: Record<string, string | undefined>): boolean => env.ENV !== Env.PROD;

/** Whether a switch is turned on: `on` or `true`, any case; anything else is off. */
export const isSwitchOn = (raw: string | undefined): boolean => {
  const value = raw?.trim().toLowerCase();
  return value === "on" || value === "true";
};

/** A positive number from the environment, or the fallback when absent or not one. */
export const positiveNumber = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(value) && value > 0 ? value : fallback;
};

/** A number 0-1 from the environment, or the fallback when absent or not one. */
export const zeroToOne = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
};

/** A whole number 0 or more from the environment, or the fallback when absent or not one. */
export const wholeNumber = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isInteger(value) && value >= 0 ? value : fallback;
};

/** {@link DAYS_ON_LEVEL} stretched by `scale`. */
export const scaledPace = (scale: number): readonly number[] =>
  scale === 1 ? DAYS_ON_LEVEL : DAYS_ON_LEVEL.map((days) => days * scale);

/** The bot switches as the environment sets them now. */
export const botConfig = (): BotConfig => ({
  fill: isSwitchOn(process.env.BOTS_FILL),
  brain: isSwitchOn(process.env.BOTS_BRAIN),
  revenge: isSwitchOn(process.env.BOTS_REVENGE),
  total: Math.floor(positiveNumber(process.env.BOTS_TOTAL, DEFAULT_BOTS_TOTAL)) || DEFAULT_BOTS_TOTAL,
  pace: scaledPace(positiveNumber(process.env.BOTS_PACE_SCALE, 1)),
  quietRate: zeroToOne(process.env.BOTS_QUIET_RATE, DEFAULT_BOTS_QUIET_RATE),
  growingFlow: positiveNumber(process.env.BOTS_GROWING_FLOW, DEFAULT_BOTS_GROWING_FLOW),
  newPerDay: wholeNumber(process.env.BOTS_NEW_PER_DAY, DEFAULT_BOTS_NEW_PER_DAY),
  levelSlack: wholeNumber(process.env.BOTS_LEVEL_SLACK, DEFAULT_BOTS_LEVEL_SLACK),
  seeded: seededYardsOn(process.env),
});
