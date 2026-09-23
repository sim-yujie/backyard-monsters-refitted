import { Container, Graphics, type Renderer } from "pixi.js";
import { MAX_TEXT_OBJECTS } from "@/config";
import { mapRoomGrid, type OffsetCell } from "@/game/HexGrid";
import { HOVER_COLOUR, SELECT_COLOUR } from "./cellVisuals";
import {
  CHUNK_TTL_MS,
  MAX_RESIDENT_CHUNKS,
  ChunkResidency,
  chunksForRange,
} from "./chunks";
import { TextPool } from "./LabelLayer";
import { LodTier, sameView, tierForZoom, viewFor } from "./lod";
import { MapAtlas } from "./mapAtlas";
import { MapChunk, TextLevel, type ChunkView } from "./MapChunk";
import { TerrainRaster } from "./TerrainRaster";
import type { ZoneRecord, ZoneStore } from "./ZoneStore";
import type { CellRange } from "./zones";

/**
 * Chunks built in one frame.
 *
 * A pan crosses a chunk boundary about twice a second, bringing three or four
 * chunks with it, so two a frame keeps up with any plausible drag. Pulling back
 * to the far tier asks for sixty at once; those arrive over the next half
 * second, and until they do the raster shows through underneath rather than a
 * hole.
 */
const MAX_BUILDS_PER_FRAME = 2;

/** Eviction is housekeeping; nothing about the answer is urgent. */
const SWEEP_INTERVAL_MS = 2_000;

/**
 * Draws the map.
 *
 * Two levels of detail, chosen by zoom: a single stretched texture for the
 * whole world (TerrainRaster) and, above the hex threshold, chunks of sprites
 * over the top of it.
 *
 * A chunk is one server zone, ten cells square, built once from the shared
 * texture atlas. Panning therefore does no geometry work at all: the visible
 * set of chunks changes, their parent's transform moves, and that is the whole
 * frame. A zone arriving marks its own chunk dirty and nothing else. Changing
 * zoom within the chunked tiers toggles layer visibility and, across a tier
 * boundary, swaps the outline texture — it never rebuilds.
 */
export class MapRenderer {
  /**
   * A render group, so moving the camera is one matrix update rather than a
   * walk over every sprite in every chunk.
   */
  readonly root = new Container({ isRenderGroup: true });

  private readonly raster = new TerrainRaster();
  private readonly world = new Container();
  private readonly highlight = new Graphics();

  private readonly pool = new TextPool();
  private readonly chunks = new Map<number, MapChunk>();
  private readonly residency = new ChunkResidency({
    ttlMs: CHUNK_TTL_MS,
    maxResident: MAX_RESIDENT_CHUNKS,
  });
  /** Chunks whose zone has been refetched since they were built. */
  private readonly dirty = new Set<number>();

  private atlas: MapAtlas | null = null;

  private lastRange: CellRange | null = null;
  private lastTier: LodTier | null = null;
  private lastView: ChunkView | null = null;
  private lastZoom = 0;
  private visibleIds: number[] = [];
  /** Set when a frame ran out of build budget, so the next frame continues. */
  private backlog = false;
  private lastSweepMs = 0;
  private buildMs = 0;

  private hovered: OffsetCell | null = null;
  private selected: OffsetCell | null = null;

  constructor(private readonly store: ZoneStore) {
    this.world.interactiveChildren = false;
    // The raster stays under the chunks at every tier, so a chunk that has not
    // been built yet shows the world at one texel per cell instead of nothing.
    this.root.addChild(this.raster.sprite, this.world, this.highlight);
  }

  /** How long the last chunk build took, in milliseconds. */
  get lastBuildMs(): number {
    return this.buildMs;
  }

  /**
   * Bakes the texture atlas. Nothing is drawn above the raster tier until this
   * has run, because it needs a live renderer to rasterise the shapes.
   */
  attach(renderer: Renderer): void {
    this.atlas?.destroy();
    this.atlas = new MapAtlas(renderer);
    this.dropAllChunks();
    this.lastRange = null;
  }

  /** Feeds a freshly loaded zone into the raster and invalidates its chunk. */
  applyZone(zone: ZoneRecord): void {
    this.raster.applyZone(zone);
    if (this.chunks.has(zone.id)) this.dirty.add(zone.id);
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
   * Brings the chunk set in line with the viewport. Returns true when it did
   * work, which the scene uses for its frame-time readout.
   */
  draw(range: CellRange, zoom: number): boolean {
    this.raster.flush();
    const atlas = this.atlas;
    if (!atlas) return false;

    if (zoom !== this.lastZoom) {
      this.lastZoom = zoom;
      // Highlight strokes are one screen pixel, so they are the one thing that
      // still depends on the zoom rather than on the tier.
      this.drawHighlight();
    }

    const tier = tierForZoom(zoom);
    const view = viewFor(tier, zoom, atlas);
    const nowMs = Date.now();

    if (tier === LodTier.RASTER) {
      const changed = this.lastTier !== tier;
      this.world.visible = false;
      this.lastTier = tier;
      this.lastRange = null;
      this.visibleIds = [];
      this.sweep(nowMs);
      return changed;
    }

    this.world.visible = true;
    if (
      !this.backlog &&
      this.dirty.size === 0 &&
      tier === this.lastTier &&
      sameView(view, this.lastView) &&
      sameRange(range, this.lastRange)
    ) {
      this.residency.keep(this.visibleIds, nowMs);
      this.sweep(nowMs);
      return false;
    }

    this.lastTier = tier;
    this.lastView = view;
    this.lastRange = { ...range };
    this.reconcile(range, view, atlas, nowMs);
    this.sweep(nowMs);
    return true;
  }

  destroy(): void {
    this.dropAllChunks();
    this.pool.destroy();
    this.atlas?.destroy();
    this.atlas = null;
    this.raster.destroy();
    this.root.destroy({ children: true });
  }

  /** Builds what is missing, hides what is not on screen, shows the rest. */
  private reconcile(range: CellRange, view: ChunkView, atlas: MapAtlas, nowMs: number): void {
    const refs = chunksForRange(range);
    const visible = new Set<number>();
    for (const ref of refs) visible.add(ref.id);

    for (const [id, chunk] of this.chunks) {
      if (visible.has(id)) continue;
      chunk.container.visible = false;
      // Text is the scarce resource, so an off-screen chunk gives its share
      // back as soon as the on-screen ones might want it.
      if (this.pool.inUse > MAX_TEXT_OBJECTS) chunk.releaseText();
    }

    const wanted = view.names
      ? TextLevel.NAMES
      : view.badges
        ? TextLevel.BADGES
        : TextLevel.NONE;

    let budget = MAX_BUILDS_PER_FRAME;
    this.backlog = false;
    const nowSeconds = nowMs / 1000;

    for (const ref of refs) {
      let chunk = this.chunks.get(ref.id);
      const stale = this.dirty.has(ref.id);

      if (!chunk || stale) {
        if (budget <= 0) {
          this.backlog = true;
          continue;
        }
        budget -= 1;
        if (!chunk) {
          chunk = new MapChunk(ref, atlas, this.pool);
          this.chunks.set(ref.id, chunk);
          this.world.addChild(chunk.container);
        }
        const started = performance.now();
        chunk.build(this.store, nowSeconds);
        this.buildMs = performance.now() - started;
        this.dirty.delete(ref.id);
      }

      if (wanted > chunk.textLevel && this.pool.inUse < MAX_TEXT_OBJECTS) {
        chunk.ensureText(wanted);
      }
      chunk.applyView(view);
      chunk.container.visible = true;
    }

    this.visibleIds = [...visible];
    this.residency.keep(this.visibleIds, nowMs);
  }

  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweepMs < SWEEP_INTERVAL_MS) return;
    this.lastSweepMs = nowMs;
    for (const id of this.residency.evict(nowMs)) {
      this.chunks.get(id)?.destroy();
      this.chunks.delete(id);
      this.dirty.delete(id);
    }
  }

  private dropAllChunks(): void {
    for (const chunk of this.chunks.values()) chunk.destroy();
    this.chunks.clear();
    this.dirty.clear();
    this.visibleIds = [];
    for (const id of this.residency.ids()) this.residency.forget(id);
  }

  /**
   * The one thing still drawn as vectors, because there is at most one of each
   * and both strokes are a fixed number of *screen* pixels.
   *
   * Each cell gets its own corner array: `Graphics.poly` keeps the array it is
   * handed rather than copying it, so a shared buffer would move the selection
   * outline onto the hovered cell.
   */
  private drawHighlight(): void {
    this.highlight.clear();
    const zoom = this.lastZoom || 1;

    if (this.selected) {
      const corners = mapRoomGrid.writeCellCorners(this.selected.col, this.selected.row, []);
      this.highlight.poly(corners);
      this.highlight.fill({ color: SELECT_COLOUR, alpha: 0.12 });
      this.highlight.poly(corners);
      this.highlight.stroke({ width: 3 / zoom, color: SELECT_COLOUR });
    }

    if (this.hovered && !same(this.hovered, this.selected)) {
      const corners = mapRoomGrid.writeCellCorners(this.hovered.col, this.hovered.row, []);
      this.highlight.poly(corners);
      this.highlight.fill({ color: HOVER_COLOUR, alpha: 0.2 });
      this.highlight.poly(corners);
      this.highlight.stroke({ width: 2 / zoom, color: HOVER_COLOUR });
    }
  }
}

const same = (a: OffsetCell | null, b: OffsetCell | null): boolean =>
  a === b || (a !== null && b !== null && a.col === b.col && a.row === b.row);

const sameRange = (a: CellRange, b: CellRange | null): boolean =>
  b !== null &&
  a.minCol === b.minCol &&
  a.maxCol === b.maxCol &&
  a.minRow === b.minRow &&
  a.maxRow === b.maxRow;
