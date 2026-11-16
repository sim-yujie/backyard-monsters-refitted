import { describe, expect, it } from "vitest";
import type { EventView } from "@/api/events";
import type { WeekendRun, WeekendState } from "@/game/weekend";
import {
  nextDailyReset,
  nextWeeklyReset,
  pillCountdown,
  resetRows,
  rowCountdown,
  rowTimeText,
  serverTimeText,
  type ResetRow,
} from "./resetClock";

const at = (iso: string): number => Date.parse(iso) / 1000;

/** The mock-up's moment: Sunday 15 Nov 2026, 05:59 server time. */
const MOCKUP = at("2026-11-15T05:59:00Z");

const NO_WEEKEND: WeekendState = { active: null, next: null };

const run = (startsAt: number, extra: Partial<WeekendRun> = {}): WeekendRun => ({
  id: "builders",
  title: "Builder's Weekend",
  line: "Upgrades cost 30% less",
  percent: 30,
  key: "k",
  startsAt,
  endsAt: startsAt + 48 * 3600,
  announceAt: startsAt - 24 * 3600,
  forced: false,
  ...extra,
});

const hunt = (status: EventView["status"], startsAt: number, endsAt: number, id = "krallen-2026-11"): EventView => ({
  id,
  title: "Krallen Hunt",
  text: "",
  kind: "krallen",
  banner: null,
  status,
  startsAt,
  endsAt,
  claimUntil: null,
  locked: null,
  calendar: null,
  ladder: null,
  krallen: null,
});

const byId = (rows: readonly ResetRow[], id: ResetRow["id"]): ResetRow | undefined => rows.find((row) => row.id === id);

describe("daily reset", () => {
  it("is the next 00:00 UTC", () => {
    expect(nextDailyReset(MOCKUP)).toBe(at("2026-11-16T00:00:00Z"));
    expect(nextDailyReset(at("2026-11-15T23:59:59Z"))).toBe(at("2026-11-16T00:00:00Z"));
  });

  it("at exactly midnight is a whole day on, never zero", () => {
    expect(nextDailyReset(at("2026-11-16T00:00:00Z"))).toBe(at("2026-11-17T00:00:00Z"));
  });
});

describe("weekly reset", () => {
  it("is the next Monday 00:00 UTC", () => {
    expect(nextWeeklyReset(MOCKUP)).toBe(at("2026-11-16T00:00:00Z")); // a Sunday
    expect(nextWeeklyReset(at("2026-11-16T00:00:01Z"))).toBe(at("2026-11-23T00:00:00Z")); // Monday
    expect(nextWeeklyReset(at("2026-11-21T12:00:00Z"))).toBe(at("2026-11-23T00:00:00Z")); // Saturday
  });

  it("at exactly Monday 00:00 is 7 days on, not 0", () => {
    const monday = at("2026-11-16T00:00:00Z");
    expect(nextWeeklyReset(monday) - monday).toBe(7 * 86_400);
  });
});

describe("countdown words", () => {
  it("the pill: hours and padded minutes, then minutes and padded seconds", () => {
    expect(pillCountdown(nextDailyReset(MOCKUP) - MOCKUP)).toBe("18h 01m");
    expect(pillCountdown(23 * 3600 + 59 * 60 + 59)).toBe("23h 59m");
    expect(pillCountdown(24 * 3600)).toBe("24h 00m");
    expect(pillCountdown(3599)).toBe("59m 59s");
    expect(pillCountdown(249)).toBe("4m 09s");
    expect(pillCountdown(0)).toBe("0m 00s");
    expect(pillCountdown(-5)).toBe("0m 00s");
  });

  it("the pill is at most 7 characters within a day (its fixed width)", () => {
    for (const seconds of [86_400, 36_000, 3_600, 3_599, 600, 59, 0]) {
      expect(pillCountdown(seconds).length).toBeLessThanOrEqual(7);
    }
  });

  it("a row: days and hours from a day out", () => {
    expect(rowCountdown(15 * 86_400 + 18 * 3600 + 1)).toBe("15d 18h");
    expect(rowCountdown(86_400)).toBe("1d 0h");
    expect(rowCountdown(18 * 3600 + 60)).toBe("18h 01m");
  });

  it("the server's time of day, in UTC", () => {
    expect(serverTimeText(MOCKUP)).toBe("05:59");
    expect(serverTimeText(at("2026-11-15T23:07:59Z"))).toBe("23:07");
  });
});

describe("the rows", () => {
  it("daily and weekly always; nothing else when no event is known", () => {
    const rows = resetRows(MOCKUP, { weekend: NO_WEEKEND, events: null });
    expect(rows.map((row) => row.id)).toEqual(["daily", "weekly"]);
    expect(rows.map((row) => rowTimeText(row, MOCKUP))).toEqual(["18h 01m", "18h 01m"]);
    expect(byId(rows, "daily")?.detail).toBe("quests, gifts, help rewards, trade asks");
    expect(byId(rows, "weekly")?.detail).toBe("quests, alliance goals");
  });

  it("matches the mock-up: weekend on Saturday, Krallen Hunt ending 1 Dec", () => {
    const saturday = at("2026-11-21T00:00:00Z");
    const rows = resetRows(MOCKUP, {
      weekend: { active: null, next: run(saturday) },
      events: [hunt("active", at("2026-11-15T00:00:00Z"), at("2026-12-01T00:00:00Z"))],
    });
    expect(rows.map((row) => row.id)).toEqual(["daily", "weekly", "weekend", "krallen"]);
    expect(rows.map((row) => rowTimeText(row, MOCKUP))).toEqual([
      "18h 01m",
      "18h 01m",
      "starts in 5d 18h",
      "ends in 15d 18h",
    ]);
    expect(byId(rows, "weekend")?.detail).toBe("Builder's Weekend");
  });
});

describe("the weekend row", () => {
  it("uses the server's start, which carries the dashboard's time offset", () => {
    // utcOffsetMinutes = 480: Saturday 00:00 at UTC+8 is Friday 16:00 UTC.
    const start = at("2026-11-20T16:00:00Z");
    const row = byId(resetRows(MOCKUP, { weekend: { active: null, next: run(start) }, events: null }), "weekend");
    expect(row).toMatchObject({ phase: "starts", at: start });
  });

  it("while one runs: ends in", () => {
    const start = at("2026-11-14T00:00:00Z");
    const now = at("2026-11-15T05:59:00Z");
    const row = byId(resetRows(now, { weekend: { active: run(start), next: null }, events: null }), "weekend");
    expect(row).toMatchObject({ phase: "ends", at: start + 48 * 3600 });
    expect(rowTimeText(row!, now)).toBe("ends in 18h 01m");
  });

  it("the next one once its Saturday has come, before the server says so", () => {
    const start = at("2026-11-21T00:00:00Z");
    const now = start + 60;
    const row = byId(resetRows(now, { weekend: { active: null, next: run(start) }, events: null }), "weekend");
    expect(row).toMatchObject({ phase: "ends", at: start + 48 * 3600 });
  });

  it("is left out when no weekend event is scheduled", () => {
    expect(byId(resetRows(MOCKUP, { weekend: NO_WEEKEND, events: null }), "weekend")).toBeUndefined();
  });
});

describe("the Krallen Hunt row", () => {
  const start = at("2026-12-15T00:00:00Z");
  const end = at("2027-01-01T00:00:00Z");

  it("coming up: starts in", () => {
    const now = at("2026-12-10T00:00:00Z");
    const row = byId(resetRows(now, { weekend: NO_WEEKEND, events: [hunt("upcoming", start, end)] }), "krallen");
    expect(row).toMatchObject({ title: "Krallen Hunt", phase: "starts", at: start });
    expect(rowTimeText(row!, now)).toBe("starts in 5d 0h");
  });

  it("on now: ends in, ahead of a later one coming up", () => {
    const now = at("2026-12-20T00:00:00Z");
    const events = [hunt("upcoming", at("2027-01-15T00:00:00Z"), at("2027-02-01T00:00:00Z"), "krallen-2027-01"), hunt("active", start, end)];
    expect(byId(resetRows(now, { weekend: NO_WEEKEND, events }), "krallen")).toMatchObject({ phase: "ends", at: end });
  });

  it("over, with only its claim days left: no row", () => {
    const now = at("2027-01-03T00:00:00Z");
    expect(byId(resetRows(now, { weekend: NO_WEEKEND, events: [hunt("ended", start, end)] }), "krallen")).toBeUndefined();
  });

  it("an active hunt whose end has passed (list not read again yet): no row", () => {
    expect(byId(resetRows(end + 1, { weekend: NO_WEEKEND, events: [hunt("active", start, end)] }), "krallen")).toBeUndefined();
  });

  it("other events are not Krallen Hunts", () => {
    const other = { ...hunt("active", start, end), kind: "pumpkin" };
    expect(byId(resetRows(start + 1, { weekend: NO_WEEKEND, events: [other] }), "krallen")).toBeUndefined();
  });
});
