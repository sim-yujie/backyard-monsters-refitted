import { Container, Graphics } from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { mapRoomGrid } from "@/game/HexGrid";
import {
  NEIGHBOUR_EDGES,
  rangeEdges,
  reachableCells,
  type RangeEdge,
  type RangeSource,
} from "./attackRange";
import { RANGE_COLOUR } from "./cellVisuals";

/**
 * The player's attack range drawn over the map (issue #177): a line round
 * every cell a flinger of theirs reaches, the cells inside it faintly lit and
 * the rest of the world dimmed.
 *
 * The cells come from `attackRange.ts`, which measures with the rule the
 * Attack button and the server use, so the line cannot promise a cell the
 * button would refuse.
 *
 * Built once per change of the player's flingers, not per frame: the dim is
 * one rectangle over the whole world with the reachable cells cut out of it by
 * an inverse mask, and only the line's width follows the zoom.
 */

/** How dark the out-of-reach world goes, and how bright the inside glows. */
const DIM_COLOUR = 0x05080c;
const DIM_ALPHA = 0.45;
const INSIDE_ALPHA = 0.1;

/** The line is this many screen pixels wide at every zoom. */
const LINE_PX = 3;

export class RangeOverlay {
  readonly container = new Container();

  private readonly dim = new Graphics();
  private readonly hole = new Graphics();
  private readonly inside = new Graphics();
  private readonly line = new Graphics();

  private edges: RangeEdge[] = [];
  private zoom = 1;
  /** The zoom the line was last stroked for. */
  private lineZoom = 0;
  /** The last sources drawn, as a key, so an unchanged set is not rebuilt. */
  private drawnKey = "";

  constructor() {
    this.container.interactiveChildren = false;
    this.container.visible = false;

    const bounds = mapRoomGrid.worldBounds(WORLD_WIDTH, WORLD_HEIGHT);
    // A cell's width of margin all round, so the dim reaches past the art.
    this.dim
      .rect(-mapRoomGrid.cellWidth, -mapRoomGrid.cellHeight, bounds.width * 1.1, bounds.height * 1.1)
      .fill({ color: DIM_COLOUR, alpha: DIM_ALPHA });
    this.dim.setMask({ mask: this.hole, inverse: true });

    this.container.addChild(this.hole, this.dim, this.inside, this.line);
  }

  /** Shows the range of these flingers, or hides the overlay for null. */
  show(sources: readonly RangeSource[] | null): void {
    if (!sources) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;

    const key = sources.map((one) => `${one.col},${one.row},${one.reach}`).join(";");
    if (key === this.drawnKey) {
      if (this.lineZoom !== this.zoom) this.drawLine();
      return;
    }
    this.drawnKey = key;

    const cells = reachableCells(sources);
    this.hole.clear();
    this.inside.clear();
    const corners: number[] = [];
    for (const cellKey of cells) {
      const col = Math.floor(cellKey / WORLD_HEIGHT);
      const row = cellKey % WORLD_HEIGHT;
      mapRoomGrid.writeCellCorners(col, row, corners);
      this.hole.poly(corners.slice());
      this.inside.poly(corners.slice());
    }
    this.hole.fill({ color: 0xffffff });
    this.inside.fill({ color: RANGE_COLOUR, alpha: INSIDE_ALPHA });

    this.edges = rangeEdges(cells);
    this.drawLine();
  }

  /** The line keeps its screen width as the map zooms. */
  setZoom(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    if (this.container.visible) this.drawLine();
  }

  private drawLine(): void {
    this.lineZoom = this.zoom;
    this.line.clear();
    if (this.edges.length === 0) return;
    const corners: number[] = [];
    for (const { col, row, side } of this.edges) {
      mapRoomGrid.writeCellCorners(col, row, corners);
      const [a, b] = NEIGHBOUR_EDGES[side]!;
      this.line.moveTo(corners[a * 2]!, corners[a * 2 + 1]!);
      this.line.lineTo(corners[b * 2]!, corners[b * 2 + 1]!);
    }
    this.line.stroke({
      width: LINE_PX / this.zoom,
      color: RANGE_COLOUR,
      cap: "round",
      join: "round",
    });
  }
}
