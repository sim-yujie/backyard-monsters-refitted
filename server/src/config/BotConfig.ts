import { Env } from "../enums/Env.js";
import { positiveNumber } from "./envValues.js";

/**
 * What is left of the Map Room 1 bot settings. **Bots are decommissioned**
 * (owner, 12 Nov 2026: "bots can be decommissioned from game. we have a
 * sufficiently big population now."; 13 Nov). The bot sweep, the neighbour
 * fill, revenge and their switches (`BOTS_FILL`, `BOTS_BRAIN`,
 * `BOTS_REVENGE`, `BOTS_TOTAL`, `BOTS_QUIET_*`, `BOTS_GROWING_FLOW`,
 * `BOTS_NEW_PER_DAY`, `BOTS_FRESH_PER_DAY`, `BOTS_LEVEL_SLACK`) were removed in
 * beta 9; the retired bots' accounts stay, kept out by `isBot`.
 *
 * What remains serves the seeded Map Room 2 dev players (`db:seed:mr2`,
 * `services/bots/seededPlayers.ts`), whose yards the bots' yard generator
 * draws, and the tests that make bot accounts:
 *
 * - `BOTS_FLOOR_LEVEL` — the level floor the generator draws from (default
 *                        {@link DEFAULT_BOTS_FLOOR_LEVEL}, a whole number
 *                        {@link LOWEST_BOT_FLOOR_LEVEL}-{@link BOT_TOP_LEVEL}).
 * - `BOTS_PACE_SCALE`  — stretches the growth pace, {@link DAYS_ON_LEVEL}
 *                        (default 1), which places a drawn yard within its level.
 *
 * Read on each call rather than once at import, so tests can change them.
 */

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

/** The level floor as `BOTS_FLOOR_LEVEL` sets it now: a whole number 15-40, else {@link DEFAULT_BOTS_FLOOR_LEVEL}. */
export const botFloorLevel = (raw: string | undefined = process.env.BOTS_FLOOR_LEVEL): number => {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isInteger(value) && value >= LOWEST_BOT_FLOOR_LEVEL && value <= BOT_TOP_LEVEL
    ? value
    : DEFAULT_BOTS_FLOOR_LEVEL;
};

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

/** Whether seeded Map Room 2 dev yards may be given with these variables: never on production. */
export const seededYardsOn = (env: Record<string, string | undefined>): boolean => env.ENV !== Env.PROD;

/** {@link DAYS_ON_LEVEL} stretched by `BOTS_PACE_SCALE` (a positive number; anything else reads as 1). */
export const botPace = (raw: string | undefined = process.env.BOTS_PACE_SCALE): Pace => {
  const scale = positiveNumber(raw, 1);
  return scale === 1 ? DAYS_ON_LEVEL : DAYS_ON_LEVEL.map((days) => days * scale);
};
