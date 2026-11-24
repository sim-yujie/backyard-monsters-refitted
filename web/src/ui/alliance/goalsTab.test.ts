import { describe, expect, it } from "vitest";
import { goalCount, shortCount, shortTarget } from "./goalsTab";

describe("goal counts on the bar (owner, 15 Nov 2026: round down, never look done early)", () => {
  it("shortens big counts and always rounds down", () => {
    expect(shortCount(0)).toBe("0");
    expect(shortCount(9_999)).toBe("9,999");
    expect(shortCount(12_345)).toBe("12.3K");
    expect(shortCount(999_999)).toBe("999.9K");
    expect(shortCount(1_299_999)).toBe("1.2M");
    expect(shortCount(1_234_567_890)).toBe("1.23B");
    expect(shortCount(1_200_000_000)).toBe("1.2B");
    expect(shortCount(2_249_999_999)).toBe("2.24B");
    expect(shortCount(-5)).toBe("0");
  });

  it("targets stay exact; a count never passes its target", () => {
    expect(shortTarget(450_000_000)).toBe("450M");
    expect(shortTarget(2_250_000_000)).toBe("2.25B");
    expect(shortTarget(90)).toBe("90");
    expect(goalCount({ progress: 1_234_567_890, target: 2_250_000_000 })).toBe("1.23B / 2.25B");
    expect(goalCount({ progress: 2_249_999_999, target: 2_250_000_000 })).toBe("2.24B / 2.25B");
    expect(goalCount({ progress: 400, target: 300 })).toBe("300 / 300");
  });

  it("the Hard targets of 24 Nov 2026 (x10) stay short: 22.5B Midas, 45B Conquest, 90B Fortress loot", () => {
    expect(shortTarget(22_500_000_000)).toBe("22.5B");
    expect(shortTarget(45_000_000_000)).toBe("45B");
    expect(shortTarget(90_000_000_000)).toBe("90B");
    expect(shortTarget(2_750)).toBe("2.75K");
    expect(shortTarget(180_000)).toBe("180K");
    expect(goalCount({ progress: 22_499_999_999, target: 22_500_000_000 })).toBe("22.49B / 22.5B");
    expect(goalCount({ progress: 89_999_999_999, target: 90_000_000_000 })).toBe("89.99B / 90B");
  });
});
