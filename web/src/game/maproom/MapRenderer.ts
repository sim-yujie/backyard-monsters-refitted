import { Container, Graphics, type Renderer } from "pixi.js";
import { MAX_TEXT_OBJECTS, WATER_MAX_HEIGHT } from "@/config";
import { mapRoomGrid, type OffsetCell } from "@/game/HexGrid";
import { HOVER_COLOUR, KitFilter, SELECT_COLOUR, type MapViewerContext } from "./cellVisuals";
import {
  CHUNK_TTL_MS,
  MAX_RESIDENT_CHUNKS,
  ChunkResidency,
  chunksForRange,
} from "./chunks";
import type { RangeSource } from "./attackRange";
import { TextPool } from "./LabelLayer";
import { LodTier, sameView, tierForZoom, viewFor } from "./lod";
import { MapAtlas } from "./mapAtlas";
import { MapChunk, TextLevel, type ChunkView } from "./MapChunk";
import type { Projector } from "./markerPins";
import type { BorderLayer } from "./painted/BorderLayer";
import type { CloudLayer } from "./painted/CloudLayer";
import type { PaintedGround } from "./painted/PaintedGround";
import type { PaintedPrograms } from "./painted/paintedLook";
import { BuildingAvatars } from "./buildingAvatars";
import { cellLift, liftCorners, setFlatGround } from "./ground";
import { GroundArt } from "./groundArt";
import { LiveMap } from "./live/LiveMap";
import { ConstructionBadge } from "./constructionBadge";
import { RangeOverlay } from "./RangeOverlay";
import type { Sight } from "./Sight";
import { TerrainRaster } from "./TerrainRaster";
import { TribeAvatars } from "./tribeAvatars";
import { classicLook } from "@/game/classicLook";
import { isFogCell } from "@/api/types";
import type { ZoneRecord, ZoneStore } from "./ZoneStore";
import type { CellRange } from "./zones";

type PaintedLookModule = typeof import("./painted/paintedLook");

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
  /**
   * Every chunk's ground tiles, painted in Flash's order (`ground.ts`
   * `paintOrder`), so a cell's cliff goes under the faces in front of it
   * whichever chunk those belong to.
   */
  private readonly ground = new Container({ sortableChildren: true });
  private readonly world = new Container();
  /** Every chunk's badges, markers and plates, over every chunk's ground. */
  private readonly worldTop = new Container();
  private readonly highlight = new Graphics();
  /**
   * The upright marker layer for the tilted map (`markerPins.ts`): while the
   * tilt is on, `world` and `worldTop` leave `root` (so they are not drawn
   * into the warped picture) and live here, in screen pixels, over it. The
   * scene puts this on the stage above the tilted picture. Empty when flat.
   * Its own render group, so markers coming on and off screen as the map
   * pans rebuild only this layer's draw list, not the whole stage's.
   */
  readonly markers = new Container({ isRenderGroup: true });
  /** How the markers stand on the tilted screen, or null on the flat map. */
  private projector: Projector | null = null;
  private projectorKey = "";
  /** The player's attack range (#177), over the cells and under the highlight. */
  private readonly range = new RangeOverlay();

  private readonly pool = new TextPool();
  /**
   * The tribe portraits, shared by every chunk.
   *
   * Owned here rather than by the atlas because it is fetched over the
   * network: the atlas is baked synchronously from a live renderer, this
   * arrives whenever it arrives, and the map has to look right in between.
   */
  private readonly avatars = new TribeAvatars();
  /** The Town Hall and outpost pictures a player cell wears (#334), fetched the same way. */
  private readonly buildings = new BuildingAvatars();
  /** Flash's ground tiles, fetched the same way; flat hexes until they land. */
  private readonly groundArt = new GroundArt();
  private readonly constructionBadge = new ConstructionBadge();
  /** The living map (water, clouds, birds): its own layers, told when chunks come and go. */
  private readonly live = new LiveMap(this.ground, () => this.rebuildAll());
  private readonly chunks = new Map<number, MapChunk>();
  private readonly residency = new ChunkResidency({
    ttlMs: CHUNK_TTL_MS,
    maxResident: MAX_RESIDENT_CHUNKS,
  });
  /** Chunks whose zone has been refetched since they were built. */
  private readonly dirty = new Set<number>();

  private atlas: MapAtlas | null = null;
  /** Map Room 2's painted look (`painted/`, MR2_PAINTED_MAP), in place of the tiles; null when off. */
  private painted: PaintedGround | null = null;
  /** The glowing borders round players' land (plan step 8); with the painted look only. */
  private borders: BorderLayer | null = null;
  /** The painted fog (plan step 9): cloud over every cell outside the player's sight; with the painted look only. */
  private clouds: CloudLayer | null = null;
  /**
   * Whether the last `draw` stepped the painted water, so a tilted view must redraw its picture
   * (`TiltView.invalidate`): the step only changes a shader uniform, which Pixi's change lists miss.
   */
  paintedStepped = false;
  private webGL2 = false;
  /** The live renderer (attach), which the painted look's sprite placement pass draws with. */
  private renderer: Renderer | null = null;
  /** The map's WebGL2 context, where the painted look's shaders are compiled ahead (`shaderWarmup.ts`). */
  private gl: WebGL2RenderingContext | null = null;
  /** Whether the painted look is asked for (`setPaintedMap`); it shows once its code and shaders are ready. */
  private paintedWanted = false;
  /**
   * The painted look's code (fetched on first use, `painted/paintedLook.ts`) and which of its
   * shaders compiled; null until both are known.
   */
  private paintedKit: { look: PaintedLookModule; programs: PaintedPrograms } | null = null;
  /** Fetching the code and compiling the shaders, while it runs. */
  private paintedPreparing: Promise<void> | null = null;
  private destroyed = false;

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

  /** The viewer's own alliance id (#334), or null; drives the "your alliance" plate colour. */
  private myAlliance: number | null = null;
  /** The active kit filter (#334). */
  private kitFilter: KitFilter = KitFilter.ALL;

  constructor(
    private readonly store: ZoneStore,
    /** The fog of war sight (#331): a long-lived 1:1 dependency, like `store`. */
    private readonly sight: Sight,
  ) {
    this.ground.interactiveChildren = false;
    this.world.interactiveChildren = false;
    this.worldTop.interactiveChildren = false;
    this.markers.interactiveChildren = false;
    this.markers.eventMode = "none";
    this.range.liftOf = this.liftAt;
    // The raster stays under the chunks at every tier, so a chunk that has not
    // been built yet shows the world at one texel per cell instead of nothing.
    this.root.addChild(
      this.raster.sprite,
      this.ground,
      this.world,
      this.range.container,
      this.worldTop,
      this.live.overlay,
      this.highlight,
    );
  }

  /**
   * Stands the markers upright on the tilted screen (`project` from
   * `markerPins.uprightProjector`, `key` naming the camera and tilt it was
   * made for), or puts them back into the flat map for null. Cheap to call
   * every frame: chunks re-place only when the key or their markers changed.
   */
  setMarkerProjector(project: Projector | null, key: string): void {
    const tilted = project !== null;
    const wasTilted = this.projector !== null;
    // The flat map stays exactly as it always was: nothing to do.
    if (!tilted && !wasTilted) return;
    if (tilted !== wasTilted) {
      if (tilted) {
        this.markers.addChild(this.world, this.worldTop);
      } else {
        // Back in the flat map's order: over the ground (and the borders), and the badges over the range.
        this.root.addChildAt(this.world, this.root.getChildIndex(this.range.container));
        this.root.addChildAt(this.worldTop, this.root.getChildIndex(this.range.container) + 1);
      }
    }
    this.projector = project;
    this.projectorKey = key;
    this.placeMarkers();
  }

  /** How many markers the chunks on screen carry, for the speed readout. */
  get markerCount(): number {
    let count = 0;
    for (const id of this.visibleIds) count += this.chunks.get(id)?.pins.size ?? 0;
    return count;
  }

  /** Places the markers of every chunk on screen for the current projector. */
  private placeMarkers(): void {
    if (!this.projector) {
      // Chunks that stood on the tilted screen go back, once; the rest are untouched.
      for (const chunk of this.chunks.values()) if (chunk.pins.tilted) chunk.pins.place(null, "");
      return;
    }
    for (const id of this.visibleIds) this.chunks.get(id)?.pins.place(this.projector, this.projectorKey);
  }

  /** How long the last chunk build took, in milliseconds. */
  get lastBuildMs(): number {
    return this.buildMs;
  }

  /**
   * Fetches the tribe portraits and the players' critters and puts them on
   * the map.
   *
   * Until the portraits land the camps wear their tent glyphs, and the players'
   * markers their plain ring, which is also where they stay if the art cannot
   * be fetched. Chunks built in the meantime hold no picture sprites, so they
   * are marked dirty and rebuilt as each set lands; that is at most a
   * screenful, and only ever on the first visit to the map.
   */
  async loadPictures(): Promise<void> {
    await Promise.all([
      this.avatars.load().then((ok) => ok && this.rebuildAll()),
      this.buildings.load().then((ok) => ok && this.rebuildAll()),
      this.groundArt.load().then((ok) => ok && this.rebuildAll()),
      this.constructionBadge.load().then((ok) => ok && this.rebuildAll()),
    ]);
  }

  private rebuildAll(): void {
    for (const id of this.chunks.keys()) this.dirty.add(id);
  }

  /** Sets the viewer's own alliance id (#334) and rebuilds every chunk if it changed. */
  setMyAlliance(id: number | null): void {
    if (id === this.myAlliance) return;
    this.myAlliance = id;
    this.borders?.setMyAlliance(id, this.store.loadedZoneRefs());
    this.rebuildAll();
  }

  /** Sets the active kit filter (#334) and rebuilds every chunk if it changed. */
  setKitFilter(filter: KitFilter): void {
    if (filter === this.kitFilter) return;
    this.kitFilter = filter;
    this.rebuildAll();
  }

  /**
   * The sight version changed (#331): what used to be drawn, chunk and raster
   * alike, may no longer be owed to the viewer ("no memory" — leaving sight
   * means fully dark again). Forgets the raster back to flat fog and rebuilds
   * every chunk so its fog cloud/feather follows the new sight, as the zone
   * cache the scene re-requests lands.
   */
  resetSight(): void {
    this.raster.reset();
    this.painted?.reset();
    this.clouds?.invalidate();
    this.borders?.reset();
    this.rebuildAll();
  }

  /**
   * Bakes the texture atlas. Nothing is drawn above the raster tier until this
   * has run, because it needs a live renderer to rasterise the shapes. Runs
   * after the map has set the world's hex shape.
   */
  attach(renderer: Renderer): void {
    // The world's hex shape is known by now (`setHexShape`); the layers built
    // before it line up with the grid again.
    this.raster.fitGrid();
    this.range.fitGrid();
    this.atlas?.destroy();
    this.atlas = new MapAtlas(renderer);
    this.renderer = renderer;
    this.webGL2 = (renderer as { context?: { webGLVersion?: number } }).context?.webGLVersion === 2;
    this.gl = this.webGL2 ? ((renderer as { gl?: WebGL2RenderingContext }).gl ?? null) : null;
    this.live.attach(renderer);
    this.dropAllChunks();
    this.lastRange = null;
  }

  /** Feeds a freshly loaded zone into the raster and invalidates its chunk. */
  applyZone(zone: ZoneRecord): void {
    this.raster.applyZone(zone);
    this.painted?.applyZone(zone);
    this.clouds?.invalidate();
    this.borders?.applyZone(zone);
    if (this.chunks.has(zone.id)) this.dirty.add(zone.id);
    this.live.zoneArrived(zone.id);
    this.painted?.invalidateRivers();
    // The range and the highlight stand on the cells, which now have their heights.
    this.range.invalidate();
    this.drawHighlight();
  }

  /** How far a cell is drawn from its spot on the grid (`ground.ts`), for picking and outlines. */
  readonly liftAt = (col: number, row: number): number => cellLift(this.store.getCell(col, row));

  /** What the rivers (look plan step 7, painted by the painted ground) read of the loaded cells. */
  private readonly riverCells = {
    rvAt: (col: number, row: number): number => {
      const cell = this.store.getCell(col, row);
      return cell && !isFogCell(cell) && "rv" in cell ? (cell.rv ?? 0) : 0;
    },
    isWater: (col: number, row: number): boolean => {
      const cell = this.store.getCell(col, row);
      return cell !== undefined && !isFogCell(cell) && cell.i <= WATER_MAX_HEIGHT;
    },
    isKnown: (col: number, row: number): boolean => {
      const cell = this.store.getCell(col, row);
      return cell !== undefined && !isFogCell(cell);
    },
    liftOf: this.liftAt,
  };

  setHovered(cell: OffsetCell | null): void {
    if (same(this.hovered, cell)) return;
    this.hovered = cell;
    this.drawHighlight();
  }

  /** Draws the range of these flingers, or hides it for null (#177). */
  setRange(sources: readonly RangeSource[] | null): void {
    this.range.show(sources);
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
    this.painted?.flush();
    const fogChanged = this.clouds?.flush() ?? false;
    const bordersChanged = this.borders?.flush() ?? false;
    const nowPaint = performance.now();
    const waterStepped = this.painted?.animate(nowPaint, range) ?? false;
    // The player's Quality's ground program once compiled, and the sprite pieces round the view.
    // A cell's width in drawn pixels, as the shader's fades see it (zoom is CSS pixels per world
    // point; the renderer's resolution is the most the tilted picture draws at, so never too few).
    const groundReady =
      this.painted && this.renderer
        ? this.painted.prepare(this.renderer, range, this.painted.shape.cellWidth * zoom * this.renderer.resolution)
        : false;
    const pulseStepped = this.borders?.animate(nowPaint, range) ?? false;
    const cloudsStepped = this.clouds?.animate(nowPaint, range) ?? false;
    this.paintedStepped = waterStepped || groundReady || pulseStepped || bordersChanged || cloudsStepped || fogChanged;
    this.range.flush();
    const atlas = this.atlas;
    if (!atlas) return false;

    if (zoom !== this.lastZoom) {
      this.lastZoom = zoom;
      // Highlight strokes are one screen pixel, so they and the range's line
      // are the things that still depend on the zoom rather than on the tier.
      this.drawHighlight();
      this.range.setZoom(zoom);
    }

    this.live.update(range, zoom);
    const tier = tierForZoom(zoom);
    const view = viewFor(tier, zoom, atlas);
    const nowMs = Date.now();

    // Rivers belong to the painted map (MR2_PAINTED_MAP): with it off the map
    // is exactly today's tiles. Never in Classic (Flash's map, which never
    // gets the painted look anyway), and not on the far raster tier yet.
    const riversShown = this.painted !== null && tier !== LodTier.RASTER && !classicLook();
    const riversWork = this.painted?.updateRivers(range, riversShown, this.riverCells) ?? false;
    if (riversWork) this.paintedStepped = true;

    if (tier === LodTier.RASTER) {
      const changed = this.lastTier !== tier;
      this.ground.visible = false;
      this.world.visible = false;
      this.worldTop.visible = false;
      this.lastTier = tier;
      this.lastRange = null;
      this.visibleIds = [];
      this.sweep(nowMs);
      return changed;
    }

    // The painted look draws its own ground and hex lines: the tiles stay hidden.
    this.ground.visible = this.painted === null;
    this.world.visible = true;
    this.worldTop.visible = true;
    if (
      !this.backlog &&
      this.dirty.size === 0 &&
      tier === this.lastTier &&
      sameView(view, this.lastView) &&
      sameRange(range, this.lastRange)
    ) {
      this.residency.keep(this.visibleIds, nowMs);
      this.sweep(nowMs);
      return riversWork;
    }

    this.lastTier = tier;
    this.lastView = view;
    this.lastRange = { ...range };
    this.reconcile(range, view, atlas, nowMs);
    this.sweep(nowMs);
    return true;
  }

  /**
   * Turns Map Room 2's painted look on or off (`painted/paintedSwitch.ts` decides). On, the painted
   * ground replaces the tiles, the raster and the hex outline sprites, and cells stop rising to
   * their height. It stays off where the shader cannot run (no WebGL2, or it does not compile).
   *
   * The first time, the look's code is fetched and its shaders compiled in the background
   * (`painted/shaderWarmup.ts`): the big ground shader can take the browser 10-40 s to compile the
   * first time, and doing that on the spot froze the page (the owner's Map Room "crash", 4 Nov
   * 2026). Today's tiles show meanwhile and the painted look takes over when it is ready.
   * Returns whether it is on now.
   */
  setPaintedMap(on: boolean): boolean {
    this.paintedWanted = on;
    if (on && this.painted === null) {
      const kit = this.paintedKit;
      if (!kit) {
        if (this.webGL2 && this.gl) this.paintedPreparing ??= this.preparePainted(this.gl);
        return false;
      }
      if (!kit.programs.ground) return false;
      this.buildPainted(kit.look, kit.programs);
    } else if (!on && this.painted !== null) {
      this.clouds?.destroy();
      this.clouds = null;
      this.painted.destroy();
      this.painted = null;
      this.borders?.destroy();
      this.borders = null;
    } else {
      return this.painted !== null;
    }
    const painted = this.painted !== null;
    setFlatGround(painted);
    this.live.setPaintedWater(painted);
    this.raster.sprite.visible = !painted;
    if (this.lastTier !== null && this.lastTier !== LodTier.RASTER) this.ground.visible = !painted;
    this.range.invalidate();
    this.drawHighlight();
    this.rebuildAll();
    return painted;
  }

  /** Whether the painted look is still being fetched or compiled. */
  get paintedPending(): boolean {
    return this.paintedPreparing !== null;
  }

  /** Fetches the painted look's code, compiles its shaders, then shows it if it is still wanted. */
  private async preparePainted(gl: WebGL2RenderingContext): Promise<void> {
    let kit: { look: PaintedLookModule; programs: PaintedPrograms };
    try {
      const look = await import("./painted/paintedLook");
      kit = { look, programs: this.destroyed ? { ground: false, clouds: false, warmer: null } : await look.preparePrograms(gl) };
    } catch (caught) {
      // The code did not arrive (offline, a new release): the tiles stay; the next map open tries again.
      console.warn("The painted map could not be prepared; the map keeps its tiles.", caught);
      this.paintedPreparing = null;
      return;
    }
    this.paintedPreparing = null;
    if (this.destroyed) return;
    this.paintedKit = kit;
    if (!kit.programs.ground) console.warn("The painted map's shader did not compile here; the map keeps its tiles.");
    if (this.paintedWanted) this.setPaintedMap(true);
  }

  private buildPainted(look: PaintedLookModule, programs: PaintedPrograms): void {
    const painted = new look.PaintedGround(undefined, programs.warmer);
    this.painted = painted;
    this.root.addChildAt(painted.mesh, this.root.getChildIndex(this.raster.sprite) + 1);
    for (const zone of this.store.loadedZoneRefs()) painted.applyZone(zone);
    void painted.load();
    this.borders = new look.BorderLayer();
    this.borders.setMyAlliance(this.myAlliance, []);
    // Over the ground (and rivers), under the cells' markers; with the markers standing upright
    // (tilt) they live outside the root, and the borders go under the attack range instead.
    const above = this.world.parent === this.root ? this.world : this.range.container;
    this.root.addChildAt(this.borders.mesh, this.root.getChildIndex(above));
    for (const zone of this.store.loadedZoneRefs()) this.borders.applyZone(zone);
    // The painted fog over the ground and the borders (a border running into the fog goes under
    // the cloud), under the attack range and the cells' markers.
    if (programs.clouds) {
      this.clouds = new look.CloudLayer(painted.groundData);
      this.root.addChildAt(this.clouds.mesh, this.root.getChildIndex(above));
      painted.setFogColour(look.FOG_UNDER_CLOUD);
      void this.clouds.load();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.clouds?.destroy();
    this.clouds = null;
    this.painted?.destroy();
    this.painted = null;
    this.borders?.destroy();
    this.borders = null;
    setFlatGround(false);
    this.dropAllChunks();
    this.live.destroy();
    this.pool.destroy();
    this.avatars.destroy();
    this.buildings.destroy();
    this.groundArt.destroy();
    this.constructionBadge.destroy();
    this.atlas?.destroy();
    this.atlas = null;
    this.raster.destroy();
    this.root.destroy({ children: true });
    this.markers.destroy({ children: true });
  }

  /** Builds what is missing, hides what is not on screen, shows the rest. */
  private reconcile(range: CellRange, view: ChunkView, atlas: MapAtlas, nowMs: number): void {
    const refs = chunksForRange(range);
    const visible = new Set<number>();
    for (const ref of refs) visible.add(ref.id);

    for (const [id, chunk] of this.chunks) {
      if (visible.has(id)) continue;
      chunk.visible = false;
      this.live.show(id, false);
      // Text is the scarce resource, so an off-screen chunk gives its share
      // back as soon as the on-screen ones might want it.
      if (this.pool.inUse > MAX_TEXT_OBJECTS) chunk.releaseText();
    }

    const wanted = view.badges ? TextLevel.BADGES : TextLevel.NONE;

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
          chunk = new MapChunk(
            ref,
            atlas,
            this.avatars,
            this.buildings,
            this.pool,
            this.ground,
            this.groundArt,
            this.constructionBadge,
          );
          this.chunks.set(ref.id, chunk);
          this.world.addChild(chunk.container);
          this.worldTop.addChild(chunk.top);
        }
        const started = performance.now();
        const context: MapViewerContext = {
          myAlliance: this.myAlliance,
          kitFilter: this.kitFilter,
          sight: this.sight,
        };
        chunk.build(this.store, nowSeconds, context);
        this.live.chunkBuilt(ref, { store: this.store, viewer: context, nowSeconds, groundReady: this.groundArt.ready });
        this.buildMs = performance.now() - started;
        this.dirty.delete(ref.id);
      }

      if (wanted > chunk.textLevel && this.pool.inUse < MAX_TEXT_OBJECTS) {
        chunk.ensureText(wanted);
      }
      chunk.applyView(view);
      chunk.visible = true;
      this.live.show(ref.id, true);
    }

    this.visibleIds = [...visible];
    this.residency.keep(this.visibleIds, nowMs);
    // Chunks just built or shown stand up with the rest.
    if (this.projector) this.placeMarkers();
  }

  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweepMs < SWEEP_INTERVAL_MS) return;
    this.lastSweepMs = nowMs;
    for (const id of this.residency.evict(nowMs)) {
      this.chunks.get(id)?.destroy();
      this.chunks.delete(id);
      this.live.drop(id);
      this.dirty.delete(id);
    }
  }

  private dropAllChunks(): void {
    for (const chunk of this.chunks.values()) chunk.destroy();
    this.chunks.clear();
    this.live.dropAll();
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
      const corners = this.liftedCorners(this.selected);
      this.highlight.poly(corners);
      this.highlight.fill({ color: SELECT_COLOUR, alpha: 0.12 });
      this.highlight.poly(corners);
      this.highlight.stroke({ width: 3 / zoom, color: SELECT_COLOUR });
    }

    if (this.hovered && !same(this.hovered, this.selected)) {
      const corners = this.liftedCorners(this.hovered);
      this.highlight.poly(corners);
      this.highlight.fill({ color: HOVER_COLOUR, alpha: 0.2 });
      this.highlight.poly(corners);
      this.highlight.stroke({ width: 2 / zoom, color: HOVER_COLOUR });
    }
  }

  /** A cell's outline where its face is drawn, raised or sunk to its height. */
  private liftedCorners(cell: OffsetCell): number[] {
    return liftCorners(mapRoomGrid.writeCellCorners(cell.col, cell.row, []), this.liftAt(cell.col, cell.row));
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
