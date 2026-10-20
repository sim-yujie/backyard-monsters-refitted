import { describe, expect, test } from "bun:test";

import { EVENTS, HALLOWEEN_2026_CALENDAR } from "../../game-data/events/events.js";
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
});
