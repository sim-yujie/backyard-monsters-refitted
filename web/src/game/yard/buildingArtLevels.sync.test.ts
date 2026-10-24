import { describe, expect, it } from "vitest";
import { artLevelOf, BUILDING_ART_LEVELS } from "../../../../server/src/game-data/buildingArtLevels";
import { BUILDING_ART_ROWS } from "./buildingArtData";
import { ArtState, resolveArt } from "./buildingArt";

/**
 * The server sends someone else's yard with only the level each building's
 * art needs (`server/src/services/base/viewMask.ts`), read from its own copy
 * of the levels at which the art changes. If that copy falls behind this
 * table, a viewer sees the wrong picture, or the real level leaks again.
 */

/** The art levels of every type whose art changes, as this table has them. */
const webArtLevels = (): Record<number, number[]> => {
  const out: Record<number, number[]> = {};
  for (const [type, , , levels] of BUILDING_ART_ROWS) {
    const steps = levels.map((level) => level[0]);
    if (steps.length > 1) out[type] = steps;
  }
  return out;
};

describe("the server's art levels match the web art table", () => {
  it("names the same types with the same steps", () => {
    expect(BUILDING_ART_LEVELS).toEqual(webArtLevels());
  });

  it("picks the picture the client draws for every level up to 20", () => {
    for (const [type, , , levels] of BUILDING_ART_ROWS) {
      if (levels.length === 0) continue;
      for (let level = 1; level <= 20; level++) {
        const art = resolveArt(type, level, ArtState.DEFAULT);
        if (!art) continue;
        const masked = artLevelOf(type, level);
        expect(resolveArt(type, masked, ArtState.DEFAULT)?.top.url, `type ${type} level ${level}`).toBe(art.top.url);
      }
    }
  });
});
