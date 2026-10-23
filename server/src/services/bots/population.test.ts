import { describe, expect, test } from "bun:test";

import {
  DAYS_ON_LEVEL,
  DEFAULT_BOTS_GROWING_FLOW,
  DEFAULT_BOTS_LEVEL_SLACK,
  DEFAULT_BOTS_NEW_PER_DAY,
  DEFAULT_BOTS_QUIET_RATE,
  EARLY_QUIET,
} from "../../config/BotConfig.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { evenSpread } from "./factory.js";
import {
  anchorFor,
  bornQuietShare,
  drawQuiet,
  isQuiet,
  paceClock,
  pacePosition,
  planRebalance,
  quietChance,
  RETIRE_POSITION,
  SPREAD_TOLERANCE,
  type RebalanceBot,
} from "./population.js";

/** The bot population's pace, quiet bots and daily rebalance (`docs/design/bot-neighbours.md` §4.4). */

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;
const T = 3;
const date = (seconds: number) => new Date(seconds * 1000);

describe("the pace", () => {
  test("at one number a bot climbs one level every T days", () => {
    const bot = { level: 12, level_since: date(NOW - DAY) };
    expect(pacePosition(bot, NOW, T)).toBeCloseTo(12 + 1 / 3, 9);
    expect(pacePosition(bot, NOW + 2 * DAY, T)).toBeCloseTo(13, 9);
    expect(pacePosition(bot, NOW + 5 * DAY, T)).toBeCloseTo(14, 9);
  });

  test("on the curve a bot walks across levels at each level's days, and reads 41 past level 40", () => {
    const days = DAYS_ON_LEVEL;
    const bot = { level: 10, level_since: date(NOW - (days[10]! + days[11]! / 2) * DAY) };
    expect(pacePosition(bot, NOW, days)).toBeCloseTo(11.5, 6);
    // Fast early, slow late: a day takes a level 5 bot past level 10, a level 35 bot a fiftieth of its level.
    expect(pacePosition({ level: 5, level_since: date(NOW - DAY) }, NOW, days)).toBeGreaterThan(10);
    expect(pacePosition({ level: 35, level_since: date(NOW - DAY) }, NOW, days)).toBeCloseTo(35 + 1 / days[35]!, 6);
    const top = { level: 40, level_since: date(NOW - (days[40]! + 1) * DAY) };
    expect(pacePosition(top, NOW, days)).toBeGreaterThanOrEqual(RETIRE_POSITION);
  });

  test("a new anchor keeps the bot where it stands, never after the clock", () => {
    for (const pace of [T, DAYS_ON_LEVEL]) {
      const bot = { level: 18, level_since: date(NOW - 4 * DAY) };
      const position = pacePosition(bot, NOW, pace);
      const level = Math.floor(position);
      const anchored = { level, level_since: anchorFor(position, level, NOW, pace) };
      expect(pacePosition(anchored, NOW, pace)).toBeCloseTo(position, 6);
      // A yard a level ahead of its place (a step carried it past the band) waits there.
      expect(anchorFor(position, level + 1, NOW, pace).getTime()).toBe(NOW * 1000);
    }
  });
});

describe("quiet bots", () => {
  test("a quiet bot's place stands still from quiet_since; before it, the bot still grows", () => {
    const bot = { level: 20, level_since: date(NOW - DAY), quiet_since: date(NOW) };
    const at = pacePosition(bot, NOW, T);
    expect(pacePosition(bot, NOW + 30 * DAY, T)).toBe(at);
    expect(isQuiet(bot, NOW)).toBe(true);
    expect(paceClock(bot, NOW + DAY)).toBe(NOW);

    const later = { ...bot, quiet_since: date(NOW + DAY) };
    expect(isQuiet(later, NOW)).toBe(false);
    expect(pacePosition(later, NOW + DAY, T)).toBeGreaterThan(at);
    expect(pacePosition(later, NOW + 9 * DAY, T)).toBe(pacePosition(later, NOW + DAY, T));
  });

  test("each level gained has the quiet rate's chance; the bot stops somewhere in the level it is on", () => {
    expect(drawQuiet(Math.random, 10, 13, NOW, T, 0)).toBeNull();
    expect(drawQuiet(Math.random, 13, 12, NOW, T, 1)).toBeNull();
    const draw = mulberry32(17);
    const rng = () => draw.float();
    for (let n = 0; n < 50; n++) {
      const at = drawQuiet(rng, 12, 13, NOW, T, 1)!.getTime() / 1000;
      expect(at).toBeGreaterThanOrEqual(NOW);
      expect(at).toBeLessThan(NOW + T * DAY);
    }
    // Three levels at 0.1: 1 - 0.9³ = 27% go quiet.
    let quiet = 0;
    for (let n = 0; n < 4000; n++) if (drawQuiet(rng, 10, 13, NOW, T, 0.1)) quiet++;
    expect(quiet / 4000).toBeGreaterThan(0.24);
    expect(quiet / 4000).toBeLessThan(0.3);
  });

  test("most bots stop by level 4, as most real players do on their first day; a rate of 0 stops none", () => {
    expect(quietChance(4, DEFAULT_BOTS_QUIET_RATE)).toBe(EARLY_QUIET.rate);
    expect(quietChance(5, DEFAULT_BOTS_QUIET_RATE)).toBe(DEFAULT_BOTS_QUIET_RATE);
    expect(quietChance(2, 0)).toBe(0);
    const draw = mulberry32(5);
    const rng = () => draw.float();
    // Real players: 14 of 24 stopped at level 1-4.
    let quiet = 0;
    for (let n = 0; n < 4000; n++) if (drawQuiet(rng, 1, 4, NOW, T, DEFAULT_BOTS_QUIET_RATE)) quiet++;
    expect(quiet / 4000).toBeGreaterThan(0.54);
    expect(quiet / 4000).toBeLessThan(0.62);
    expect(drawQuiet(rng, 1, 4, NOW, T, 0)).toBeNull();
  });

  test("new bots start quiet by their level's settled mix: nearly all low, none at the top", () => {
    const share = 12.5;
    const quietShare = (level: number) => bornQuietShare(level, DAYS_ON_LEVEL, share, DEFAULT_BOTS_GROWING_FLOW);
    expect(quietShare(1)).toBeGreaterThan(0.99);
    expect(quietShare(20)).toBeGreaterThan(0.9);
    expect(quietShare(40)).toBe(0);
    for (let level = 2; level <= 40; level++) expect(quietShare(level)).toBeLessThanOrEqual(quietShare(level - 1));
    expect(bornQuietShare(5, T, 0, 1)).toBe(0);
  });
});

describe("the daily rebalance", () => {
  let id = 0;
  const bot = (level: number, daysOnLevel: number, quietDaysAgo?: number): RebalanceBot => ({
    userid: ++id,
    level,
    level_since: date(NOW - daysOnLevel * DAY),
    quiet_since: quietDaysAgo === undefined ? null : date(NOW - quietDaysAgo * DAY),
  });
  const rules = (share: number[], extra: Partial<{ total: number; slack: number; newPerDay: number }> = {}) => ({
    share,
    total: share.reduce((a, b) => a + b, 0),
    slack: 1,
    newPerDay: 8,
    ...extra,
  });

  test("a crowded level retires down to its share: quiet bots longest quiet first, then growing ones longest on the level", () => {
    const growingNew = bot(1, 0.5);
    const growingOld = bot(1, 3);
    const quietRecent = bot(1, 9, 1);
    const quietLong = bot(1, 2, 5);
    const quietSoon = bot(1, 9, -1);
    const others = [bot(2, 1), bot(2, 1), bot(2, 1)];
    const plan = planRebalance([growingNew, growingOld, quietRecent, quietLong, quietSoon, ...others], rules([1, 3]), NOW);
    // A bot going quiet tomorrow is still growing today.
    expect(plan.retire).toEqual([quietLong.userid, quietRecent.userid, quietSoon.userid, growingOld.userid]);
    expect(plan.make).toEqual([]);
  });

  test("within the slack nothing happens", () => {
    const bots = [bot(1, 1), bot(1, 1), bot(1, 1), bot(3, 1)];
    expect(planRebalance(bots, rules([2, 1, 1]), NOW)).toEqual({ retire: [], born: 0, make: [] });
  });

  test("short levels get new bots at that level, the shortest first, at most the daily cap", () => {
    const bots = [bot(1, 1), bot(1, 1), bot(1, 1), bot(2, 1), bot(4, 1), bot(4, 1)];
    const share = [3, 3, 3, 3];
    const plan = planRebalance(bots, rules(share, { total: 12, slack: 0, newPerDay: 3 }), NOW);
    expect(plan.retire).toEqual([]);
    // Level 3 is three short, level 2 two, level 4 one.
    expect(plan.make).toEqual([3, 2, 3]);
    expect(planRebalance(bots, rules(share, { total: 12, slack: 0, newPerDay: 0 }), NOW).make).toEqual([]);
  });

  test("the total is never passed: a full table frees a new bot's place on the level most over its share", () => {
    // Twelve bots against a total of twelve; levels 1 and 4 one over (within the slack), level 3 two short.
    const quiet = bot(1, 1, 2);
    const bots = [quiet, bot(1, 1), bot(1, 1), bot(1, 1), bot(2, 1), bot(2, 1), bot(2, 1), bot(3, 1)];
    bots.push(bot(4, 1), bot(4, 1), bot(4, 1), bot(4, 1));
    const plan = planRebalance(bots, rules([3, 3, 3, 3], { slack: 1 }), NOW);
    expect(plan.make).toEqual([3, 3]);
    expect(plan.retire).toHaveLength(2);
    expect(plan.retire[0]).toBe(quiet.userid);
    // A lowered total retires the extra from the levels most over.
    const lowered = planRebalance(bots, rules([2, 2, 2, 2], { slack: 5 }), NOW);
    expect(lowered.retire).toHaveLength(4);
    expect(lowered.make).toEqual([]);
  });
});

describe("the population over simulated time", () => {
  const TOTAL = 500;
  const HOUR = 60 * 60;

  /**
   * The sweep's climb without the yards: each bot grows every 2-6 hours (its
   * level follows its place on the climb, and a new level may make it quiet),
   * one past level 40 retires, and the rebalance runs once a UTC day. It
   * starts as `create --fill` leaves the table: every level at its share, each
   * bot at a random point of its level, quiet by its level's settled mix.
   */
  const simulate = (days: number, seed: number) => {
    const draw = mulberry32(seed);
    const rng = () => draw.float();
    const pace = DAYS_ON_LEVEL;
    const share = evenSpread(TOTAL);
    let bots: (RebalanceBot & { growAt: number })[] = [];
    let id = 0;
    const make = (level: number, now: number) => {
      const quiet = rng() < bornQuietShare(level, pace, share[level - 1]!, DEFAULT_BOTS_GROWING_FLOW);
      bots.push({
        userid: ++id,
        level,
        level_since: date(now - rng() * pace[level]! * DAY),
        quiet_since: quiet ? date(now) : null,
        growAt: now + rng() * 6 * HOUR,
      });
    };
    share.forEach((want, index) => {
      for (let n = 0; n < want; n++) make(index + 1, NOW);
    });

    const made: number[] = [];
    const worstOff: number[] = [];
    const totals: number[] = [];
    for (let now = NOW + HOUR; now <= NOW + days * DAY; now += HOUR) {
      if (Math.floor(now / DAY) !== Math.floor((now - HOUR) / DAY)) {
        const rules = { share, total: TOTAL, slack: DEFAULT_BOTS_LEVEL_SLACK, newPerDay: DEFAULT_BOTS_NEW_PER_DAY };
        const plan = planRebalance(bots, rules, now);
        const gone = new Set(plan.retire);
        bots = bots.filter((one) => !gone.has(one.userid));
        for (const level of plan.make) make(level, now);
        made.push(plan.make.length);
        const counts = share.map(() => 0);
        for (const one of bots) counts[one.level - 1]!++;
        worstOff.push(Math.max(...counts.map((have, index) => Math.abs(have - share[index]!))));
        totals.push(bots.length);
      }
      bots = bots.filter((one) => {
        if (one.growAt > now) return true;
        one.growAt = now + (2 + 4 * rng()) * HOUR;
        const position = pacePosition(one, now, pace);
        if (position >= RETIRE_POSITION) return false;
        const level = Math.floor(position);
        if (level !== one.level) {
          const clock = paceClock(one, now);
          one.quiet_since ??= drawQuiet(rng, one.level, level, now, pace, DEFAULT_BOTS_QUIET_RATE);
          one.level_since = anchorFor(position, level, clock, pace);
          one.level = level;
        }
        return true;
      });
    }
    const growingOver = (from: number) =>
      bots.filter((one) => one.level >= from && !isQuiet(one, NOW + days * DAY)).length;
    return { made, worstOff, totals, growingOver };
  };

  test("over half a year 500 bots keep every level near its share with few new bots a day", () => {
    const { made, worstOff, totals, growingOver } = simulate(180, 7);
    expect(Math.max(...worstOff.slice(3))).toBeLessThanOrEqual(SPREAD_TOLERANCE);
    for (const total of totals) {
      expect(total).toBeLessThanOrEqual(TOTAL);
      expect(total).toBeGreaterThan(TOTAL - 40);
    }
    // Well under one new bot a day on average, and never more than the cap.
    const perDay = made.reduce((a, b) => a + b, 0) / made.length;
    expect(perDay).toBeLessThan(2);
    expect(Math.max(...made)).toBeLessThanOrEqual(DEFAULT_BOTS_NEW_PER_DAY);
    // The top levels are still growing.
    expect(growingOver(36)).toBeGreaterThan(30);
  }, 60_000);
});
