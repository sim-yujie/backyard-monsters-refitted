import { describe, expect, it } from "vitest";
import {
  artLevelOf,
  BUILDING_ART_LEVELS,
  TOWER_TIER_ART_LEVELS,
} from "../../../../server/src/game-data/buildingArtLevels";
import { BUILDING_ART_ROWS } from "./buildingArtData";
import { ArtState, resolveArt } from "./buildingArt";
import { setClassicLook } from "@/game/classicLook";
import {
  INFERNO_TOWER_TIER_ART,
  MODERN_TOWERS,
  TOWER_TIER_ART,
  TOWN_HALL_ART,
} from "./buildingArtTiers";

/**
 * The server sends someone else's yard with only the level each building's
 * art needs (`server/src/services/base/viewMask.ts`), read from its own copy
 * of the levels at which the art changes. If that copy falls behind this
 * table, a viewer sees the wrong picture, or the real level leaks again.
 * The 3D towers' tiers, which the Modern look shows, have their own copy;
 * the painted towers players do not see yet have none. The new Town Hall,
 * the default, needs none.
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

  it("names the same tower tiers, for the towers the Modern look shows", () => {
    const tiers = Object.fromEntries(
      MODERN_TOWERS.map((type) => [
        type,
        (TOWER_TIER_ART[type] ?? INFERNO_TOWER_TIER_ART[type] ?? []).map((tier) => tier.from),
      ]),
    );
    expect(TOWER_TIER_ART_LEVELS).toEqual(tiers);
  });

  it("splits an Inferno tower that shares a type as its namesake up top does", () => {
    for (const [type, inferno] of Object.entries(INFERNO_TOWER_TIER_ART)) {
      expect(inferno.map((tier) => tier.from)).toEqual(TOWER_TIER_ART_LEVELS[Number(type)]);
    }
  });

  it("needs no tiers for the new Town Hall: it has a picture at every Flash step", () => {
    expect(TOWN_HALL_ART.map((level) => level.from)).toEqual(BUILDING_ART_LEVELS[14]);
  });

  it("picks the picture the client draws for every level up to 20, as both sides start", () => {
    const { drawn, sent } = drawnAndSent(true);
    expect(sent).toEqual(drawn);
  });

  it("picks the picture the client draws with the Classic look", () => {
    setClassicLook(true);
    try {
      const { drawn, sent } = drawnAndSent(true);
      expect(sent).toEqual(drawn);
    } finally {
      setClassicLook(false);
    }
  });
});
