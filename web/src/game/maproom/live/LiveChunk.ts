import { Container } from "pixi.js";
import { isFogCell, type MapCell } from "@/api/types";
import { mapRoomGrid } from "@/game/HexGrid";
import { appearanceOf, type CellAppearance, type MapViewerContext } from "../cellVisuals";
import { chunkCells, type ChunkRef } from "../chunks";
import { cellLift, paintOrder } from "../ground";
import type { ZoneStore } from "../ZoneStore";

/** What the renderer hands the living map when it has built a chunk. */
export interface LiveSource {
  readonly store: ZoneStore;
  readonly viewer: MapViewerContext;
  readonly nowSeconds: number;
  /** Whether the chunk was drawn with Flash's (or the painted) ground tiles rather than flat hexes. */
  readonly groundReady: boolean;
}

/** One cell of a chunk, as the living map's layers see it. */
export interface LiveCell {
  readonly col: number;
  readonly row: number;
  readonly cell: MapCell | undefined;
  /** Its height, or null for fog or a cell not loaded. */
  readonly height: number | null;
  /** Its place on the grid, where water's surface lies. */
  readonly spot: { readonly x: number; readonly y: number };
  /** Where its ground is drawn: the spot raised or sunk to its height. */
  readonly centre: { readonly x: number; readonly y: number };
  /** Its `zIndex` in the shared ground layer (`ground.ts` `paintOrder`). */
  readonly order: number;
  readonly appearance: CellAppearance;
}

/**
 * The living map's share of one chunk: everything its layers drew for it,
 * shown, hidden and thrown away together with the renderer's chunk.
 *
 * A layer adds what it draws through `addGround` (into the renderer's sorted
 * ground layer, for things that must sit between cells, like the water) or
 * `overlay` (over every chunk's buildings and plates). It never
 * has to track visibility or clean up itself.
 */
export class LiveChunk {
  /** This chunk's things over the map, shown and hidden as one. */
  readonly overlay = new Container();
  readonly cells: LiveCell[] = [];

  private readonly groundSprites: Container[] = [];
  private shown = true;

  constructor(
    readonly ref: ChunkRef,
    readonly source: LiveSource,
    private readonly ground: Container,
  ) {
    this.overlay.interactiveChildren = false;
    const range = chunkCells(ref);
    for (let col = range.minCol; col <= range.maxCol; col++) {
      for (let row = range.minRow; row <= range.maxRow; row++) {
        const cell = source.store.getCell(col, row);
        const spot = mapRoomGrid.cellToPixel(col, row);
        this.cells.push({
          col,
          row,
          cell,
          height: cell && !isFogCell(cell) ? cell.i : null,
          spot,
          centre: { x: spot.x, y: spot.y + cellLift(cell) },
          order: paintOrder(col, row),
          appearance: appearanceOf(cell, source.nowSeconds, source.viewer, { x: col, y: row }),
        });
      }
    }
  }

  get visible(): boolean {
    return this.shown;
  }

  /** A neighbour's height (it may be in another chunk), or null for fog or a cell not loaded. */
  heightAt(col: number, row: number): number | null {
    const cell = this.source.store.getCell(col, row);
    return cell && !isFogCell(cell) ? cell.i : null;
  }

  /** Puts a display object in the shared ground layer at this paint order. */
  addGround(object: Container, order: number): void {
    object.zIndex = order;
    object.visible = this.shown;
    this.groundSprites.push(object);
    this.ground.addChild(object);
  }

  show(visible: boolean): void {
    if (visible === this.shown) return;
    this.shown = visible;
    this.overlay.visible = visible;
    for (const object of this.groundSprites) object.visible = visible;
  }

  destroy(): void {
    // Textures are shared (the water sheet, the art), so only the sprites go.
    for (const object of this.groundSprites) object.destroy();
    this.groundSprites.length = 0;
    this.overlay.destroy({ children: true });
  }
}

/**
 * A layer of the living map that draws per chunk (the water; the
 * land features' animation in part 2).
 *
 * `build` runs once when the renderer builds or rebuilds a chunk, never per
 * frame. `step` runs at the animation rate with the chunks currently on
 * screen, for layers that move individual sprites; a layer whose motion is
 * all in a shared texture (the water) does nothing there. `forget` runs when
 * a chunk is thrown away, for layers that keep their own lists by chunk.
 */
export interface LiveChunkLayer {
  build(chunk: LiveChunk): void;
  step?(timeSeconds: number, visible: Iterable<LiveChunk>, zoom: number): void;
  forget?(chunk: LiveChunk): void;
  destroy?(): void;
}
