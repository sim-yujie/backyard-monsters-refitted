import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { ArtState, resolveArt } from "./buildingArt";
import { BUILDING_ART_ROWS } from "./buildingArtData";
import { PAINTED_BUILDING_ART, tierArtFor, type TierImage } from "./buildingArtTiers";

/** The game server's assets, which the painted pictures are served from. */
const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));
const LOCKER = 8;
const FOLDER = `${ASSETS}buildings/monsterlocker/`;

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
const bottomOf = ([file, , y]: TierImage): number => {
  const [, height] = file.includes("@2x") ? webpSize(FOLDER + file) : pngSize(FOLDER + file);
  return y + (file.includes("@2x") ? height / 2 : height);
};

afterEach(() => setClassicLook(false));

describe("the painted Monster Locker", () => {
  const looks = PAINTED_BUILDING_ART[LOCKER] ?? [];
  const flash = BUILDING_ART_ROWS.find(([type]) => type === LOCKER);

  it("has a look for each of Flash's four, at the same levels", () => {
    expect(looks.map((look) => look.from)).toEqual(flash?.[3].map(([level]) => level));
    expect(looks.map((look) => look.from)).toEqual([1, 2, 3, 4]);
  });

  it("names only pictures that are on disk", () => {
    for (const look of looks) {
      const files = [look.top, look.shadow, look.anim?.body, look.damaged?.top, look.damaged?.shadow, look.destroyed?.top];
      for (const file of files) {
        expect(file, `level ${look.from}`).toBeTruthy();
        expect(existsSync(FOLDER + (file?.[0] ?? "")), file?.[0]).toBe(true);
      }
      expect(existsSync(FOLDER + (look.anim?.strip[0] ?? "")), look.anim?.strip[0]).toBe(true);
    }
  });

  it("stands where Flash's does: each picture's base within 4 px of Flash's", () => {
    for (const [index, look] of looks.entries()) {
      const [, top, damaged, destroyed] = flash?.[3][index] ?? [];
      expect(Math.abs(bottomOf(look.top) - bottomOf(top as TierImage)), `level ${look.from}`).toBeLessThanOrEqual(4);
      expect(Math.abs(bottomOf(look.damaged?.top as TierImage) - bottomOf(damaged as TierImage))).toBeLessThanOrEqual(4);
      expect(Math.abs(bottomOf(look.destroyed?.top as TierImage) - bottomOf(destroyed as TierImage))).toBeLessThanOrEqual(4);
    }
  });

  it("keeps Flash's own shadows (the footprint is Flash's)", () => {
    for (const [index, look] of looks.entries()) {
      const level = flash?.[3][index];
      expect(look.shadow).toEqual(level?.[4]);
      expect(look.damaged?.shadow).toEqual(level?.[5]);
      expect(look.destroyed?.shadow).toEqual(level?.[6]);
    }
  });

  it("draws its body with the turning key over it, the whole picture kept for icons", () => {
    const art = resolveArt(LOCKER, 3, ArtState.DEFAULT);
    expect(art?.top.url).toBe("/assets/buildings/monsterlocker/body.c3@2x.webp");
    expect(art?.still?.url).toBe("/assets/buildings/monsterlocker/top.c3@2x.webp");
    expect(art?.anims).toHaveLength(1);
    expect(art?.anims[0]?.url).toBe("/assets/buildings/monsterlocker/anim.c3@2x.webp");
    // Twice Flash's cells: a whole turn at the pace of Flash's half turn.
    expect(art?.anims[0]?.frames).toBe(2 * (flash?.[3][2]?.[7]?.[0]?.[5] ?? 0));
  });

  it("is damaged and destroyed in paint too, standing still", () => {
    const damaged = resolveArt(LOCKER, 2, ArtState.DAMAGED);
    expect(damaged?.top.url).toBe("/assets/buildings/monsterlocker/top.c2.damaged@2x.webp");
    expect(damaged?.anims).toEqual([]);
    expect(resolveArt(LOCKER, 4, ArtState.DESTROYED)?.top.url).toBe(
      "/assets/buildings/monsterlocker/top.c.destroyed@2x.webp",
    );
  });

  it("goes back to Flash's Locker with the Classic look, and keeps it in the Inferno", () => {
    expect(tierArtFor(LOCKER, 2)?.from).toBe(2);
    expect(tierArtFor(LOCKER, 9)?.from).toBe(4);
    expect(tierArtFor(LOCKER, 2, "inferno")).toBeNull();
    setClassicLook(true);
    expect(tierArtFor(LOCKER, 2)).toBeNull();
    expect(resolveArt(LOCKER, 2, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/monsterlocker/top.2.png");
  });
});
