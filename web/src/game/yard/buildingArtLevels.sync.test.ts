import { describe, expect, it } from "vitest";
import {
  artLevelOf,
  BUILDING_ART_LEVELS,
  TOWER_TIER_ART_LEVELS,
} from "../../../../server/src/game-data/buildingArtLevels";
import { BUILDING_ART_ROWS } from "./buildingArtData";
import { ArtState, resolveArt } from "./buildingArt";
import { setNewTowerArt, TOWER_TIER_ART, TOWN_HALL_ART } from "./buildingArtTiers";

/**
 * The server sends someone else's yard with only the level each building's
 * art needs (`server/src/services/base/viewMask.ts`), read from its own copy
 * of the levels at which the art changes. If that copy falls behind this
 * table, a viewer sees the wrong picture, or the real level leaks again.
 * The repainted towers' tiers have their own copy, sent only while the
 * server's `TOWER_TIER_ART` is on, as the new tower art is only shown here
 * while its switch is on.
 */

/** The art levels of every type whose Flash art changes, as this table has them. */
const webArtLevels = (): Record<number, number[]> => {
  const out: Record<number, number[]> = {};
  for (const [type, , , levels] of BUILDING_ART_ROWS) {
    const steps = [...new Set(levels.map((level) => level[0]))].sort((a, b) => a - b);
    if (steps.length > 1) out[type] = steps;
  }
  return out;
};

/** The level every type shows art for, from 1 to 20, as the client draws it and from the level the server sends. */
const drawnAndSent = (towerTiers: boolean): { drawn: string[]; sent: string[] } => {
  const drawn: string[] = [];
  const sent: string[] = [];
  for (const [type, , , levels] of BUILDING_ART_ROWS) {
    if (levels.length === 0) continue;
    for (let level = 1; level <= 20; level++) {
      const art = resolveArt(type, level, ArtState.DEFAULT);
      if (!art) continue;
      const masked = artLevelOf(type, level, towerTiers);
      drawn.push(`${type}@${level} ${art.top.url}`);
      sent.push(`${type}@${level} ${resolveArt(type, masked, ArtState.DEFAULT)?.top.url}`);
    }
  }
  return { drawn, sent };
};

describe("the server's art levels match the web art table", () => {
  it("names the same types with the same steps", () => {
    expect(BUILDING_ART_LEVELS).toEqual(webArtLevels());
  });

  it("names the same tower tiers", () => {
    const tiers = Object.fromEntries(
      Object.entries(TOWER_TIER_ART).map(([type, list]) => [type, list.map((tier) => tier.from)]),
    );
    expect(TOWER_TIER_ART_LEVELS).toEqual(tiers);
  });

  it("needs no tiers for the new Town Hall: it has a picture at every Flash step", () => {
    expect(TOWN_HALL_ART.map((level) => level.from)).toEqual(BUILDING_ART_LEVELS[14]);
  });

  it("picks the picture the client draws for every level up to 20", () => {
    const { drawn, sent } = drawnAndSent(false);
    expect(sent).toEqual(drawn);
  });

  it("picks the tier the client draws with the new tower art on both sides", () => {
    setNewTowerArt(true);
    try {
      const { drawn, sent } = drawnAndSent(true);
      expect(sent).toEqual(drawn);
    } finally {
      setNewTowerArt(false);
    }
  });
});
