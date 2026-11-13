import { afterEach, describe, expect, it } from "vitest";
import { popupRun } from "@/game/yard/plugins/weekend";
import {
  announcedWeekend,
  checkinAt,
  checkinWaiting,
  costLessBy,
  currentWeekend,
  lessByPercent,
  onWeekendChange,
  readCheckin,
  readWeekendState,
  resetWeekend,
  runningWeekend,
  setWeekend,
  setWeekendCheckin,
  shorterBy,
  weekendCheckin,
  weekendNow,
  weekendPercent,
  type WeekendRun,
} from "./weekend";

const SAT = 1_794_614_400; // Saturday 14 Nov 2026 00:00 UTC
const RUN: WeekendRun = {
  id: "builders",
  title: "Builder's Weekend",
  line: "Upgrades cost 30% less",
  percent: 30,
  key: "2026-11-14",
  startsAt: SAT,
  endsAt: SAT + 48 * 3600,
  announceAt: SAT - 24 * 3600,
  forced: false,
};

afterEach(() => resetWeekend());

describe("readWeekendState", () => {
  it("reads the server's runs and drops anything malformed", () => {
    expect(readWeekendState({ active: null, next: RUN })).toEqual({ active: null, next: RUN });
    expect(readWeekendState({ active: { ...RUN, id: "nope" }, next: { ...RUN, percent: 0 } })).toEqual({
      active: null,
      next: null,
    });
    expect(readWeekendState(undefined)).toEqual({ active: null, next: null });
    expect(readWeekendState("x")).toEqual({ active: null, next: null });
  });
});

describe("running and announced", () => {
  const state = { active: null, next: RUN };

  it("Friday: announced, not running", () => {
    const friday = SAT - 3600;
    expect(announcedWeekend(friday, state)).toBe(RUN);
    expect(runningWeekend(friday, state)).toBeNull();
    expect(announcedWeekend(RUN.announceAt - 1, state)).toBeNull();
  });

  it("the next one runs from Saturday 00:00 without asking the server again, and ends Sunday 23:59:59", () => {
    expect(runningWeekend(SAT, state)).toBe(RUN);
    expect(runningWeekend(RUN.endsAt - 1, state)).toBe(RUN);
    expect(runningWeekend(RUN.endsAt, state)).toBeNull();
    expect(announcedWeekend(SAT, state)).toBeNull();
  });

  it("weekendPercent reads the running event against the server clock", () => {
    setWeekend({ active: RUN, next: null }, SAT + 10);
    expect(Math.abs(weekendNow() - (SAT + 10))).toBeLessThanOrEqual(1);
    expect(weekendPercent("builders")).toBe(30);
    expect(weekendPercent("study")).toBe(0);
    expect(weekendPercent("builders", RUN.endsAt)).toBe(0);
  });

  it("listeners hear a change only", () => {
    const heard: unknown[] = [];
    onWeekendChange((s) => heard.push(s));
    setWeekend({ active: RUN, next: null });
    setWeekend({ active: { ...RUN }, next: null });
    setWeekend({ active: null, next: null });
    expect(heard).toHaveLength(2);
    expect(currentWeekend()).toEqual({ active: null, next: null });
  });
});

describe("the server's arithmetic (weekendBoosts.ts)", () => {
  it("prices round up, timers round up to at least 1 s", () => {
    expect(lessByPercent(34_560, 30)).toBe(24_192);
    expect(costLessBy({ r1: 50_000, r2: 37_500, r3: 12_500, r4: 0 }, 30)).toEqual({
      r1: 35_000,
      r2: 26_250,
      r3: 8_750,
      r4: 0,
    });
    expect(shorterBy(15, 30)).toBe(11);
    expect(shorterBy(86_400, 30)).toBe(60_480);
    expect(shorterBy(1, 90)).toBe(1);
  });
});

describe("popupRun: once per run on this device", () => {
  const state = { active: null, next: RUN };

  it("announced on Friday, then not again for the same run", () => {
    expect(popupRun(SAT - 60, state, null)).toBe(RUN);
    expect(popupRun(SAT - 60, state, RUN.key)).toBeNull();
    expect(popupRun(SAT + 60, state, RUN.key)).toBeNull();
  });

  it("first visit during the weekend shows it; nothing before the announcement", () => {
    expect(popupRun(SAT + 60, state, "2026-11-07")).toBe(RUN);
    expect(popupRun(RUN.announceAt - 60, state, null)).toBeNull();
  });
});

describe("the daily check-in (owner, 13 Nov 2026)", () => {
  const wire = {
    key: "2026-11-14",
    amount: 50,
    day: 1,
    days: 2,
    claimedToday: true,
    marks: [
      { day: 1, claimed: true },
      { day: 2, claimed: false },
    ],
    nextAt: SAT + 86_400,
  };

  it("reads the server's check-in and drops anything malformed", () => {
    expect(readCheckin(wire)).toEqual(wire);
    expect(readCheckin(null)).toBeNull();
    expect(readCheckin({ ...wire, day: 0 })).toBeNull();
    expect(readCheckin({ ...wire, key: 5 })).toBeNull();
    expect(readCheckin({ ...wire, nextAt: null })?.nextAt).toBeNull();
  });

  it("Sunday 00:00 opens day 2 without asking the server; Sunday is the last day", () => {
    const sunday = checkinAt(readCheckin(wire)!, SAT + 86_400);
    expect(sunday).toMatchObject({ day: 2, claimedToday: false, nextAt: null });
    expect(sunday.marks).toEqual(wire.marks);
    expect(checkinAt(readCheckin(wire)!, SAT + 86_399)).toMatchObject({ day: 1, claimedToday: true });
  });

  it("a long test run's two marks move on a day", () => {
    const long = { ...wire, day: 20_406, days: 47_000, marks: [{ day: 20_405, claimed: false }, { day: 20_406, claimed: true }] };
    expect(checkinAt(readCheckin(long)!, SAT + 86_400).marks).toEqual([
      { day: 20_406, claimed: true },
      { day: 20_407, claimed: false },
    ]);
  });

  it("belongs to its own run only; a check-in waits while today is not done", () => {
    setWeekend({ active: RUN, next: null }, SAT + 60);
    setWeekendCheckin(readCheckin(wire));
    expect(weekendCheckin(RUN, SAT + 60)?.claimedToday).toBe(true);
    expect(weekendCheckin({ key: "2026-11-21" }, SAT + 60)).toBeNull();
    expect(checkinWaiting(SAT + 60)).toBe(false);
    expect(checkinWaiting(SAT + 86_400)).toBe(true);
    // After the weekend nothing waits.
    expect(checkinWaiting(SAT + 2 * 86_400)).toBe(false);
  });
});
