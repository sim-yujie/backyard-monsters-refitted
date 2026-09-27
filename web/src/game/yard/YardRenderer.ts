import { Container, Graphics, Sprite, type Renderer } from "pixi.js";
import { YardBuildings } from "./YardBuildings";
import { YardGround } from "./YardGround";
import { YardJobBars } from "./YardJobBars";
import { yardArtAtlas, type YardArtAtlas } from "./yardAtlas";
import { BlueprintLayer } from "./planner/BlueprintLayer";
import { blueprintToYard, blueprintToWorld } from "./planner/blueprint";
import { PlannerOverlay, type PlannerVisuals } from "./planner/PlannerOverlay";
import { diamondCorners, type Corners, type Diamond } from "./planner/marquee";
import { fromIso, toIso, yardFitRect, yardToWorld, type Point, type Rect } from "./YardGrid";
import { mushroomAt, mushroomKey } from "./mushroomPick";
import type { Yard, YardBuilding, YardMushroom } from "./yardModel";

/**
 * The yard's scene graph: ground, mushrooms, buildings and the selection
 * chrome, stacked in that order — plus the blueprint, a flat top-down drawing
 * of the same yard that the planner can switch to.
 *
 * This is composition and layer order only. The buildings — far and away the
 * expensive part — are `YardBuildings`, the tiled ground is `YardGround`, the
 * blueprint is `BlueprintLayer`, and the glyphs everything else is drawn from
 * are `yardAtlas`. What is left here is which container sits above which, the
 * hover and selection outlines, and the one question the two views answer
 * differently: where on screen is building `id` right now.
 *
 * Both views live in the same world-pixel space and under the same camera, so
 * switching is showing one set of containers and hiding the other. The world
 * has a different size in each, which the scene reads from `worldSize` when it
 * re-bounds the camera.
 */

/** Which drawing of the yard is showing. */
export const YardView = {
  /** The isometric yard with its real art. */
  ISO: "iso",
  /** The planner's flat view: footprints as coloured tiles. */
  BLUEPRINT: "blueprint",
} as const;
export type YardView = (typeof YardView)[keyof typeof YardView];

export class YardRenderer {
  readonly root = new Container();

  private readonly ground = new YardGround();
  private readonly buildings = new YardBuildings();
  private readonly mushroomLayer = new Container();
  /** Each mushroom's sprite by `mushroomKey`, rebuilt with every `show`. */
  private readonly mushroomSprites = new Map<string, Sprite>();
  /** Mushrooms shaking for a pick, by `mushroomKey` (`BMUSHROOM.as:76-81`). */
  private readonly shaking = new Set<string>();
  private readonly blueprint = new BlueprintLayer(this.buildings.art);
  private readonly chrome = new Graphics();
  private readonly planner = new PlannerOverlay();
  /** Progress bars over running builds and upgrades, own yard only (#139). */
  private readonly jobBars = new YardJobBars((id) => this.jobBarAnchor(id));

  /**
   * Where the planner hangs its world-space decals: the tower range discs and
   * the centre mark.
   *
   * Two containers because "under the buildings" is a different place in each
   * view. In the isometric yard it is above the ground and below the sprites,
   * so a disc reads as paint on the grass. The blueprint draws its own ground,
   * its grid and its tiles inside one container, so its decal slot lives in
   * there, between the grid and the tiles, and shows and hides with it.
   *
   * Public because the planner owns what goes in them and the renderer has no
   * opinion about it; empty and invisible until something is put in.
   */
  readonly isoDecals = new Container();
  readonly flatDecals: Container = this.blueprint.decals;

  private atlas: YardArtAtlas | null = null;
  private yard: Yard | null = null;
  private readonly byId = new Map<number, YardBuilding>();
  /**
   * Buildings the planner has taken off the yard and into its drawer.
   *
   * Held here as well as on the two views because everything that asks *where*
   * a building is has to answer "nowhere" for these: the minimap paints every
   * id it knows, and a stored building left answering would go on being
   * painted at the spot it was lifted from.
   */
  private readonly stored = new Set<number>();
  /**
   * Buildings hidden from a viewer who must not know they are there: an
   * enemy's traps until they fire (issue #66). Kept apart from `stored` so the
   * planner's drawer never gains or loses an entry it did not put there.
   */
  private readonly concealed = new Set<number>();

  private hovered: YardBuilding | null = null;
  private selected: YardBuilding | null = null;
  private chromeDirty = true;
  private plannerVisuals: PlannerVisuals | null = null;
  private currentView: YardView = YardView.ISO;
  private zoomLevel = 1;
  private zoomWatcher: ((zoom: number) => void) | null = null;

  constructor() {
    this.mushroomLayer.eventMode = "none";
    this.isoDecals.eventMode = "none";
    this.root.addChild(
      this.ground.root,
      this.isoDecals,
      this.buildings.shadows,
      this.mushroomLayer,
      this.buildings.tops,
      this.blueprint.root,
      this.chrome,
      this.planner.root,
      this.buildings.markers,
      this.jobBars.root,
      this.buildings.labels,
    );
  }

  /** Bakes the vector glyphs. Call once, before the first `show`. */
  attach(renderer: Renderer): void {
    this.atlas ??= yardArtAtlas(renderer);
  }

  /** Buildings still waiting on, or missing, their picture. */
  get placeholderCount(): number {
    return this.buildings.placeholderCount;
  }

  /** Replaces what is on screen with a yard. */
  show(yard: Yard): void {
    const atlas = this.atlas;
    if (!atlas) return;

    this.clearMushrooms();
    this.setHovered(null);
    this.setSelected(null);
    this.yard = yard;
    this.byId.clear();
    // Fresh sprites are drawn, so nothing is hidden any more. A planner that
    // is still open re-asserts its drawer through `rebase`; a scene that
    // conceals traps does so again after every `show`.
    this.stored.clear();
    this.concealed.clear();
    for (const building of yard.buildings) this.byId.set(building.id, building);

    // The base seed keeps one yard's grass the same between visits. Somebody
    // else's yard sits on open grass with no plot edge (see `Yard.foreign`).
    this.ground.layout(yard.bounds, yard.savedAt || 1, yard.foreign ? "open" : "plot");
    void this.ground.loadTiles();

    this.buildings.show(yard, atlas);
    this.jobBars.show(yard);
    this.blueprint.show(yard);
    this.blueprint.setActive(this.currentView === YardView.BLUEPRINT);

    for (const mushroom of yard.mushrooms) {
      const sprite = new Sprite(atlas.mushroom);
      sprite.anchor.set(0.5, 0.85);
      sprite.position.set(mushroom.worldX, mushroom.worldY);
      this.mushroomLayer.addChild(sprite);
      this.mushroomSprites.set(mushroomKey(mushroom), sprite);
    }
  }

  /**
   * Advances one frame: `visible` is the world rectangle on screen and
   * `deltaSeconds` is how long the last one took, which is what the building
   * animations run on.
   */
  draw(visible: Rect, deltaSeconds = 0): void {
    // The blueprint has no culling and no animation, so a hidden isometric
    // yard costs nothing per frame.
    if (this.currentView === YardView.ISO) {
      this.buildings.draw(visible, deltaSeconds);
      this.jobBars.update();
      this.shakeMushrooms();
    }

    if (this.chromeDirty) {
      this.chromeDirty = false;
      this.drawChrome();
    }
  }

  setHovered(building: YardBuilding | null): void {
    if (this.hovered?.id === building?.id) return;
    this.hovered = building;
    this.chromeDirty = true;
  }

  setSelected(building: YardBuilding | null): void {
    if (this.selected?.id === building?.id) return;
    this.selected = building;
    this.chromeDirty = true;
  }

  /* ── Views ──────────────────────────────────────────────────────────── */

  get view(): YardView {
    return this.currentView;
  }

  /** Shows one drawing of the yard and hides the other. */
  setView(view: YardView): void {
    if (this.currentView === view) return;
    this.currentView = view;
    const iso = view === YardView.ISO;
    for (const layer of [
      this.ground.root,
      this.isoDecals,
      this.buildings.shadows,
      this.mushroomLayer,
      this.buildings.tops,
      this.buildings.markers,
      this.jobBars.root,
      this.buildings.labels,
    ]) {
      layer.visible = iso;
    }
    this.blueprint.setActive(!iso);
    this.chromeDirty = true;
    if (this.plannerVisuals) this.setPlannerVisuals(this.plannerVisuals);
  }

  /**
   * Tells the views the camera's zoom.
   *
   * The blueprint cares because its tile labels are 11 px of text drawn in
   * yard units, so past a certain zoom out they are noise rather than writing.
   * The isometric yard sizes nothing by zoom. The decals care because a
   * fixed-size mark — the planner's centre crosshair — has to hold its size on
   * screen rather than shrink with the yard.
   */
  setZoom(zoom: number): void {
    this.zoomLevel = zoom;
    this.blueprint.setZoom(zoom);
    this.jobBars.setZoom(zoom);
    this.zoomWatcher?.(zoom);
  }

  /**
   * Draws a progress bar with the time left over every building with a build
   * or upgrade running, counted against `clock` (server unix seconds), or
   * stops drawing them when passed null (#139). The yard scene passes its
   * store's clock on the player's own yard; a visit and an attack never call
   * this, and a foreign yard gets no bars regardless.
   */
  setJobClock(clock: (() => number) | null): void {
    this.jobBars.setClock(clock);
  }

  /** The ids of the buildings showing a progress bar, in drawing order. */
  get jobBarIds(): number[] {
    return this.jobBars.ids;
  }

  /** The camera's zoom, as the scene last reported it. */
  get zoom(): number {
    return this.zoomLevel;
  }

  /**
   * Asks to be told when the zoom changes, or stops asking when passed null.
   *
   * One watcher, because there is one thing in the decals that needs it and a
   * list would outlive its only member. The planner registers on the way in
   * and clears it on the way out.
   */
  watchZoom(watcher: ((zoom: number) => void) | null): void {
    this.zoomWatcher = watcher;
    if (watcher) watcher(this.zoomLevel);
  }

  /** The world extent of the active view, for the camera's clamp. */
  worldSize(): { width: number; height: number } {
    if (this.currentView === YardView.BLUEPRINT) return this.blueprint.worldSize();
    const bounds = this.yard?.bounds;
    return { width: bounds?.width ?? 1, height: bounds?.height ?? 1 };
  }

  /** The world rectangle "zoom to fit" should frame in the active view. */
  fitRect(): Rect {
    if (this.currentView === YardView.BLUEPRINT) return this.blueprint.fitRect();
    const bounds = this.yard?.bounds;
    if (!bounds) return { x: 0, y: 0, width: 1, height: 1 };
    // The plot plus its headroom; a foreign yard's wider world stays pannable
    // but is not what "fit" shows.
    return yardFitRect(bounds);
  }

  /** Yard units to world pixels in the active view. */
  yardToWorld(x: number, y: number): Point {
    if (this.currentView === YardView.BLUEPRINT) return blueprintToWorld(x, y);
    const bounds = this.yard?.bounds;
    if (!bounds) return { x, y };
    return yardToWorld(bounds, x, y);
  }

  /** World pixels in the active view to yard units. */
  worldToYard(worldX: number, worldY: number): Point {
    if (this.currentView === YardView.BLUEPRINT) return blueprintToYard(worldX, worldY);
    const bounds = this.yard?.bounds;
    if (!bounds) return { x: worldX, y: worldY };
    return fromIso(worldX - bounds.originX, worldY - bounds.originY);
  }

  /** The plot outline in the active view, in world pixels. */
  plotCorners(): Corners {
    if (this.currentView === YardView.BLUEPRINT) return this.blueprint.plotCorners();
    return (this.yard?.bounds.corners ?? []).map((point) => [point.x, point.y] as const);
  }

  /* ── Planner ────────────────────────────────────────────────────────── */

  /**
   * Shows the planner's chrome, or hides it when passed null.
   *
   * The planner never owns sprites of its own: it moves the buildings that are
   * already on screen and draws its outlines over them, so entering and leaving
   * it costs one `Graphics` rather than a second copy of the yard.
   *
   * Called once per change, including once per pointer move during a drag —
   * never per frame, because an idle selection has nothing to redraw.
   */
  setPlannerVisuals(visuals: PlannerVisuals | null): void {
    this.plannerVisuals = visuals;
    this.chromeDirty = true;
    if (!visuals) {
      this.planner.clear();
      this.blueprint.setPlanned(null);
      return;
    }
    // The badge has two halves: the chevron the overlay draws over either view,
    // and the "3→5" the blueprint writes on the tile it already levels.
    this.blueprint.setPlanned(visuals.planned);
    this.planner.draw(visuals, (id) => this.cornersOf(id));
  }

  /**
   * Draws a building at a yard position, in both views at once.
   *
   * Keeping the hidden view in step is a container move and an offset write,
   * so switching views mid-plan needs no catch-up pass.
   */
  placeBuilding(id: number, x: number, y: number): void {
    const building = this.byId.get(id);
    if (!building) return;
    const from = toIso(building.x, building.y);
    const to = toIso(x, y);
    this.buildings.offsetBuilding(id, to.x - from.x, to.y - from.y);
    this.blueprint.place(id, x, y);
    this.jobBars.reposition();
  }

  /**
   * Shows or hides one building in both views, for the planner's drawer.
   *
   * A stored building is drawn nowhere and cannot be picked, in the isometric
   * yard and on the blueprint alike, but it keeps its sprites: clearing a
   * 575-building yard and undoing it has to be two flag sweeps rather than two
   * rebuilds of the draw list.
   */
  setBuildingStored(id: number, stored: boolean): void {
    if (stored) this.stored.add(id);
    else this.stored.delete(id);
    this.applyHidden(id);
  }

  /**
   * Hides a building from the viewer altogether, or shows it again: an enemy
   * trap that has not fired (issue #66).
   *
   * Hidden the same way a stored building is — drawn in neither view, never
   * picked, no corners — so the minimap and the outlines forget it too. A
   * building both stored and concealed stays hidden until both are lifted.
   */
  setConcealed(id: number, concealed: boolean): void {
    if (concealed) this.concealed.add(id);
    else this.concealed.delete(id);
    this.applyHidden(id);
  }

  /** Whether a building is concealed from the viewer. */
  isConcealed(id: number): boolean {
    return this.concealed.has(id);
  }

  private applyHidden(id: number): void {
    const hidden = this.stored.has(id) || this.concealed.has(id);
    this.buildings.setHidden(id, hidden);
    this.blueprint.setHidden(id, hidden);
    this.jobBars.reposition();
  }

  /** Re-stacks the isometric draw list after a planner move is committed. */
  resortByDepth(): void {
    this.buildings.resortByDepth();
  }

  /* ── A live battle ──────────────────────────────────────────────────── */

  /**
   * The isometric building container with depth sorting switched on, for a
   * battle layer that wants its creeps interleaved with the buildings
   * (issue #32, WP5).
   *
   * Every building's `zIndex` is `depth * 8` (see `YardBuildings.resortByDepth`)
   * and its animation layers sit at the next few keys; a caller adds children
   * of its own and gives each a `zIndex` from `depthKey` of its ground point.
   * Pixi re-sorts the container on the frames a `zIndex` changes. The caller
   * owns what it adds and must remove it before the yard is torn down.
   * The read-only yard never asks for this, so its draw order is unchanged.
   */
  depthSortedLayer(): Container {
    this.buildings.resortByDepth();
    return this.buildings.tops;
  }

  /**
   * The container every building's shadow is drawn in, beneath all the
   * buildings, for a battle layer's flyer shadows (issue #78). Flash draws
   * both at `MAP.DEPTH_SHADOW`, so a wall block stands over a flyer's shadow.
   * The same ownership rule as `depthSortedLayer` applies.
   */
  groundShadowLayer(): Container {
    return this.buildings.shadows;
  }

  /**
   * Draws a building as battered as `fraction` of its health says, 1 being
   * untouched and 0 a ruin; see `YardBuildings.setDamage`.
   */
  setBuildingDamage(id: number, fraction: number): void {
    this.buildings.setDamage(id, fraction);
  }

  /**
   * Puts one of a building's animation layers on a cell: a tower's gun turned
   * toward its target (issue #67); see `YardBuildings.setAnimFrame`.
   */
  setAnimFrame(id: number, layerIndex: number, frame: number): void {
    this.buildings.setAnimFrame(id, layerIndex, frame);
  }

  /** Puts every building back where the save had it, in both views. */
  resetPlacements(): void {
    for (const id of this.byId.keys()) this.buildings.offsetBuilding(id, 0, 0);
    // Leaving the planner puts back what its drawer was holding: nothing the
    // player stored was ever applied, so the yard still has all of it.
    this.buildings.showAll();
    this.stored.clear();
    this.blueprint.reset();
    // What the viewer must not see stays unseen through the planner's exit.
    for (const id of this.concealed) this.applyHidden(id);
    this.buildings.resortByDepth();
    this.jobBars.reposition();
  }

  /** A building's footprint corners where it is drawn now, in the active view. */
  cornersOf(id: number): Corners | null {
    if (this.stored.has(id) || this.concealed.has(id)) return null;
    if (this.currentView === YardView.BLUEPRINT) return this.blueprint.cornersOf(id);
    const shape = this.isoShapeOf(id);
    return shape ? diamondCorners(shape) : null;
  }

  /** The middle of a building's footprint where it is drawn now. */
  centreOf(id: number): Point | null {
    if (this.stored.has(id) || this.concealed.has(id)) return null;
    if (this.currentView === YardView.BLUEPRINT) return this.blueprint.centreOf(id);
    const shape = this.isoShapeOf(id);
    if (!shape) return null;
    return {
      x: shape.x + (shape.width - shape.height) / 2,
      y: shape.y + (shape.width + shape.height) / 4,
    };
  }

  /** The yard currently on screen. */
  get shown(): Yard | null {
    return this.yard;
  }

  /** The building under a world point in the active view, or null. */
  pick(worldX: number, worldY: number): YardBuilding | null {
    if (this.currentView === YardView.BLUEPRINT) return this.blueprint.pick(worldX, worldY);
    return this.buildings.pick(worldX, worldY);
  }

  /** The mushroom under a world point in the isometric yard, or null. */
  pickMushroom(worldX: number, worldY: number): YardMushroom | null {
    if (this.currentView !== YardView.ISO || !this.yard) return null;
    return mushroomAt(this.yard.mushrooms, worldX, worldY);
  }

  /** Starts or stops a mushroom's pick shake. Stopping puts it back where it stood. */
  shakeMushroom(spot: Pick<YardMushroom, "x" | "y">, on: boolean): void {
    const key = mushroomKey(spot);
    if (on) {
      this.shaking.add(key);
      return;
    }
    this.shaking.delete(key);
    const sprite = this.mushroomSprites.get(key);
    const mushroom = this.yard?.mushrooms.find((one) => mushroomKey(one) === key);
    if (sprite && mushroom) sprite.position.set(mushroom.worldX, mushroom.worldY);
  }

  destroy(): void {
    this.clearMushrooms();
    this.planner.destroy();
    this.jobBars.destroy();
    this.blueprint.destroy();
    this.byId.clear();
    this.yard = null;
    this.buildings.destroy();
    this.atlas?.destroy();
    this.atlas = null;
    this.ground.destroy();
    this.root.destroy({ children: true });
  }

  /** Where a building's progress bar goes: over its middle, at the top of its art. */
  private jobBarAnchor(id: number): Point | null {
    if (this.stored.has(id) || this.concealed.has(id)) return null;
    const building = this.byId.get(id);
    const crown = this.buildings.crownOf(id);
    if (!building || crown === null) return null;
    return { x: building.centreX + this.buildings.offsetOf(id).x, y: crown };
  }

  /** The isometric footprint diamond where a building is currently drawn. */
  private isoShapeOf(id: number): Diamond | null {
    const building = this.byId.get(id);
    if (!building) return null;
    const offset = this.buildings.offsetOf(id);
    const [width, height] = building.footprint;
    return { x: building.worldX + offset.x, y: building.worldY + offset.y, width, height };
  }

  private drawChrome(): void {
    this.chrome.clear();

    // The hover outline is suppressed on the selected building, so the two do
    // not stack into a brighter, heavier shape than either on its own.
    if (this.hovered && this.hovered.id !== this.selected?.id) {
      const corners = this.cornersOf(this.hovered.id);
      if (corners) {
        this.chrome
          .poly(flatten(corners))
          .fill({ color: 0xffffff, alpha: 0.12 })
          .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
      }
    }

    if (this.selected && !this.plannerVisuals) {
      const corners = this.cornersOf(this.selected.id);
      if (corners) {
        this.chrome
          .poly(flatten(corners))
          .fill({ color: 0x7ec8ff, alpha: 0.16 })
          .stroke({ width: 3, color: 0x7ec8ff, alpha: 0.95 });
      }
    }
  }

  private clearMushrooms(): void {
    for (const child of this.mushroomLayer.removeChildren()) child.destroy();
    this.mushroomSprites.clear();
  }

  /**
   * One frame of every pick shake: the mushroom jumps up to 2 px from where
   * it stands, as `BMUSHROOM.HasWorker` jittered it (`client/scripts/BMUSHROOM.as:76-81`).
   * A shaking mushroom a redraw removed is simply not found.
   */
  private shakeMushrooms(): void {
    if (this.shaking.size === 0 || !this.yard) return;
    for (const mushroom of this.yard.mushrooms) {
      const key = mushroomKey(mushroom);
      if (!this.shaking.has(key)) continue;
      this.mushroomSprites
        .get(key)
        ?.position.set(
          mushroom.worldX - 2 + Math.random() * 4,
          mushroom.worldY - 2 + Math.random() * 4,
        );
    }
  }

  /* ── A live battle: hit flash (#63) ─────────────────────────────────── */

  /** Lights a building up for the frames after a monster strikes it; see `YardBuildings.setFlash`. */
  flashBuilding(id: number, on: boolean): void {
    this.buildings.setFlash(id, on);
  }

  /**
   * Lights a building up, or puts it back, for the drop an armed bomb or the
   * bucket would make (#88); see `YardBuildings.setHighlight`. The isometric
   * view only: the blueprint has no building art to light.
   */
  highlightBuilding(id: number, on: boolean): void {
    this.buildings.setHighlight(id, on);
  }
}

/** Corners as the flat point list `Graphics.poly` wants. */
const flatten = (corners: Corners): number[] => corners.flatMap(([x, y]) => [x, y]);
