import { describe, expect, test } from "bun:test";

import { eventsForcedOff, eventsForcedOn } from "../../config/GameConfig.js";
import { EVENTS, KRALLEN_HUNT_SERIES, krallenHunt, type EventDefinition } from "../../game-data/events/events.js";
import { claimsUntil, eventWindow, nextUtcMidnight, statusAt, utcDay, visibleEvents } from "./schedule.js";

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

  test("EVENTS_FORCE_OFF is read locally and ignored on production", () => {
    expect([...eventsForcedOff({ EVENTS_FORCE_OFF: "halloween-2026, krallen-2026-11" })]).toEqual([
      "halloween-2026",
      "krallen-2026-11",
    ]);
    expect(eventsForcedOff({ EVENTS_FORCE_OFF: "halloween-2026", ENV: "production" }).size).toBe(0);
    expect(eventsForcedOff({ EVENTS_FORCE_ON: "halloween-2026" }).size).toBe(0);
  });

  test("an event switched off is over in the middle of its dates, with nothing to claim", () => {
    const now = at("2026-11-01T12:00:00Z");
    const off = new Set(["halloween"]);
    expect(statusAt(eventWindow(HALLOWEEN, now, NONE, NONE), now)).toBe("active");
    const window = eventWindow(HALLOWEEN, now, NONE, off);
    expect(statusAt(window, now)).toBe("past");
    expect(claimsUntil({ ...HALLOWEEN, claimDays: 7 }, window)).toBeLessThan(now);
  });

  test("switched off wins over forced on", () => {
    const now = at("2026-10-20T15:00:00Z");
    const both = new Set(["halloween"]);
    expect(statusAt(eventWindow(HALLOWEEN, now, both, both), now)).toBe("past");
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

  test("an event switched off is not listed, the others are", () => {
    const now = at("2026-11-01T00:00:00Z");
    const soon = event("soon", "2026-11-12T00:00:00Z", "2026-11-13T00:00:00Z");
    const ids = (off: ReadonlySet<string>) => visibleEvents(now, [soon, HALLOWEEN], NONE, off).map((one) => one.event.id);
    expect(ids(NONE)).toEqual(["halloween", "soon"]);
    expect(ids(new Set(["halloween"]))).toEqual(["soon"]);
  });

  test("an active event comes before an upcoming one that starts sooner", () => {
    const soon = event("soon", "2026-11-12T00:00:00Z", "2026-11-13T00:00:00Z");
    const now = at("2026-11-10T00:00:00Z");
    expect(visibleEvents(now, [soon, HALLOWEEN], NONE).map((one) => one.event.id)).toEqual(["halloween", "soon"]);
  });
});

describe("a repeating series (owner, 15 Nov 2026)", () => {
  const ids = (iso: string, events: readonly EventDefinition[] = EVENTS) =>
    visibleEvents(at(iso), events, NONE, NONE).map((one) => `${one.event.id}:${one.status}`);

  test("every monthly Krallen Hunt is one series", () => {
    expect(krallenHunt(2026, 11).series).toBe(KRALLEN_HUNT_SERIES);
    expect(krallenHunt(2027, 3).series).toBe(KRALLEN_HUNT_SERIES);
  });

  test("while a Krallen Hunt is on, the next one is not coming up; other events are", () => {
    // 15 Nov 2026 13:30 UTC: the November hunt has just begun, December's is 29d 10h away.
    const shown = ids("2026-11-15T13:30:00Z");
    expect(shown).toContain("krallen-2026-11:active");
    expect(shown.some((id) => id.startsWith("krallen-2026-12"))).toBe(false);
    expect(shown).toContain("thanksgiving-2026:upcoming");
    const late = ids("2026-11-30T23:59:59Z");
    expect(late).toContain("krallen-2026-11:active");
    expect(late.some((id) => id.startsWith("krallen-2026-12"))).toBe(false);
  });

  test("once the hunt is over the next one shows, even while the last one's claim days run", () => {
    const shown = ids("2026-12-02T00:00:00Z");
    expect(shown).toContain("krallen-2026-11:ended");
    expect(shown).toContain("krallen-2026-12:upcoming");
    expect(ids("2026-12-10T00:00:00Z")).toContain("krallen-2026-12:upcoming");
    expect(ids("2026-12-15T00:00:00Z")).toContain("krallen-2026-12:active");
    expect(ids("2026-12-15T00:00:00Z").some((id) => id.startsWith("krallen-2027-01"))).toBe(false);
  });

  test("only the same series is held back; an event without one is never", () => {
    const run = (id: string, startsAt: string, endsAt: string, series?: string): EventDefinition => ({
      ...event(id, startsAt, endsAt),
      ...(series && { series }),
    });
    const a1 = run("a1", "2026-11-01T00:00:00Z", "2026-11-20T00:00:00Z", "a");
    const a2 = run("a2", "2026-11-25T00:00:00Z", "2026-12-05T00:00:00Z", "a");
    const b2 = run("b2", "2026-11-25T00:00:00Z", "2026-12-05T00:00:00Z", "b");
    const loose = run("loose", "2026-11-25T00:00:00Z", "2026-12-05T00:00:00Z");
    expect(ids("2026-11-10T00:00:00Z", [a1, a2, b2, loose])).toEqual(["a1:active", "b2:upcoming", "loose:upcoming"]);
    expect(ids("2026-11-21T00:00:00Z", [a1, a2, b2, loose])).toEqual(["a2:upcoming", "b2:upcoming", "loose:upcoming"]);
  });
});
