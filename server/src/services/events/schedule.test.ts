import { describe, expect, test } from "bun:test";

import { eventsForcedOn } from "../../config/GameConfig.js";
import type { EventDefinition } from "../../game-data/events/events.js";
import { eventWindow, nextUtcMidnight, statusAt, utcDay, visibleEvents } from "./schedule.js";

const DAY = 86_400;
const at = (iso: string) => Date.parse(iso) / 1000;

const event = (id: string, startsAt: string, endsAt: string): EventDefinition => ({
  id,
  title: id,
  text: "",
  kind: "test",
  startsAt,
  endsAt,
});

const HALLOWEEN = event("halloween", "2026-10-28T00:00:00Z", "2026-11-11T00:00:00Z");
const XMAS = event("xmas", "2026-12-20T00:00:00Z", "2027-01-03T00:00:00Z");
const NONE = new Set<string>();

describe("UTC days", () => {
  test("a day is the UTC calendar day, whatever the hour", () => {
    expect(utcDay(at("2026-10-28T00:00:00Z"))).toBe("2026-10-28");
    expect(utcDay(at("2026-10-28T23:59:59Z"))).toBe("2026-10-28");
    expect(utcDay(at("2026-10-29T00:00:00Z"))).toBe("2026-10-29");
  });

  test("the next day opens at the next UTC midnight", () => {
    expect(nextUtcMidnight(at("2026-10-28T13:00:00Z"))).toBe(at("2026-10-29T00:00:00Z"));
    expect(nextUtcMidnight(at("2026-10-28T00:00:00Z"))).toBe(at("2026-10-29T00:00:00Z"));
  });
});

describe("event windows", () => {
  test("on from the start up to, not including, the end", () => {
    const window = eventWindow(HALLOWEEN, 0, NONE);
    expect(statusAt(window, at("2026-10-27T23:59:59Z"))).toBe("upcoming");
    expect(statusAt(window, at("2026-10-28T00:00:00Z"))).toBe("active");
    expect(statusAt(window, at("2026-11-10T23:59:59Z"))).toBe("active");
    expect(statusAt(window, at("2026-11-11T00:00:00Z"))).toBe("past");
  });

  test("a forced event starts at today's UTC midnight and keeps its length", () => {
    const now = at("2026-10-20T15:00:00Z");
    const window = eventWindow(HALLOWEEN, now, new Set(["halloween"]));
    expect(window).toEqual({ startsAt: at("2026-10-20T00:00:00Z"), endsAt: at("2026-10-20T00:00:00Z") + 14 * DAY });
    expect(statusAt(window, now)).toBe("active");
  });

  test("EVENTS_FORCE_ON is read locally and ignored on production", () => {
    expect([...eventsForcedOn({ EVENTS_FORCE_ON: "a, b,,c" })]).toEqual(["a", "b", "c"]);
    expect(eventsForcedOn({ EVENTS_FORCE_ON: "a", ENV: "production" }).size).toBe(0);
    expect(eventsForcedOn({}).size).toBe(0);
  });
});

describe("which events show", () => {
  const shown = (iso: string) =>
    visibleEvents(at(iso), [XMAS, HALLOWEEN], NONE).map((one) => [one.event.id, one.status]);

  test("active first, then upcoming within 30 days; past and far-off ones are left out", () => {
    expect(shown("2026-10-20T00:00:00Z")).toEqual([["halloween", "upcoming"]]);
    expect(shown("2026-11-01T00:00:00Z")).toEqual([["halloween", "active"]]);
    expect(shown("2026-11-25T00:00:00Z")).toEqual([["xmas", "upcoming"]]);
    expect(shown("2026-12-21T00:00:00Z")).toEqual([["xmas", "active"]]);
    expect(shown("2027-02-01T00:00:00Z")).toEqual([]);
  });

  test("an active event comes before an upcoming one that starts sooner", () => {
    const soon = event("soon", "2026-11-12T00:00:00Z", "2026-11-13T00:00:00Z");
    const now = at("2026-11-10T00:00:00Z");
    expect(visibleEvents(now, [soon, HALLOWEEN], NONE).map((one) => one.event.id)).toEqual(["halloween", "soon"]);
  });
});
