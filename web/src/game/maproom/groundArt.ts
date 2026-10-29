import { Assets, Rectangle, Texture } from "pixi.js";
import { classicLook } from "@/game/classicLook";
import { terrainBand } from "./cellVisuals";

/**
 * Flash's eleven ground tiles (`MapRoomCell_CLIP`'s frames water1..3,
 * sand1..2 and land1..6, shapes 174, 178, 180, 182, 184, 67, 186, 188, 190,
 * 192 and 194 of `assets.swf`), rendered at twice Flash's size into one
 * sheet, `public/maproom/ground@2x.webp`: four tiles a row, in that order.
 *
 * Each tile is 150 x 100 points: the 150 x 75 hex top face, its texture
 * (water, sand, four grasses, rock), and 25 points of cliff below it.
 *
 * That is Classic's ground. Modern wears the same eleven tiles repainted
 * (owner, 29 Oct 2026), `ground-painted@2x.webp`, laid out the same way and
 * in Flash's colours but for a toned-down water (owner's pick: option A with
 * calm water); `web/tools/maproom-ground/build.py` makes it from Codex's
 * painted swatches.
 */
const FLASH_SHEET_URL = `${import.meta.env.BASE_URL}maproom/ground@2x.webp`;
const PAINTED_SHEET_URL = `${import.meta.env.BASE_URL}maproom/ground-painted@2x.webp`;
const SHEET_COLUMNS = 4;
const SHEET_ROWS = 3;
const TILE_COUNT = 11;

/**
 * The half-clear sheet over sunken water cells (`MapRoomCell_CLIP`'s
 * `mcWater`): Flash's light blue, or a deeper, quieter blue over the painted
 * water, so Modern's water is toned down too.
 */
export interface WaterSurface {
  colour: number;
  alpha: number;
}
const FLASH_WATER_SURFACE: WaterSurface = { colour: 0x00ccff, alpha: 0.5 };
const PAINTED_WATER_SURFACE: WaterSurface = { colour: 0x2a8fc8, alpha: 0.4 };

/** Where the cell's place is on a tile: the middle of its top face. */
export const GROUND_ANCHOR_X = 0.5;
export const GROUND_ANCHOR_Y = 0.375;

export class GroundArt {
  private tiles: Texture[] = [];
  private pending: Promise<boolean> | null = null;
  private surface: WaterSurface = FLASH_WATER_SURFACE;

  /** The water sheet that goes with the tiles that loaded. */
  get waterSurface(): WaterSurface {
    return this.surface;
  }

  /** True once the sheet is on the GPU. */
  get ready(): boolean {
    return this.tiles.length > 0;
  }

  /** The tile for a cell of this height, or null until the sheet has landed. */
  tileFor(height: number): Texture | null {
    return this.tiles[terrainBand(height)] ?? null;
  }

  /** Fetches the sheet. Idempotent, and resolves true when it arrived. */
  load(): Promise<boolean> {
    this.pending ??= this.loadOnce();
    return this.pending;
  }

  /** Drops the tile textures; the sheet stays in `Assets`' cache. */
  destroy(): void {
    for (const tile of this.tiles) tile.destroy(false);
    this.tiles = [];
    this.pending = null;
  }

  private async loadOnce(): Promise<boolean> {
    if (!classicLook() && (await this.loadSheet(PAINTED_SHEET_URL, PAINTED_WATER_SURFACE))) return true;
    return this.loadSheet(FLASH_SHEET_URL, FLASH_WATER_SURFACE);
  }

  private async loadSheet(url: string, surface: WaterSurface): Promise<boolean> {
    try {
      const sheet = await Assets.load<Texture>(url);
      // In points: the @2x sheet's source is half its pixel size.
      const width = sheet.source.width / SHEET_COLUMNS;
      const height = sheet.source.height / SHEET_ROWS;
      for (let index = 0; index < TILE_COUNT; index++) {
        const frame = new Rectangle(
          (index % SHEET_COLUMNS) * width,
          Math.floor(index / SHEET_COLUMNS) * height,
          width,
          height,
        );
        this.tiles.push(new Texture({ source: sheet.source, frame }));
      }
      this.surface = surface;
      return true;
    } catch (caught) {
      console.warn(`The map's ground tiles (${url}) did not load.`, caught);
      return false;
    }
  }
}
