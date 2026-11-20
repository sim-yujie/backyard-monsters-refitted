import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { buildPicture } from "./buildButtonArt";
import { ArtState, resolveArt } from "./buildingArt";
import { BUILDING_ART_ROWS } from "./buildingArtData";
import { INFERNO_ART_ROWS } from "./buildingArtInfernoData";
import { CAVERN_ART, INFERNO_PAINTED_BUILDING_ART, tierArtFor, type TierImage } from "./buildingArtTiers";
import { animPolicy } from "./yardAnim";

/** The game server's assets, which the painted pictures are served from. */
const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));

/** A WebP's size in pixels from its `VP8X` header (every picture with alpha has one). */
const webpSize = (file: string): [number, number] => {
  const data = readFileSync(file);
  expect(data.toString("ascii", 12, 16), file).toBe("VP8X");
  return [1 + data.readUIntLE(24, 3), 1 + data.readUIntLE(27, 3)];
};

/** A PNG's size in pixels from its `IHDR`. */
const pngSize = (file: string): [number, number] => {
  const data = readFileSync(file);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
};

/** Where a picture's bottom edge stands below the building's origin, in world px (`@2x` pictures at half size). */
const bottomOf = ([file, , y]: TierImage, folder: string): number => {
  const [, height] = file.includes("@2x") ? webpSize(folder + file) : pngSize(folder + file);
  return y + (file.includes("@2x") ? height / 2 : height);
};

afterEach(() => setClassicLook(false));

describe("the painted Under Hall (the Inferno's centre building)", () => {
  const UNDER_HALL = 14;
  const folder = `${ASSETS}buildings/itownhall/`;
  const looks = INFERNO_PAINTED_BUILDING_ART[UNDER_HALL] ?? [];
  const flash = INFERNO_ART_ROWS.find(([type]) => type === UNDER_HALL);
  /** Flash's look a painted one stands in for: its own level's, or level 3's for the new levels 4 to 6. */
  const flashFor = (index: number) => flash?.[3][Math.min(index, (flash?.[3].length ?? 1) - 1)];

  it("has a look for each of Flash's three, at the same levels, and one each for levels 4, 5 and 6", () => {
    expect(looks.slice(0, 3).map((look) => look.from)).toEqual(flash?.[3].map(([level]) => level));
    expect(looks.map((look) => look.from)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("names only pictures that are on disk", () => {
    for (const look of looks) {
      const files = [
        look.top,
        look.shadow,
        look.damaged?.top,
        look.damaged?.shadow,
        look.destroyed?.top,
        look.destroyed?.shadow,
        ...(look.anim ? [look.anim.strip, look.anim.body] : []),
      ];
      for (const file of files) {
        expect(file, `level ${look.from}`).toBeTruthy();
        expect(existsSync(folder + (file?.[0] ?? "")), file?.[0]).toBe(true);
      }
    }
  });

  it("stands where Flash's does: each picture's base within 4 px of Flash's", () => {
    for (const [index, look] of looks.entries()) {
      const [, top, damaged, destroyed] = flashFor(index) ?? [];
      expect(Math.abs(bottomOf(look.top, folder) - bottomOf(top as TierImage, folder)), `level ${look.from}`).toBeLessThanOrEqual(4);
      // Level 5's damaged picture runs 6 px below Flash's: its plinth stands on Flash's base (115), but a few chips of
      // rubble lie in front of it, as the first pass painted them.
      const ruinSlack = look.from > 3 ? 6 : 4;
      expect(Math.abs(bottomOf(look.damaged?.top as TierImage, folder) - bottomOf(damaged as TierImage, folder))).toBeLessThanOrEqual(ruinSlack);
      expect(Math.abs(bottomOf(look.destroyed?.top as TierImage, folder) - bottomOf(destroyed as TierImage, folder))).toBeLessThanOrEqual(ruinSlack);
    }
  });

  it("keeps Flash's own shadows (the footprint is Flash's)", () => {
    for (const [index, look] of looks.entries()) {
      const level = flashFor(index);
      expect(look.shadow).toEqual(level?.[4]);
      expect(look.damaged?.shadow).toEqual(level?.[5]);
      expect(look.destroyed?.shadow).toEqual(level?.[6]);
    }
  });

  it("shows levels 1 to 3 in the Inferno yard, whole, damaged and destroyed, standing still", () => {
    const root = "/assets/buildings/itownhall/";
    expect(resolveArt(UNDER_HALL, 1, ArtState.DEFAULT, "inferno")?.top.url).toBe(`${root}top.c1@2x.webp`);
    expect(resolveArt(UNDER_HALL, 2, ArtState.DEFAULT, "inferno")?.top.url).toBe(`${root}top.c2@2x.webp`);
    expect(resolveArt(UNDER_HALL, 3, ArtState.DEFAULT, "inferno")?.top.url).toBe(`${root}top.c3@2x.webp`);
    for (const level of [1, 2, 3]) {
      expect(resolveArt(UNDER_HALL, level, ArtState.DEFAULT, "inferno")?.anims, `level ${level}`).toEqual([]);
    }
    expect(resolveArt(UNDER_HALL, 2, ArtState.DAMAGED, "inferno")?.top.url).toBe(`${root}top.c2.damaged@2x.webp`);
    expect(resolveArt(UNDER_HALL, 3, ArtState.DESTROYED, "inferno")?.top.url).toBe(`${root}top.c3.destroyed@2x.webp`);
  });

  it("shows levels 4, 5 and 6 each with a look of its own: its body with the glow's loop over it", () => {
    const root = "/assets/buildings/itownhall/";
    for (const level of [4, 5, 6]) {
      const art = resolveArt(UNDER_HALL, level, ArtState.DEFAULT, "inferno");
      expect(art?.level).toBe(level);
      expect(art?.top.url).toBe(`${root}body.c${level}@2x.webp`);
      expect(art?.still?.url).toBe(`${root}top.c${level}@2x.webp`);
      expect(art?.topIsAnim).toBe(false);
      expect(art?.anims).toHaveLength(1);
      expect(art?.anims[0]).toMatchObject({ url: `${root}anim.c${level}@2x.webp`, frames: 48, columns: 8 });
      expect(resolveArt(UNDER_HALL, level, ArtState.DAMAGED, "inferno")).toMatchObject({
        top: { url: `${root}top.c${level}.damaged@2x.webp` },
        shadow: { url: `${root}shadow.3.damaged.v2.jpg` },
        anims: [],
      });
      expect(resolveArt(UNDER_HALL, level, ArtState.DESTROYED, "inferno")).toMatchObject({
        top: { url: `${root}top.c${level}.destroyed@2x.webp` },
        shadow: { url: `${root}shadow.3.destroyed.v2.jpg` },
        anims: [],
      });
    }
  });

  it("cuts each strip into 8 by 6 cells of the size the table gives, at 2x", () => {
    for (const look of looks.filter((one) => one.anim)) {
      const [file, , , width, height, frames] = look.anim?.strip ?? ["", 0, 0, 0, 0, 0];
      expect(frames).toBe(48);
      expect(look.anim?.columns).toBe(8);
      expect(webpSize(folder + file), file).toEqual([8 * width * 2, (frames / 8) * height * 2]);
    }
  });

  it("puts the still and the body on the same base as level 3, so the strip lines up with the body", () => {
    const base = bottomOf(looks[2]?.top as TierImage, folder);
    for (const look of looks.filter((one) => one.anim)) {
      expect(bottomOf(look.top, folder), `level ${look.from}`).toBe(base);
      expect(bottomOf(look.anim?.body as TierImage, folder), `level ${look.from}`).toBe(base);
    }
  });

  it("runs the strip from cell 0, two ticks a cell, and leaves the main yard's Town Hall without a strip", () => {
    expect(animPolicy(UNDER_HALL)).toMatchObject({ ticksPerFrame: 2, randomStart: false, work: null });
    for (const level of [1, 3, 6, 10]) {
      expect(resolveArt(UNDER_HALL, level, ArtState.DEFAULT)?.anims, `Town Hall level ${level}`).toEqual([]);
    }
    setClassicLook(true);
    expect(resolveArt(UNDER_HALL, 6, ArtState.DEFAULT, "inferno")?.anims).toEqual([]);
    expect(resolveArt(UNDER_HALL, 6, ArtState.DEFAULT, "inferno")?.top.url).toBe("/assets/buildings/itownhall/top.3.v2.png");
  });

  it("leaves the main yard's Town Hall alone, and goes back to Flash's Under Hall with the Classic look", () => {
    expect(resolveArt(UNDER_HALL, 3, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/townhall/top.new3@2x.webp");
    expect(tierArtFor(UNDER_HALL, 3, "inferno")?.top[0]).toBe("top.c3@2x.webp");
    setClassicLook(true);
    expect(tierArtFor(UNDER_HALL, 3, "inferno")).toBeNull();
    expect(resolveArt(UNDER_HALL, 3, ArtState.DEFAULT, "inferno")?.top.url).toBe("/assets/buildings/itownhall/top.3.v2.png");
    expect(resolveArt(UNDER_HALL, 3, ArtState.DESTROYED, "inferno")?.top.url).toBe(
      "/assets/buildings/itownhall/top.3.destroyed.v2.png",
    );
  });
});

describe("the painted Resource Pod (the Inferno's storage)", () => {
  const POD = 6;
  const folder = `${ASSETS}buildings/istoragesilo/`;
  const looks = INFERNO_PAINTED_BUILDING_ART[POD] ?? [];
  const flash = INFERNO_ART_ROWS.find(([type]) => type === POD);

  it("has one look for all ten levels, as Flash's", () => {
    expect(looks.map((look) => look.from)).toEqual(flash?.[3].map(([level]) => level));
    expect(looks.map((look) => look.from)).toEqual([1]);
  });

  it("names only pictures that are on disk", () => {
    const [look] = looks;
    const files = [look?.top, look?.shadow, look?.damaged?.top, look?.damaged?.shadow, look?.destroyed?.top, look?.destroyed?.shadow];
    for (const file of files) {
      expect(file).toBeTruthy();
      expect(existsSync(folder + (file?.[0] ?? "")), file?.[0]).toBe(true);
    }
  });

  it("stands where Flash's does: each picture's base within 4 px of Flash's, centred within 4 px", () => {
    const [look] = looks;
    const [, top, damaged, destroyed] = flash?.[3][0] ?? [];
    const pairs: [TierImage | undefined, TierImage][] = [
      [look?.top, top as TierImage],
      [look?.damaged?.top, damaged as TierImage],
      [look?.destroyed?.top, destroyed as TierImage],
    ];
    for (const [painted, old] of pairs) {
      expect(painted, old[0]).toBeTruthy();
      const p = painted as TierImage;
      expect(Math.abs(bottomOf(p, folder) - bottomOf(old, folder)), p[0]).toBeLessThanOrEqual(4);
      const [width] = webpSize(folder + p[0]);
      const [oldWidth] = pngSize(folder + old[0]);
      expect(Math.abs(p[1] + width / 4 - (old[1] + oldWidth / 2)), p[0]).toBeLessThanOrEqual(4);
    }
  });

  it("keeps Flash's own shadows (the footprint is Flash's)", () => {
    const [look] = looks;
    const level = flash?.[3][0];
    expect(look?.shadow).toEqual(level?.[4]);
    expect(look?.damaged?.shadow).toEqual(level?.[5]);
    expect(look?.destroyed?.shadow).toEqual(level?.[6]);
  });

  it("shows in the Inferno yard at every level, whole, damaged and destroyed, standing still", () => {
    const root = "/assets/buildings/istoragesilo/";
    for (const level of [1, 5, 10]) {
      expect(resolveArt(POD, level, ArtState.DEFAULT, "inferno")?.top.url).toBe(`${root}top.c1@2x.webp`);
      expect(resolveArt(POD, level, ArtState.DEFAULT, "inferno")?.anims).toEqual([]);
    }
    expect(resolveArt(POD, 3, ArtState.DAMAGED, "inferno")?.top.url).toBe(`${root}top.c1.damaged@2x.webp`);
    expect(resolveArt(POD, 10, ArtState.DESTROYED, "inferno")?.top.url).toBe(`${root}top.c1.destroyed@2x.webp`);
  });

  it("leaves the main yard's Silo alone, and goes back to Flash's Pod with the Classic look", () => {
    expect(resolveArt(POD, 1, ArtState.DEFAULT)?.top.url).not.toContain("istoragesilo");
    setClassicLook(true);
    expect(tierArtFor(POD, 1, "inferno")).toBeNull();
    expect(resolveArt(POD, 1, ArtState.DEFAULT, "inferno")?.top.url).toBe("/assets/buildings/istoragesilo/top.1.v2.png");
    expect(resolveArt(POD, 1, ArtState.DESTROYED, "inferno")?.top.url).toBe("/assets/buildings/istoragesilo/top.1.destroyed.v2.png");
  });
});

/** A painted picture stands where Flash's does: its base within 4 px of Flash's, centred within 4 px. */
const standsLikeFlash = (painted: TierImage | undefined, old: TierImage, folder: string): void => {
  expect(painted, old[0]).toBeTruthy();
  const p = painted as TierImage;
  expect(Math.abs(bottomOf(p, folder) - bottomOf(old, folder)), p[0]).toBeLessThanOrEqual(4);
  const [width] = webpSize(folder + p[0]);
  const [oldWidth] = pngSize(folder + old[0]);
  expect(Math.abs(p[1] + width / 4 - (old[1] + oldWidth / 2)), p[0]).toBeLessThanOrEqual(4);
};

describe.each([
  { type: 128, name: "Housing Bunker", dir: "ihousingbunker", levels: [1], flashTop: ["top.1.v2.png"] },
])("the painted Inferno $name ($type)", ({ type, dir, levels, flashTop }) => {
  const folder = `${ASSETS}buildings/${dir}/`;
  const looks = INFERNO_PAINTED_BUILDING_ART[type] ?? [];
  const flash = INFERNO_ART_ROWS.find(([one]) => one === type);

  it("has a look for each of Flash's, at the same levels", () => {
    expect(looks.map((look) => look.from)).toEqual(flash?.[3].map(([level]) => level));
    expect(looks.map((look) => look.from)).toEqual(levels);
  });

  it("names only pictures that are on disk", () => {
    for (const look of looks) {
      const files = [look.top, look.shadow, look.damaged?.top, look.damaged?.shadow, look.destroyed?.top, look.destroyed?.shadow];
      for (const file of files) {
        expect(file).toBeTruthy();
        expect(existsSync(folder + (file?.[0] ?? "")), file?.[0]).toBe(true);
      }
    }
  });

  it("stands where Flash's does, whole, damaged and destroyed", () => {
    looks.forEach((look, i) => {
      const [, top, damaged, destroyed] = flash?.[3][i] ?? [];
      standsLikeFlash(look.top, top as TierImage, folder);
      standsLikeFlash(look.damaged?.top, damaged as TierImage, folder);
      standsLikeFlash(look.destroyed?.top, destroyed as TierImage, folder);
    });
  });

  it("keeps Flash's own shadows; a state with none of its own takes its look's, as Flash's does", () => {
    looks.forEach((look, i) => {
      const level = flash?.[3][i];
      expect(look.shadow).toEqual(level?.[4]);
      expect(look.damaged?.shadow).toEqual(level?.[5] ?? level?.[4]);
      expect(look.destroyed?.shadow).toEqual(level?.[6] ?? level?.[4]);
    });
  });

  it("shows in the Inferno yard at each look's levels, whole, damaged and destroyed, standing still", () => {
    const root = `/assets/buildings/${dir}/`;
    for (const look of looks) {
      const n = look.from;
      expect(resolveArt(type, n, ArtState.DEFAULT, "inferno")?.top.url).toBe(`${root}top.c${n}@2x.webp`);
      expect(resolveArt(type, n, ArtState.DEFAULT, "inferno")?.anims).toEqual([]);
      expect(resolveArt(type, n, ArtState.DAMAGED, "inferno")?.top.url).toBe(`${root}top.c${n}.damaged@2x.webp`);
      expect(resolveArt(type, n, ArtState.DESTROYED, "inferno")?.top.url).toBe(`${root}top.c${n}.destroyed@2x.webp`);
      expect(resolveArt(type, n, ArtState.DAMAGED, "inferno")?.shadow?.url).toBe(`${root}${look.damaged?.shadow?.[0]}`);
    }
    expect(resolveArt(type, 4, ArtState.DEFAULT, "inferno")?.top.url).toBe(`${root}top.c${levels.at(-1)}@2x.webp`);
  });

  it("goes back to Flash's with the Classic look", () => {
    setClassicLook(true);
    expect(tierArtFor(type, 1, "inferno")).toBeNull();
    expect(resolveArt(type, 1, ArtState.DEFAULT, "inferno")?.top.url).toBe(`/assets/buildings/${dir}/${flashTop[0]}`);
  });
});

describe("the painted Inferno Cavern (Moloch's cave on the main yard)", () => {
  const CAVE = 127;
  const folder = `${ASSETS}buildings/iportal/`;
  const flash = BUILDING_ART_ROWS.find(([type]) => type === CAVE);

  it("has a stage for each of Flash's five, at the same levels", () => {
    expect(CAVERN_ART.map((look) => look.from)).toEqual(flash?.[3].map(([level]) => level));
    expect(CAVERN_ART.map((look) => look.from)).toEqual([1, 2, 3, 4, 5]);
  });

  it("names only pictures that are on disk, and keeps Flash's main-yard shadows (stage 5 only)", () => {
    CAVERN_ART.forEach((look, i) => {
      expect(existsSync(folder + look.top[0]), look.top[0]).toBe(true);
      expect(look.shadow).toEqual(flash?.[3][i]?.[4] ?? null);
      expect(look.damaged).toBeUndefined();
      expect(look.destroyed).toBeUndefined();
    });
    expect(CAVERN_ART[4]?.shadow?.[0]).toBe("shadow.5.v2.jpg");
  });

  it("stands where Flash's does at every stage, inside the box the yard keeps room for (cave.ts)", () => {
    CAVERN_ART.forEach((look, i) => {
      standsLikeFlash(look.top, flash?.[3][i]?.[1] as TierImage, folder);
      expect(look.top[1]).toBeGreaterThanOrEqual(-169);
      expect(look.top[2]).toBeGreaterThanOrEqual(-172);
    });
  });

  it("shows on the main yard with the Modern look, and Flash's with the Classic look", () => {
    for (const level of [1, 2, 3, 4, 5]) {
      expect(resolveArt(CAVE, level, ArtState.DEFAULT)?.top.url).toBe(`/assets/buildings/iportal/top.c${level}@2x.webp`);
    }
    expect(resolveArt(CAVE, 2, ArtState.DEFAULT)?.shadow).toBeNull();
    expect(resolveArt(CAVE, 5, ArtState.DEFAULT)?.shadow?.url).toBe("/assets/buildings/iportal/shadow.5.v2.jpg");
    setClassicLook(true);
    expect(resolveArt(CAVE, 3, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/iportal/top.3.v2.png");
  });
});

/**
 * The Inferno's General Store (12, owner 20 Nov 2026, patch 8.1): an original painted Inferno shop with the Modern
 * look (`web/tools/store-inferno/`, shop C), in the surface store's folder, standing on the surface Modern store's
 * footprint; Flash's store with the Classic look; the surface keeps its own 3D store.
 */
describe("the painted Inferno General Store", () => {
  const STORE = 12;
  const folder = `${ASSETS}buildings/generalstore/`;
  const root = "/assets/buildings/generalstore/";
  const [look] = INFERNO_PAINTED_BUILDING_ART[STORE] ?? [];

  it("is one look from level 1, its picture and shadow on disk, at an even @2x size", () => {
    expect(INFERNO_PAINTED_BUILDING_ART[STORE]).toHaveLength(1);
    expect(look?.from).toBe(1);
    for (const file of [look?.top[0], look?.shadow?.[0]]) expect(existsSync(folder + (file ?? "")), file).toBe(true);
    const [width, height] = webpSize(folder + (look?.top[0] ?? ""));
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
  });

  it("stands where the surface's Modern store does: base within 4 px, centred within 4 px", () => {
    const surface = tierArtFor(STORE, 1, "main")?.top as TierImage;
    expect(surface[0]).toBe("top.3d1@2x.webp");
    const shop = look?.top as TierImage;
    expect(Math.abs(bottomOf(shop, folder) - bottomOf(surface, folder))).toBeLessThanOrEqual(4);
    const centre = (one: TierImage): number => one[1] + webpSize(folder + one[0])[0] / 4;
    expect(Math.abs(centre(shop) - centre(surface))).toBeLessThanOrEqual(4);
  });

  it("shows in the Inferno yard with the Modern look, and leaves the surface's 3D store alone", () => {
    expect(resolveArt(STORE, 1, ArtState.DEFAULT, "inferno")?.top.url).toBe(`${root}${look?.top[0]}`);
    expect(resolveArt(STORE, 1, ArtState.DEFAULT, "inferno")?.shadow?.url).toBe(`${root}${look?.shadow?.[0]}`);
    expect(resolveArt(STORE, 1, ArtState.DEFAULT)?.top.url).toBe(`${root}top.3d1@2x.webp`);
  });

  it("has its own damaged and destroyed looks, on disk, each with its own shadow", () => {
    for (const state of [look?.damaged, look?.destroyed]) {
      for (const file of [state?.top[0], state?.shadow?.[0]]) expect(existsSync(folder + (file ?? "")), file).toBe(true);
    }
    expect(resolveArt(STORE, 1, ArtState.DAMAGED, "inferno")?.top.url).toBe(`${root}top.ishop3C.damaged@2x.webp`);
    expect(resolveArt(STORE, 1, ArtState.DESTROYED, "inferno")?.top.url).toBe(`${root}top.ishop3C.destroyed@2x.webp`);
    expect(resolveArt(STORE, 1, ArtState.DESTROYED, "inferno")?.shadow?.url).toBe(`${root}shadow.ishop3C.destroyed.v2.jpg`);
    // The surface's store keeps Flash's rubble.
    expect(resolveArt(STORE, 1, ArtState.DESTROYED)?.top.url).not.toContain("ishop");
  });

  it("goes back to Flash's store with the Classic look", () => {
    setClassicLook(true);
    expect(tierArtFor(STORE, 1, "inferno")).toBeNull();
    expect(resolveArt(STORE, 1, ArtState.DEFAULT, "inferno")?.top.url).toBe(`${root}top.1.png`);
  });

  it("has an Inferno build-menu picture of its own with the Modern look, and an Inferno Classic button (flames)", () => {
    const modern = buildPicture(STORE, "inferno", false);
    expect(modern.modern).toBe(true);
    expect(modern.url).toMatch(/\/buildingbuttons\/modern\/12\.inferno\.[0-9a-f]{8}\.webp$/);
    expect(existsSync(`${ASSETS}buildingbuttons/modern/${modern.url.split("/").at(-1)}`)).toBe(true);
    expect(buildPicture(STORE, "inferno", true)).toEqual({ url: "/assets/buildingbuttons/general_store.v2.jpg", modern: false });
    expect(existsSync(`${ASSETS}buildingbuttons/general_store.v2.jpg`)).toBe(true);
    expect(buildPicture(STORE, "main", true)).toEqual({ url: "/assets/buildingbuttons/12.jpg", modern: false });
  });
});
