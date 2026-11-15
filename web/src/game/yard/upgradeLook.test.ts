import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { BUILDING_3D_ART, MODERN_TOWERS, tierArtFor } from "./buildingArtTiers";
import { maxLevel } from "./buildingCosts";
import { previewLayers, upgradeLook } from "./upgradeLook";

/**
 * The upgrade preview (beta 8) shows a building's next level only where it
 * looks different: a new tier of a 3D building or tower, every Town Hall
 * level, and never with the Classic look.
 */

const GOO_FACTORY = 4;
const SNIPER = 21;
const TOWN_HALL = 14;
const MAP_ROOM = 11;

afterEach(() => setClassicLook(false));

describe("upgradeLook", () => {
  it("shows a 3D building's next look only where its tier changes (Goo Factory 1/3/6/10)", () => {
    const changes: number[] = [];
    for (let level = 1; level < 10; level++) {
      if (upgradeLook(GOO_FACTORY, level, level + 1)) changes.push(level + 1);
    }
    expect(changes).toEqual([3, 6, 10]);
    expect(upgradeLook(GOO_FACTORY, 5, 6)?.level).toBe(6);
    expect(upgradeLook(GOO_FACTORY, 9, 10)?.top.url).toContain("3d10");
    // Mid-tier: same pictures, no preview.
    expect(upgradeLook(GOO_FACTORY, 3, 4)).toBeNull();
    expect(upgradeLook(GOO_FACTORY, 6, 7)).toBeNull();
  });

  it("shows a tower's next look at its tiers (4 and 7) only", () => {
    expect(upgradeLook(SNIPER, 3, 4)).not.toBeNull();
    expect(upgradeLook(SNIPER, 6, 7)).not.toBeNull();
    expect(upgradeLook(SNIPER, 4, 5)).toBeNull();
    expect(upgradeLook(SNIPER, 1, 2)).toBeNull();
  });

  it("shows every Town Hall level, each its own look", () => {
    for (let level = 1; level < 10; level++) {
      const next = upgradeLook(TOWN_HALL, level, level + 1);
      expect(next, `level ${level}`).not.toBeNull();
      expect(next?.top.url).toContain(`new${level + 1}@`);
    }
  });

  it("shows nothing for a maxed building or a level that is not higher", () => {
    expect(upgradeLook(GOO_FACTORY, 10, 10)).toBeNull();
    expect(upgradeLook(GOO_FACTORY, 6, 5)).toBeNull();
  });

  it("shows nothing for a one-look building (the Map Room)", () => {
    expect(upgradeLook(MAP_ROOM, 1, 2)).toBeNull();
  });

  it("shows nothing with the Classic look", () => {
    setClassicLook(true);
    expect(upgradeLook(GOO_FACTORY, 5, 6)).toBeNull();
    expect(upgradeLook(TOWN_HALL, 3, 4)).toBeNull();
    expect(upgradeLook(SNIPER, 3, 4)).toBeNull();
  });

  it("follows the Inferno's own tiers in an Inferno yard (3 and 7)", () => {
    expect(upgradeLook(GOO_FACTORY, 2, 3, "inferno")).not.toBeNull();
    expect(upgradeLook(GOO_FACTORY, 5, 6, "inferno")).toBeNull();
    expect(upgradeLook(GOO_FACTORY, 6, 7, "inferno")).not.toBeNull();
  });

  it("agrees with the tier tables for every 3D building and Modern tower on the main yard", () => {
    for (const type of [...Object.keys(BUILDING_3D_ART).map(Number), ...MODERN_TOWERS]) {
      const top = maxLevel(type, "main");
      for (let level = 1; level < top; level++) {
        const tierChanges = tierArtFor(type, level) !== tierArtFor(type, level + 1);
        expect(
          upgradeLook(type, level, level + 1) !== null,
          `type ${type} level ${level}`,
        ).toBe(tierChanges);
      }
    }
  });

  it("draws a tower whose turret turns as its whole still picture", () => {
    const next = upgradeLook(SNIPER, 3, 4);
    expect(next).not.toBeNull();
    const layers = previewLayers(next!);
    expect(layers).toHaveLength(1);
    expect(layers[0]?.url).toBe(next?.still?.url ?? next?.top.url);
  });
});
