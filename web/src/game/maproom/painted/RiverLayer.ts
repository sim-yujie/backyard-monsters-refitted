import { BufferImageSource } from "pixi.js";
import { mapRoomGrid } from "@/game/HexGrid";
import { quality, type Quality } from "@/game/quality";
import type { CellRange } from "../zones";
import { buildRiverMask, type RiverMask, type WorldRect } from "./riverMask";
import { riverPaths, type RiverCells } from "./riverPaths";

/**
 * Map Room 2 rivers (look plan step 7), for the painted ground: the river shapes (`riverPaths.ts`)
 * turned into the distance picture its shader paints them from (`riverMask.ts`). The rivers are
 * painted inside the ground, with the coast's water, so nothing is drawn over the ground any more.
 *
 * Look only. Nothing shows unless the server sent rivers (`rv`, switch `MR2_RIVERS`) and the
 * renderer asks for them: only with the painted look (`MR2_PAINTED_MAP`) on, so with it off the map
 * is exactly today's tiles; Classic is always Flash's map.
 *
 * Built for the cells on screen plus a margin, again only when the view leaves that, a zone arrives,
 * or the Quality changes; panning costs nothing.
 */

/** Cells built past each side of the view, so a short pan does not rebuild. */
const MARGIN = 6;

/** Texels a cell, by Quality: the distance picture stays sharp with few (the GPU blends them). */
const TEXELS_PER_CELL: Record<Quality, number> = { high: 40, medium: 32, low: 22 };

/** What the shader gets: the picture, where it lies, and whether to look at it. */
export interface RiverUniforms {
  source: BufferImageSource;
  /** x0, y0, 1 / width, 1 / height, in world points. */
  rect: Float32Array;
  on: boolean;
}

export class RiverLayer {
  /** A 1 x 1 "no river" picture until the first build. */
  private source = new BufferImageSource({
    resource: new Uint8Array(4),
    width: 1,
    height: 1,
    format: "rgba8unorm",
    scaleMode: "linear",
    autoGenerateMipmaps: false,
  });
  private readonly rect = new Float32Array([0, 0, 1, 1]);
  private on = false;
  private built: CellRange | null = null;
  private builtQuality: Quality | null = null;
  private stale = true;
  private anyRiver = false;

  /** A zone arrived (new rivers or heights): rebuilt on the next `update`. */
  invalidate(): void {
    this.stale = true;
  }

  get uniforms(): RiverUniforms {
    return { source: this.source, rect: this.rect, on: this.on };
  }

  /** Whether rivers are showing (so the water clock needs to run). */
  get showing(): boolean {
    return this.on;
  }

  /**
   * Shows the rivers round `range`, or hides them. Returns whether the picture changed (rebuilt,
   * shown or hidden), so the renderer can redraw a tilted view and count the work.
   */
  update(range: CellRange, shown: boolean, cells: RiverCells, level: Quality = quality()): boolean {
    if (!shown) {
      const was = this.on;
      this.on = false;
      return was;
    }
    const built = this.built;
    if (
      !this.stale &&
      level === this.builtQuality &&
      built &&
      range.minCol >= built.minCol &&
      range.maxCol <= built.maxCol &&
      range.minRow >= built.minRow &&
      range.maxRow <= built.maxRow
    ) {
      const was = this.on;
      this.on = this.anyRiver;
      return was !== this.on;
    }
    const around: CellRange = {
      minCol: range.minCol - MARGIN,
      maxCol: range.maxCol + MARGIN,
      minRow: range.minRow - MARGIN,
      maxRow: range.maxRow + MARGIN,
    };
    const mask = buildRiverMask(riverPaths(around, cells), worldRectOf(around), mapRoomGrid.cellWidth, TEXELS_PER_CELL[level]);
    this.upload(mask);
    this.built = around;
    this.builtQuality = level;
    this.stale = false;
    this.anyRiver = mask.any;
    this.on = mask.any;
    return true;
  }

  destroy(): void {
    this.source.destroy();
  }

  private upload(mask: RiverMask): void {
    if (mask.width === this.source.width && mask.height === this.source.height) {
      (this.source.resource as Uint8Array).set(mask.bytes);
      this.source.update();
    } else {
      const old = this.source;
      this.source = new BufferImageSource({
        resource: mask.bytes,
        width: mask.width,
        height: mask.height,
        format: "rgba8unorm",
        scaleMode: "linear",
        autoGenerateMipmaps: false,
      });
      old.destroy();
    }
    const { x0, y0, x1, y1 } = mask.rect;
    this.rect.set([x0, y0, 1 / Math.max(1e-6, x1 - x0), 1 / Math.max(1e-6, y1 - y0)]);
  }
}

/** The world rectangle round a range of cells (a cell's width and height past its outer centres). */
export const worldRectOf = (range: CellRange): WorldRect => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const col of [range.minCol, range.minCol + 1, range.maxCol - 1, range.maxCol]) {
    for (const row of [range.minRow, range.minRow + 1, range.maxRow - 1, range.maxRow]) {
      const centre = mapRoomGrid.cellToPixel(col, row);
      x0 = Math.min(x0, centre.x);
      y0 = Math.min(y0, centre.y);
      x1 = Math.max(x1, centre.x);
      y1 = Math.max(y1, centre.y);
    }
  }
  return {
    x0: x0 - mapRoomGrid.cellWidth,
    y0: y0 - mapRoomGrid.cellHeight,
    x1: x1 + mapRoomGrid.cellWidth,
    y1: y1 + mapRoomGrid.cellHeight,
  };
};
