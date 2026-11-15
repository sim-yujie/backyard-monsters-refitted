import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { ArtState, resolveArt } from "./buildingArt";
import { INFERNO_ART_ROWS } from "./buildingArtInfernoData";
import { INFERNO_PAINTED_BUILDING_ART, tierArtFor, type TierImage } from "./buildingArtTiers";
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
