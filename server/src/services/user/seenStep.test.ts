import { describe, expect, test } from "bun:test";

import { SEEN_STEPS, SEEN_WEEKS_DAYS, seenStepOf } from "./seenStep.js";

/**
 * "Last seen" on the friends list and the alliance Members tab (owner, 25 Nov
 * 2026 grilling, beta 9): five rough steps, never a time; a player who hides
 * their online status shows only the two inactive steps.
 */

const DAY = 24 * 60 * 60;
const T0 = Math.floor(Date.UTC(2026, 10, 26, 12) / 1000);
const ago = (days: number) => T0 - Math.round(days * DAY);

describe("last seen steps", () => {
  test("the five steps, in order", () => {
    expect(SEEN_STEPS).toEqual(["online", "today", "week", "weeks", "month"]);
    expect(SEEN_WEEKS_DAYS).toBe(28);
  });

  test("shown: online, then today, this week, 1-4 weeks and over a month by the last yard load", () => {
    expect(seenStepOf(false, true, ago(40), T0)).toBe("online");
    expect(seenStepOf(false, true, null, T0)).toBe("online");
    expect(seenStepOf(false, false, T0, T0)).toBe("today");
    expect(seenStepOf(false, false, T0 - DAY + 1, T0)).toBe("today");
    expect(seenStepOf(false, false, T0 - DAY, T0)).toBe("week");
    expect(seenStepOf(false, false, T0 - 7 * DAY + 1, T0)).toBe("week");
    expect(seenStepOf(false, false, T0 - 7 * DAY, T0)).toBe("weeks");
    expect(seenStepOf(false, false, ago(10), T0)).toBe("weeks");
    expect(seenStepOf(false, false, T0 - 28 * DAY + 1, T0)).toBe("weeks");
    expect(seenStepOf(false, false, T0 - 28 * DAY, T0)).toBe("month");
    expect(seenStepOf(false, false, ago(40), T0)).toBe("month");
  });

  test("never seen counts as over a month", () => {
    expect(seenStepOf(false, false, null, T0)).toBe("month");
    expect(seenStepOf(true, false, null, T0)).toBe("month");
  });

  test("hidden: nothing while active, only 1-4 weeks and over a month after", () => {
    expect(seenStepOf(true, false, ago(3), T0)).toBeNull();
    expect(seenStepOf(true, false, ago(0.5), T0)).toBeNull();
    expect(seenStepOf(true, false, T0 - 7 * DAY + 1, T0)).toBeNull();
    expect(seenStepOf(true, false, T0 - 7 * DAY, T0)).toBe("weeks");
    expect(seenStepOf(true, false, ago(10), T0)).toBe("weeks");
    expect(seenStepOf(true, false, ago(40), T0)).toBe("month");
  });

  test("hidden and online now: nothing, even with an old or missing yard load", () => {
    expect(seenStepOf(true, true, T0, T0)).toBeNull();
    expect(seenStepOf(true, true, ago(40), T0)).toBeNull();
    expect(seenStepOf(true, true, ago(10), T0)).toBeNull();
    expect(seenStepOf(true, true, null, T0)).toBeNull();
  });

  test("a load stamped in the future (clock skew) reads as today", () => {
    expect(seenStepOf(false, false, T0 + 60, T0)).toBe("today");
    expect(seenStepOf(true, false, T0 + 60, T0)).toBeNull();
  });
});
