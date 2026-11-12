import { Env } from "../enums/Env.js";

/**
 * **Bots are retired** (owner, 12 Nov 2026: "bots can be decommissioned from
 * game. we have a sufficiently big population now."). {@link BOTS_RETIRED}
 * holds {@link botConfig} to: no bot fills a neighbour list (`fill` false
 * whatever `BOTS_FILL` says), no revenge (`revenge` false whatever
 * `BOTS_REVENGE` says), and the sweep (`brain`) never on production; outside
 * production `BOTS_BRAIN=on` still runs it, for the seeded Map Room 2 dev
 * players alone (`retired`: it makes, grows and rebalances no bot). The
 * one-time move of every active bot off Map Room 1 is the migration
 * `20261117_RetireBots.ts`. The switches and numbers below are kept only for
 * the tests of the old machinery, which pass their own config.
 *
 * The switches for Map Room 1 bot neighbours (issue #235,
 * `docs/design/bot-neighbours.md` §10). All three are off unless set to `on`,
 * so a server that has never heard of bots behaves exactly as before.
 *
 * - `BOTS_FILL`    — `on`: bots fill the Map Room 1 neighbour places real
 *                    players leave empty.
 * - `BOTS_BRAIN`   — `on`: the bot sweep runs (grow, repair, rebalance).
 * - `BOTS_REVENGE` — `on`: an attacked bot may attack back. Off stops new
 *                    revenge and cancels pending jobs.
 * - `BOTS_FLOOR_LEVEL`  — no active bot stands below this level, and new
 *                         bots start there (default
 *                         {@link DEFAULT_BOTS_FLOOR_LEVEL}, a whole number
 *                         {@link LOWEST_BOT_FLOOR_LEVEL}-{@link BOT_TOP_LEVEL};
 *                         anything else reads as the default). Raising it
 *                         retires the bots below it on the next daily
 *                         rebalance ({@link botFloorLevel}).
 * - `BOTS_TOTAL`        — how many active bots to keep (default
 *                         {@link defaultBotsTotal}: {@link DEFAULT_BOTS_PER_LEVEL}
 *                         for each level from the floor to 40, 185 at the
 *                         default floor).
 * - `BOTS_PACE_SCALE`   — stretches the growth pace, {@link DAYS_ON_LEVEL}
 *                         (default 1; 0.1 grows ten times as fast, for dev).
 * - `BOTS_QUIET_RATE`   — the chance, each level a bot gains, that it goes
 *                         quiet: stops growing, as a player who quits or slows
 *                         down (default {@link DEFAULT_BOTS_QUIET_RATE}, 0-1).
 * - `BOTS_QUIET_ONLINE` — the chance a quiet bot shows online on a grow (one
 *                         every 2-6 hours), where a growing bot always does
 *                         (default {@link DEFAULT_BOTS_QUIET_ONLINE}, 0-1).
 * - `BOTS_GROWING_FLOW` — how many growing bots a day pass each level once
 *                         the population settles; a new bot starts quiet
 *                         unless its level needs it growing for that
 *                         (default {@link DEFAULT_BOTS_GROWING_FLOW}). The main
 *                         lever on how many new bots a day are made.
 * - `BOTS_NEW_PER_DAY`  — at most this many new bots a day, made by the daily
 *                         rebalance on levels short of their share (default
 *                         {@link DEFAULT_BOTS_NEW_PER_DAY}).
 * - `BOTS_FRESH_PER_DAY` — how many new bots a day, on average, start at
 *                         the bottom of the level floor (`BOTS_FLOOR_LEVEL`)
 *                         and grow (and quit) like players from there; each
 *                         takes the place of a quiet bot on the most crowded
 *                         level once the total is full (default
 *                         {@link DEFAULT_BOTS_FRESH_PER_DAY}, 0 turns it off).
 *                         Counted in `BOTS_NEW_PER_DAY`. (Was
 *                         `BOTS_LEVEL1_PER_DAY` while bots started at level 1.)
 * - `BOTS_LEVEL_SLACK`  — how far a level may sit off its share before the
 *                         rebalance acts: more retires its extra bots, fewer
 *                         makes new ones (default {@link DEFAULT_BOTS_LEVEL_SLACK}).
 *
 * Each level's share of the total is {@link levelWeights}: even from the
 * floor to 40, none below.
 *
 * Not a switch: `seeded` is whether the sweep may tend the seeded Map Room 2
 * dev players' yards (issue #233, `services/bots/seededPlayers.ts`), true
 * everywhere but `ENV=production` ({@link seededYardsOn}).
 *
 * Read on each call rather than once at import, so tests can flip them.
 */

/** `[PLACEHOLDER]` defaults, from the population simulation (`population.test.ts`). */
export const DEFAULT_BOTS_GROWING_FLOW = 0.3;
/** `[PLACEHOLDER]`: halved from 0.1 so more bots started at level 1 grow on through levels 5-30 (owner, 2026-10-23). */
export const DEFAULT_BOTS_QUIET_RATE = 0.05;
/** `[PLACEHOLDER]`: a quiet bot shows online about once in three days, a growing one several times a day (owner, 2026-10-23). */
export const DEFAULT_BOTS_QUIET_ONLINE = 0.05;
export const DEFAULT_BOTS_NEW_PER_DAY = 8;
/** `[PLACEHOLDER]`: three new players' worth of bots a day, so the lower levels see some bots grow (owner, 2026-10-23). */
export const DEFAULT_BOTS_FRESH_PER_DAY = 3;
export const DEFAULT_BOTS_LEVEL_SLACK = 2;

/** The top level a bot stands on; past it a bot retires (decision 17). */
export const BOT_TOP_LEVEL = 40;

/**
 * The lowest level `BOTS_FLOOR_LEVEL` takes (owner, 2026-10-23). The smallest
 * yard a bot shows (`MINIMUM_YARD`, `progression.ts`: Town Hall 2, every
 * resource building and tower it allows, Housing with an army) comes at
 * level 10-15, so no floor goes below 15, and a bot made on the floor keeps
 * building until it has both.
 */
export const LOWEST_BOT_FLOOR_LEVEL = 15;

/**
 * No active bot stands below this level unless `BOTS_FLOOR_LEVEL` says
 * otherwise (owner 3 Nov 2026, was 15 from 2026-10-23): enough real players
 * now stand on the lower levels, so the bots below 25 retire and the higher
 * ones stay.
 */
export const DEFAULT_BOTS_FLOOR_LEVEL = 25;

/**
 * Players under this level are shown no bots, only real players (owner 3 Nov
 * 2026). From it up a list takes bots from the floor up
 * (`botLevelWindow`, `services/bots/botNeighbours.ts`).
 */
export const BOTS_SHOWN_FROM_LEVEL = 15;

/**
 * Active bots kept on each level from the floor up when `BOTS_TOTAL` is not
 * set: the 300 live bots over levels 15-40 before the floor rose (owner 3 Nov
 * 2026), so each level keeps about as many bots when the floor moves.
 */
export const DEFAULT_BOTS_PER_LEVEL = 300 / 26;

/** The level floor as `BOTS_FLOOR_LEVEL` sets it now: a whole number 15-40, else {@link DEFAULT_BOTS_FLOOR_LEVEL}. */
export const botFloorLevel = (raw: string | undefined = process.env.BOTS_FLOOR_LEVEL): number => {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isInteger(value) && value >= LOWEST_BOT_FLOOR_LEVEL && value <= BOT_TOP_LEVEL
    ? value
    : DEFAULT_BOTS_FLOOR_LEVEL;
};

/** `BOTS_TOTAL`'s default for a floor: {@link DEFAULT_BOTS_PER_LEVEL} on each level from it to 40, rounded. */
export const defaultBotsTotal = (floor: number = botFloorLevel()): number =>
  Math.round(DEFAULT_BOTS_PER_LEVEL * (BOT_TOP_LEVEL - floor + 1));

/**
 * Days a bot grows on each level, index 1-40 (index 0 is unused): a real
 * player's climb (`docs/design/bot-neighbours.md` §4.4). Bots start at the
 * floor (`BOTS_FLOOR_LEVEL`), so only the levels from it to 40 are walked: a
 * bot started there takes as long from the floor up as a real player does.
 *
 * Source: the live game's 24 real players on 2026-10-23, all under 13 days
 * old (the owner's query; a player's age is an upper bound on how long they
 * took). Levels 11-12 were reached in about a day, 17 in 1-1.3 days, 21 and 25
 * in about 6 and 26 in about 12. The table reaches level 12 at 0.6 days, 17 at
 * 1.1, 21 at 2.1, 25 at 5.9 and 26 at 8. From level 17 each level takes 1.4
 * times the one before; past 26 there is no data, and each level needs about
 * 1.4 times the points of the one before, so the same rule carries on. That
 * reaches level 30 at about 28 days, 35 at 150 and 40 at 800; a bot that
 * grows through level 40 too retires after about 1,100 days.
 */
export const DAYS_ON_LEVEL: readonly number[] = Object.freeze([
  0,
  // 1-10: the first half day
  0.02, 0.03, 0.04, 0.04, 0.05, 0.05, 0.06, 0.06, 0.07, 0.08,
  // 11-20
  0.09, 0.09, 0.1, 0.1, 0.11, 0.12, 0.14, 0.2, 0.27, 0.38,
  // 21-30
  0.54, 0.75, 1.05, 1.5, 2.1, 2.9, 4, 5.6, 7.9, 11,
  // 31-40
  15, 22, 30, 42, 59, 83, 116, 162, 227, 318,
]);

/**
 * How much of the total each level 1-40 holds, index 0 is level 1
 * `[PLACEHOLDER]`: even from `floor` to 40, so every level there has
 * neighbours (decision 4), and none below the floor (owner, 2026-10-23).
 */
export const levelWeights = (floor: number = botFloorLevel()): readonly number[] =>
  Array.from({ length: BOT_TOP_LEVEL }, (_, index) => (index + 1 >= floor ? 1 : 0));

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
  /** The chance a quiet bot shows online on a grow, 0-1; absent reads as {@link DEFAULT_BOTS_QUIET_ONLINE}. */
  readonly quietOnline?: number;
  /** Growing bots a day passing each level once settled: how many new bots start growing. */
  readonly growingFlow: number;
  /** At most this many new bots a day. */
  readonly newPerDay: number;
  /** New growing bots a day, on average, started at the bottom of the floor level; absent reads as 0. */
  readonly freshPerDay?: number;
  /** Bots a level may sit off its share before the rebalance acts. */
  readonly levelSlack: number;
  /** Seeded Map Room 2 dev players are repaired and grown too; absent reads as false. */
  readonly seeded?: boolean;
  /**
   * Map Room 1 bots are retired ({@link BOTS_RETIRED}): the sweep books no
   * grow for an active bot, drops any job it finds for one, and runs no
   * rebalance, so no bot is made, grown or retired by it; seeded dev players
   * are still tended. Absent reads as false.
   */
  readonly retired?: boolean;
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

/** A number 0 or more from the environment, or the fallback when absent or not one. */
export const zeroOrMore = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(value) && value >= 0 ? value : fallback;
};

/** A whole number 0 or more from the environment, or the fallback when absent or not one. */
export const wholeNumber = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isInteger(value) && value >= 0 ? value : fallback;
};

/** {@link DAYS_ON_LEVEL} stretched by `scale`. */
export const scaledPace = (scale: number): readonly number[] =>
  scale === 1 ? DAYS_ON_LEVEL : DAYS_ON_LEVEL.map((days) => days * scale);

/**
 * Map Room 1 bots are retired for good (owner, 12 Nov 2026; the file
 * comment). While true, {@link botConfig} ignores `BOTS_FILL` and
 * `BOTS_REVENGE`, and `BOTS_BRAIN` only outside production.
 */
export const BOTS_RETIRED = true;

/** The bot switches as the environment sets them now, held off while {@link BOTS_RETIRED}. */
export const botConfig = (): BotConfig => ({
  fill: !BOTS_RETIRED && isSwitchOn(process.env.BOTS_FILL),
  brain: isSwitchOn(process.env.BOTS_BRAIN) && (!BOTS_RETIRED || seededYardsOn(process.env)),
  revenge: !BOTS_RETIRED && isSwitchOn(process.env.BOTS_REVENGE),
  retired: BOTS_RETIRED,
  total: Math.floor(positiveNumber(process.env.BOTS_TOTAL, defaultBotsTotal())) || defaultBotsTotal(),
  pace: scaledPace(positiveNumber(process.env.BOTS_PACE_SCALE, 1)),
  quietRate: zeroToOne(process.env.BOTS_QUIET_RATE, DEFAULT_BOTS_QUIET_RATE),
  quietOnline: zeroToOne(process.env.BOTS_QUIET_ONLINE, DEFAULT_BOTS_QUIET_ONLINE),
  growingFlow: positiveNumber(process.env.BOTS_GROWING_FLOW, DEFAULT_BOTS_GROWING_FLOW),
  newPerDay: wholeNumber(process.env.BOTS_NEW_PER_DAY, DEFAULT_BOTS_NEW_PER_DAY),
  freshPerDay: zeroOrMore(process.env.BOTS_FRESH_PER_DAY, DEFAULT_BOTS_FRESH_PER_DAY),
  levelSlack: wholeNumber(process.env.BOTS_LEVEL_SLACK, DEFAULT_BOTS_LEVEL_SLACK),
  seeded: seededYardsOn(process.env),
});
