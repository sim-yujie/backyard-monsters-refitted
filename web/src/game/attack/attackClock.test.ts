import { describe, expect, it } from "vitest";
import { clockReading, formatClock } from "./attackClock";

describe("formatClock", () => {
  it("spells m:ss, rounding up and never below zero", () => {
    expect(formatClock(300)).toBe("5:00");
    expect(formatClock(59.2)).toBe("1:00");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("clockReading (#149)", () => {
  it("counts the attack down, turning to a warning in the last minute", () => {
    expect(clockReading({ phase: "running", remainingSeconds: 200, hardStopSeconds: 320 })).toEqual({
      text: "3:20",
      title: "",
      warning: false,
      grace: false,
    });
    expect(clockReading({ phase: "running", remainingSeconds: 45, hardStopSeconds: 165 }).warning).toBe(true);
  });

  it("labels the retreat grace and counts it down instead of sitting at 0:00", () => {
    const reading = clockReading({ phase: "running", remainingSeconds: 0, hardStopSeconds: 107 });
    expect(reading.text).toBe("Retreating 1:47");
    expect(reading.grace).toBe(true);
    expect(reading.warning).toBe(true);
    expect(reading.title).toContain("in 1:47");
  });

  it("reads 0:00 once the attack is over", () => {
    expect(clockReading({ phase: "ended", remainingSeconds: 0, hardStopSeconds: 90 }).text).toBe("0:00");
    expect(clockReading({ phase: "running", remainingSeconds: 0, hardStopSeconds: 0 }).text).toBe("0:00");
  });
});
