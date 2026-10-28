// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { BuildOffer } from "@/game/yard/buildCatalogue";
import { NEED_MORE_PODS, NEED_MORE_SILOS } from "@/game/yard/storage";
import { gateLine, gateSentence, hallWord, needText, tileLine } from "./BuildMenu";

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

  it("points a price above the Inferno cap at the Resource Pods, not the silos", () => {
    const overCap = { reason: "shortfall", shortfall: { r1: 1, r2: 0, r3: 0, r4: 0 }, overCap: true } as const;
    // On the Inferno yard, and for a main-yard building paid from the Inferno purse.
    expect(gateSentence(overCap, "inferno")).toBe(NEED_MORE_PODS);
    expect(gateLine(overCap, "main", true).textContent).toBe(NEED_MORE_PODS);
    expect(gateLine(overCap, "main").textContent).toBe(NEED_MORE_SILOS);
  });
});
