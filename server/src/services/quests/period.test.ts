import { describe, expect, test } from "bun:test";

import { DAY_SECONDS, nextUtcMidnight, nextUtcMonday, utcDay, utcWeek, utcWeekStart, WEEK_SECONDS } from "./period.js";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("the quests' clock (one reset for everyone, owner 2 Nov 2026)", () => {
  test("a day is the UTC calendar day and turns at 00:00 UTC", () => {
    expect(utcDay(at("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
    expect(utcDay(at("2026-11-02T23:59:59Z"))).toBe("2026-11-02");
    expect(utcDay(at("2026-11-03T00:00:00Z"))).toBe("2026-11-03");
    expect(nextUtcMidnight(at("2026-11-02T13:00:00Z"))).toBe(at("2026-11-03T00:00:00Z"));
    expect(nextUtcMidnight(at("2026-11-02T00:00:00Z"))).toBe(at("2026-11-03T00:00:00Z"));
  });

  test("a week starts on Monday 00:00 UTC and is named by that Monday", () => {
    // 2026-11-02 is a Monday.
    expect(utcWeekStart(at("2026-11-02T00:00:00Z"))).toBe(at("2026-11-02T00:00:00Z"));
    expect(utcWeek(at("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
    expect(utcWeek(at("2026-11-04T12:00:00Z"))).toBe("2026-11-02");
    expect(utcWeek(at("2026-11-08T23:59:59Z"))).toBe("2026-11-02");
  });

  test("Sunday belongs to the week that began the Monday before; the week turns at Monday 00:00", () => {
    expect(utcWeek(at("2026-11-01T23:59:59Z"))).toBe("2026-10-26");
    expect(utcWeek(at("2026-11-09T00:00:00Z"))).toBe("2026-11-09");
    expect(utcWeek(at("2026-11-08T23:59:59Z"))).not.toBe(utcWeek(at("2026-11-09T00:00:00Z")));
  });

  test("weeks across a month and a year end", () => {
    // 2030-01-01 is a Tuesday: its week began Monday 2029-12-31.
    expect(utcWeek(at("2030-01-01T05:00:00Z"))).toBe("2029-12-31");
    expect(utcWeek(at("2030-01-06T23:00:00Z"))).toBe("2029-12-31");
    expect(utcWeek(at("2030-01-07T00:00:00Z"))).toBe("2030-01-07");
  });

  test("the next weekly reset is the next Monday 00:00 UTC, a full week from a Monday midnight", () => {
    expect(nextUtcMonday(at("2026-11-04T12:00:00Z"))).toBe(at("2026-11-09T00:00:00Z"));
    expect(nextUtcMonday(at("2026-11-08T23:59:59Z"))).toBe(at("2026-11-09T00:00:00Z"));
    expect(nextUtcMonday(at("2026-11-02T00:00:00Z"))).toBe(at("2026-11-09T00:00:00Z"));
    expect(WEEK_SECONDS).toBe(7 * DAY_SECONDS);
  });
});
