import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { ArtState, artFolder, resolveArt, restingLayers } from "./buildingArt";
import { BUILDING_ART_ROWS } from "./buildingArtData";
import { BUILDING_3D_ART, tierArtFor } from "./buildingArtTiers";

/** The game server's assets, which the 3D pictures are served from. */
const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));

/** The eight 3D yard buildings (owner, 31 Oct 2026: "All approved"). */
const TYPES = [1, 2, 3, 4, 6, 13, 15, 16];
/** The ones whose parts move, as Flash's do; Housing and the Control Center stand still. */
const MOVING = [1, 2, 3, 4, 6, 13];

/** A WebP's size in pixels, from its `VP8X` header (every picture with alpha has one). */
const webpSize = (file: string): [number, number] => {
  const bytes = readFileSync(file);
  expect(bytes.toString("latin1", 12, 16), file).toBe("VP8X");
  return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
};

/** The Flash row's looks for a type: each look's first level, its strip's cells and its offset. */
const flashLooks = (type: number) => BUILDING_ART_ROWS.find((row) => row[0] === type)?.[3] ?? [];

afterEach(() => setClassicLook(false));

describe("the 3D yard buildings", () => {
  it("are the eight approved, one look for each of Flash's", () => {
    expect(Object.keys(BUILDING_3D_ART).map(Number)).toEqual(TYPES);
    for (const type of TYPES) {
      expect(BUILDING_3D_ART[type]?.map((look) => look.from), `type ${type}`).toEqual(
        flashLooks(type).map((look) => look[0]),
      );
    }
  });

  it("show with the Modern look at every level, the right look for each", () => {
    for (const type of TYPES) {
      const looks = BUILDING_3D_ART[type] ?? [];
      for (let level = 0; level <= 10; level++) {
        const want = [...looks].reverse().find((look) => look.from <= Math.max(level, 1)) ?? looks[0];
        const art = resolveArt(type, level, ArtState.DEFAULT);
        expect(art?.level, `type ${type} level ${level}`).toBe(want?.from);
        expect(art?.still?.url ?? art?.top.url).toBe(`/assets/${artFolder(type) ?? ""}${want?.top[0] ?? ""}`);
      }
    }
  });

  it("give the Flash buildings back with the Classic look", () => {
    setClassicLook(true);
    for (const type of TYPES) {
      expect(tierArtFor(type, 5)).toBeNull();
      expect(resolveArt(type, 5, ArtState.DEFAULT)?.top.url).not.toContain("3d");
    }
    expect(resolveArt(1, 6, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/twigsnapper.v2/top.6.png");
  });

  it("move as Flash's do: the same cells, the moving parts over a body without them", () => {
    for (const type of MOVING) {
      for (const look of BUILDING_3D_ART[type] ?? []) {
        const flash = flashLooks(type).find((one) => one[0] === look.from);
        const art = resolveArt(type, look.from, ArtState.DEFAULT);
        expect(art?.anims, `type ${type} look ${look.from}`).toHaveLength(1);
        expect(art?.anims[0]?.frames).toBe(flash?.[7]?.[0]?.[5]);
        // The body under the cells, the whole building at rest for the icons.
        expect(art?.top.url).toContain("/body.3d");
        expect(art?.still?.url).toContain("/top.3d");
        expect(art?.topIsAnim).toBe(false);
        expect(restingLayers(art!).map((layer) => layer.url)).toEqual([art?.top.url, art?.anims[0]?.url]);
      }
    }
    for (const type of [15, 16]) {
      const art = resolveArt(type, 4, ArtState.DEFAULT);
      expect(art?.anims).toEqual([]);
      expect(art?.still).toBeUndefined();
      expect(art?.top.url).toContain("/top.3d1@2x.webp");
    }
  });

  it("ship every picture, strip and shadow they name, each strip as big as its cells", () => {
    const missing: string[] = [];
    for (const type of TYPES) {
      const folder = `${ASSETS}${artFolder(type) ?? ""}`;
      for (const look of BUILDING_3D_ART[type] ?? []) {
        const files = [look.top[0], look.shadow[0], ...(look.anim ? [look.anim.strip[0], look.anim.body?.[0] ?? ""] : [])];
        for (const file of files) if (!existsSync(folder + file)) missing.push(`${type}: ${file}`);
        if (!look.anim || !existsSync(folder + look.anim.strip[0])) continue;
        const [file, , , width, height, cells] = look.anim.strip;
        const columns = look.anim.columns ?? cells;
        expect(webpSize(folder + file), file).toEqual([2 * width * columns, 2 * height * Math.ceil(cells / columns)]);
      }
    }
    expect(missing).toEqual([]);
  });

  it("stand where Flash's do: the whole building's top-left within a few pixels of Flash's", () => {
    for (const type of TYPES) {
      for (const look of BUILDING_3D_ART[type] ?? []) {
        const flash = flashLooks(type).find((one) => one[0] === look.from);
        // Flash's building is its top and its strip (the Hatchery's roof is all strip).
        const parts = [flash?.[1], ...(flash?.[7] ?? [])].filter((part) => !!part);
        expect(parts.length, `type ${type} look ${look.from}`).toBeGreaterThan(0);
        const left = Math.min(...parts.map((part) => part?.[1] ?? 0));
        const top = Math.min(...parts.map((part) => part?.[2] ?? 0));
        // Fitted to Flash's outline, so the edges agree to a few pixels.
        expect(Math.abs(look.top[1] - left), `type ${type} look ${look.from} x`).toBeLessThanOrEqual(6);
        expect(Math.abs(look.top[2] - top), `type ${type} look ${look.from} y`).toBeLessThanOrEqual(8);
        expect(look.lift).toBe(0);
      }
    }
  });

  it("keep the picture when damaged and fall to the Flash rubble when destroyed", () => {
    const healthy = resolveArt(4, 10, ArtState.DEFAULT);
    expect(resolveArt(4, 10, ArtState.DAMAGED)?.top.url).toBe(healthy?.top.url);
    const ruin = resolveArt(4, 10, ArtState.DESTROYED);
    expect(ruin?.top.url).toBe("/assets/buildings/goofactory.v2/top.destroyed.png");
    expect(ruin?.anims).toEqual([]);
  });

  it("leave the Inferno's own producers, silo and hatchery as they are", () => {
    for (const type of [1, 2, 3, 4, 6, 13]) {
      const art = resolveArt(type, 1, ArtState.DEFAULT, "inferno");
      expect(art?.top.url, `type ${type}`).not.toContain("3d");
      expect(art?.folder).toMatch(/buildings\/i/);
    }
  });
});
