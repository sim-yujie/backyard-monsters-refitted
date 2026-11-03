import { Sprite } from "pixi.js";
import { WATER_MAX_HEIGHT } from "@/config";
import { mapRoomGrid } from "@/game/HexGrid";
import { groundLift } from "../ground";
import type { LiveChunk, LiveChunkLayer } from "./LiveChunk";
import { FoamEdge, type WaterSheet } from "./WaterSheet";

/**
 * Puts the moving water on every water cell, and foam on its shores.
 *
 * Each water cell gets one sprite of the water sheet's glint frame for its
 * place, laid over the cell's water surface (`MapChunk`, `zIndex` order + 0.5)
 * in the shared ground layer, so the land in front of it still covers it as
 * it covers the water. Each edge it shares with land gets a foam sprite. All
 * of it is built with the chunk; the motion is all in the sheet.
 */

/** Just over the water surface, and the foam just over that. */
const GLINT_ORDER = 0.6;
const FOAM_ORDER = 0.7;

/**
 * The six edges of a hex: where the neighbour across it is (in columns and
 * rows of world points from the cell's place), which foam frame lines it, and
 * how that frame is flipped.
 */
interface Edge {
  dx: number;
  dy: number;
  frame: FoamEdge;
  flipX: boolean;
  flipY: boolean;
}
const FLAT_EDGES: readonly Edge[] = [
  { dx: 0, dy: -1, frame: FoamEdge.TOP, flipX: false, flipY: false },
  { dx: 0, dy: 1, frame: FoamEdge.TOP, flipX: false, flipY: true },
  { dx: -1, dy: -0.5, frame: FoamEdge.UPPER_LEFT, flipX: false, flipY: false },
  { dx: 1, dy: -0.5, frame: FoamEdge.UPPER_LEFT, flipX: true, flipY: false },
  { dx: -1, dy: 0.5, frame: FoamEdge.UPPER_LEFT, flipX: false, flipY: true },
  { dx: 1, dy: 0.5, frame: FoamEdge.UPPER_LEFT, flipX: true, flipY: true },
];
/** Pointy-top (`MR2_HEX_SHAPE=pointy`): upright left and right sides, and four slanted edges. */
const POINTY_EDGES: readonly Edge[] = [
  { dx: -1, dy: 0, frame: FoamEdge.SIDE, flipX: false, flipY: false },
  { dx: 1, dy: 0, frame: FoamEdge.SIDE, flipX: true, flipY: false },
  { dx: -0.5, dy: -1, frame: FoamEdge.UPPER_LEFT, flipX: false, flipY: false },
  { dx: 0.5, dy: -1, frame: FoamEdge.UPPER_LEFT, flipX: true, flipY: false },
  { dx: -0.5, dy: 1, frame: FoamEdge.UPPER_LEFT, flipX: false, flipY: true },
  { dx: 0.5, dy: 1, frame: FoamEdge.UPPER_LEFT, flipX: true, flipY: true },
];

/**
 * A raised cell in front of the water hides the water's lower edge behind its
 * top face, so the shore the player sees is that face's upper edge: the foam
 * on a lower edge moves up by the land's rise, to at most this far.
 */
const MAX_FOAM_RISE = 60;

export class WaterLayer implements LiveChunkLayer {
  constructor(
    private readonly sheet: WaterSheet,
    private readonly foam: boolean,
  ) {}

  build(chunk: LiveChunk): void {
    // Until the ground tiles arrive, water is a flat blue hex at the cell's lifted centre; the
    // renderer rebuilds every chunk when they land.
    if (!chunk.source.groundReady) return;
    const edges = mapRoomGrid.shape === "pointy" ? POINTY_EDGES : FLAT_EDGES;
    for (const cell of chunk.cells) {
      if (cell.height === null || cell.height > WATER_MAX_HEIGHT) continue;

      const glint = new Sprite(this.sheet.waterFrame(cell.col, cell.row));
      glint.anchor.set(0.5);
      glint.position.set(cell.spot.x, cell.spot.y);
      chunk.addGround(glint, cell.order + GLINT_ORDER);

      if (!this.foam) continue;
      for (const edge of edges) {
        const neighbour = mapRoomGrid.pixelToCell(
          cell.spot.x + edge.dx * mapRoomGrid.colStep,
          cell.spot.y + edge.dy * mapRoomGrid.rowStep,
        );
        const height = chunk.heightAt(neighbour.col, neighbour.row);
        if (height === null || height <= WATER_MAX_HEIGHT) continue;

        const foam = new Sprite(this.sheet.foamFrame(edge.frame, phaseOf(cell.col, cell.row, edge)));
        foam.anchor.set(0.5);
        foam.scale.set(edge.flipX ? -1 : 1, edge.flipY ? -1 : 1);
        const rise = edge.dy > 0 ? Math.min(-groundLift(height), MAX_FOAM_RISE) : 0;
        foam.position.set(cell.spot.x, cell.spot.y - Math.max(rise, 0));
        chunk.addGround(foam, cell.order + FOAM_ORDER);
      }
    }
  }
}

/** Which of the two foam phases an edge washes in, scattered so a coast does not breathe in step. */
const phaseOf = (col: number, row: number, edge: Edge): number =>
  ((col * 73856093) ^ (row * 19349663) ^ ((edge.dx + 2) * 83492791) ^ ((edge.dy + 2) * 4 * 2654435761)) & 1;
