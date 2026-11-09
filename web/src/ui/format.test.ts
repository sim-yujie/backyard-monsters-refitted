import { describe, expect, it } from "vitest";
import { formatAmount, formatCompact, formatCountdown, formatShort, formatShortPrice } from "./format";

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

describe("formatShort", () => {
  it("is exact under a thousand", () => {
    expect(formatShort(0)).toBe("0");
    expect(formatShort(71)).toBe("71");
    expect(formatShort(999.9)).toBe("999");
  });

  it("drops a trailing .0", () => {
    expect(formatShort(100_000)).toBe("100K");
    expect(formatShort(2_000_000)).toBe("2M");
  });

  it("keeps one decimal, rounded down so a held amount is never overstated", () => {
    expect(formatShort(12_552_536)).toBe("12.5M");
    expect(formatShort(21_463_172)).toBe("21.4M");
    expect(formatShort(99_960)).toBe("99.9K");
    expect(formatShort(1_250)).toBe("1.2K");
  });

  it("goes up a unit rather than reading 1000K", () => {
    expect(formatShort(999_999)).toBe("999.9K");
    expect(formatShort(1_000_000)).toBe("1M");
    expect(formatShort(1_234_567_890)).toBe("1.2B");
  });

  it("shows a dash for a value the save did not send", () => {
    expect(formatShort(undefined)).toBe("—");
  });
});

describe("formatShortPrice", () => {
  it("spells hatchery prices the way the owner asked (9 Nov)", () => {
    expect(formatShortPrice(468_000)).toBe("468K");
    expect(formatShortPrice(120_000)).toBe("120K");
    expect(formatShortPrice(14_400)).toBe("14.4K");
    expect(formatShortPrice(1_200_000)).toBe("1.2M");
    expect(formatShortPrice(350)).toBe("350");
  });

  it("rounds up, so a tile never looks cheaper than it is (tester, 9 Nov)", () => {
    expect(formatShortPrice(1_250)).toBe("1.3K");
    expect(formatShortPrice(14_450)).toBe("14.5K");
    expect(formatShortPrice(47_500)).toBe("47.5K");
    expect(formatShortPrice(1_001)).toBe("1.1K");
    expect(formatShortPrice(999.2)).toBe("1K");
  });

  it("goes up a unit rather than reading 1000K", () => {
    expect(formatShortPrice(999_950)).toBe("1M");
    expect(formatShortPrice(1_000_000)).toBe("1M");
    expect(formatShortPrice(1_234_567_890)).toBe("1.3B");
  });

  it("leaves formatShort rounding down for its other users", () => {
    expect(formatShort(1_250)).toBe("1.2K");
  });
});
