import { daysBetween, daysOn, type Pace } from "../../config/BotConfig.js";
import { BOT_MAX_LEVEL, BOT_MIN_LEVEL } from "./factory.js";

/**
 * How the bot population climbs and is kept even over levels 15-40
 * (`docs/design/bot-neighbours.md` §4.4). Everything here is pure; the sweep
 * (`sweep.ts`) reads the rows, runs these and writes.
 *
 * ## The pace
 *
 * A bot grows at a real player's speed: `BotConfig.pace` days on each level,
 * fast early and slow late (`DAYS_ON_LEVEL`). Its place on the climb is its
 * level plus the time since `level_since` walked along that table
 * ({@link pacePosition}), so a bot that could not grow for a while (damaged,
 * under attack) catches up on its next grow, across as many levels as the
 * time covers. When the yard's level changes, `level_since` is moved so the
 * place stays where it was ({@link anchorFor}).
 *
 * ## Quiet bots
 *
 * Each level a bot gains, it has `BotConfig.quietRate` chance to go quiet
 * ({@link drawQuiet}): to stop growing at some point of the level it is on,
 * as a player who quits or slows down. (Bots no longer start below level 15,
 * so the higher early chance real players show at levels 1-4 is gone, owner
 * 2026-10-23.) From `quiet_since` on its place on the
 * climb stands still; the sweep still repairs it, refills it and keeps its
 * loot in band. A quiet bot never wakes up again. A new bot, from the fill or
 * the rebalance, starts quiet by its level's settled mix ({@link bornQuietShare}).
 * Without that, every new bot on a short level would grow, leave the level
 * within days and need a new one in turn, and the population would churn
 * several new bots a day.
 *
 * ## The daily rebalance
 *
 * Every level should hold its share of the total ({@link planRebalance}). A
 * bot below the level floor (`BOT_MIN_LEVEL`, 15) is always retired, all of
 * them on the first rebalance after the floor came in (owner, 2026-10-23):
 * neighbour lists already skip them, and raising them in place would only
 * pile them all on level 15, where the crowded-level rule would retire them
 * the next day; the band-filling below makes their places up on 15-40. A
 * level more than `BotConfig.levelSlack` bots over its share retires bots
 * down to it, quiet ones first (longest quiet first), then growing ones
 * (longest on the level first). A level more than the slack short gets new
 * bots made right at that level, with a yard the generator draws for it, at
 * most `BotConfig.newPerDay` a day, the shortest levels first. The total is
 * never passed: when it is full, a new bot's place is freed on the level most
 * over its share.
 *
 * Because a growing bot spends under a day on each level up to 22, and short
 * levels are only ever the high ones (quiet bots never leave a level, so lower
 * ones never run short), the band-filling alone would leave nearly every bot
 * on the lower levels quiet. So each day also starts about
 * `BotConfig.freshPerDay` new bots at the bottom of level 15, the floor
 * ({@link birthsToday}), growing, to climb and quit as players do from there.
 * They come first, within the daily cap; once the total is full,
 * each takes the place of a quiet bot on the most crowded level
 * ({@link planRebalance}). Neighbour lists are drawn fresh
 * from a level window each time (`botNeighbours.ts`), so a player still meets
 * different bots as they climb.
 */

const DAY = 24 * 60 * 60;

/** A bot retires once its place on the climb passes level 40 (decision 17). */
export const RETIRE_POSITION = BOT_MAX_LEVEL + 1;

/**
 * With the rebalance running daily, no level should sit more than this many
 * bots off its share once it has had a few days (issue #251); the rebalance
 * logs a warning when one does.
 */
export const SPREAD_TOLERANCE = 4;

/** What the pace reads of a bot. */
export interface PaceBot {
  level: number;
  level_since: Date;
  /** When the bot stops growing; null while it never will. */
  quiet_since?: Date | null;
}

const seconds = (date: Date): number => date.getTime() / 1000;

/** Whether the bot has stopped growing by `now` (unix seconds). */
export const isQuiet = (bot: PaceBot, now: number): boolean => !!bot.quiet_since && seconds(bot.quiet_since) <= now;

/** The moment the bot's climb is read at: `now`, or when it went quiet if that was earlier. */
export const paceClock = (bot: PaceBot, now: number): number =>
  bot.quiet_since ? Math.min(now, seconds(bot.quiet_since)) : now;

/**
 * Where on the climb a bot stands at `now` (unix seconds), in levels: its
 * level plus the days since `level_since` walked along `pace`, one level's
 * days at a time; past level 40 it reads {@link RETIRE_POSITION} or more.
 */
export const pacePosition = (bot: PaceBot, now: number, pace: Pace): number => {
  let left = Math.max(0, paceClock(bot, now) - seconds(bot.level_since)) / DAY;
  let level = bot.level;
  while (level < RETIRE_POSITION && left >= daysOn(pace, level)) {
    left -= daysOn(pace, level);
    level++;
  }
  return level + left / daysOn(pace, level);
};

/**
 * `level_since` for a bot now on `level` that keeps it at `position` when
 * its climb is read at `clock` ({@link paceClock}): the part of the position
 * past `level`, counted back along the pace. Never after `clock`.
 */
export const anchorFor = (position: number, level: number, clock: number, pace: Pace): Date =>
  new Date((clock - daysBetween(level, position, pace) * DAY) * 1000);

/**
 * When a bot that just climbed from level `from` to `to` goes quiet, or null
 * when it keeps growing: each level gained has `quietRate` chance. The bot
 * stops at a random point of the level it is on, so quiet bots stand all
 * through their levels rather than at the bottom.
 */
export const drawQuiet = (
  rng: () => number,
  from: number,
  to: number,
  now: number,
  pace: Pace,
  quietRate: number
): Date | null => {
  for (let level = from + 1; level <= Math.min(to, BOT_MAX_LEVEL); level++) {
    if (rng() < quietRate) return new Date((now + rng() * daysOn(pace, to) * DAY) * 1000);
  }
  return null;
};

/**
 * The share of new bots on `level` that start quiet, so a level is made with
 * the mix it holds once the population has settled: about `flow`
 * (`BotConfig.growingFlow`) growing bots a day pass each level, so the level
 * holds `flow` times its days of growing bots and the rest of its share
 * quiet. A bot that starts quiet stands still where it was made.
 */
export const bornQuietShare = (level: number, pace: Pace, share: number, flow: number): number =>
  share <= 0 ? 0 : Math.min(1, Math.max(0, 1 - (flow * daysOn(pace, level)) / share));

/**
 * How many new bots start at the floor today for `perDay` a day on average: its
 * whole part, and one more by the chance of its fraction.
 */
export const birthsToday = (perDay: number, rng: () => number): number => {
  if (!(perDay > 0)) return 0;
  const whole = Math.floor(perDay);
  return whole + (rng() < perDay - whole ? 1 : 0);
};

/** One active bot as the rebalance sees it. */
export interface RebalanceBot extends PaceBot {
  userid: number;
}

/** What the rebalance aims for: `BotConfig`'s total, slack and daily cap, and each level's share. */
export interface RebalanceRules {
  /** Bots each level should hold, index 0 is level 1. */
  share: readonly number[];
  total: number;
  slack: number;
  newPerDay: number;
  /** New bots to start at the floor today ({@link birthsToday}); absent reads as 0. */
  births?: number;
}

/** The daily rebalance's plan. */
export interface RebalancePlan {
  /** Bots to retire. */
  retire: number[];
  /** New bots to start at the bottom of the floor level, growing. */
  born: number;
  /** One level per new bot to make on a short level, the shortest level first. */
  make: number[];
}

/** Who leaves a crowded level first: quiet bots, longest quiet first, then growing ones, longest on the level first. */
const leavesFirst =
  (now: number) =>
  (a: RebalanceBot, b: RebalanceBot): number => {
    const quietA = isQuiet(a, now);
    const quietB = isQuiet(b, now);
    if (quietA !== quietB) return quietA ? -1 : 1;
    if (quietA) return seconds(a.quiet_since!) - seconds(b.quiet_since!) || a.userid - b.userid;
    return seconds(a.level_since) - seconds(b.level_since) || a.userid - b.userid;
  };

/**
 * The daily rebalance at `now` (the file comment): which bots to retire, how
 * many to start at the floor and which levels to make new bots on.
 */
export const planRebalance = (bots: readonly RebalanceBot[], rules: RebalanceRules, now: number): RebalancePlan => {
  const { share, total, slack, newPerDay, births = 0 } = rules;
  const byLevel: RebalanceBot[][] = share.map(() => []);
  for (const bot of bots) byLevel[Math.min(Math.max(bot.level, 1), share.length) - 1]!.push(bot);
  for (const list of byLevel) list.sort(leavesFirst(now));

  const retire: number[] = [];
  const take = (index: number) => retire.push(byLevel[index]!.shift()!.userid);
  const want = (index: number) => share[index] ?? 0;
  /** New bots planned on each level. */
  const planned = share.map(() => 0);
  const held = (index: number) => byLevel[index]!.length + planned[index]!;

  byLevel.forEach((list, index) => {
    if (index + 1 < BOT_MIN_LEVEL) while (list.length > 0) take(index);
    else if (list.length > want(index) + slack) while (list.length > want(index)) take(index);
  });

  /** The level most over its share, to free a place on; -1 when none is over. */
  const mostOver = (): number => {
    let best = -1;
    byLevel.forEach((list, index) => {
      const over = held(index) - want(index);
      if (list.length > 0 && over > 0 && (best < 0 || over > held(best) - want(best))) best = index;
    });
    return best;
  };

  /** The most crowded level whose next bot to leave is quiet, the higher on a tie; -1 when no bot is quiet. */
  const mostCrowdedQuiet = (): number => {
    let best = -1;
    byLevel.forEach((list, index) => {
      if (list.length > 0 && isQuiet(list[0]!, now) && (best < 0 || held(index) - want(index) >= held(best) - want(best)))
        best = index;
    });
    return best;
  };

  let live = bots.length - retire.length;
  while (live > total) {
    const index = mostOver();
    if (index < 0) break;
    take(index);
    live--;
  }

  let born = 0;
  while (born < Math.min(births, newPerDay)) {
    if (live >= total) {
      const index = mostCrowdedQuiet();
      if (index < 0) break;
      take(index);
      live--;
    }
    planned[BOT_MIN_LEVEL - 1]!++;
    born++;
    live++;
  }

  const short = byLevel.flatMap((_, index) => (held(index) < want(index) - slack ? [index] : []));
  const gap = (index: number) => want(index) - held(index);
  const make: number[] = [];
  while (born + make.length < newPerDay) {
    const index = short.reduce((best, one) => (best < 0 || gap(one) > gap(best) ? one : best), -1);
    if (index < 0 || gap(index) <= 0) break;
    if (live >= total) {
      const over = mostOver();
      if (over < 0) break;
      take(over);
      live--;
    }
    planned[index]!++;
    make.push(index + 1);
    live++;
  }
  return { retire, born, make };
};
