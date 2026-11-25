import { BufferImageSource } from "pixi.js";
import { mapRoomGrid } from "@/game/HexGrid";
import { quality, type Quality } from "@/game/quality";
import type { CellRange } from "../zones";
import type { RiverMask, WorldRect } from "./riverMask";
import type { RiverCells } from "./riverPaths";
import { RiverBuilder } from "./riverBuilder";
import { snapshotRiverCells } from "./riverPicture";

/**
 * Map Room 2 rivers (look plan step 7), for the painted ground: the river shapes (`riverPaths.ts`)
 * turned into the distance picture its shader paints them from (`riverMask.ts`). The rivers are
 * painted inside the ground, with the coast's water, so nothing is drawn over the ground any more.
 *
 * Look only. Nothing shows unless the server sent rivers (`rv`, switch `MR2_RIVERS`) and the
 * renderer asks for them: only with the painted look (`MR2_PAINTED_MAP`) on, so with it off the map
 * is exactly today's tiles; Classic is always Flash's map.
 *
 * Built for the cells on screen plus a margin, again only when the view nears the edge of that, a
 * zone arrives, or the Quality changes; panning costs nothing. The build runs in a Web Worker
 * (`riverBuilder.ts`, on the main thread where there is none), off the frame.
 */

/** Cells built past each side of the view, so a short pan does not rebuild. */
const MARGIN = 6;

/**
 * With a worker, the next picture is asked for once the view comes within this many cells of the
 * built one's edge, so it has usually landed before the view gets there.
 */
const PREFETCH = MARGIN / 2;

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
    // Data, not colour: Pixi would otherwise multiply the alpha (the half width) into the others.
    alphaMode: "no-premultiply-alpha",
    scaleMode: "linear",
    autoGenerateMipmaps: false,
  });
  private readonly rect = new Float32Array([0, 0, 1, 1]);
  private on = false;
  private built: CellRange | null = null;
  private builtQuality: Quality | null = null;
  private stale = true;
  private anyRiver = false;
  /** Pictures replaced by a bigger or smaller one, destroyed once the shader holds the new one. */
  private retired: BufferImageSource[] = [];
  private readonly builder: RiverBuilder;
  /** Bumped by every `invalidate` that counts, so a picture asked for before it lands as stale. */
  private generation = 0;
  private nextId = 1;
  /** The picture asked for and not landed yet. */
  private asked: { id: number; around: CellRange; level: Quality; generation: number } | null = null;
  /** Pictures built so far, where they ran and how long they took (request to landing), for the speed check. */
  readonly stats = { worker: 0, main: 0, lastMs: 0, maxMs: 0 };

  constructor(builder: () => RiverBuilder = () => new RiverBuilder()) {
    this.builder = builder();
  }

  /**
   * A zone arrived (new rivers or heights): rebuilt on the next `update`. With `area` (the cells
   * that changed), only when the built picture, or the one asked for, reaches them: a picture
   * built elsewhere is rebuilt from the store's cells anyway once the view reaches past it.
   */
  invalidate(area?: CellRange): void {
    if (area && !overlaps(area, this.built) && !overlaps(area, this.asked?.around ?? null)) return;
    this.stale = true;
    this.generation += 1;
  }

  get uniforms(): RiverUniforms {
    return { source: this.source, rect: this.rect, on: this.on };
  }

  /** Whether rivers are showing (so the water clock needs to run). */
  get showing(): boolean {
    return this.on;
  }

  /**
   * Shows the rivers round `range`, or hides them. Returns whether the picture changed (a new one
   * landed, shown or hidden), so the renderer can redraw a tilted view and count the work.
   *
   * A new picture is built in a worker (`riverBuilder.ts`) when the view nears the edge of the
   * built one, and shown on the frame it lands; the old one shows until then. Without a worker it
   * is built here, at once, when the view leaves the built cells (as before the worker).
   */
  update(range: CellRange, shown: boolean, cells: RiverCells, level: Quality = quality()): boolean {
    const was = this.on;
    let landed = this.land();
    if (!shown) {
      this.on = false;
      return landed || was;
    }
    const built = this.built;
    const covered =
      !this.stale && level === this.builtQuality && built !== null && inside(range, built, 0);
    if (!covered) {
      // Without a worker this builds now and lands at once, as the old synchronous build did.
      if (!this.builder.busy) {
        this.ask(range, cells, level);
        landed = this.land() || landed;
      }
    } else if (this.builder.usesWorker && !this.builder.busy && !inside(range, built, PREFETCH)) {
      // Near the edge: the next picture is built ahead, so a pan rarely reaches past this one.
      this.ask(range, cells, level);
    }
    this.on = this.built !== null && this.anyRiver;
    return landed || was !== this.on;
  }

  /** Destroys the pictures the shader no longer holds (call after handing it the new one). */
  releaseRetired(): void {
    for (const source of this.retired) source.destroy();
    this.retired = [];
  }

  destroy(): void {
    this.builder.destroy();
    this.asked = null;
    this.releaseRetired();
    this.source.destroy();
  }

  /** Asks for the picture round `range` (the view plus a margin) from the cells as they are now. */
  private ask(range: CellRange, cells: RiverCells, level: Quality): void {
    const around: CellRange = {
      minCol: range.minCol - MARGIN,
      maxCol: range.maxCol + MARGIN,
      minRow: range.minRow - MARGIN,
      maxRow: range.maxRow + MARGIN,
    };
    const id = this.nextId++;
    const request = snapshotRiverCells(id, around, cells, mapRoomGrid, worldRectOf(around), TEXELS_PER_CELL[level]);
    this.asked = { id, around, level, generation: this.generation };
    if (!this.builder.request(request)) this.asked = null;
  }

  /** Takes the picture that landed, if any, as the one shown. Returns whether one did. */
  private land(): boolean {
    const asked = this.asked;
    const landed = this.builder.take();
    if (!landed || !asked || landed.id !== asked.id) return false;
    this.asked = null;
    this.upload(landed.mask);
    this.built = asked.around;
    this.builtQuality = asked.level;
    // A zone that arrived while it was built makes it stale at once.
    this.stale = asked.generation !== this.generation;
    this.anyRiver = landed.mask.any;
    this.stats[landed.servedBy] += 1;
    this.stats.lastMs = landed.ms;
    this.stats.maxMs = Math.max(this.stats.maxMs, landed.ms);
    return true;
  }

  private upload(mask: RiverMask): void {
    if (mask.width === this.source.width && mask.height === this.source.height) {
      (this.source.resource as Uint8Array).set(mask.bytes);
      this.source.update();
    } else {
      this.retired.push(this.source);
      this.source = new BufferImageSource({
        resource: mask.bytes,
        width: mask.width,
        height: mask.height,
        format: "rgba8unorm",
        alphaMode: "no-premultiply-alpha",
        scaleMode: "linear",
        autoGenerateMipmaps: false,
      });
    }
    const { x0, y0, x1, y1 } = mask.rect;
    this.rect.set([x0, y0, 1 / Math.max(1e-6, x1 - x0), 1 / Math.max(1e-6, y1 - y0)]);
  }
}

/** Whether `range` lies inside `outer` with at least `margin` cells to spare on every side. */
const inside = (range: CellRange, outer: CellRange, margin: number): boolean =>
  range.minCol - margin >= outer.minCol &&
  range.maxCol + margin <= outer.maxCol &&
  range.minRow - margin >= outer.minRow &&
  range.maxRow + margin <= outer.maxRow;

const overlaps = (area: CellRange, other: CellRange | null): boolean =>
  other !== null &&
  !(area.maxCol < other.minCol || area.minCol > other.maxCol || area.maxRow < other.minRow || area.minRow > other.maxRow);

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
