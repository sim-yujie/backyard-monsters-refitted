import { describe, expect, test } from "bun:test";

import {
  BIG_EVENT_COINS,
  EVENT_COINS_LADDER_TOTAL,
  EVENT_COINS_PER_CALENDAR_DAY,
  type EventReward,
} from "../../game-data/events/eventRewards.js";
import {
  EVENTS,
  KRALLEN_HUNTS,
  THANKSGIVING_2026_COINS,
  withEventCoins,
  type EventDefinition,
} from "../../game-data/events/events.js";
import { WEEKEND_EVENT_INFO } from "../../game-data/events/weekendEvents.js";
import { WEEKEND_COINS } from "./weekendCoins.js";

/**
 * Event coins come only from big 1-2 week events (owner, 8 Nov 2026), through
 * the event's `coins` field: 15 a calendar day and a coin amount per ladder
 * tier, about 400 for a full 14-day event. Weekend events pay a small
 * fixed amount of their own instead (`weekendCoins.ts`, owner 12 Nov 2026).
 */

const coinsIn = (rewards: readonly EventReward[]): number =>
  rewards.reduce((sum, reward) => sum + (reward.kind === "eventCoins" ? reward.amount : 0), 0);

const eventCoinsTotal = (event: EventDefinition): number =>
  (event.calendar ?? []).reduce((sum, day) => sum + coinsIn(day.rewards), 0) +
  (event.ladder?.tiers ?? []).reduce((sum, tier) => sum + coinsIn(tier.rewards), 0);

const BIG: EventDefinition = {
  id: "big-test",
  title: "Big",
  text: "Big",
  kind: "test",
  startsAt: "2030-01-01T00:00:00Z",
  endsAt: "2030-01-15T00:00:00Z",
  calendar: Array.from({ length: 14 }, () => ({ rewards: [{ kind: "shiny", amount: 5 } as const] })),
  ladder: {
    label: "Things",
    tiers: [10, 25, 50, 100].map((need) => ({ need, rewards: [{ kind: "shiny", amount: 1 } as const] })),
  },
  coins: BIG_EVENT_COINS,
};

describe("big events pay event coins", () => {
  test("the numbers: 15 a calendar day, 20/35/55/80 over the ladder, 400 for a 14-day event", () => {
    expect(BIG_EVENT_COINS).toEqual({ perCalendarDay: 15, milestones: [20, 35, 55, 80] });
    expect(EVENT_COINS_PER_CALENDAR_DAY).toBe(15);
    expect(EVENT_COINS_LADDER_TOTAL).toBe(190);
    expect(14 * EVENT_COINS_PER_CALENDAR_DAY + EVENT_COINS_LADDER_TOTAL).toBe(400);
  });

  test("withEventCoins adds the day's coins to every calendar day and each tier's to its tier", () => {
    const paid = withEventCoins(BIG);
    expect(paid.calendar!.map((day) => coinsIn(day.rewards))).toEqual(Array(14).fill(15));
    expect(paid.calendar![0]!.rewards).toEqual([
      { kind: "shiny", amount: 5 },
      { kind: "eventCoins", amount: 15 },
    ]);
    expect(paid.ladder!.tiers.map((tier) => coinsIn(tier.rewards))).toEqual([20, 35, 55, 80]);
    expect(eventCoinsTotal(paid)).toBe(400);
    // The event's own rewards stay; the original is not changed.
    expect(BIG.calendar![0]!.rewards).toHaveLength(1);
    expect(paid.ladder!.tiers[3]!.rewards[0]).toEqual({ kind: "shiny", amount: 1 });
  });

  test("an event without coins pays none; a tier past the milestones or a 0 adds nothing", () => {
    const { coins: _none, ...plain } = BIG;
    expect(withEventCoins(plain)).toBe(plain);
    expect(eventCoinsTotal(withEventCoins(plain))).toBe(0);
    const short = withEventCoins({ ...BIG, coins: { perCalendarDay: 0, milestones: [5] } });
    expect(short.calendar![0]!.rewards).toHaveLength(1);
    expect(short.ladder!.tiers.map((tier) => coinsIn(tier.rewards))).toEqual([5, 0, 0, 0]);
  });

  test("Halloween 2026 pays them: 15 on each of its 14 days and 190 over its 4 pumpkin tiers", () => {
    const halloween = EVENTS.find((event) => event.id === "halloween-2026")!;
    expect(halloween.coins).toBe(BIG_EVENT_COINS);
    expect(halloween.calendar!.map((day) => coinsIn(day.rewards))).toEqual(Array(14).fill(15));
    expect(halloween.ladder!.tiers.map((tier) => coinsIn(tier.rewards))).toEqual([20, 35, 55, 80]);
    expect(eventCoinsTotal(halloween)).toBe(400);
  });

  test("Thanksgiving 2026 pays them like Halloween, plus 100 at the 50-turkey tier: 15 a day and 290 over its 4 tiers", () => {
    const thanksgiving = EVENTS.find((event) => event.id === "thanksgiving-2026")!;
    expect(thanksgiving.coins).toBe(THANKSGIVING_2026_COINS);
    expect(THANKSGIVING_2026_COINS).toEqual({ perCalendarDay: 15, milestones: [20, 135, 55, 80] });
    expect(thanksgiving.calendar!.map((day) => coinsIn(day.rewards))).toEqual(Array(14).fill(15));
    expect(thanksgiving.ladder!.tiers.map((tier) => coinsIn(tier.rewards))).toEqual([20, 135, 55, 80]);
    // One Glimmer figure per tier: the 50-turkey tier's 100 is in its milestone, not a second row.
    for (const tier of thanksgiving.ladder!.tiers) {
      expect(tier.rewards.filter((one) => one.kind === "eventCoins")).toHaveLength(1);
    }
    expect(eventCoinsTotal(thanksgiving)).toBe(500);
    // The Glimmers come last, after the day's own reward, as on Halloween's days.
    expect(thanksgiving.calendar![0]!.rewards.at(-1)).toEqual({ kind: "eventCoins", amount: 15 });
  });

  test("every event with coins has one milestone per ladder tier", () => {
    for (const event of EVENTS) {
      if (!event.coins) continue;
      expect([event.id, event.coins.milestones.length]).toEqual([event.id, event.ladder?.tiers.length ?? 0]);
      expect(event.coins.perCalendarDay).toBeGreaterThanOrEqual(0);
    }
  });

  test("the monthly Krallen Hunt pays no coins", () => {
    for (const hunt of KRALLEN_HUNTS) expect(eventCoinsTotal(EVENTS.find((event) => event.id === hunt.id)!)).toBe(0);
  });

  test("weekend events pay only their fixed 25 + 75 (weekendCoins.ts); their definitions carry boosts only", () => {
    for (const weekend of Object.values(WEEKEND_EVENT_INFO)) {
      expect(JSON.stringify(weekend)).not.toMatch(/coin/i);
    }
    expect(WEEKEND_COINS).toEqual({ played: 25, boost: 75 });
  });
});
