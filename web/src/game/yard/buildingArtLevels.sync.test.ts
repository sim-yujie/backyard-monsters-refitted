import { describe, expect, it } from "vitest";
import {
  artLevelOf,
  BUILDING_ART_LEVELS,
  INFERNO_ART_LEVELS,
  MODERN_BUILDING_ART_LEVELS,
  TOWER_TIER_ART_LEVELS,
} from "../../../../server/src/game-data/buildingArtLevels";
import { BUILDING_ART_ROWS } from "./buildingArtData";
import { ArtState, resolveArt } from "./buildingArt";
import { setClassicLook } from "@/game/classicLook";
import {
  BUILDING_3D_ART,
  INFERNO_BUILDING_3D_ART,
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

  it("names the Inferno's own 3D tiers that split where the main yard's art does not", () => {
    for (const [type, steps] of Object.entries(INFERNO_ART_LEVELS)) {
      expect(INFERNO_BUILDING_3D_ART[Number(type)]?.map((tier) => tier.from)).toEqual(steps);
    }
  });

  it("picks the picture the client draws for the Inferno's own 3D buildings, in an Inferno yard, either look", () => {
    for (const classic of [false, true]) {
      setClassicLook(classic);
      try {
        for (const type of Object.keys(INFERNO_BUILDING_3D_ART).map(Number)) {
          for (let level = 1; level <= 20; level++) {
            const drawn = resolveArt(type, level, ArtState.DEFAULT, "inferno")?.top.url;
            const masked = artLevelOf(type, level, true, "inferno");
            expect(resolveArt(type, masked, ArtState.DEFAULT, "inferno")?.top.url, `${type}@${level}`).toBe(drawn);
          }
        }
      } finally {
        setClassicLook(false);
      }
    }
  });

  it("names the 3D buildings whose looks split where Flash's art does not (the Control Center's levels 2 and 3)", () => {
    const flashSteps = (type: number): number[] => [
      ...new Set((BUILDING_ART_ROWS.find((row) => row[0] === type)?.[3] ?? []).map((level) => level[0])),
    ];
    const split = Object.fromEntries(
      Object.entries(BUILDING_3D_ART)
        .map(([type, looks]) => [Number(type), looks.map((look) => look.from)] as const)
        .filter(([type, steps]) => steps.some((step) => !flashSteps(type).includes(step)))
        .filter(([type]) => BUILDING_ART_ROWS.some((row) => row[0] === type)),
    );
    expect(MODERN_BUILDING_ART_LEVELS).toEqual(split);
  });

  it("sends an outpost's Control Center the level its 3D look needs, and the Inferno's one look level 1", () => {
    for (let level = 1; level <= 3; level++) {
      const drawn = resolveArt(16, level, ArtState.DEFAULT, "outpost")?.top.url;
      expect(resolveArt(16, artLevelOf(16, level, true, "outpost"), ArtState.DEFAULT, "outpost")?.top.url).toBe(drawn);
      expect(artLevelOf(16, level, true, "inferno")).toBe(1);
    }
    expect(artLevelOf(16, 3, false)).toBe(1);
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
