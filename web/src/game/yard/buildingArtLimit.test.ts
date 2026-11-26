import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { ArtState, GRID_COLUMNS, GRID_REPACKS, artTypes, resolveArt, type ResolvedAnim } from "./buildingArt";
import { INFERNO_ART_ROWS } from "./buildingArtInfernoData";
import { INFERNO_TOWER_TIER_ART, TOWER_TIER_ART } from "./buildingArtTiers";
import { buildAnimLayers } from "./YardAnimations";
import { animPolicy, startFrame } from "./yardAnim";

/**
 * No building picture is wider or taller than 4096 px, the texture limit of
 * many phones: WebGL refuses a bigger one, so it is drawn black or has to be
 * copied cell by cell through a canvas (`textureLimit.ts`). The one-row strips
 * that were wider (the 3D Flak, Railgun and Inferno turrets, four Flash
 * strips) are repacked into grids of 8 a row (`repack_grid.py`).
 */

/** The texture limit of many phones, in pixels a side. */
const STRIP_LIMIT_PX = 4096;

const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));

/** A PNG's or WebP's size in pixels from its header; null for any other file. */
const pictureSize = (path: string): [number, number] | null => {
  const bytes = readFileSync(path);
  if (bytes.toString("latin1", 1, 4) === "PNG") return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunk = bytes.toString("latin1", 12, 16);
  if (chunk === "VP8X") return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (chunk === "VP8 ") return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  return null;
};

const fileOf = (url: string): string => ASSETS + url.replace(/^\/assets\//, "").replace(/\?.*$/, "");

/** Every picture a building can be drawn with, in either look, in both yards, at levels 1 to 12. */
const everyPicture = (): Map<string, string> => {
  const pictures = new Map<string, string>();
  const kinds: [kind: "main" | "inferno", types: number[]][] = [
    ["main", artTypes()],
    ["inferno", [...new Set([...INFERNO_ART_ROWS.map((row) => row[0]), ...Object.keys(INFERNO_TOWER_TIER_ART).map(Number)])]],
  ];
  for (const classic of [false, true]) {
    setClassicLook(classic);
    for (const [kind, types] of kinds) {
      for (const type of types) {
        for (let level = 1; level <= 12; level += 1) {
          for (const state of [ArtState.DEFAULT, ArtState.DAMAGED, ArtState.DESTROYED]) {
            const art = resolveArt(type, level, state, kind);
            if (!art) continue;
            const where = `${classic ? "Classic" : "Modern"} ${kind} type ${type} level ${level} ${state || "default"}`;
            for (const url of [art.top.url, art.shadow?.url, art.still?.url, ...art.anims.map((anim) => anim.url)]) {
              if (url && !pictures.has(url)) pictures.set(url, where);
            }
          }
        }
      }
    }
  }
  setClassicLook(false);
  return pictures;
};

afterEach(() => setClassicLook(false));

// Reads every building picture's header from disk: a tenth of a second alone,
// past Vitest's 5 s default when the suite runs beside the server's (21 Nov 2026).
describe("building pictures within the phones' texture limit", { timeout: 30_000 }, () => {
  it(`draws no building picture wider or taller than ${STRIP_LIMIT_PX} px`, () => {
    const over: string[] = [];
    let checked = 0;
    for (const [url, where] of everyPicture()) {
      const path = fileOf(url);
      if (!existsSync(path)) continue;
      const size = pictureSize(path);
      if (!size) continue;
      checked += 1;
      if (size[0] > STRIP_LIMIT_PX || size[1] > STRIP_LIMIT_PX) over.push(`${url} ${size[0]}x${size[1]} (${where})`);
    }
    expect(checked).toBeGreaterThan(500);
    expect(over).toEqual([]);
  });

  it("repacks each over-wide Flash strip into a grid of 8 a row, with every cell of the old strip", () => {
    setClassicLook(true);
    for (const [old, grid] of Object.entries(GRID_REPACKS)) {
      const folder = old.slice(0, old.lastIndexOf("/") + 1);
      const anim = [...artTypes(), ...INFERNO_ART_ROWS.map((row) => row[0])]
        .flatMap((type) =>
          (["main", "inferno"] as const).flatMap((kind) =>
            [1, 2, 3, 4, 5].flatMap((level) => resolveArt(type, level, ArtState.DEFAULT, kind)?.anims ?? []),
          ),
        )
        .find((found) => found.url === `/assets/${folder}${grid}`);
      if (!anim) throw new Error(`${grid} is never drawn`);
      expect(anim.columns, grid).toBe(GRID_COLUMNS);
      expect(anim.grid, grid).toBe(true);
      const [oldWidth, oldHeight] = pictureSize(ASSETS + old) ?? [0, 0];
      const cells = Math.floor(oldWidth / anim.width);
      expect(oldHeight, old).toBe(anim.height);
      expect(cells, old).toBeGreaterThanOrEqual(anim.frames);
      expect(pictureSize(ASSETS + folder + grid), grid).toEqual([anim.width * GRID_COLUMNS, anim.height * Math.ceil(cells / GRID_COLUMNS)]);
    }
  });

  it("keeps a wrapped turret strip's facings one run: a random first cell from all 32, not the first row's 8", () => {
    const flak = TOWER_TIER_ART[115]?.[0];
    expect(flak?.turret?.grid).toBe(GRID_COLUMNS);
    const art = resolveArt(115, 1, ArtState.DEFAULT);
    const strip = art?.anims[0] as ResolvedAnim;
    expect(strip).toMatchObject({ columns: GRID_COLUMNS, grid: true, frames: 32 });
    const building = { id: 0, type: 115, level: 1, worldX: 0, worldY: 0, countdown: 0 } as never;
    const policy = animPolicy(115)!;
    expect(policy.randomStart).toBe(true);
    for (const id of [1, 2, 3, 17, 40, 99, 1234]) {
      const [layer] = buildAnimLayers({ ...(building as object), id } as never, art!);
      expect(layer?.progress, `id ${id}`).toBe(startFrame(policy, 32, id));
    }
    // The 3D Laser's rows are its tilts: it still starts in the first, the head nearest level.
    const laser = resolveArt(23, 1, ArtState.DEFAULT)?.anims[0];
    expect(laser?.grid).toBeUndefined();
    expect(laser?.columns).toBe(32);
  });
});
