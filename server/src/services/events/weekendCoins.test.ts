import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";

import { DEFAULT_WEEKEND_SETTINGS, type WeekendSettings } from "../../game-data/events/weekendEvents.js";
import { coinNotes, memoryCoinStore } from "./eventCoins.js";
import { activeRun } from "./weekendSchedule.js";
import {
  checkInWeekend,
  WEEKEND_CHECKIN_COINS,
  weekendCheckinKey,
  weekendCheckinState,
  weekendDayOf,
  weekendDaysOf,
} from "./weekendCoins.js";

/**
 * A weekend event's Glimmers (owner, 13 Nov 2026): a check-in once per event
 * day, 50 each, 100 for a 48-hour weekend; nothing outside a run, for all
 * four weekend events. The schedule is the default rotation: Saturday 14 Nov
 * 2026 is a Builder's Weekend, 21 Nov a Tribe Plunder.
 */
const at = (iso: string): number => Date.parse(iso) / 1000;
const settings = (over: Partial<WeekendSettings> = {}): WeekendSettings => ({ ...DEFAULT_WEEKEND_SETTINGS, ...over });

const SATURDAY = at("2026-11-14T10:00:00Z");
const SATURDAY_LATE = at("2026-11-14T23:59:59Z");
const SUNDAY = at("2026-11-15T00:00:00Z");
const SUNDAY_LATE = at("2026-11-15T23:30:00Z");
const MONDAY = at("2026-11-16T00:00:00Z");
const NEXT_SATURDAY = at("2026-11-21T10:00:00Z");
const FRIDAY = at("2026-11-13T10:00:00Z");

const fakeEm = (): EntityManager => ({}) as EntityManager;

describe("weekend check-in", () => {
  let store: ReturnType<typeof memoryCoinStore>;
  const options = (over: Partial<WeekendSettings> = {}) => ({ settings: settings(over), store });
  const paid = async (t: number, userid = 7, over: Partial<WeekendSettings> = {}): Promise<number> => {
    const result = await checkInWeekend(fakeEm(), userid, t, options(over));
    return result.refused ? 0 : result.paid;
  };

  beforeEach(() => {
    store = memoryCoinStore();
  });

  test("the owner's figure: 50 a day, 100 for a two-day weekend", async () => {
    expect(WEEKEND_CHECKIN_COINS).toBe(50);
    expect(await paid(SATURDAY)).toBe(50);
    expect(await paid(SUNDAY_LATE)).toBe(50);
    expect(store.balances.get(7)).toBe(100);
    expect(store.log.map((row) => row.reason)).toEqual(["weekend-checkin", "weekend-checkin"]);
  });

  test("once per day: a second click or another tab is refused and pays nothing", async () => {
    expect(await paid(SATURDAY)).toBe(50);
    const again = await checkInWeekend(fakeEm(), 7, SATURDAY_LATE, options());
    expect(again.refused).toBe("checkedInToday");
    if (again.refused === "checkedInToday") {
      expect(again.state).toMatchObject({ day: 1, claimedToday: true, nextAt: SUNDAY });
    }
    expect(store.balances.get(7)).toBe(50);
    // Two at once (two tabs): only one is paid.
    const both = await Promise.all([paid(SUNDAY), paid(SUNDAY + 1)]);
    expect(both.sort()).toEqual([0, 50]);
    expect(store.balances.get(7)).toBe(100);
  });

  test("the day turns at the run's midnight: Saturday 23:59:59 is day 1, Sunday 00:00 day 2", async () => {
    const run = activeRun(settings(), SATURDAY)!;
    expect(weekendDayOf(run, SATURDAY_LATE)).toBe(1);
    expect(weekendDayOf(run, SUNDAY)).toBe(2);
    expect(weekendDaysOf(run)).toBe(2);
    expect(await paid(SATURDAY_LATE)).toBe(50);
    expect(await paid(SUNDAY)).toBe(50);
    expect(store.log.map((row) => row.awardKey)).toEqual(["weekend:2026-11-14:day1", "weekend:2026-11-14:day2"]);
  });

  test("a missed day is gone: coming only on Sunday pays 50", async () => {
    expect(await paid(SUNDAY_LATE)).toBe(50);
    expect(await weekendCheckinState(fakeEm(), 7, SUNDAY_LATE, options())).toEqual({
      key: "2026-11-14",
      amount: 50,
      day: 2,
      days: 2,
      claimedToday: true,
      marks: [
        { day: 1, claimed: false },
        { day: 2, claimed: true },
      ],
      nextAt: null,
    });
  });

  test("refused outside a run: Friday, Monday, switched off, a skipped weekend", async () => {
    for (const t of [FRIDAY, MONDAY]) {
      expect((await checkInWeekend(fakeEm(), 7, t, options())).refused).toBe("noWeekend");
    }
    expect(await paid(SATURDAY, 7, { enabled: false })).toBe(0);
    expect(await paid(SATURDAY, 7, { overrides: { "2026-11-14": "skip" } })).toBe(0);
    expect(store.log).toEqual([]);
  });

  test("each weekend and each player is paid apart", async () => {
    expect(await paid(SATURDAY)).toBe(50);
    expect(await paid(NEXT_SATURDAY)).toBe(50);
    expect(await paid(SATURDAY, 8)).toBe(50);
    expect(store.balances.get(7)).toBe(100);
    expect(store.balances.get(8)).toBe(50);
  });

  test("all four weekend events pay 100 each: Builder's, Plunder, Study, Hatch Rush", async () => {
    const saturdays = [0, 1, 2, 3].map((week) => SATURDAY + week * 7 * 86_400);
    expect(saturdays.map((t) => activeRun(settings(), t)?.id)).toEqual(["builders", "plunder", "study", "hatch"]);
    for (const t of saturdays) {
      expect(await paid(t)).toBe(50);
      expect(await paid(t + 3_600)).toBe(0);
      expect(await paid(t + 86_400)).toBe(50);
    }
    expect(store.balances.get(7)).toBe(400);
  });

  test("a weekend lengthened from the dashboard has more days; a shortened one fewer", async () => {
    // 72 h: Saturday, Sunday, Monday.
    expect(await paid(MONDAY + 3_600, 7, { lengthHours: 72 })).toBe(50);
    const long = await weekendCheckinState(fakeEm(), 7, MONDAY + 3_600, options({ lengthHours: 72 }));
    expect(long).toMatchObject({ day: 3, days: 3, nextAt: null });
    expect(long?.marks.map((m) => m.day)).toEqual([1, 2, 3]);
    // 24 h: Saturday only; Sunday is outside the run.
    expect(await weekendCheckinState(fakeEm(), 7, SATURDAY, options({ lengthHours: 24 }))).toMatchObject({
      day: 1,
      days: 1,
      nextAt: null,
    });
    expect(await paid(SUNDAY, 7, { lengthHours: 24 })).toBe(0);
    // 36 h: the last 12 hours count as a day.
    expect(weekendDaysOf({ startsAt: 0, endsAt: 36 * 3_600 })).toBe(2);
  });

  test("a run forced from the dashboard counts its days from when it was switched on", async () => {
    const since = SATURDAY - 5 * 3_600; // switched on at 05:00 UTC
    const forced = { forced: { id: "study" as const, since, until: since + 48 * 3_600 } };
    expect(await paid(FRIDAY, 7, forced)).toBe(0); // before it started
    expect(await paid(since + 23 * 3_600, 7, forced)).toBe(50);
    expect(await paid(since + 24 * 3_600, 7, forced)).toBe(50);
    expect(store.log.map((row) => row.awardKey)).toEqual([`weekend:forced-${since}:day1`, `weekend:forced-${since}:day2`]);
  });

  test("the local WEEKEND_FORCE run (1970 to 2100): one a UTC day; the card shows yesterday and today", async () => {
    const forced = { forced: { id: "builders" as const, since: 0, until: 4_102_444_800 } };
    expect(await paid(FRIDAY, 7, forced)).toBe(50);
    expect(await paid(FRIDAY + 3_600, 7, forced)).toBe(0);
    expect(await paid(SATURDAY, 7, forced)).toBe(50);
    const day = Math.floor(SATURDAY / 86_400) + 1;
    expect(store.log[1]?.awardKey).toBe(`weekend:forced-0:day${day}`);
    const state = await weekendCheckinState(fakeEm(), 7, SATURDAY, options(forced));
    expect(state).toMatchObject({ day, claimedToday: true, nextAt: SUNDAY });
    expect(state?.marks).toEqual([
      { day: day - 1, claimed: true },
      { day, claimed: true },
    ]);
  });

  test("a check-in is noted on the request's entity manager for the yard answer", async () => {
    const em = fakeEm();
    expect(coinNotes(em)).toBeNull();
    await checkInWeekend(em, 7, SATURDAY, options());
    expect(coinNotes(em)).toEqual({ balance: 50, gained: [{ amount: 50, reason: "weekend-checkin" }] });
  });

  test("the card's state before and after", async () => {
    expect(await weekendCheckinState(fakeEm(), 7, FRIDAY, options())).toBeNull();
    expect(await weekendCheckinState(fakeEm(), 7, SATURDAY, options())).toEqual({
      key: "2026-11-14",
      amount: 50,
      day: 1,
      days: 2,
      claimedToday: false,
      marks: [
        { day: 1, claimed: false },
        { day: 2, claimed: false },
      ],
      nextAt: SUNDAY,
    });
    const result = await checkInWeekend(fakeEm(), 7, SATURDAY, options());
    expect(result.refused).toBeUndefined();
    expect(result.refused === undefined && result.state).toMatchObject({
      claimedToday: true,
      marks: [
        { day: 1, claimed: true },
        { day: 2, claimed: false },
      ],
    });
    expect(weekendCheckinKey({ key: "2026-11-14" }, 2)).toBe("weekend:2026-11-14:day2");
  });
});

describe("the in-memory coin store's rules (the SQL store's twin)", () => {
  test("spend takes only what the balance covers; amounts are whole and above 0", async () => {
    const store = memoryCoinStore();
    const em = fakeEm();
    expect(await store.spend(em, 1, 5, "decor-55")).toBeNull();
    expect(await store.grant(em, 1, 40.9, "calendar")).toBe(40);
    expect(await store.grant(em, 1, 0, "calendar")).toBeNull();
    expect(await store.grant(em, 1, -5, "calendar")).toBeNull();
    expect(await store.spend(em, 1, 50, "decor-57")).toBeNull();
    expect(await store.spend(em, 1, 40, "decor-57")).toBe(0);
    expect(await store.balance(em, 1)).toBe(0);
  });

  test("an award key pays once; other grants are not limited", async () => {
    const store = memoryCoinStore();
    const em = fakeEm();
    expect(await store.grant(em, 1, 10, "x", "k")).toBe(10);
    expect(await store.grant(em, 1, 10, "x", "k")).toBeNull();
    expect(await store.grant(em, 1, 10, "calendar")).toBe(20);
    expect(await store.grant(em, 1, 10, "calendar")).toBe(30);
    expect(await store.awarded(em, 1, ["k", "other"])).toEqual(new Set(["k"]));
  });
});
