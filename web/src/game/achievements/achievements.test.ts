import { describe, expect, it } from "vitest";
import type { AchievementView } from "@/api/achievements";
import {
  badgeTier,
  earnedGroup,
  earnedText,
  notEarnedGroup,
  playerTitle,
  progressRatio,
  progressText,
  rewardText,
  summaryText,
  toDoGroup,
} from "./achievements";

/** The achievements screen's arithmetic and words (issue #204, §10.1). */

const entry = (id: number, over: Partial<AchievementView> = {}): AchievementView => ({
  id,
  name: `A${id}`,
  description: "",
  shiny: 10,
  status: "locked",
  progress: { value: 0, target: 1 },
  ...over,
});

/** Midday on a date, so the local day is the same in every time zone the tests run in. */
const noon = (iso: string): number => Math.floor(new Date(`${iso}T12:00:00`).getTime() / 1000);

describe("achievements: progress words", () => {
  it("names the unit for a counted entry, in full figures", () => {
    expect(progressText(entry(2, { progress: { value: 4, target: 5 } }))).toBe("Town Hall 4 / 5");
    expect(progressText(entry(11, { progress: { value: 1200, target: 5000 } }))).toBe("Juiced 1,200 / 5,000");
    expect(progressText(entry(5, { progress: { value: 2, target: 3 } }))).toBe("Fully evolved 2 / 3");
  });

  it("says Not yet for a one-step entry with no unit, and a bare count for an unknown one", () => {
    expect(progressText(entry(6, { progress: { value: 0, target: 1 } }))).toBe("Not yet");
    expect(progressText(entry(15, { progress: { value: 0, target: 1 } }))).toBe("Not yet");
    expect(progressText(entry(99, { progress: { value: 3, target: 7 } }))).toBe("3 / 7");
  });

  it("fills the bar by value over target, kept between 0 and 1", () => {
    expect(progressRatio({ value: 4, target: 5 })).toBeCloseTo(0.8);
    expect(progressRatio({ value: 9, target: 5 })).toBe(1);
    expect(progressRatio({ value: 1, target: 0 })).toBe(0);
  });

  it("words the reward, the date, the header and the read-only title", () => {
    expect(rewardText(25)).toBe("+25 Shiny");
    expect(earnedText(noon("2026-10-03"))).toBe("Earned 3 Oct 2026");
    expect(earnedText(undefined)).toBe("Earned");
    expect(summaryText(7, 16, 85)).toBe("7 of 16 earned · 85 Shiny earned");
    expect(summaryText(7, 16)).toBe("7 of 16 earned");
    expect(playerTitle("Bob")).toBe("Bob's achievements");
    expect(playerTitle("  ")).toBe("Achievements");
  });

  it("tiers the placeholder badge by reward: bronze 5, silver 10-15, gold 20-25, plain without one", () => {
    expect([5, 10, 15, 20, 25].map(badgeTier)).toEqual(["bronze", "silver", "silver", "gold", "gold"]);
    expect(badgeTier(undefined)).toBe("plain");
  });
});

describe("achievements: the groups", () => {
  it("puts To do closest to done first, ties in Flash's order, and leaves earned ones out", () => {
    const list = [
      entry(1, { progress: { value: 0, target: 1 } }),
      entry(2, { progress: { value: 4, target: 5 } }),
      entry(3, { status: "earned", at: 100, progress: { value: 8, target: 8 } }),
      entry(12, { progress: { value: 160, target: 200 } }),
      entry(16, { progress: { value: 2, target: 8 } }),
    ];
    expect(toDoGroup(list).map((one) => one.id)).toEqual([2, 12, 16, 1]);
  });

  it("puts Earned newest first, ties in Flash's order", () => {
    const list = [
      entry(1, { status: "earned", at: 100 }),
      entry(2, { status: "earned", at: 300 }),
      entry(6, { status: "earned", at: 100 }),
      entry(7),
    ];
    expect(earnedGroup(list).map((one) => one.id)).toEqual([2, 1, 6]);
  });

  it("keeps someone else's not-earned entries in Flash's order", () => {
    const list = [
      { id: 12, status: "locked" as const },
      { id: 1, status: "earned" as const, at: 5 },
      { id: 3, status: "locked" as const },
    ];
    expect(notEarnedGroup(list).map((one) => one.id)).toEqual([3, 12]);
  });
});
