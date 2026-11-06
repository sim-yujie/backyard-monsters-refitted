import { describe, expect, test } from "bun:test";

import {
  DAYS_ON_LEVEL,
  DEFAULT_BOTS_FLOOR_LEVEL,
  DEFAULT_BOTS_GROWING_FLOW,
  DEFAULT_BOTS_FRESH_PER_DAY,
  DEFAULT_BOTS_LEVEL_SLACK,
  DEFAULT_BOTS_NEW_PER_DAY,
  DEFAULT_BOTS_QUIET_RATE,
  defaultBotsTotal,
  LOWEST_BOT_FLOOR_LEVEL,
} from "../../config/BotConfig.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { evenSpread } from "./factory.js";
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
/** The level floor `BOTS_FLOOR_LEVEL` gives when unset: 25 (owner 3 Nov 2026). */
const FLOOR = DEFAULT_BOTS_FLOOR_LEVEL;
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
    for (const from of [LOWEST_BOT_FLOOR_LEVEL, 30]) {
      let quiet = 0;
      for (let n = 0; n < 4000; n++) if (drawQuiet(rng, from, from + 3, NOW, T, DEFAULT_BOTS_QUIET_RATE)) quiet++;
      expect(quiet / 4000).toBeGreaterThan(0.12);
      expect(quiet / 4000).toBeLessThan(0.165);
    }
    expect(drawQuiet(rng, LOWEST_BOT_FLOOR_LEVEL, 20, NOW, T, 0)).toBeNull();
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
  /** The rules' levels from the floor up: `L(1)` is level 25, the default floor. */
  const L = (n: number) => FLOOR - 1 + n;
  /** A share array from the floor up, none below it. */
  const at = (shares: number[]) => [...Array<number>(FLOOR - 1).fill(0), ...shares];
  const bot = (level: number, daysOnLevel: number, quietDaysAgo?: number): RebalanceBot => ({
    userid: ++id,
    level,
    level_since: date(NOW - daysOnLevel * DAY),
    quiet_since: quietDaysAgo === undefined ? null : date(NOW - quietDaysAgo * DAY),
  });
  const rules = (
    share: number[],
    extra: Partial<{ total: number; slack: number; newPerDay: number; births: number; floor: number }> = {}
  ) => ({
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
    const below = [bot(1, 1), bot(3, 1, 2), bot(15, 1), bot(FLOOR - 1, 0.1), bot(FLOOR - 1, 1, 1)];
    const bots = [...below, bot(L(1), 1), bot(L(2), 1)];
    const plan = planRebalance(bots, rules(at([2, 2]), { slack: 5, total: 6 }), NOW);
    expect([...plan.retire].sort((a, b) => a - b)).toEqual(below.map((one) => one.userid));
    expect(plan.make).toEqual([]);
    // With the slack at 0 the floor's levels are made up.
    expect(planRebalance(bots, rules(at([2, 2]), { slack: 0, total: 6 }), NOW).make).toEqual([L(1), L(2)]);
  });

  test("the floor is the rules' or BOTS_FLOOR_LEVEL's: a lower floor keeps the bots above it", () => {
    const fifteen = bot(15, 1);
    const twenty = bot(20, 1);
    const bots = [bot(3, 1), fifteen, twenty, bot(30, 1)];
    const share = [...Array<number>(14).fill(0), ...Array<number>(26).fill(1)];
    const low = planRebalance(bots, rules(share, { slack: 5, floor: 15 }), NOW);
    expect(low.retire).toEqual([bots[0]!.userid]);
    const before = process.env.BOTS_FLOOR_LEVEL;
    try {
      process.env.BOTS_FLOOR_LEVEL = "21";
      expect([...planRebalance(bots, rules(share, { slack: 5 }), NOW).retire].sort((a, b) => a - b)).toEqual(
        [bots[0]!.userid, fifteen.userid, twenty.userid].sort((a, b) => a - b)
      );
    } finally {
      if (before === undefined) delete process.env.BOTS_FLOOR_LEVEL;
      else process.env.BOTS_FLOOR_LEVEL = before;
    }
  });

  test("the first rebalance at floor 25 on today's live spread: every bot below 25 retires, new ones only from 25 up", () => {
    // Active bots by level on the live server (3 Nov 2026): 35 on 16-20, 42 on 21-25, 83 on 26-30, 67 on 31-35, 61 on 36-40.
    const live: RebalanceBot[] = [];
    const spread = (from: number, to: number, count: number) => {
      for (let n = 0; n < count; n++) live.push(bot(from + (n % (to - from + 1)), 1 + (n % 5), n % 3 === 0 ? undefined : 1 + (n % 4)));
    };
    spread(16, 20, 35);
    spread(21, 25, 42);
    spread(26, 30, 83);
    spread(31, 35, 67);
    spread(36, 40, 61);
    const total = defaultBotsTotal();
    expect(total).toBe(185);
    const share = evenSpread(total);
    const plan = planRebalance(live, { share, total, slack: DEFAULT_BOTS_LEVEL_SLACK, newPerDay: DEFAULT_BOTS_NEW_PER_DAY, births: 3 }, NOW);
    const byId = new Map(live.map((one) => [one.userid, one]));
    const retired = plan.retire.map((userid) => byId.get(userid)!);
    // All 69 below 25 go (35 on 16-20, 34 on 21-24).
    const belowFloor = live.filter((one) => one.level < FLOOR);
    expect(belowFloor).toHaveLength(69);
    for (const one of belowFloor) expect(plan.retire).toContain(one.userid);
    // The rest of the retired come off levels over their share, never below it.
    const left = live.filter((one) => !plan.retire.includes(one.userid));
    for (let level = FLOOR; level <= 40; level++) {
      const have = left.filter((one) => one.level === level).length;
      const was = live.filter((one) => one.level === level).length;
      if (have < was) expect(have).toBeGreaterThanOrEqual(share[level - 1]!);
    }
    expect(retired.every((one) => one.level < FLOOR || share[one.level - 1]! > 0)).toBe(true);
    // New bots only at the floor and above, within the daily cap; the total is never passed.
    expect(plan.make.every((level) => level >= FLOOR)).toBe(true);
    expect(plan.born + plan.make.length).toBeLessThanOrEqual(DEFAULT_BOTS_NEW_PER_DAY);
    expect(left.length + plan.born + plan.make.length).toBeLessThanOrEqual(total);
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
  const HOUR = 60 * 60;

  /**
   * The sweep's climb without the yards: each bot grows every 2-6 hours (its
   * level follows its place on the climb, and a new level may make it quiet),
   * one past level 40 retires, and the rebalance runs once a UTC day. It
   * starts as `create --fill` leaves the table: every level at its share, each
   * bot at a random point of its level, quiet by its level's settled mix.
   */
  const simulate = (days: number, seed: number, floor: number, TOTAL: number) => {
    const draw = mulberry32(seed);
    const rng = () => draw.float();
    const pace = DAYS_ON_LEVEL;
    const share = evenSpread(TOTAL, floor);
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
      bots.push({ userid: ++id, level: floor, level_since: date(now), quiet_since: null, growAt: now + rng() * 6 * HOUR });
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
          floor,
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

  test("over half a year 500 bots from floor 15 keep every level near its share with few new bots a day", () => {
    const TOTAL = 500;
    const { made, births, growingLow, worstOff, totals, growingOver, bornTop, lowest } = simulate(180, 7, LOWEST_BOT_FLOOR_LEVEL, TOTAL);
    // No bot ever stands below the floor.
    expect(lowest()).toBe(LOWEST_BOT_FLOOR_LEVEL);
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

  test("over half a year the default floor and total, 25 and 185, keep every level near its share too", () => {
    const TOTAL = defaultBotsTotal();
    const { made, births, worstOff, totals, growingOver, bornTop, lowest } = simulate(180, 7, FLOOR, TOTAL);
    expect(lowest()).toBe(FLOOR);
    expect(Math.max(...worstOff.slice(3))).toBeLessThanOrEqual(SPREAD_TOLERANCE);
    for (const total of totals) {
      expect(total).toBeLessThanOrEqual(TOTAL);
      expect(total).toBeGreaterThan(TOTAL - 25);
    }
    const bornPerDay = births.reduce((a, b) => a + b, 0) / births.length;
    expect(bornPerDay).toBeGreaterThan(DEFAULT_BOTS_FRESH_PER_DAY * 0.8);
    expect(bornPerDay).toBeLessThan(DEFAULT_BOTS_FRESH_PER_DAY * 1.2);
    expect(Math.max(...made)).toBeLessThanOrEqual(DEFAULT_BOTS_NEW_PER_DAY);
    const perDay = made.reduce((a, b) => a + b, 0) / made.length;
    expect(perDay).toBeLessThan(DEFAULT_BOTS_FRESH_PER_DAY + 2);
    expect(growingOver(36)).toBeGreaterThan(20);
    expect(bornTop()).toBeGreaterThanOrEqual(30);
  }, 60_000);
});
