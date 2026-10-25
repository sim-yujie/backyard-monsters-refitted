import { describe, expect, it } from "vitest";
import type { BuildOffer } from "@/game/yard/buildCatalogue";
import { gateSentence, hallWord, needText, tileLine } from "./BuildMenu";

/** The Inferno build menu's words (WP 1.19): the Under Hall is the hall. */

const locked = (need: number): BuildOffer =>
  ({
    type: 129,
    stored: null,
    status: "locked",
    gate: { reason: "townHall", have: 2, need },
    needs: [],
  }) as unknown as BuildOffer;

describe("the Inferno build menu's words", () => {
  it("calls the hall the Under Hall", () => {
    expect(hallWord("inferno")).toBe("Under Hall");
    expect(hallWord()).toBe("Town Hall");
    expect(tileLine(locked(3), "inferno")).toBe("Unlocks at Under Hall 3");
    expect(tileLine(locked(3))).toBe("Unlocks at Town Hall 3");
    expect(needText({ kind: "townHall", level: 2, met: false }, "inferno")).toBe("Under Hall level 2");
    expect(gateSentence({ reason: "limit", have: 2, allowed: 2, next: 4 }, "inferno")).toBe(
      "You have all 2 your Under Hall allows. Under Hall 4 allows more.",
    );
  });

  it("names a prerequisite by its Inferno name", () => {
    expect(needText({ kind: "building", type: 8, count: 1, level: 2, met: false }, "inferno")).toMatch(
      /^an? .+ at level 2$/,
    );
    expect(needText({ kind: "building", type: 14, count: 1, level: 1, met: false }, "inferno")).toBe("an Under Hall");
  });
});
