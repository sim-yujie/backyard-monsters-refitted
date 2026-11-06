import { describe, expect, test } from "bun:test";

import { DEFAULT_WEEKEND_SETTINGS, type WeekendSettings } from "../../game-data/events/weekendEvents.js";
import {
  activeRun,
  boostAt,
  isSaturday,
  scheduledEvent,
  dayOfDate,
  weekendPlan,
  weekendState,
} from "./weekendSchedule.js";

const at = (iso: string) => Date.parse(iso) / 1000;
const settings = (over: Partial<WeekendSettings> = {}): WeekendSettings => ({ ...DEFAULT_WEEKEND_SETTINGS, ...over });

describe("weekend schedule", () => {
  test("Saturdays are told apart", () => {
    expect(isSaturday("2026-11-14")).toBe(true);
    expect(isSaturday("2026-11-13")).toBe(false);
    expect(isSaturday("2026-02-30")).toBe(false);
    expect(isSaturday("nope")).toBe(false);
  });

  test("rotates one event per weekend from the first weekend, round and round", () => {
    const s = settings();
    const sat = (date: string) => dayOfDate(date)!;
    expect(scheduledEvent(s, sat("2026-11-14"))).toBe("builders");
    expect(scheduledEvent(s, sat("2026-11-21"))).toBe("plunder");
    expect(scheduledEvent(s, sat("2026-11-28"))).toBe("study");
    expect(scheduledEvent(s, sat("2026-12-05"))).toBe("hatch");
    expect(scheduledEvent(s, sat("2026-12-12"))).toBe("builders");
    // Nothing runs before the first weekend (the owner picks the start), unless swapped in by hand.
    expect(scheduledEvent(s, sat("2026-11-07"))).toBeNull();
    expect(scheduledEvent({ ...s, overrides: { "2026-11-07": "study" } }, sat("2026-11-07"))).toBe("study");
  });

  test("runs Saturday 00:00 to the end of Sunday, server time (UTC)", () => {
    const s = settings();
    expect(activeRun(s, at("2026-11-13T23:59:59Z"))).toBeNull();
    expect(activeRun(s, at("2026-11-14T00:00:00Z"))?.id).toBe("builders");
    expect(activeRun(s, at("2026-11-15T23:59:59Z"))?.id).toBe("builders");
    expect(activeRun(s, at("2026-11-16T00:00:00Z"))).toBeNull();
    expect(activeRun(s, at("2026-11-21T12:00:00Z"))?.id).toBe("plunder");
  });

  test("announces the next one from Friday 00:00", () => {
    const state = weekendState(settings(), at("2026-11-13T09:00:00Z"));
    expect(state.active).toBeNull();
    expect(state.next).toMatchObject({
      id: "builders",
      title: "Builder's Weekend",
      line: "Upgrades cost 30% less",
      percent: 30,
      key: "2026-11-14",
      startsAt: at("2026-11-14T00:00:00Z"),
      endsAt: at("2026-11-16T00:00:00Z"),
      announceAt: at("2026-11-13T00:00:00Z"),
      forced: false,
    });
  });

  test("while one runs, next is the following weekend's", () => {
    const state = weekendState(settings(), at("2026-11-15T10:00:00Z"));
    expect(state.active?.id).toBe("builders");
    expect(state.next?.key).toBe("2026-11-21");
    expect(state.next?.id).toBe("plunder");
  });

  test("a swapped weekend runs the chosen event, a skipped one nothing", () => {
    const s = settings({ overrides: { "2026-11-14": "hatch", "2026-11-21": "skip" } });
    expect(activeRun(s, at("2026-11-14T10:00:00Z"))?.id).toBe("hatch");
    expect(activeRun(s, at("2026-11-21T10:00:00Z"))).toBeNull();
    // The rotation goes on by date: the week after a skip is still "study".
    expect(activeRun(s, at("2026-11-28T10:00:00Z"))?.id).toBe("study");
    // Next after the swapped weekend skips the skipped one.
    expect(weekendState(s, at("2026-11-15T10:00:00Z")).next?.key).toBe("2026-11-28");
  });

  test("switched off: nothing runs and nothing is announced", () => {
    const state = weekendState(settings({ enabled: false }), at("2026-11-14T10:00:00Z"));
    expect(state).toEqual({ active: null, next: null });
  });

  test("a forced event runs now, ahead of the schedule, until it ends", () => {
    const now = at("2026-11-10T10:00:00Z");
    const s = settings({ forced: { id: "study", since: now, until: now + 3600 } });
    expect(activeRun(s, now)).toMatchObject({ id: "study", forced: true, startsAt: now, endsAt: now + 3600 });
    expect(activeRun(s, now + 3600)).toBeNull();
    expect(boostAt(s, "study", now + 10)).toBe(30);
    expect(boostAt(s, "builders", now + 10)).toBe(0);
    // Switched off takes the forced run with it.
    expect(activeRun({ ...s, enabled: false }, now)).toBeNull();
  });

  test("the percentage is the event's own", () => {
    const s = settings({ percent: { builders: 25, plunder: 30, study: 30, hatch: 30 } });
    expect(boostAt(s, "builders", at("2026-11-14T01:00:00Z"))).toBe(25);
    expect(activeRun(s, at("2026-11-14T01:00:00Z"))?.line).toBe("Upgrades cost 25% less");
  });

  test("a time zone moves the weekend: UTC+8 starts Friday 16:00 UTC", () => {
    const s = settings({ utcOffsetMinutes: 8 * 60 });
    expect(activeRun(s, at("2026-11-13T15:59:59Z"))).toBeNull();
    expect(activeRun(s, at("2026-11-13T16:00:00Z"))?.id).toBe("builders");
    expect(activeRun(s, at("2026-11-15T15:59:59Z"))?.id).toBe("builders");
    expect(activeRun(s, at("2026-11-15T16:00:00Z"))).toBeNull();
  });

  test("the dashboard's plan lists the weekends ahead with rotation, override and what runs", () => {
    const s = settings({ overrides: { "2026-11-21": "skip", "2026-11-28": "builders" } });
    const plan = weekendPlan(s, at("2026-11-12T00:00:00Z"), 4);
    expect(plan.map((row) => [row.key, row.rotation, row.override, row.runs])).toEqual([
      ["2026-11-14", "builders", null, "builders"],
      ["2026-11-21", "plunder", "skip", null],
      ["2026-11-28", "study", "builders", "builders"],
      ["2026-12-05", "hatch", null, "hatch"],
    ]);
    // During a weekend, the plan starts with the running one.
    expect(weekendPlan(s, at("2026-11-15T20:00:00Z"), 1)[0]?.key).toBe("2026-11-14");
  });
});
