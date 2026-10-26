import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtState, resolveArt } from "./buildingArt";
import {
  NEW_TOWER_ART_KEY,
  TOWER_TIER_ART,
  TOWN_HALL_ART,
  newTowerArt,
  readNewTowerArt,
  setNewTowerArt,
  tierArtFor,
  tierLift,
} from "./buildingArtTiers";

/** The game server's assets, which the tier pictures are served from. */
const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));

const TOWERS = [20, 21, 22, 23, 25, 115, 118];

/** A browser's site data, kept in memory. */
const memoryStore = (): Storage => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as unknown as Storage;
};

describe("the new tower art switch", () => {
  it("is off by default, so every tower keeps its Flash art", () => {
    expect(newTowerArt()).toBe(false);
    expect(readNewTowerArt("", memoryStore())).toBe(false);
    expect(resolveArt(20, 8, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/cannontower/top.3.png");
    expect(resolveArt(21, 5, ArtState.DEFAULT)?.anims.length).toBeGreaterThan(0);
    expect(resolveArt(14, 6, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/townhall/top.6.png");
    expect(tierArtFor(14, 6)).toBeNull();
    for (const type of TOWERS) {
      expect(tierArtFor(type, 8)).toBeNull();
      expect(tierLift(type, 8)).toBe(0);
    }
  });

  it("turns on with ?towers=new, is remembered, and turns off with ?towers=classic", () => {
    const store = memoryStore();
    expect(readNewTowerArt("?towers=new", store)).toBe(true);
    expect(store.getItem(NEW_TOWER_ART_KEY)).toBe("1");
    expect(readNewTowerArt("", store)).toBe(true);
    expect(readNewTowerArt("?towers=classic", store)).toBe(false);
    expect(store.getItem(NEW_TOWER_ART_KEY)).toBeNull();
    expect(readNewTowerArt("?towers=anything", store)).toBe(false);
  });

  it("still follows the address when site data is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(readNewTowerArt("?towers=new", blocked)).toBe(true);
    expect(readNewTowerArt("", blocked)).toBe(false);
    expect(readNewTowerArt("?towers=new", null)).toBe(true);
  });

  it("turns on and off for the page", () => {
    setNewTowerArt(true);
    expect(resolveArt(20, 1, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/cannontower/top.t1@2x.webp");
    setNewTowerArt(false);
    expect(resolveArt(20, 1, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/cannontower/top.3.png");
  });
});

describe("the repainted tower tiers", () => {
  beforeEach(() => setNewTowerArt(true));
  afterEach(() => setNewTowerArt(false));

  it("cover all seven defensive towers, three tiers each", () => {
    expect(Object.keys(TOWER_TIER_ART).map(Number)).toEqual(TOWERS);
    for (const type of TOWERS) {
      expect(TOWER_TIER_ART[type]).toHaveLength(3);
      expect(TOWER_TIER_ART[type]?.[0]?.from).toBe(1);
    }
  });

  it("name pictures and shadows the game server has", () => {
    const missing: string[] = [];
    for (const type of TOWERS) {
      for (const level of [1, 4, 7]) {
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

  it("show tier 1 at levels 0-3 and switch at 4 and 7", () => {
    for (const level of [0, 1, 2, 3]) {
      const art = resolveArt(20, level, ArtState.DEFAULT);
      expect(art?.top.url).toBe("/assets/buildings/cannontower/top.t1@2x.webp");
      expect(art?.level).toBe(1);
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
    expect(resolveArt(22, 2, ArtState.DEFAULT)?.top.url).toContain("bunker/top.t1@2x.webp");
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

  it("lift the gun with the picture, and not on another type", () => {
    expect(tierLift(21, 3)).toBeLessThan(tierLift(21, 4));
    expect(tierLift(21, 7)).toBeGreaterThan(tierLift(21, 4));
    expect(tierLift(14, 9)).toBe(0);
    expect(tierArtFor(1, 10)).toBeNull();
  });

  it("stand each higher tier taller, on the same base", () => {
    for (const type of TOWERS) {
      const [one, two, three] = TOWER_TIER_ART[type] ?? [];
      expect(one && two && two.top[2] < one.top[2] && two.lift > one.lift, `type ${type}`).toBe(true);
      expect(two && three && three.top[2] < two.top[2], `type ${type}`).toBe(true);
      expect(two && three && three.lift > two.lift, `type ${type}`).toBe(true);
    }
  });
});

describe("the repainted Town Hall", () => {
  beforeEach(() => setNewTowerArt(true));
  afterEach(() => setNewTowerArt(false));

  it("has its own picture for each of the ten levels, on the server", () => {
    expect(TOWN_HALL_ART.map((level) => level.from)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const missing: string[] = [];
    for (let level = 1; level <= 10; level++) {
      const art = resolveArt(14, level, ArtState.DEFAULT);
      expect(art?.top.url).toBe(`/assets/buildings/townhall/top.new${level}@2x.webp`);
      expect(art?.level).toBe(level);
      for (const url of [art?.top.url, art?.shadow?.url]) {
        if (!url || !existsSync(ASSETS + url.replace(/^\/assets\//, ""))) missing.push(`level ${level}: ${url}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("shows level 1 while being built and level 10 past the top", () => {
    expect(resolveArt(14, 0, ArtState.DEFAULT)?.top.url).toContain("townhall/top.new1@2x.webp");
    expect(resolveArt(14, 11, ArtState.DEFAULT)?.top.url).toContain("townhall/top.new10@2x.webp");
  });

  it("stands where Flash's does at every level", () => {
    setNewTowerArt(false);
    const flash = TOWN_HALL_ART.map((level) => resolveArt(14, level.from, ArtState.DEFAULT)?.top);
    setNewTowerArt(true);
    TOWN_HALL_ART.forEach((level, i) => {
      // Same left edge give or take a pixel or two; at most 15% taller, so the top moves a little at most.
      expect(Math.abs(level.top[1] - (flash[i]?.x ?? 0)), `level ${level.from}`).toBeLessThanOrEqual(2);
      expect(Math.abs(level.top[2] - (flash[i]?.y ?? 0)), `level ${level.from}`).toBeLessThanOrEqual(15);
    });
  });

  it("keeps its picture when damaged, falls to the Flash rubble when destroyed, and has no strips", () => {
    expect(resolveArt(14, 7, ArtState.DAMAGED)?.top.url).toBe("/assets/buildings/townhall/top.new7@2x.webp");
    expect(resolveArt(14, 7, ArtState.DEFAULT)?.anims).toEqual([]);
    expect(resolveArt(14, 7, ArtState.DESTROYED)?.top.url).toBe("/assets/buildings/townhall/top.7.destroyed.png");
  });
});
