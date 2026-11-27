import { describe, expect, it } from "vitest";
import { hatchCost } from "@/game/monsters/monsterCatalogue";
import { FEED_GIBLETS_MAX, FEED_GIBLETS_MIN, feedGiblets } from "./feedShow";

describe("feedGiblets", () => {
  it("is Flash's int(_goo / 400) where that is a fair spurt", () => {
    expect(feedGiblets(hatchCost("C5", 1)!)).toBe(12); // Eye-ra, 5,000 goo
    expect(feedGiblets(10_000)).toBe(25);
  });

  it("never shows a feed with no blood, where Flash showed none for a cheap monster", () => {
    expect(Math.floor(hatchCost("C1", 1)! / 400)).toBe(0);
    expect(feedGiblets(hatchCost("C1", 1)!)).toBe(FEED_GIBLETS_MIN);
    expect(feedGiblets(0)).toBe(FEED_GIBLETS_MIN);
    expect(feedGiblets(-5)).toBe(FEED_GIBLETS_MIN);
  });

  it("never floods the yard with an expensive one", () => {
    expect(feedGiblets(hatchCost("IC8", 1)!)).toBe(FEED_GIBLETS_MAX);
  });
});
