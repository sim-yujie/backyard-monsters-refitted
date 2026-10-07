import { describe, expect, it } from "vitest";
import { truncateToFit } from "./LabelLayer";

const widthOf = (s: string): number => s.length * 10;

describe("truncateToFit", () => {
  it("leaves a name that fits alone", () => {
    expect(truncateToFit("Bramble", widthOf, 70)).toBe("Bramble");
  });

  it("cuts a long name with dots so it fits the width", () => {
    const cut = truncateToFit("AVeryLongPlayerName", widthOf, 100);
    expect(cut.endsWith("...")).toBe(true);
    expect(widthOf(cut)).toBeLessThanOrEqual(100);
    expect(cut.length).toBeGreaterThan(4);
  });

  it("never goes below one letter and the dots", () => {
    expect(truncateToFit("Abcdef", widthOf, 5)).toBe("A...");
  });
});
