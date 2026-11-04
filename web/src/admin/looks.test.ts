// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { LookTotals } from "./api";
import { lookName } from "./format";
import { renderLooks } from "./sections";

/** Modern or Classic on the owner's dashboard (owner, 4 Nov 2026). */

const LOOKS: LookTotals = {
  days: 7,
  reported: 40,
  style: { modern: 30, classic: 10 },
  music: { style: 20, new: 15, flash: 5 },
  quality: { high: 36, medium: 3, low: 1 },
  font: { game: 38, clear: 2, readable: 0 },
};

describe("renderLooks", () => {
  it("shows Modern and Classic with their share, and the other choices", () => {
    const text = renderLooks(LOOKS).textContent ?? "";
    expect(text).toContain("Modern or Classic");
    expect(text).toContain("Modern30");
    expect(text).toContain("75% of 40");
    expect(text).toContain("Classic10");
    expect(text).toContain("25% of 40");
    expect(text).toContain("Same as Style 20 (50%) · New 15 (38%) · Original Flash 5 (13%)");
    expect(text).toContain("High 36 (90%) · Medium 3 (8%) · Low 1 (3%)");
    expect(text).toContain("Game font 38 (95%) · Clear 2 (5%) · Extra readable 0 (0%)");
    expect(text).toContain("40 players whose game opened their yard in the last 7 days");
  });

  it("says so when no game has sent its look yet, or the server is older", () => {
    const empty = { ...LOOKS, reported: 0, style: { modern: 0, classic: 0 } };
    expect(renderLooks(empty).textContent).toContain("No player's game has sent its look yet");
    expect(renderLooks(undefined).textContent).toContain("No player's game has sent its look yet");
  });
});

describe("lookName", () => {
  it("names a player's look, or nothing when their game never sent it", () => {
    expect(lookName("modern")).toBe("Modern look");
    expect(lookName("classic")).toBe("Classic look");
    expect(lookName(null)).toBeNull();
    expect(lookName(undefined)).toBeNull();
    expect(lookName("retro")).toBeNull();
  });
});
