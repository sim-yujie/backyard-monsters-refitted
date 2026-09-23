import { Container, Graphics } from "pixi.js";
import { LOD_BADGE_ZOOM, LOD_GLYPH_ZOOM, LOD_HEX_ZOOM, LOD_LABEL_ZOOM, MAX_HEX_CELLS } from "@/config";
import { mapRoomGrid, type OffsetCell } from "@/game/HexGrid";
import { drawCellDecoration, flatten, markerPolygon } from "./cellMarkers";
import { LabelLayer, type LabelRequest } from "./LabelLayer";
import {
  CellMarker,
  GRID_LINE_COLOUR,
  HOVER_COLOUR,
  SELECT_COLOUR,
  appearanceOf,
  type CellAppearance,
} from "./cellVisuals";
import { TerrainRaster } from "./TerrainRaster";
import type { ZoneRecord, ZoneStore } from "./ZoneStore";
import type { CellRange } from "./zones";

/** How much detail the current zoom earns. */
export const LodTier = {
  /** One texel per cell: the whole world at once. */
  RASTER: 0,
  /** Hexagons and glyphs, no text. */
  SHAPES: 1,
  /** Plus level badges. */
  BADGES: 2,
  /** Plus owner and tribe names. */
  LABELS: 3,
} as const;
export type LodTier = (typeof LodTier)[keyof typeof LodTier];

export const tierForZoom = (zoom: number): LodTier => {
  if (zoom < LOD_HEX_ZOOM) return LodTier.RASTER;
  if (zoom < LOD_BADGE_ZOOM) return LodTier.SHAPES;
  if (zoom < LOD_LABEL_ZOOM) return LodTier.BADGES;
  return LodTier.LABELS;
};

/**
 * Hairlines between cells are dropped once there are this many on screen. The
 * stroker walks six segments per hex, so the cost grows faster than the fills
 * do, and at that density the outlines have merged into a grey wash anyway.
 */
const MAX_OUTLINED_CELLS = 3_000;

/**
 * Draws the map.
 *
 * Two levels of detail, chosen by zoom: a single stretched texture for the
 * whole world (TerrainRaster) and real hexagons for anything closer. The
 * expensive path only rebuilds when something it depends on changed — the
 * visible range, the level of detail, or the zone store's revision — so panning
 * within a cell and idling both cost nothing.
 */
export class MapRenderer {
  readonly root = new Container();

  private readonly raster = new TerrainRaster();
  private readonly terrain = new Graphics();
  private readonly markers = new Graphics();
  private readonly decoration = new Graphics();
  private readonly labels = new LabelLayer();
  private readonly highlight = new Graphics();

  /**
   * Reused hex corner arrays, one per cell drawn.
   *
   * A rebuild can touch five thousand cells, and allocating a twelve-number
   * array plus six point objects for each was the largest single source of
   * garbage in the frame — enough to turn a 4 ms rebuild into a 10 ms one
   * whenever a collection landed. Graphics keeps a reference to each array
   * until the next `clear()`, and `clear()` happens at the top of the rebuild
   * that reuses them, so recycling is safe.
   */
  private readonly polygonPool: number[][] = [];
  private polygonCursor = 0;

  private lastRange: CellRange | null = null;
  private lastTier: LodTier | null = null;
  private lastRevision = -1;
  private lastZoom = 0;

  private hovered: OffsetCell | null = null;
  private selected: OffsetCell | null = null;

  constructor(private readonly store: ZoneStore) {
    this.root.addChild(
      this.raster.sprite,
      this.terrain,
      this.markers,
      this.decoration,
      this.highlight,
      this.labels.container,
    );
  }

  /** Feeds a freshly loaded zone into the far-detail texture. */
  applyZone(zone: ZoneRecord): void {
    this.raster.applyZone(zone);
  }

  setHovered(cell: OffsetCell | null): void {
    if (same(this.hovered, cell)) return;
    this.hovered = cell;
    this.drawHighlight();
  }

  setSelected(cell: OffsetCell | null): void {
    if (same(this.selected, cell)) return;
    this.selected = cell;
    this.drawHighlight();
  }

  /**
   * Redraws if anything it depends on moved. Returns true when it did work,
   * which the scene uses for its frame-time readout.
   */
  draw(range: CellRange, zoom: number): boolean {
    this.raster.flush();

    const tier = tierForZoom(zoom);
    const revision = this.store.revision;
    const unchanged =
      tier === this.lastTier &&
      revision === this.lastRevision &&
      sameRange(range, this.lastRange) &&
      // Stroke widths are in world units and divided by the zoom, so a zoom
      // change inside one tier still has to redraw them.
      (tier === LodTier.RASTER || zoom === this.lastZoom);
    if (unchanged) return false;

    this.lastTier = tier;
    this.lastRevision = revision;
    this.lastRange = { ...range };
    this.lastZoom = zoom;

    if (tier === LodTier.RASTER) {
      this.showRasterOnly();
      this.drawHighlight();
      return true;
    }

    this.raster.sprite.visible = false;
    this.terrain.visible = true;
    this.markers.visible = true;
    this.decoration.visible = true;
    this.labels.visible = tier >= LodTier.BADGES;

    this.rebuild(range, tier, zoom);
    this.drawHighlight();
    return true;
  }

  destroy(): void {
    this.raster.destroy();
    this.root.destroy({ children: true });
  }

  private showRasterOnly(): void {
    this.raster.sprite.visible = true;
    this.terrain.visible = false;
    this.markers.visible = false;
    this.decoration.visible = false;
    this.labels.visible = false;
  }

  private rebuild(range: CellRange, tier: LodTier, zoom: number): void {
    this.terrain.clear();
    this.markers.clear();
    this.decoration.clear();

    const cols = range.maxCol - range.minCol + 1;
    const rows = range.maxRow - range.minRow + 1;
    if (cols <= 0 || rows <= 0 || cols * rows > MAX_HEX_CELLS) {
      this.showRasterOnly();
      return;
    }

    this.polygonCursor = 0;
    const nowSeconds = Date.now() / 1000;
    const showCamps = zoom >= LOD_GLYPH_ZOOM;
    const context = {
      cellWidth: mapRoomGrid.cellWidth,
      cellHeight: mapRoomGrid.cellHeight,
      zoom,
    };

    // Batching by colour keeps the draw-call count at the number of distinct
    // terrain bands rather than the number of cells.
    const hexes = new Map<number, number[][]>();
    const glyphs = new Map<number, number[][]>();
    const decorated: { appearance: CellAppearance; col: number; row: number }[] = [];
    const texts: LabelRequest[] = [];

    for (let col = range.minCol; col <= range.maxCol; col++) {
      for (let row = range.minRow; row <= range.maxRow; row++) {
        const appearance = appearanceOf(this.store.getCell(col, row), nowSeconds);
        push(
          hexes,
          appearance.terrain,
          mapRoomGrid.writeCellCorners(col, row, this.takePolygon()),
        );

        if (appearance.marker === CellMarker.NONE && !appearance.own) continue;
        // Almost every land cell is a camp, so below the glyph threshold their
        // tents are the bulk of the geometry and none of the information.
        const isCamp =
          appearance.marker === CellMarker.CAMP ||
          appearance.marker === CellMarker.CAMP_DESTROYED;
        if (isCamp && !showCamps && !appearance.own) continue;

        const centre = mapRoomGrid.cellToPixel(col, row);
        const polygon = markerPolygon(appearance, centre, context);
        if (polygon) push(glyphs, appearance.markerColour, polygon);

        // Rings and damage bars need real corner objects, but only a handful of
        // cells ever have them, so they are built here rather than for every cell.
        if (appearance.own || appearance.shielded || appearance.damage > 0) {
          decorated.push({ appearance, col, row });
        }
        if (tier >= LodTier.BADGES && appearance.badge) {
          texts.push({ badge: appearance.badge, name: appearance.label, centre });
        }
      }
    }

    fillBatched(this.terrain, hexes);
    if (cols * rows <= MAX_OUTLINED_CELLS) {
      for (const polygons of hexes.values()) {
        for (const points of polygons) this.terrain.poly(points);
      }
      // One screen pixel whatever the zoom, so the grid does not disappear.
      this.terrain.stroke({ width: 1 / zoom, color: GRID_LINE_COLOUR, alpha: 0.35 });
    }

    fillBatched(this.markers, glyphs);
    for (const item of decorated) {
      drawCellDecoration(
        this.decoration,
        item.appearance,
        mapRoomGrid.cellToPixel(item.col, item.row),
        mapRoomGrid.cellCorners(item.col, item.row),
        context,
      );
    }

    this.labels.layOut(texts, tier >= LodTier.LABELS);
  }

  /** Next recycled corner array, growing the pool only on the first pass. */
  private takePolygon(): number[] {
    const existing = this.polygonPool[this.polygonCursor];
    this.polygonCursor += 1;
    if (existing) return existing;
    const fresh = new Array<number>(12).fill(0);
    this.polygonPool.push(fresh);
    return fresh;
  }

  private drawHighlight(): void {
    this.highlight.clear();
    const zoom = this.lastZoom || 1;

    if (this.selected) {
      const corners = mapRoomGrid.cellCorners(this.selected.col, this.selected.row);
      this.highlight.poly(flatten(corners));
      this.highlight.fill({ color: SELECT_COLOUR, alpha: 0.12 });
      this.highlight.poly(flatten(corners));
      this.highlight.stroke({ width: 3 / zoom, color: SELECT_COLOUR });
    }

    if (this.hovered && !same(this.hovered, this.selected)) {
      const corners = mapRoomGrid.cellCorners(this.hovered.col, this.hovered.row);
      this.highlight.poly(flatten(corners));
      this.highlight.fill({ color: HOVER_COLOUR, alpha: 0.2 });
      this.highlight.poly(flatten(corners));
      this.highlight.stroke({ width: 2 / zoom, color: HOVER_COLOUR });
    }
  }
}

const push = (into: Map<number, number[][]>, key: number, polygon: number[]): void => {
  const existing = into.get(key);
  if (existing) existing.push(polygon);
  else into.set(key, [polygon]);
};

const fillBatched = (graphics: Graphics, byColour: Map<number, number[][]>): void => {
  for (const [colour, polygons] of byColour) {
    for (const points of polygons) graphics.poly(points);
    graphics.fill({ color: colour });
  }
};

const same = (a: OffsetCell | null, b: OffsetCell | null): boolean =>
  a === b || (a !== null && b !== null && a.col === b.col && a.row === b.row);

const sameRange = (a: CellRange, b: CellRange | null): boolean =>
  b !== null &&
  a.minCol === b.minCol &&
  a.maxCol === b.maxCol &&
  a.minRow === b.minRow &&
  a.maxRow === b.maxRow;
