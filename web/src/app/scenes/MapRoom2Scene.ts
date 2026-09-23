import { Container, Graphics } from "pixi.js";
import { logout } from "@/api/auth";
import { WATER_MAX_HEIGHT, WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { Camera } from "@/game/Camera";
import { HexGrid, mapRoomGrid, type OffsetCell } from "@/game/HexGrid";
import { Hud } from "@/ui/Hud";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";

/**
 * Placeholder Map Room 2 screen.
 *
 * It draws the real 800 x 800 odd-q grid with the real cell geometry and the
 * real camera, but the heights are a local stand-in: terrain comes from the
 * server's noise function seeded by the world uuid, and cell contents come from
 * /worldmapv2/getarea. Both arrive in a later task. What is exercised here is
 * the camera, the grid maths and the overlay.
 */

/** Terrain bands from server/src/enums/MapRoom.ts, as fill colours. */
const TERRAIN_COLOURS: { maxHeight: number; colour: number }[] = [
  { maxHeight: 79, colour: 0x123253 },
  { maxHeight: 89, colour: 0x17416b },
  { maxHeight: WATER_MAX_HEIGHT, colour: 0x1d5183 },
  { maxHeight: 104, colour: 0xd9c489 },
  { maxHeight: 109, colour: 0xc9b070 },
  { maxHeight: 119, colour: 0x5c8f47 },
  { maxHeight: 139, colour: 0x4b7b3c },
  { maxHeight: 159, colour: 0x3f6833 },
  { maxHeight: 169, colour: 0x37592c },
  { maxHeight: 174, colour: 0x7a776e },
  { maxHeight: Number.POSITIVE_INFINITY, colour: 0x6e6b63 },
];

const GRID_LINE_COLOUR = 0x0d1017;
const HOVER_COLOUR = 0xf0a12e;

/**
 * Upper bound on hexes drawn in one pass. A wide monitor at minimum zoom is
 * around 4,000; the cap stops an unusual viewport from stalling the frame.
 */
const MAX_DRAWN_CELLS = 12_000;

export class MapRoom2Scene implements Scene {
  private readonly camera = new Camera({
    bounds: mapRoomGrid.worldBounds(WORLD_WIDTH, WORLD_HEIGHT),
  });

  private readonly world = new Container();
  private readonly terrain = new Graphics();
  private readonly highlight = new Graphics();

  private canvas: HTMLCanvasElement | null = null;
  private hud: Hud | null = null;
  private readout: HTMLElement | null = null;
  private hint: HTMLElement | null = null;

  /** The cell range last drawn, so a pan only rebuilds geometry when it must. */
  private drawnRange: {
    minCol: number;
    maxCol: number;
    minRow: number;
    maxRow: number;
  } | null = null;
  private hovered: OffsetCell | null = null;

  enter(context: SceneContext): void {
    this.canvas = context.canvas;

    this.world.addChild(this.terrain, this.highlight);
    context.stage.addChild(this.world);

    this.camera.resize(context.width, context.height);
    this.camera.centreOn(mapRoomGrid.cellToPixel(WORLD_WIDTH / 2, WORLD_HEIGHT / 2));
    this.camera.attach(context.canvas);

    context.canvas.addEventListener("pointermove", this.handleHover);
    context.canvas.addEventListener("pointerleave", this.clearHover);

    this.hud = new Hud({
      scenes: [
        { id: SceneName.MAP_ROOM_2, label: "Map" },
        { id: SceneName.LOGIN, label: "Account" },
      ],
      onSceneSelect: (id) => context.goTo(id),
      onSignOut: () => {
        logout();
        context.goTo(SceneName.LOGIN);
      },
    }).mount(context.overlay.content);
    this.hud.setActiveScene(SceneName.MAP_ROOM_2);

    this.readout = document.createElement("div");
    this.readout.className = "cell-readout";
    this.readout.textContent = "—";
    context.overlay.content.append(this.readout);

    this.hint = document.createElement("p");
    this.hint.className = "map-hint";
    this.hint.textContent =
      "Drag to pan, scroll or pinch to zoom. Cell data is not loaded yet.";
    context.overlay.content.append(this.hint);
  }

  exit(): void {
    this.camera.detach();
    this.canvas?.removeEventListener("pointermove", this.handleHover);
    this.canvas?.removeEventListener("pointerleave", this.clearHover);
    this.canvas = null;

    this.hud?.destroy();
    this.hud = null;
    this.readout?.remove();
    this.readout = null;
    this.hint?.remove();
    this.hint = null;

    this.world.destroy({ children: true });
  }

  resize(width: number, height: number): void {
    this.camera.resize(width, height);
  }

  update(): void {
    if (!this.camera.dirty) return;
    this.camera.dirty = false;
    this.applyCamera();
    this.redrawIfRangeChanged();
    // The outline width is in world units, so it has to follow the zoom.
    if (this.hovered) this.drawHighlight();
  }

  /**
   * Moves the whole world container instead of re-projecting every vertex, so
   * panning and zooming cost one transform rather than a geometry rebuild.
   */
  private applyCamera(): void {
    const { zoom, position } = this.camera;
    this.world.scale.set(zoom);
    this.world.position.set(-position.x * zoom, -position.y * zoom);
  }

  /** The inclusive cell range covering the viewport, with a one-cell margin. */
  private visibleRange(): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
    const view = this.camera.visibleWorldRect();

    const topLeft = mapRoomGrid.pixelToCell(view.left, view.top);
    const bottomRight = mapRoomGrid.pixelToCell(view.right, view.bottom);

    const clampCol = (value: number) => Math.min(Math.max(value, 0), WORLD_WIDTH - 1);
    const clampRow = (value: number) => Math.min(Math.max(value, 0), WORLD_HEIGHT - 1);

    return {
      minCol: clampCol(topLeft.col - 1),
      maxCol: clampCol(bottomRight.col + 1),
      minRow: clampRow(topLeft.row - 2),
      maxRow: clampRow(bottomRight.row + 2),
    };
  }

  private redrawIfRangeChanged(): void {
    const range = this.visibleRange();
    const previous = this.drawnRange;

    if (
      previous &&
      previous.minCol === range.minCol &&
      previous.maxCol === range.maxCol &&
      previous.minRow === range.minRow &&
      previous.maxRow === range.maxRow
    ) {
      return;
    }

    this.drawnRange = range;
    this.drawTerrain(range);
  }

  private drawTerrain(range: {
    minCol: number;
    maxCol: number;
    minRow: number;
    maxRow: number;
  }): void {
    this.terrain.clear();

    const cols = range.maxCol - range.minCol + 1;
    const rows = range.maxRow - range.minRow + 1;
    if (cols * rows > MAX_DRAWN_CELLS) return;

    // Batch by colour: every polygon of one band is added to a single path and
    // filled once, which keeps the draw-call count at the number of bands.
    const byColour = new Map<number, number[][]>();

    for (let col = range.minCol; col <= range.maxCol; col++) {
      for (let row = range.minRow; row <= range.maxRow; row++) {
        const colour = terrainColour(placeholderHeight(col, row));
        const polygons = byColour.get(colour) ?? [];
        polygons.push(flatten(mapRoomGrid.cellCorners(col, row)));
        byColour.set(colour, polygons);
      }
    }

    for (const [colour, polygons] of byColour) {
      for (const points of polygons) this.terrain.poly(points);
      this.terrain.fill({ color: colour });
    }

    // One pass of hairlines over the top, so cell edges read at any zoom.
    for (const polygons of byColour.values()) {
      for (const points of polygons) this.terrain.poly(points);
    }
    this.terrain.stroke({ width: 1, color: GRID_LINE_COLOUR, alpha: 0.35 });
  }

  private drawHighlight(): void {
    this.highlight.clear();
    if (!this.hovered) return;

    this.highlight.poly(flatten(mapRoomGrid.cellCorners(this.hovered.col, this.hovered.row)));
    this.highlight.fill({ color: HOVER_COLOUR, alpha: 0.22 });

    this.highlight.poly(flatten(mapRoomGrid.cellCorners(this.hovered.col, this.hovered.row)));
    this.highlight.stroke({ width: 2 / this.camera.zoom, color: HOVER_COLOUR });
  }

  private readonly handleHover = (event: PointerEvent): void => {
    const rect = this.canvas?.getBoundingClientRect();
    const world = this.camera.screenToWorld({
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    });

    const cell = mapRoomGrid.pixelToCell(world.x, world.y);
    const inWorld =
      cell.col >= 0 && cell.col < WORLD_WIDTH && cell.row >= 0 && cell.row < WORLD_HEIGHT;

    if (!inWorld) {
      this.clearHover();
      return;
    }

    if (this.hovered?.col === cell.col && this.hovered.row === cell.row) return;

    this.hovered = cell;
    this.drawHighlight();

    const height = placeholderHeight(cell.col, cell.row);
    const axial = HexGrid.toAxial(cell.col, cell.row);

    if (this.readout) {
      this.readout.textContent =
        `x ${cell.col}  y ${cell.row}` +
        `   q ${axial.q}  r ${axial.r}` +
        `   h ${height}${height <= WATER_MAX_HEIGHT ? "  water" : ""}`;
    }
  };

  private readonly clearHover = (): void => {
    if (!this.hovered) return;
    this.hovered = null;
    this.highlight.clear();
    if (this.readout) this.readout.textContent = "—";
  };
}

const flatten = (points: { x: number; y: number }[]): number[] => {
  const flat: number[] = [];
  for (const point of points) flat.push(point.x, point.y);
  return flat;
};

const terrainColour = (height: number): number => {
  for (const band of TERRAIN_COLOURS) {
    if (height <= band.maxHeight) return band.colour;
  }
  return TERRAIN_COLOURS[TERRAIN_COLOURS.length - 1]!.colour;
};

/**
 * A stand-in height so the placeholder grid looks like a map rather than a
 * chequerboard. Value noise over a hashed integer lattice, scaled to roughly
 * the server's 60..190 output range. Replaced by the real terrain once
 * /worldmapv2/getarea is wired in.
 */
const placeholderHeight = (col: number, row: number): number => {
  const frequency = 1 / 11;
  const x = col * frequency;
  const y = row * frequency;

  const value = valueNoise(x, y) * 0.65 + valueNoise(x * 2.3, y * 2.3) * 0.35;
  return Math.round(60 + value * 130);
};

/** Bilinear value noise in 0..1 over a hashed lattice. */
const valueNoise = (x: number, y: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);

  const top = lerp(hash(x0, y0), hash(x0 + 1, y0), fx);
  const bottom = lerp(hash(x0, y0 + 1), hash(x0 + 1, y0 + 1), fx);
  return lerp(top, bottom, fy);
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Deterministic 0..1 hash of an integer pair. */
const hash = (x: number, y: number): number => {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 0xffffffff;
};
