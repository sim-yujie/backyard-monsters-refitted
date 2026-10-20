import { describe, expect, it } from "vitest";
import type { CalendarView, EventView } from "@/api/events";
import {
  calendarDays,
  claimableCount,
  claimableTiers,
  countdownText,
  isOver,
  rewardText,
  serverClock,
  shortAmount,
  sortEvents,
} from "./eventsModel";

const calendar = (over: Partial<CalendarView> = {}): CalendarView => ({
  days: [[{ kind: "shiny", amount: 1 }], [{ kind: "shiny", amount: 2 }], [{ kind: "shiny", amount: 3 }]],
  claimed: 0,
  canClaim: true,
  nextAt: null,
  ...over,
});

const event = (over: Partial<EventView> = {}): EventView => ({
  id: "halloween-2026",
  title: "Halloween",
  text: "Spooky.",
  kind: "halloween",
  banner: null,
  status: "active",
  startsAt: 1_000,
  endsAt: 100_000,
  calendar: calendar(),
  ladder: null,
  ...over,
});

const name = (type: number): string => (type === 111 ? "Mini-Pumpkin" : `Type ${type}`);

describe("calendarDays", () => {
  it("marks today's day claimable and the rest locked on a fresh calendar", () => {
    expect(calendarDays(calendar()).map((day) => day.state)).toEqual(["today", "locked", "locked"]);
  });

  it("marks claimed days and today's next one", () => {
    expect(calendarDays(calendar({ claimed: 1 })).map((day) => day.state)).toEqual(["claimed", "today", "locked"]);
  });

  it("shows tomorrow's day once today's is claimed", () => {
    const states = calendarDays(calendar({ claimed: 1, canClaim: false, nextAt: 5_000 })).map((day) => day.state);
    expect(states).toEqual(["claimed", "tomorrow", "locked"]);
  });

  it("locks the next day before the event starts", () => {
    expect(calendarDays(calendar({ canClaim: false })).map((day) => day.state)).toEqual(["locked", "locked", "locked"]);
  });

  it("numbers days from 1", () => {
    expect(calendarDays(calendar()).map((day) => day.day)).toEqual([1, 2, 3]);
  });
});

describe("claimableCount", () => {
  it("counts today's calendar day and every reached, unclaimed ladder tier", () => {
    const ladder = {
      label: "Pumpkins found",
      counter: 12,
      tiers: [
        { need: 5, rewards: [], claimed: true },
        { need: 10, rewards: [], claimed: false },
        { need: 20, rewards: [], claimed: false },
      ],
    };
    expect(claimableTiers(ladder)).toEqual([1]);
    expect(claimableCount([event({ ladder })])).toBe(2);
  });

  it("ignores events coming up and claimed days", () => {
    expect(claimableCount([event({ status: "upcoming" })])).toBe(0);
    expect(claimableCount([event({ calendar: calendar({ canClaim: false }) })])).toBe(0);
    expect(claimableCount([])).toBe(0);
  });
});

describe("countdowns", () => {
  it("counts to the end of an event that is on, to the start of one coming up", () => {
    expect(countdownText(event(), 100_000 - 3 * 86_400 - 4 * 3_600)).toBe("Ends in 3d 4h");
    expect(countdownText(event({ status: "upcoming", startsAt: 7_200 }), 0)).toBe("Starts in 2h 0m");
  });

  it("says when the list has gone stale", () => {
    expect(isOver(event(), 99_999)).toBe(false);
    expect(isOver(event(), 100_000)).toBe(true);
    expect(isOver(event({ status: "upcoming" }), 1_000)).toBe(true);
  });

  it("runs on the server's clock", () => {
    let device = 50_000;
    const clock = serverClock(1_000, 40_000, () => device);
    expect(clock.now()).toBe(1_010);
    device = 60_000;
    expect(clock.now()).toBe(1_020);
  });
});

describe("rewardText", () => {
  it("names each kind of reward", () => {
    expect(rewardText({ kind: "resources", amounts: { r1: 10_000, r2: 10_000 } }, name)).toBe(
      "10,000 Twigs, 10,000 Pebbles",
    );
    expect(rewardText({ kind: "shiny", amount: 25 }, name)).toBe("25 Shiny");
    expect(rewardText({ kind: "shopItem", item: "BST" }, name)).toBe("Sharper Tools (7 days)");
    expect(rewardText({ kind: "speedup", item: "SP2", count: 1 }, name)).toBe("1-hour speed-up");
    expect(rewardText({ kind: "speedup", item: "SP3", count: 2 }, name)).toBe("2x 2-hour speed-up");
    expect(rewardText({ kind: "decoration", type: 111, count: 1 }, name)).toBe("Mini-Pumpkin");
  });
});

describe("sortEvents", () => {
  it("lists events on now by end, then coming up by start", () => {
    const a = event({ id: "a", endsAt: 9 });
    const b = event({ id: "b", endsAt: 5 });
    const c = event({ id: "c", status: "upcoming", startsAt: 30 });
    const d = event({ id: "d", status: "upcoming", startsAt: 20 });
    const sorted = sortEvents([a, c, b, d]);
    expect(sorted.active.map((one) => one.id)).toEqual(["b", "a"]);
    expect(sorted.upcoming.map((one) => one.id)).toEqual(["d", "c"]);
  });
});

describe("shortAmount", () => {
  it("drops the decimal on round thousands", () => {
    expect(shortAmount(10_000)).toBe("10K");
    expect(shortAmount(12_500)).toBe("12.5K");
    expect(shortAmount(2_000_000)).toBe("2M");
    expect(shortAmount(25)).toBe("25");
  });
});
