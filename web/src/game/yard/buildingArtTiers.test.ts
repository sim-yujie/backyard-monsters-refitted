import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ArtState, resolveArt } from "./buildingArt";
import { TOWER_TIER_ART, tierArtFor, tierLift } from "./buildingArtTiers";

/** The game server's assets, which the tier pictures are served from. */
const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));

const TOWERS = [20, 21, 22, 23, 25, 115, 118];

describe("the repainted tower tiers", () => {
  it("cover all seven defensive towers, two tiers each", () => {
    expect(Object.keys(TOWER_TIER_ART).map(Number)).toEqual(TOWERS);
    for (const type of TOWERS) expect(TOWER_TIER_ART[type]).toHaveLength(2);
  });

  it("name pictures and shadows the game server has", () => {
    const missing: string[] = [];
    for (const type of TOWERS) {
      for (const level of [4, 7]) {
        const art = resolveArt(type, level === 7 && type === 22 ? 5 : level, ArtState.DEFAULT);
        for (const url of [art?.top.url, art?.shadow?.url]) {
          if (!url || !existsSync(ASSETS + url.replace(/^\/assets\//, ""))) {
            missing.push(`${type} level ${level}: ${url}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("keep levels 1-3 on the Flash picture and switch at 4 and 7", () => {
    for (const level of [0, 1, 2, 3]) {
      expect(resolveArt(20, level, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/cannontower/top.3.png");
    }
    for (const level of [4, 5, 6]) {
      const art = resolveArt(20, level, ArtState.DEFAULT);
      expect(art?.top.url).toBe("/assets/buildings/cannontower/top.t2@2x.webp");
      expect(art?.level).toBe(4);
    }
    for (const level of [7, 8, 9, 10, 99]) {
      expect(resolveArt(20, level, ArtState.DEFAULT)?.top.url).toBe(
        "/assets/buildings/cannontower/top.t3@2x.webp",
      );
    }
  });

  it("split the five-level Monster Bunker 1-2, 3-4 and 5", () => {
    expect(resolveArt(22, 2, ArtState.DEFAULT)?.top.url).toContain("bunker/anim.1.png");
    expect(resolveArt(22, 3, ArtState.DEFAULT)?.top.url).toContain("bunker/top.t2@2x.webp");
    expect(resolveArt(22, 4, ArtState.DEFAULT)?.top.url).toContain("bunker/top.t2@2x.webp");
    expect(resolveArt(22, 5, ArtState.DEFAULT)?.top.url).toContain("bunker/top.t3@2x.webp");
  });

  it("are still pictures: no strips, the gun is painted in", () => {
    const art = resolveArt(21, 5, ArtState.DEFAULT);
    expect(art?.anims).toEqual([]);
    expect(art?.topIsAnim).toBe(false);
    expect(art?.top.frame).toBeNull();
    expect(art?.shadow?.url).toBe("/assets/buildings/snipertower/shadow.t2.jpg");
  });

  it("stay on the tier picture when damaged and fall to the Flash rubble when destroyed", () => {
    const healthy = resolveArt(25, 8, ArtState.DEFAULT);
    expect(resolveArt(25, 8, ArtState.DAMAGED)?.top.url).toBe(healthy?.top.url);
    const ruin = resolveArt(25, 8, ArtState.DESTROYED);
    expect(ruin?.top.url).toBe("/assets/buildings/lightningtower/top.3.destroyed.png");
    expect(ruin?.anims).toEqual([]);
  });

  it("lift the gun with the picture, and not on tier 1 or another type", () => {
    expect(tierLift(21, 3)).toBe(0);
    expect(tierLift(21, 4)).toBeGreaterThan(0);
    expect(tierLift(21, 7)).toBeGreaterThan(tierLift(21, 4));
    expect(tierLift(14, 10)).toBe(0);
    expect(tierArtFor(1, 10)).toBeNull();
  });

  it("stand each higher tier taller, on the same base", () => {
    for (const type of TOWERS) {
      const [two, three] = TOWER_TIER_ART[type] ?? [];
      expect(two && three && three.top[2] < two.top[2], `type ${type}`).toBe(true);
      expect(two && three && three.lift > two.lift, `type ${type}`).toBe(true);
    }
  });
});
