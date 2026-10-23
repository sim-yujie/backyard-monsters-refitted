import { describe, expect, test } from "bun:test";

import {
  EVENTS,
  HALLOWEEN_2026_CALENDAR,
  KRALLEN_HUNT_GOALS,
  KRALLEN_HUNTS,
  krallenHunt,
  tierNeed,
} from "../../game-data/events/events.js";
import { rewardProblem } from "./grant.js";

/** The event list (`game-data/events/events.ts`): every entry must be payable and well formed. */
describe("the event list", () => {
  test("ids are unique and plain; every window is UTC and starts before it ends", () => {
    const ids = EVENTS.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const event of EVENTS) {
      expect(event.id).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(event.startsAt.endsWith("Z") && event.endsAt.endsWith("Z")).toBe(true);
      const start = Date.parse(event.startsAt);
      const end = Date.parse(event.endsAt);
      expect(Number.isFinite(start) && Number.isFinite(end)).toBe(true);
      expect(start).toBeLessThan(end);
    }
  });

  test("every calendar and ladder reward can be paid", () => {
    for (const event of EVENTS) {
      const rewards = [
        ...(event.calendar ?? []).flatMap((day) => day.rewards),
        ...(event.ladder?.tiers ?? []).flatMap((tier) => tier.rewards),
      ];
      for (const reward of rewards) expect([event.id, reward, rewardProblem(reward)]).toEqual([event.id, reward, null]);
      for (const day of event.calendar ?? []) expect(day.rewards.length).toBeGreaterThan(0);
      const needs = (event.ladder?.tiers ?? []).map((tier) => tier.need);
      expect(needs).toEqual([...needs].sort((a, b) => a - b));
    }
  });

  test("Halloween 2026: 28 Oct to 11 Nov UTC, a 14-day calendar with pumpkins on days 7 and 14", () => {
    const halloween = EVENTS.find((event) => event.id === "halloween-2026")!;
    expect(halloween).toMatchObject({ startsAt: "2026-10-28T00:00:00Z", endsAt: "2026-11-11T00:00:00Z" });
    expect(HALLOWEEN_2026_CALENDAR).toHaveLength(14);
    expect(HALLOWEEN_2026_CALENDAR[6]!.rewards).toContainEqual({ kind: "decoration", type: 111, count: 1 });
    expect(HALLOWEEN_2026_CALENDAR[13]!.rewards).toContainEqual({ kind: "decoration", type: 110, count: 1 });
  });

  test("Krallen Hunt: monthly from 15 Nov 2026, the 15th to the 1st, never during Halloween", () => {
    expect(KRALLEN_HUNTS[0]).toMatchObject({
      id: "krallen-2026-11",
      kind: "krallen",
      startsAt: "2026-11-15T00:00:00Z",
      endsAt: "2026-12-01T00:00:00Z",
      requires: { townHall: 6, tutorial: true },
    });
    expect(KRALLEN_HUNTS[0]!.ladder).toMatchObject({
      source: "attackLoot",
      tiers: [{ need: 60_000_000, needByKrallenLevel: KRALLEN_HUNT_GOALS, rewards: [{ kind: "krallen" }] }],
    });
    expect(KRALLEN_HUNT_GOALS).toEqual([60_000_000, 100_000_000, 150_000_000, 225_000_000, 300_000_000]);
    expect(krallenHunt(2026, 12)).toMatchObject({ id: "krallen-2026-12", startsAt: "2026-12-15T00:00:00Z", endsAt: "2027-01-01T00:00:00Z" });
    expect(KRALLEN_HUNTS[1]!.id).toBe("krallen-2026-12");
    expect(KRALLEN_HUNTS[2]!.id).toBe("krallen-2027-01");
    for (const hunt of KRALLEN_HUNTS) {
      expect(hunt.startsAt).toMatch(/^\d{4}-\d{2}-15T00:00:00Z$/);
      expect(hunt.endsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00Z$/);
      expect(Date.parse(hunt.endsAt) - Date.parse(hunt.startsAt)).toBeLessThan(18 * 86_400_000);
    }
    const halloween = EVENTS.find((event) => event.id === "halloween-2026")!;
    for (const hunt of KRALLEN_HUNTS) {
      const overlaps = Date.parse(hunt.startsAt) < Date.parse(halloween.endsAt) && Date.parse(halloween.startsAt) < Date.parse(hunt.endsAt);
      expect([hunt.id, overlaps]).toEqual([hunt.id, false]);
    }
  });

  test("Krallen Hunt goal by her level: 60M to win her, then 100M, 150M, 225M, 300M; level 5 keeps the last", () => {
    const tier = KRALLEN_HUNTS[0]!.ladder!.tiers[0]!;
    expect([0, 1, 2, 3, 4, 5, 9].map((level) => tierNeed(tier, level))).toEqual([
      60_000_000, 100_000_000, 150_000_000, 225_000_000, 300_000_000, 300_000_000, 300_000_000,
    ]);
    expect(tierNeed(tier, -1)).toBe(60_000_000);
    expect(tierNeed({ need: 25, rewards: [] }, 3)).toBe(25);
  });
});
