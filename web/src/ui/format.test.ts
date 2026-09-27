import { describe, expect, it } from "vitest";
import { formatAmount, formatCompact, formatCountdown } from "./format";

/** The shared spellings: amounts in full by default (#134), short only on request. */

describe("formatAmount", () => {
  it("writes every digit with thousands separators", () => {
    expect(formatAmount(15_000_000)).toBe("15,000,000");
    expect(formatAmount(23_050_000)).toBe("23,050,000");
    expect(formatAmount(11_158_040_000)).toBe("11,158,040,000");
    expect(formatAmount(999)).toBe("999");
    expect(formatAmount(0)).toBe("0");
  });

  it("drops a fraction rather than rounding up to what is not held", () => {
    expect(formatAmount(999.9)).toBe("999");
    expect(formatAmount(1_234_567.8)).toBe("1,234,567");
  });

  it("shows a value the save did not send as a dash", () => {
    expect(formatAmount(undefined)).toBe("—");
  });
});

describe("formatCompact", () => {
  it("keeps one decimal of K and M and two of B", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(12_500)).toBe("12.5K");
    expect(formatCompact(100_000)).toBe("100.0K");
    expect(formatCompact(15_000_000)).toBe("15.0M");
    expect(formatCompact(11_163_050_000)).toBe("11.16B");
    expect(formatCompact(undefined)).toBe("—");
  });
});

describe("formatCountdown", () => {
  it("shows two units, largest first", () => {
    expect(formatCountdown(0)).toBe("Done");
    expect(formatCountdown(45)).toBe("45s");
    expect(formatCountdown(125)).toBe("2m 5s");
    expect(formatCountdown(3_725)).toBe("1h 2m");
    expect(formatCountdown(90_000)).toBe("1d 1h");
  });
});
