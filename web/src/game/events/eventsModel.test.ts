import { describe, expect, it } from "vitest";
import type { CalendarView, EventView } from "@/api/events";
import {
  auraWaitsForKrallen,
  krallenPenaltyNotice,
  krallenPenaltyText,
  grantedAuraText,
  payingClaimableTiers,
  shortDate,
  calendarDays,
  claimableCount,
  claimableTiers,
  countdownText,
  grantedKorathText,
  grantedKrallenText,
  isOver,
  krallenMaxed,
  korathPowerName,
  krallenPrizeText,
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
  claimUntil: null,
  locked: null,
  krallen: null,
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
    expect(rewardText({ kind: "eventCoins", amount: 15 }, name)).toBe("15 Glimmers");
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

describe("the Krallen Hunt", () => {
  const hunt = (over: Partial<EventView> = {}): EventView =>
    event({
      id: "krallen-2026-11",
      kind: "krallen",
      calendar: null,
      ladder: { label: "Loot taken", counter: 100_000_000, tiers: [{ need: 100_000_000, rewards: [{ kind: "krallen" }], claimed: false }] },
      claimUntil: 100_000 + 7 * 86_400,
      krallen: { level: 0, maxLevel: 5 },
      ...over,
    });

  it("names the prize for the player's Krallen level", () => {
    expect(krallenPrizeText({ level: 0, maxLevel: 5 })).toBe("Win Krallen, a champion of your own");
    expect(krallenPrizeText({ level: 2, maxLevel: 5 })).toBe("Krallen level 2 → 3");
    expect(krallenPrizeText({ level: 5, maxLevel: 5 })).toBe("Your Krallen is already level 5, the highest. Thanks for hunting!");
    expect(rewardText({ kind: "krallen" }, name)).toBe("Krallen");
  });

  it("says what a claim gave", () => {
    expect(grantedKrallenText([{ kind: "krallen", level: 1, raised: true }])).toBe("Krallen joined your yard!");
    expect(grantedKrallenText([{ kind: "krallen", level: 4, raised: true }])).toBe("Krallen is now level 4!");
    expect(grantedKrallenText([{ kind: "krallen", level: 5, raised: false }])).toBe("Your Krallen is already level 5, the highest.");
    expect(grantedKrallenText([{ kind: "shiny", amount: 5 }])).toBeNull();
  });

  it("an ended hunt counts down to its claim deadline, then goes stale", () => {
    const ended = hunt({ status: "ended" });
    expect(countdownText(ended, 100_000 + 86_400)).toMatch(/^Ended: claim by .+ \(6d 0h left\)$/);
    expect(isOver(ended, 100_000 + 86_400)).toBe(false);
    expect(isOver(ended, 100_000 + 7 * 86_400)).toBe(true);
  });

  it("an ended hunt is listed after the ones on now and counts toward the badge, unless her level is the top", () => {
    const ended = hunt({ id: "old", status: "ended" });
    const on = event();
    expect(sortEvents([ended, on]).active.map((one) => one.id)).toEqual(["halloween-2026", "old"]);
    expect(claimableCount([ended])).toBe(1);
    const topped = hunt({ status: "ended", krallen: { level: 5, maxLevel: 5 } });
    expect(krallenMaxed(topped)).toBe(true);
    expect(claimableCount([topped])).toBe(0);
    expect(claimableCount([hunt({ status: "upcoming" })])).toBe(0);
  });

  describe("the 3x mark: Krallen's loot aura (owner, 13 Nov 2026)", () => {
    const UNTIL = Date.UTC(2030, 2, 1) / 1000;
    const twoMarks = (counter: number, level: number, claimed: [boolean, boolean] = [false, false]) =>
      hunt({
        ladder: {
          label: "Loot taken",
          counter,
          tiers: [
            { need: 150_000_000, rewards: [{ kind: "krallen" }], claimed: claimed[0] },
            { need: 450_000_000, rewards: [{ kind: "krallenAura", until: UNTIL }], claimed: claimed[1] },
          ],
        },
        krallen: { level, maxLevel: 5, auraUntil: 0 },
      });

    it("counts toward the badge once reached; at level 5 only the 3x mark counts", () => {
      expect(payingClaimableTiers(twoMarks(450_000_000, 2))).toEqual([0, 1]);
      expect(payingClaimableTiers(twoMarks(449_999_999, 3, [true, false]))).toEqual([]);
      expect(payingClaimableTiers(twoMarks(900_000_000, 5))).toEqual([1]);
      expect(claimableCount([twoMarks(900_000_000, 5)])).toBe(1);
      expect(claimableCount([twoMarks(900_000_000, 5, [false, true])])).toBe(0);
    });

    it("waits for Krallen: without one only the first mark counts", () => {
      expect(auraWaitsForKrallen(twoMarks(0, 0))).toBe(true);
      expect(payingClaimableTiers(twoMarks(500_000_000, 0))).toEqual([0]);
      expect(auraWaitsForKrallen(twoMarks(0, 1))).toBe(false);
    });

    it("names the reward and says what its claim gave", () => {
      const words = (type: number) => `Decoration ${type}`;
      expect(rewardText({ kind: "krallenAura", until: UNTIL }, words)).toBe("Krallen's loot aura");
      expect(grantedKrallenText([{ kind: "krallenAura", until: UNTIL, level: 4, hasKrallen: true }])).toBe(
        `Krallen's loot aura is on until ${shortDate(UNTIL)}!`,
      );
      expect(grantedAuraText([{ kind: "krallenAura", until: UNTIL, level: 2, hasKrallen: true }])).toBe(
        "Loot aura won! Krallen uses it from level 3.",
      );
      expect(grantedAuraText([{ kind: "krallenAura", until: 0, level: 0, hasKrallen: false }])).toBe(
        "Win Krallen first: her loot aura needs her.",
      );
      expect(grantedAuraText([{ kind: "shiny", amount: 5 }])).toBeNull();
    });
  });
});

describe("Monster Madness: Korath's powers", () => {
  const name = (type: number) => `Decoration ${type}`;

  it("names each power, Flash's order", () => {
    expect(korathPowerName(1)).toBe("Burn");
    expect(korathPowerName(2)).toBe("Breath of Fire");
    expect(korathPowerName(3)).toBe("Fists of Doom");
    expect(korathPowerName(9)).toBe("Fists of Doom");
    expect(rewardText({ kind: "korath", power: 2 }, name)).toBe("Korath's Breath of Fire");
  });

  it("says what a claim taught Korath", () => {
    expect(grantedKorathText([{ kind: "korath", power: 2, raised: true, hasKorath: true }])).toBe(
      "Korath learned Breath of Fire!",
    );
    expect(grantedKorathText([{ kind: "korath", power: 1, raised: true, hasKorath: false }])).toBe(
      "Burn waits for your Korath.",
    );
    expect(grantedKorathText([{ kind: "korath", power: 3, raised: false, hasKorath: true }])).toBe(
      "Korath already knows Fists of Doom.",
    );
    expect(grantedKorathText([{ kind: "shiny", amount: 5 }])).toBeNull();
  });
});

describe("the Krallen Hunt's penalty words (owner, 13 Nov 2026)", () => {
  it("a level lost, or Krallen gone", () => {
    expect(krallenPenaltyText({ from: 3, to: 2 })).toBe("Krallen lost a level: 3 → 2");
    expect(krallenPenaltyText({ from: 1, to: 0 })).toBe("Krallen left");
  });

  it("the load's one-time notice: nothing, one hunt, or several from the first level to now", () => {
    expect(krallenPenaltyNotice([])).toBeNull();
    expect(krallenPenaltyNotice([{ from: 5, to: 4 }])).toBe("Krallen lost a level: 5 → 4");
    expect(krallenPenaltyNotice([{ from: 3, to: 2 }, { from: 2, to: 1 }])).toBe("Krallen lost 2 levels: 3 → 1");
    expect(krallenPenaltyNotice([{ from: 2, to: 1 }, { from: 1, to: 0 }])).toBe("Krallen left");
  });
});
