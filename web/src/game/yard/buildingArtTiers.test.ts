import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { facingCell, laserCell } from "@/game/attack/towerFx";
import { ArtState, artFolder, resolveArt } from "./buildingArt";
import {
  CLASSIC_BUILDING_ART_KEY,
  NEW_TOWER_ART_KEY,
  TOWER_TIER_ART,
  TOWN_HALL_ART,
  classicBuildingArt,
  newTowerArt,
  readNewTowerArt,
  saveClassicBuildingArt,
  savedClassicBuildingArt,
  setClassicBuildingArt,
  setNewTowerArt,
  tierArtFor,
  tierLift,
} from "./buildingArtTiers";

/** The game server's assets, which the tier pictures are served from. */
const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));

const TOWERS = [20, 21, 22, 23, 25, 115, 118];

/** The towers whose turret turns: Cannon, Sniper, Laser, Aerial Defense, Railgun. */
const TURRETS = [20, 21, 23, 115, 118];
/** The ones whose Flash art turned too; the Flash Cannon never did. */
const FLASH_TURRETS = [21, 23, 115, 118];

/** A WebP's size in pixels, from its `VP8X` header (every picture with alpha has one). */
const webpSize = (url: string): { width: number; height: number } => {
  const bytes = readFileSync(ASSETS + url.replace(/^\/assets\//, ""));
  expect(bytes.toString("latin1", 12, 16), url).toBe("VP8X");
  return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
};

/** A browser's site data, kept in memory. */
const memoryStore = (): Storage => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as unknown as Storage;
};

const blockedStore = (): Storage =>
  ({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  }) as unknown as Storage;

describe("the defaults", () => {
  it("show the new Town Hall and the Flash towers", () => {
    expect(classicBuildingArt()).toBe(false);
    expect(newTowerArt()).toBe(false);
    expect(resolveArt(14, 6, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/townhall/top.new6@2x.webp");
    expect(resolveArt(20, 8, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/cannontower/top.3.png");
    expect(resolveArt(21, 5, ArtState.DEFAULT)?.anims.length).toBeGreaterThan(0);
    for (const type of TOWERS) {
      expect(tierArtFor(type, 8)).toBeNull();
      expect(tierLift(type, 8)).toBe(0);
    }
  });
});

describe("the old-art option", () => {
  it("brings back the Flash Town Hall, and the Flash towers even with the tower switch on", () => {
    setClassicBuildingArt(true);
    setNewTowerArt(true);
    try {
      expect(resolveArt(14, 6, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/townhall/top.6.png");
      expect(tierArtFor(14, 6)).toBeNull();
      expect(resolveArt(20, 8, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/cannontower/top.3.png");
      for (const type of TOWERS) expect(tierArtFor(type, 8)).toBeNull();
    } finally {
      setClassicBuildingArt(false);
      setNewTowerArt(false);
    }
    expect(resolveArt(14, 6, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/townhall/top.new6@2x.webp");
  });

  it("is what Account Settings saved, read at the next load", () => {
    const store = memoryStore();
    expect(savedClassicBuildingArt(store)).toBe(false);
    expect(saveClassicBuildingArt(true, store)).toBe(true);
    expect(store.getItem(CLASSIC_BUILDING_ART_KEY)).toBe("1");
    expect(savedClassicBuildingArt(store)).toBe(true);
    expect(saveClassicBuildingArt(false, store)).toBe(true);
    expect(savedClassicBuildingArt(store)).toBe(false);
    // Saving does not redraw the page that is open.
    expect(classicBuildingArt()).toBe(false);
  });

  it("reads as off when site data is blocked, and says it could not save", () => {
    expect(saveClassicBuildingArt(true, blockedStore())).toBe(false);
    expect(saveClassicBuildingArt(true, null)).toBe(false);
    expect(savedClassicBuildingArt(blockedStore())).toBe(false);
  });
});

describe("the hidden new tower art switch", () => {
  it("is off by default", () => {
    expect(readNewTowerArt("", memoryStore())).toBe(false);
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
    expect(readNewTowerArt("?towers=new", blockedStore())).toBe(true);
    expect(readNewTowerArt("", blockedStore())).toBe(false);
    expect(readNewTowerArt("?towers=new", null)).toBe(true);
  });

  it("shows the towers' tiers for the page", () => {
    setNewTowerArt(true);
    try {
      expect(resolveArt(20, 1, ArtState.DEFAULT)?.still?.url).toBe("/assets/buildings/cannontower/top.t1@2x.webp");
    } finally {
      setNewTowerArt(false);
    }
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
      expect(art?.still?.url).toBe("/assets/buildings/cannontower/top.t1@2x.webp");
      expect(art?.level).toBe(1);
    }
    for (const level of [4, 5, 6]) {
      const art = resolveArt(20, level, ArtState.DEFAULT);
      expect(art?.still?.url).toBe("/assets/buildings/cannontower/top.t2@2x.webp");
      expect(art?.level).toBe(4);
    }
    for (const level of [7, 8, 9, 10, 99]) {
      expect(resolveArt(20, level, ArtState.DEFAULT)?.still?.url).toBe(
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

  it("are still pictures for the Bunker and Tesla: no strips, the moving part painted in", () => {
    for (const type of [22, 25]) {
      for (const level of [1, 4, 7]) {
        const art = resolveArt(type, level, ArtState.DEFAULT);
        expect(art?.anims, `type ${type} level ${level}`).toEqual([]);
        expect(art?.topIsAnim).toBe(false);
        expect(art?.top.frame).toBeNull();
        expect(art?.top.url).toMatch(/\/top\.t[123]@2x\.webp$/);
        expect(art?.still).toBeUndefined();
      }
    }
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
    setClassicBuildingArt(true);
    const flash = TOWN_HALL_ART.map((level) => resolveArt(14, level.from, ArtState.DEFAULT)?.top);
    setClassicBuildingArt(false);
    TOWN_HALL_ART.forEach((level, i) => {
      // Same left edge give or take a pixel or two; at most 15% taller, so the top moves a little at most.
      expect(Math.abs(level.top[1] - (flash[i]?.x ?? 0)), `level ${level.from}`).toBeLessThanOrEqual(2);
      expect(Math.abs(level.top[2] - (flash[i]?.y ?? 0)), `level ${level.from}`).toBeLessThanOrEqual(15);
    });
  });

  it("stands on Flash's own shadow for each level", () => {
    setClassicBuildingArt(true);
    const flash = TOWN_HALL_ART.map((level) => resolveArt(14, level.from, ArtState.DEFAULT)?.shadow);
    setClassicBuildingArt(false);
    TOWN_HALL_ART.forEach((level, i) => {
      expect(flash[i]?.url).toBe(`/assets/buildings/townhall/shadow.${level.from}.jpg`);
      expect(resolveArt(14, level.from, ArtState.DEFAULT)?.shadow, `level ${level.from}`).toEqual(flash[i]);
    });
  });

  it("keeps its picture when damaged, falls to the Flash rubble when destroyed, and has no strips", () => {
    expect(resolveArt(14, 7, ArtState.DAMAGED)?.top.url).toBe("/assets/buildings/townhall/top.new7@2x.webp");
    expect(resolveArt(14, 7, ArtState.DEFAULT)?.anims).toEqual([]);
    expect(resolveArt(14, 7, ArtState.DESTROYED)?.top.url).toBe("/assets/buildings/townhall/top.7.destroyed.png");
  });
});

describe("the turning turrets", () => {
  beforeEach(() => setNewTowerArt(true));
  afterEach(() => setNewTowerArt(false));

  /**
   * Cells per strip: the Flash strip's order, up to the last cell the game
   * picks; the 3D towers' 32 headings, the Laser's for each of its 5 tilts.
   */
  const FRAMES: Record<number, number> = { 20: 32, 21: 32, 23: 160, 115: 30, 118: 30 };
  /** The 3D towers (owner, 28 Oct 2026), which carry where each cell points. */
  const TOWERS_3D = [20, 21, 23];

  it("draw the Cannon, Sniper, Laser, Aerial and Railgun tiers as a body with the turret strip over it", () => {
    for (const type of TURRETS) {
      const folder = artFolder(type);
      [1, 4, 7].forEach((level, i) => {
        const art = resolveArt(type, level, ArtState.DEFAULT);
        const n = i + 1;
        expect(art?.top.url, `type ${type} tier ${n}`).toBe(`/assets/${folder}body.t${n}@2x.webp`);
        expect(art?.top.frame).toBeNull();
        expect(art?.topIsAnim).toBe(false);
        expect(art?.still?.url).toBe(`/assets/${folder}top.t${n}@2x.webp`);
        expect(art?.shadow?.url).toBe(`/assets/${folder}shadow.t${n}.jpg`);
        // The 3D Cannon's prongs are cut out of each barrel cell, so no tower has a front layer now.
        expect(art?.anims).toHaveLength(1);
        expect(art?.anims[0]).toMatchObject({
          url: `/assets/${folder}turret.t${n}@2x.webp`,
          frames: FRAMES[type],
        });
      });
    }
  });

  it("draw the 3D towers with no front layer, and ship no painted Cannon front pictures", () => {
    for (const type of TURRETS) {
      for (const tier of TOWER_TIER_ART[type] ?? []) expect(tier.turret?.front, `type ${type}`).toBeUndefined();
    }
    for (const n of [1, 2, 3]) expect(existsSync(`${ASSETS}cannontower/front.t${n}@2x.webp`)).toBe(false);
  });

  it("give the 3D towers an aim for every cell, and a muzzle and tilts where the art measured them", () => {
    for (const type of TOWERS_3D) {
      for (const tier of TOWER_TIER_ART[type] ?? []) {
        const where = `type ${type} tier from ${tier.from}`;
        const turret = tier.turret;
        const aim = turret?.aim;
        if (!turret || !aim) throw new Error(`${where} has no aim`);
        expect(aim.headings, where).toBe(32);
        expect(aim.aim, where).toHaveLength(turret.strip[5]);
        expect(turret.columns ?? turret.strip[5], where).toBe(aim.headings);
        for (const degrees of aim.aim) expect(degrees >= 0 && degrees < 360, where).toBe(true);
        expect(aim.muzzle, where).toHaveLength(turret.strip[5] * 2);
        // Every muzzle on the turret as drawn: inside its cell, give or take a px.
        const [, sx, sy, width, height] = turret.strip;
        const [px, py] = turret.pivot;
        for (let i = 0; i < (aim.muzzle?.length ?? 0); i += 2) {
          const x = px + (aim.muzzle?.[i] ?? 0);
          const y = py + (aim.muzzle?.[i + 1] ?? 0);
          expect(x >= sx - 1 && x <= sx + width + 1 && y >= sy - 1 && y <= sy + height + 1, `${where} cell ${i / 2}`).toBe(true);
        }
        if (type === 23) {
          expect(aim.pitch, where).toHaveLength(5);
          expect(aim.lensHeight, where).toBeGreaterThan(20);
        } else {
          expect(aim.pitch, where).toBeUndefined();
        }
      }
    }
  });

  it("ship each strip as exactly its cells at twice the game's size, and each body", () => {
    for (const type of TURRETS) {
      for (const tier of TOWER_TIER_ART[type] ?? []) {
        const art = resolveArt(type, tier.from, ArtState.DEFAULT);
        const strip = art?.anims[0];
        if (!art || !strip) throw new Error(`type ${type} tier from ${tier.from}`);
        // `stripCells` would quietly cut a strip that disagrees with its file; these must not need it.
        const columns = strip.columns ?? strip.frames;
        expect(webpSize(strip.url), strip.url).toEqual({
          width: strip.width * columns * 2,
          height: strip.height * Math.ceil(strip.frames / columns) * 2,
        });
        const body = webpSize(art.top.url);
        expect((body.width % 2) + (body.height % 2), art.top.url).toBe(0);
        expect(existsSync(ASSETS + (art.still?.url ?? "").replace(/^\/assets\//, ""))).toBe(true);
      }
    }
  });

  it("put the turret's pivot inside its cell and on the body, which stands where the tier's picture does", () => {
    for (const type of TURRETS) {
      for (const tier of TOWER_TIER_ART[type] ?? []) {
        const turret = tier.turret;
        const where = `type ${type} tier from ${tier.from}`;
        if (!turret) throw new Error(`${where} has no turret`);
        const [, sx, sy, width, height] = turret.strip;
        const [px, py] = turret.pivot;
        expect(px > sx && px < sx + width && py > sy && py < sy + height, where).toBe(true);
        const [bodyFile, bx, by] = turret.body;
        const body = webpSize(`/assets/${artFolder(type)}${bodyFile}`);
        expect(px > bx && px < bx + body.width / 2 && py > by && py < by + body.height / 2, where).toBe(true);
        // The same canvas as the whole picture: the same left edge, the turret's room above.
        expect(bx, where).toBe(tier.top[1]);
        expect(by, where).toBeGreaterThanOrEqual(tier.top[2]);
        // Straight up from the middle of the tower, give or take the painting.
        expect(Math.abs(px), where).toBeLessThanOrEqual(3);
      }
    }
  });

  it("turn by the Flash rule and reach every cell, without the Flash Sniper's clamp near due east", () => {
    for (const type of [20, 21, 115, 118]) {
      // The 3D towers pick their cell by `aim` instead, but their strips keep the rule's order.
      const frames = resolveArt(type, 8, ArtState.DEFAULT)?.anims[0]?.frames ?? 0;
      const seen = new Set<number>();
      for (let bearing = 0; bearing < 360; bearing += 0.25) {
        const cell = facingCell(type, bearing, frames);
        // The cell the rule names, never cut short by the end of the strip.
        expect(cell).toBe(facingCell(type, bearing, 1000));
        seen.add(cell ?? -1);
      }
      expect(seen.size, `type ${type}`).toBe(frames);
    }
    // The Sniper's new strip has the two cells the Flash one lacked.
    expect(facingCell(21, 350, 32)).toBe(31);
    expect(facingCell(21, 350, 30)).toBe(29);
    const laser = new Set<number>();
    for (let angle = 0; angle < 360; angle += 0.25) laser.add(laserCell(angle, 54));
    expect(laser.size).toBe(54);
  });

  it("keep the body and turret when damaged, and fall to the Flash rubble with no turret when destroyed", () => {
    for (const type of TURRETS) {
      const healthy = resolveArt(type, 8, ArtState.DEFAULT);
      const damaged = resolveArt(type, 8, ArtState.DAMAGED);
      expect(damaged?.top.url).toBe(healthy?.top.url);
      expect(damaged?.anims).toEqual(healthy?.anims);
      const ruin = resolveArt(type, 8, ArtState.DESTROYED);
      expect(ruin?.top.url).toMatch(/\/top\.\d\.destroyed\.png$/);
      expect(ruin?.anims).toEqual([]);
      expect(ruin?.still).toBeUndefined();
    }
  });
});

describe("the turret towers with the new tower art off", () => {
  /** The Flash strip each turret tower turns, its cells, and its damaged strip. */
  const FLASH: Record<number, readonly [string, number, string]> = {
    21: ["snipertower/anim.3.png", 30, "snipertower/anim.3.damaged.png"],
    23: ["lasertower/anim.1.png", 54, "lasertower/anim.1.damaged.png"],
    115: ["flaktower/anim.3.png", 32, "flaktower/anim.3.damaged.png"],
    118: ["railguntower/anim.3.loaded.png", 32, "railguntower/anim.3.damaged.png"],
  };
  const STATES = [ArtState.DEFAULT, ArtState.DAMAGED, ArtState.DESTROYED];

  it("draw exactly the Flash art at every level and state, as before the turrets", () => {
    expect(newTowerArt()).toBe(false);
    for (const type of FLASH_TURRETS) {
      const [strip, frames, damagedStrip] = FLASH[type] ?? ["", 0, ""];
      for (let level = 0; level <= 10; level++) {
        const where = `type ${type} level ${level}`;
        const off = STATES.map((state) => resolveArt(type, level, state));
        expect(off[0]?.top.url, where).toMatch(/\/top\.\d\.png$/);
        expect(off[0]?.anims.map((anim) => [anim.url, anim.frames]), where).toEqual([
          [`/assets/buildings/${strip}`, frames],
        ]);
        expect(off[1]?.anims[0]?.url, where).toBe(`/assets/buildings/${damagedStrip}`);
        expect(off[2]?.anims, where).toEqual([]);
        for (const resolved of off) {
          expect(resolved?.still, where).toBeUndefined();
          expect(JSON.stringify(resolved), where).not.toMatch(/body\.t|turret\.t|top\.t\d@2x/);
        }
        // The same as the player's old-art choice gives.
        setClassicBuildingArt(true);
        const classic = STATES.map((state) => resolveArt(type, level, state));
        setClassicBuildingArt(false);
        expect(off, where).toEqual(classic);
      }
    }
  });

  it("keep the Flash Cannon still: its own picture, no barrel strip and no front layer", () => {
    for (let level = 0; level <= 10; level++) {
      for (const state of STATES) {
        const art = resolveArt(20, level, state);
        const where = `level ${level} ${state}`;
        expect(art?.top.url, where).toMatch(/\/cannontower\/top\.\d(\.\w+)?\.png$/);
        expect(art?.anims, where).toEqual([]);
        expect(JSON.stringify(art), where).not.toMatch(/body\.t|turret\.t|front\.t|top\.t\d@2x/);
      }
    }
  });
});
