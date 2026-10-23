import { describe, expect, test } from "bun:test";

import {
  DAYS_ON_LEVEL,
  DEFAULT_BOTS_GROWING_FLOW,
  DEFAULT_BOTS_FRESH_PER_DAY,
  DEFAULT_BOTS_LEVEL_SLACK,
  DEFAULT_BOTS_NEW_PER_DAY,
  DEFAULT_BOTS_QUIET_RATE,
} from "../../config/BotConfig.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { BOT_MIN_LEVEL, evenSpread } from "./factory.js";
import {
  anchorFor,
  birthsToday,
  bornQuietShare,
  drawQuiet,
  isQuiet,
  paceClock,
  pacePosition,
  planRebalance,
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

  test("no early quitting: every level gained has the same chance from the floor up; a rate of 0 stops none", () => {
    const draw = mulberry32(5);
    const rng = () => draw.float();
    // Three levels at the default 0.05: 1 - 0.95³ = 14% go quiet, the same from 15 as from 30.
    for (const from of [BOT_MIN_LEVEL, 30]) {
      let quiet = 0;
      for (let n = 0; n < 4000; n++) if (drawQuiet(rng, from, from + 3, NOW, T, DEFAULT_BOTS_QUIET_RATE)) quiet++;
      expect(quiet / 4000).toBeGreaterThan(0.12);
      expect(quiet / 4000).toBeLessThan(0.165);
    }
    expect(drawQuiet(rng, BOT_MIN_LEVEL, 20, NOW, T, 0)).toBeNull();
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
  /** The rules' levels from the floor up: `L(1)` is level 15, the floor. */
  const L = (n: number) => BOT_MIN_LEVEL - 1 + n;
  /** A share array from the floor up, none below it. */
  const at = (shares: number[]) => [...Array<number>(BOT_MIN_LEVEL - 1).fill(0), ...shares];
  const bot = (level: number, daysOnLevel: number, quietDaysAgo?: number): RebalanceBot => ({
    userid: ++id,
    level,
    level_since: date(NOW - daysOnLevel * DAY),
    quiet_since: quietDaysAgo === undefined ? null : date(NOW - quietDaysAgo * DAY),
  });
  const rules = (share: number[], extra: Partial<{ total: number; slack: number; newPerDay: number; births: number }> = {}) => ({
    share,
    total: share.reduce((a, b) => a + b, 0),
    slack: 1,
    newPerDay: 8,
    ...extra,
  });

  test("a crowded level retires down to its share: quiet bots longest quiet first, then growing ones longest on the level", () => {
    const growingNew = bot(L(1), 0.5);
    const growingOld = bot(L(1), 3);
    const quietRecent = bot(L(1), 9, 1);
    const quietLong = bot(L(1), 2, 5);
    const quietSoon = bot(L(1), 9, -1);
    const others = [bot(L(2), 1), bot(L(2), 1), bot(L(2), 1)];
    const plan = planRebalance([growingNew, growingOld, quietRecent, quietLong, quietSoon, ...others], rules(at([1, 3])), NOW);
    // A bot going quiet tomorrow is still growing today.
    expect(plan.retire).toEqual([quietLong.userid, quietRecent.userid, quietSoon.userid, growingOld.userid]);
    expect(plan.make).toEqual([]);
  });

  test("every bot below the floor retires, growing or quiet, whatever the slack; its place is made up from the floor up", () => {
    const below = [bot(1, 1), bot(3, 1, 2), bot(BOT_MIN_LEVEL - 1, 0.1), bot(BOT_MIN_LEVEL - 1, 1, 1)];
    const bots = [...below, bot(L(1), 1), bot(L(2), 1)];
    const plan = planRebalance(bots, rules(at([2, 2]), { slack: 5, total: 6 }), NOW);
    expect([...plan.retire].sort((a, b) => a - b)).toEqual(below.map((one) => one.userid));
    expect(plan.make).toEqual([]);
    // With the slack at 0 the floor's levels are made up.
    expect(planRebalance(bots, rules(at([2, 2]), { slack: 0, total: 6 }), NOW).make).toEqual([L(1), L(2)]);
  });

  test("within the slack nothing happens", () => {
    const bots = [bot(L(1), 1), bot(L(1), 1), bot(L(1), 1), bot(L(3), 1)];
    expect(planRebalance(bots, rules(at([2, 1, 1])), NOW)).toEqual({ retire: [], born: 0, make: [] });
  });

  test("short levels get new bots at that level, the shortest first, at most the daily cap", () => {
    const bots = [bot(L(1), 1), bot(L(1), 1), bot(L(1), 1), bot(L(2), 1), bot(L(4), 1), bot(L(4), 1)];
    const share = at([3, 3, 3, 3]);
    const plan = planRebalance(bots, rules(share, { total: 12, slack: 0, newPerDay: 3 }), NOW);
    expect(plan.retire).toEqual([]);
    // Level 3 is three short, level 2 two, level 4 one.
    expect(plan.make).toEqual([L(3), L(2), L(3)]);
    expect(planRebalance(bots, rules(share, { total: 12, slack: 0, newPerDay: 0 }), NOW).make).toEqual([]);
  });

  test("the total is never passed: a full table frees a new bot's place on the level most over its share", () => {
    // Twelve bots against a total of twelve; levels 1 and 4 one over (within the slack), level 3 two short.
    const quiet = bot(L(1), 1, 2);
    const bots = [quiet, bot(L(1), 1), bot(L(1), 1), bot(L(1), 1), bot(L(2), 1), bot(L(2), 1), bot(L(2), 1), bot(L(3), 1)];
    bots.push(bot(L(4), 1), bot(L(4), 1), bot(L(4), 1), bot(L(4), 1));
    const plan = planRebalance(bots, rules(at([3, 3, 3, 3]), { slack: 1 }), NOW);
    expect(plan.make).toEqual([L(3), L(3)]);
    expect(plan.retire).toHaveLength(2);
    expect(plan.retire[0]).toBe(quiet.userid);
    // A lowered total retires the extra from the levels most over.
    const lowered = planRebalance(bots, rules(at([2, 2, 2, 2]), { slack: 5 }), NOW);
    expect(lowered.retire).toHaveLength(4);
    expect(lowered.make).toEqual([]);
  });

  test("bots start at the floor while there is room, before the short levels and within the daily cap", () => {
    const bots = [bot(L(1), 1), bot(L(2), 1), bot(L(2), 1), bot(L(3), 1), bot(L(3), 1), bot(L(3), 1)];
    const share = at([3, 3, 3, 3]);
    expect(planRebalance(bots, rules(share, { slack: 0, births: 2 }), NOW)).toEqual({ retire: [], born: 2, make: [L(4), L(4), L(2), L(4)] });
    // Level 1's planned bots count against its share.
    expect(planRebalance(bots, rules(share, { slack: 0, births: 1, newPerDay: 3 }), NOW)).toEqual({ retire: [], born: 1, make: [L(4), L(4)] });
    expect(planRebalance(bots, rules(share, { slack: 0, births: 5, newPerDay: 3 }), NOW).born).toBe(3);
    expect(planRebalance(bots, rules(share, { slack: 0, births: 1, newPerDay: 0 }), NOW).born).toBe(0);
  });

  test("on a full table each bot started at the floor takes a quiet bot's place on the most crowded level, the higher on a tie", () => {
    const quietLow = bot(L(2), 1, 3);
    const quietHigh = bot(L(4), 1, 3);
    const quietLonger = bot(L(4), 1, 6);
    const bots = [bot(L(1), 1), bot(L(1), 1), bot(L(2), 1), quietLow, bot(L(3), 1), bot(L(3), 1), bot(L(4), 1), quietHigh, quietLonger];
    // Levels 2 and 4 are one over, 1 and 3 one under (within the slack); growing bots never leave for a birth.
    const plan = planRebalance(bots, rules(at([3, 1, 3, 2]), { total: 9, births: 2 }), NOW);
    expect(plan).toEqual({ retire: [quietLonger.userid, quietLow.userid], born: 2, make: [] });
  });

  test("with no quiet bot to give up its place, a full table starts none at the floor", () => {
    const bots = [bot(L(1), 1), bot(L(2), 1), bot(L(2), 1)];
    expect(planRebalance(bots, rules(at([1, 2]), { births: 1 }), NOW)).toEqual({ retire: [], born: 0, make: [] });
  });

  test("the bots started at the floor a day: the whole part of the rate, and one more by the chance of its fraction", () => {
    expect(birthsToday(0, () => 0)).toBe(0);
    expect(birthsToday(2, () => 0)).toBe(2);
    expect(birthsToday(1.25, () => 0.2)).toBe(2);
    expect(birthsToday(1.25, () => 0.3)).toBe(1);
    const draw = mulberry32(5);
    let sum = 0;
    for (let n = 0; n < 4000; n++) sum += birthsToday(0.85, () => draw.float());
    expect(sum / 4000).toBeCloseTo(0.85, 1);
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
    /** The ids of bots started at the floor, and the highest level one of them reached while still growing. */
    const born = new Set<number>();
    let bornTop = 0;
    const startAtFloor = (now: number) => {
      bots.push({ userid: ++id, level: BOT_MIN_LEVEL, level_since: date(now), quiet_since: null, growAt: now + rng() * 6 * HOUR });
      born.add(id);
    };
    share.forEach((want, index) => {
      for (let n = 0; n < want; n++) make(index + 1, NOW);
    });

    const made: number[] = [];
    const births: number[] = [];
    /** Growing bots on levels 15-30, counted at noon UTC each day. */
    const growingLow: number[] = [];
    /** The lowest level any bot stood on, read at each rebalance. */
    let lowest = Number.POSITIVE_INFINITY;
    const worstOff: number[] = [];
    const totals: number[] = [];
    for (let now = NOW + HOUR; now <= NOW + days * DAY; now += HOUR) {
      if (Math.floor(now / DAY) !== Math.floor((now - HOUR) / DAY)) {
        const rules = {
          share,
          total: TOTAL,
          slack: DEFAULT_BOTS_LEVEL_SLACK,
          newPerDay: DEFAULT_BOTS_NEW_PER_DAY,
          births: birthsToday(DEFAULT_BOTS_FRESH_PER_DAY, rng),
        };
        const plan = planRebalance(bots, rules, now);
        const gone = new Set(plan.retire);
        bots = bots.filter((one) => !gone.has(one.userid));
        for (let n = 0; n < plan.born; n++) startAtFloor(now);
        for (const level of plan.make) make(level, now);
        made.push(plan.born + plan.make.length);
        births.push(plan.born);
        const counts = share.map(() => 0);
        for (const one of bots) counts[one.level - 1]!++;
        for (const one of bots) lowest = Math.min(lowest, one.level);
        worstOff.push(Math.max(...counts.map((have, index) => Math.abs(have - share[index]!))));
        totals.push(bots.length);
      }
      if (now % DAY === 12 * HOUR) growingLow.push(bots.filter((one) => one.level <= 30 && !isQuiet(one, now)).length);
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
          if (born.has(one.userid) && !isQuiet(one, now)) bornTop = Math.max(bornTop, level);
        }
        return true;
      });
    }
    const growingOver = (from: number) =>
      bots.filter((one) => one.level >= from && !isQuiet(one, NOW + days * DAY)).length;
    return { made, births, growingLow, worstOff, totals, growingOver, bornTop: () => bornTop, lowest: () => lowest };
  };

  test("over half a year 500 bots keep every level near its share with few new bots a day", () => {
    const { made, births, growingLow, worstOff, totals, growingOver, bornTop, lowest } = simulate(180, 7);
    // No bot ever stands below the floor.
    expect(lowest()).toBe(BOT_MIN_LEVEL);
    expect(Math.max(...worstOff.slice(3))).toBeLessThanOrEqual(SPREAD_TOLERANCE);
    for (const total of totals) {
      expect(total).toBeLessThanOrEqual(TOTAL);
      expect(total).toBeGreaterThan(TOTAL - 40);
    }
    // About BOTS_FRESH_PER_DAY bots a day start at the floor, and under two more a day fill short levels; never more than the cap.
    const bornPerDay = births.reduce((a, b) => a + b, 0) / births.length;
    expect(bornPerDay).toBeGreaterThan(DEFAULT_BOTS_FRESH_PER_DAY * 0.8);
    expect(bornPerDay).toBeLessThan(DEFAULT_BOTS_FRESH_PER_DAY * 1.2);
    const perDay = made.reduce((a, b) => a + b, 0) / made.length;
    expect(perDay).toBeLessThan(DEFAULT_BOTS_FRESH_PER_DAY + 2);
    expect(Math.max(...made)).toBeLessThanOrEqual(DEFAULT_BOTS_NEW_PER_DAY);
    // The top levels are still growing.
    expect(growingOver(36)).toBeGreaterThan(30);
    // Some bots started at the floor grow on well past it, as some players do.
    expect(bornTop()).toBeGreaterThanOrEqual(25);
    // Once they have had two months to climb, levels 15-30 hold a visible number of growing bots.
    const lowLater = growingLow.slice(60);
    expect(lowLater.reduce((a, b) => a + b, 0) / lowLater.length).toBeGreaterThan(8);
  }, 60_000);
});
