import { describe, expect, test } from "bun:test";

import {
  EVENTS,
  HALLOWEEN_2026_CALENDAR,
  THANKSGIVING_2026_CALENDAR,
  THANKSGIVING_2026_LADDER,
  huntStartLevel,
  KRALLEN_AURA_GOALS,
  KRALLEN_HUNT_GOALS,
  KRALLEN_HUNTS,
  krallenAuraUntil,
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

  test("Thanksgiving 2026: 19 Nov to 3 Dec UTC, a 14-day calendar paced like Halloween's", () => {
    const thanksgiving = EVENTS.find((event) => event.id === "thanksgiving-2026")!;
    expect(thanksgiving).toMatchObject({ startsAt: "2026-11-19T00:00:00Z", endsAt: "2026-12-03T00:00:00Z" });
    // Its own 14 days, each with the day's Glimmers added (bigEventCoins.test.ts).
    const ownRewards: unknown = thanksgiving.calendar!.map((day) => day.rewards.filter((one) => one.kind !== "eventCoins"));
    expect(ownRewards).toEqual(THANKSGIVING_2026_CALENDAR.map((day) => day.rewards));
    expect(THANKSGIVING_2026_CALENDAR).toHaveLength(14);
    const days = (Date.parse(thanksgiving.endsAt) - Date.parse(thanksgiving.startsAt)) / 86_400_000;
    expect(THANKSGIVING_2026_CALENDAR).toHaveLength(days);
    // The same kind of reward on the same day as Halloween's.
    const kinds = (calendar: typeof HALLOWEEN_2026_CALENDAR) => calendar.map((day) => day.rewards.map((one) => one.kind));
    expect(kinds(THANKSGIVING_2026_CALENDAR)).toEqual(kinds(HALLOWEEN_2026_CALENDAR));
    expect(THANKSGIVING_2026_CALENDAR[6]!.rewards).toContainEqual({ kind: "decoration", type: 55, count: 1 });
    expect(THANKSGIVING_2026_CALENDAR[11]!.rewards).toContainEqual({ kind: "shopItem", item: "POD" });
    expect(THANKSGIVING_2026_CALENDAR[13]!.rewards).toContainEqual({ kind: "decoration", type: 69, count: 1 });
  });

  test("Thanksgiving 2026 turkey ladder (owner, 13 Nov 2026): no pumpkin; Scarecrow at 150, Autumn Maple Tree at 200", () => {
    expect(THANKSGIVING_2026_LADDER).toEqual([
      { need: 25, rewards: [{ kind: "shiny", amount: 10 }] },
      { need: 50, rewards: [] },
      { need: 150, rewards: [{ kind: "decoration", type: 69, count: 1 }, { kind: "shiny", amount: 20 }] },
      { need: 200, rewards: [{ kind: "decoration", type: 206, count: 1 }, { kind: "shiny", amount: 30 }] },
    ]);
    const thanksgiving = EVENTS.find((event) => event.id === "thanksgiving-2026")!;
    const all = thanksgiving.ladder!.tiers.flatMap((tier) => tier.rewards);
    expect(all.some((one) => one.kind === "decoration" && one.type === 110)).toBe(false);
    // The 50 tier is paid in Glimmers alone: 100 of its own and the usual 35.
    expect(thanksgiving.ladder!.tiers[1]!.rewards).toEqual([{ kind: "eventCoins", amount: 135 }]);
    // Reachable in the event: at most one turkey an hour, 24 a day, over its 14 days.
    const days = (Date.parse(thanksgiving.endsAt) - Date.parse(thanksgiving.startsAt)) / 86_400_000;
    expect(THANKSGIVING_2026_LADDER.at(-1)!.need).toBeLessThanOrEqual(days * 24);
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
      tiers: [
        { need: 60_000_000, needByKrallenLevel: KRALLEN_HUNT_GOALS, rewards: [{ kind: "krallen" }] },
        {
          need: 180_000_000,
          needByKrallenLevel: KRALLEN_AURA_GOALS,
          rewards: [{ kind: "krallenAura", until: Date.UTC(2027, 0, 1) / 1000 }],
        },
      ],
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

  test("Krallen's loot aura: 3x the goal (180M to 900M), until the end of the next month's hunt", () => {
    const tier = KRALLEN_HUNTS[0]!.ladder!.tiers[1]!;
    expect([0, 1, 2, 3, 4, 5].map((level) => tierNeed(tier, level))).toEqual([
      180_000_000, 300_000_000, 450_000_000, 675_000_000, 900_000_000, 900_000_000,
    ]);
    expect(KRALLEN_AURA_GOALS).toEqual(KRALLEN_HUNT_GOALS.map((goal) => goal * 3));
    // November's runs to 1 January (the end of December's hunt), December's to 1 February.
    expect(krallenAuraUntil(2026, 11)).toBe(Date.UTC(2027, 0, 1) / 1000);
    expect(krallenAuraUntil(2026, 12)).toBe(Date.UTC(2027, 1, 1) / 1000);
    expect(krallenAuraUntil(2027, 10)).toBe(Date.UTC(2027, 11, 1) / 1000);
    expect(krallenAuraUntil(2027, 11)).toBe(Date.UTC(2028, 0, 1) / 1000);
    // Each hunt's aura outlasts the next hunt's end, never the one after.
    for (const [index, hunt] of KRALLEN_HUNTS.slice(0, -1).entries()) {
      const until = (hunt.ladder!.tiers[1]!.rewards[0] as { until: number }).until;
      expect(until).toBe(Date.parse(KRALLEN_HUNTS[index + 1]!.endsAt) / 1000);
    }
  });

  test("the hunt's start level: her level now, less the one this hunt's first mark raised", () => {
    const tiers = KRALLEN_HUNTS[0]!.ladder!.tiers;
    expect(huntStartLevel(tiers, [], 3)).toBe(3);
    expect(huntStartLevel(tiers, [0], 3)).toBe(2);
    expect(huntStartLevel(tiers, [1], 3)).toBe(3);
    expect(huntStartLevel(tiers, [0, 1], 1)).toBe(0);
    expect(huntStartLevel(tiers, [0], 0)).toBe(0);
  });
});
