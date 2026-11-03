import { Container, type Renderer } from "pixi.js";
import { AREA_ZONE_SIZE, LOD_HEX_ZOOM } from "@/config";
import { classicLook } from "@/game/classicLook";
import { mapRoomGrid } from "@/game/HexGrid";
import { onQualityChange, quality, type Quality } from "@/game/quality";
import { inWorld, zoneFor, zoneFromId, type CellRange } from "../zones";
import type { ChunkRef } from "../chunks";
import { destroyLiveArt, loadLiveArt, type LiveTextures } from "./liveArt";
import { LiveChunk, type LiveChunkLayer, type LiveSource } from "./LiveChunk";
import { liveLevelFor, planFor, type LivePlan } from "./liveLevel";
import { SkyLayer, type ViewRect } from "./SkyLayer";
import { WaterLayer } from "./WaterLayer";
import { WaterSheet } from "./WaterSheet";

/**
 * Map Room 2, alive (owner, 3 Nov 2026: "Can we make the map live/animated
 * like in civ?"). Part 1: the water moves and foams on the shores, cloud
 * shadows drift over the near map and clouds over the far one, and now and
 * then gulls fly over. (The smoke over yards was dropped by the owner.)
 *
 * Kept apart from the renderer, which only tells it when a chunk is built,
 * shown, hidden or thrown away (`chunkBuilt`, `show`, `drop`) and calls
 * `update` once a frame. Everything is built with its chunk; a frame only
 * advances the clock, and at the animation rate (`LivePlan.stepSeconds`)
 * redraws the small water sheet and moves the clouds and birds on
 * screen. Nothing here ever rebuilds a chunk on its own account.
 *
 * Off in Classic (Flash's map stood still) and on Quality Low, where nothing
 * is downloaded or drawn; reduced on Medium (`liveLevel.ts`). Paused while the
 * tab is hidden: the browser stops sending frames, and the clock skips the
 * gap rather than jumping.
 *
 * Part 2 (the land features: trees swaying, marsh bubbles, glints on
 * resources) adds a `LiveChunkLayer` to `layers` below: it gets each chunk's
 * cells at build time and a `step` at the animation rate.
 */
export class LiveMap {
  /** Shadows over every chunk's buildings, then clouds and birds over those. */
  readonly overlay = new Container();

  private readonly chunkOverlay = new Container();
  private readonly chunks = new Map<number, LiveChunk>();
  /** Chunks to redraw because a neighbouring zone arrived (their shores may have changed). */
  private readonly stale = new Set<number>();
  private layers: LiveChunkLayer[] = [];
  private sky: SkyLayer | null = null;
  private sheet: WaterSheet | null = null;
  private art: LiveTextures | null = null;
  private renderer: Renderer | null = null;
  private plan: LivePlan;
  /** The painted ground (`../painted/`) draws its own water and surf: no glints or foam then. */
  private paintedWater = false;
  /** Bumped whenever the plan changes, so art that lands for an old plan is dropped. */
  private generation = 0;
  private readonly unsubscribe: () => void;

  private clock = 0;
  private sinceStep = Number.POSITIVE_INFINITY;
  private lastMs = 0;
  private lastZoom = 0;
  /** Milliseconds `update` took, a moving average: the living map's share of a frame's script time. */
  private costMs = 0;

  constructor(
    /** The renderer's shared, sorted ground layer, where the water goes between the cells. */
    private readonly ground: Container,
    /** Asks the renderer to rebuild its chunks (the art landed, or the level changed). */
    private readonly rebuild: () => void,
  ) {
    this.overlay.interactiveChildren = false;
    this.overlay.addChild(this.chunkOverlay);
    this.plan = planFor(liveLevelFor(classicLook(), quality()));
    this.unsubscribe = onQualityChange((level) => this.setQuality(level));
    if (import.meta.env.DEV) {
      // `__mr2Live` in the console: what is on, at what zoom, and what it costs (measuring part 1).
      (globalThis as Record<string, unknown>)["__mr2Live"] = {
        level: () => this.plan.level,
        zoom: () => this.lastZoom,
        chunks: () => this.chunks.size,
        costMs: () => this.costMs,
        self: this,
      };
    }
  }

  /** Whether anything moves at all. */
  get active(): boolean {
    return this.plan.level !== "off";
  }

  /** Called with the live renderer: fetches this level's art and sets the scene up. */
  attach(renderer: Renderer): void {
    this.renderer = renderer;
    this.start();
  }

  /** The renderer built (or rebuilt) this chunk. */
  chunkBuilt(ref: ChunkRef, source: LiveSource): void {
    this.drop(ref.id);
    if (!this.active || this.layers.length === 0) return;
    const chunk = new LiveChunk(ref, source, this.ground);
    this.chunks.set(ref.id, chunk);
    this.chunkOverlay.addChild(chunk.overlay);
    for (const layer of this.layers) layer.build(chunk);
  }

  show(id: number, visible: boolean): void {
    this.chunks.get(id)?.show(visible);
  }

  /** The renderer threw this chunk away. */
  drop(id: number): void {
    const chunk = this.chunks.get(id);
    if (!chunk) return;
    for (const layer of this.layers) layer.forget?.(chunk);
    chunk.destroy();
    this.chunks.delete(id);
    this.stale.delete(id);
  }

  dropAll(): void {
    for (const id of [...this.chunks.keys()]) this.drop(id);
  }

  /** A zone's cells arrived: the chunks around it may now have a shore at their edge. */
  zoneArrived(id: number): void {
    if (this.chunks.size === 0) return;
    const zone = zoneFromId(id);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = zone.originX + dx * AREA_ZONE_SIZE;
        const y = zone.originY + dy * AREA_ZONE_SIZE;
        if ((dx === 0 && dy === 0) || !inWorld(x, y)) continue;
        const neighbour = zoneFor(x, y).id;
        if (this.chunks.has(neighbour)) this.stale.add(neighbour);
      }
    }
  }

  /** Once a frame, with what the renderer is showing. */
  update(range: CellRange, zoom: number): void {
    const nowMs = performance.now();
    this.lastZoom = zoom;
    this.step(range, zoom, nowMs);
    this.costMs += (performance.now() - nowMs - this.costMs) * 0.05;
  }

  private step(range: CellRange, zoom: number, nowMs: number): void {
    const dt = this.lastMs === 0 ? 0 : Math.min((nowMs - this.lastMs) / 1000, 0.1);
    this.lastMs = nowMs;
    if (!this.active || !this.renderer || (typeof document !== "undefined" && document.hidden)) return;

    this.redrawStale();
    this.clock += dt;
    this.sinceStep += dt;
    if (this.sinceStep < this.plan.stepSeconds) return;
    this.sinceStep = 0;

    // Below the hex zoom the renderer shows its one-texel-a-cell raster, and no chunk is on screen.
    const visible = zoom < LOD_HEX_ZOOM ? [] : [...this.chunks.values()].filter((chunk) => chunk.visible);
    if (this.sheet && visible.length > 0) this.sheet.render(this.renderer, this.clock);
    for (const layer of this.layers) layer.step?.(this.clock, visible, zoom);
    this.sky?.step(this.clock, viewOf(range), zoom);
  }

  destroy(): void {
    if (import.meta.env.DEV) delete (globalThis as Record<string, unknown>)["__mr2Live"];
    this.unsubscribe();
    this.stop();
    this.overlay.destroy({ children: true });
  }

  /**
   * The painted ground is on (it paints the sea itself) or off: the water sheet and its sprites
   * are neither downloaded nor built while it is on. The renderer rebuilds its chunks after.
   */
  setPaintedWater(on: boolean): void {
    if (on === this.paintedWater) return;
    this.paintedWater = on;
    this.stop();
    this.start();
  }

  private setQuality(level: Quality): void {
    const plan = planFor(liveLevelFor(classicLook(), level));
    if (plan.level === this.plan.level) return;
    this.stop();
    this.plan = plan;
    this.start();
    this.rebuild();
  }

  private start(): void {
    if (!this.active || !this.renderer) return;
    const generation = ++this.generation;
    const plan = this.paintedWater ? { ...this.plan, water: false, foam: false } : this.plan;
    void loadLiveArt(plan).then((art) => {
      if (generation !== this.generation) {
        destroyLiveArt(art);
        return;
      }
      this.art = art;
      const layers: LiveChunkLayer[] = [];
      if (art.water || art.foam) {
        this.sheet = new WaterSheet(art.water, art.foam, this.plan.waterResolution);
        layers.push(new WaterLayer(this.sheet, this.plan.foam && art.foam !== null));
      }
      this.layers = layers;
      if (art.clouds.length > 0 || art.bird) {
        this.sky = new SkyLayer(art.clouds, art.bird, this.plan.birds);
        // Shadows under the chunks' overlays; clouds and birds over everything.
        this.overlay.addChildAt(this.sky.shadows, 0);
        this.overlay.addChild(this.sky.above);
      }
      // Chunks built before the art have nothing alive on them yet.
      this.rebuild();
    });
  }

  private stop(): void {
    this.generation += 1;
    this.dropAll();
    for (const layer of this.layers) layer.destroy?.();
    this.layers = [];
    this.sky?.destroy();
    this.sky = null;
    this.sheet?.destroy();
    this.sheet = null;
    if (this.art) destroyLiveArt(this.art);
    this.art = null;
  }

  /** Redraws, two a frame, the chunks whose neighbours arrived since they were built. */
  private redrawStale(): void {
    let budget = 2;
    for (const id of this.stale) {
      if (budget-- <= 0) break;
      this.stale.delete(id);
      const chunk = this.chunks.get(id);
      if (!chunk) continue;
      const visible = chunk.visible;
      this.chunkBuilt(chunk.ref, chunk.source);
      this.show(id, visible);
    }
  }
}

/** The world rectangle a cell range covers. */
const viewOf = (range: CellRange): ViewRect => {
  const topLeft = mapRoomGrid.cellToPixel(range.minCol, range.minRow);
  const bottomRight = mapRoomGrid.cellToPixel(range.maxCol, range.maxRow);
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
};
