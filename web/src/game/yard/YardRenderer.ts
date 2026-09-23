import { Container, Graphics, Sprite, type Renderer } from "pixi.js";
import { YardBuildings } from "./YardBuildings";
import { YardGround } from "./YardGround";
import { yardArtAtlas, type YardArtAtlas } from "./yardAtlas";
import { BlueprintLayer } from "./planner/BlueprintLayer";
import { blueprintToYard, blueprintToWorld } from "./planner/blueprint";
import { PlannerOverlay, type PlannerVisuals } from "./planner/PlannerOverlay";
import { diamondCorners, type Corners, type Diamond } from "./planner/marquee";
import { fromIso, toIso, yardToWorld, type Point, type Rect } from "./YardGrid";
import type { Yard, YardBuilding } from "./yardModel";

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
  private readonly blueprint = new BlueprintLayer();
  private readonly chrome = new Graphics();
  private readonly planner = new PlannerOverlay();

  private atlas: YardArtAtlas | null = null;
  private yard: Yard | null = null;
  private readonly byId = new Map<number, YardBuilding>();

  private hovered: YardBuilding | null = null;
  private selected: YardBuilding | null = null;
  private chromeDirty = true;
  private plannerVisuals: PlannerVisuals | null = null;
  private currentView: YardView = YardView.ISO;

  constructor() {
    this.mushroomLayer.eventMode = "none";
    this.root.addChild(
      this.ground.root,
      this.buildings.shadows,
      this.mushroomLayer,
      this.buildings.tops,
      this.blueprint.root,
      this.chrome,
      this.planner.root,
      this.buildings.markers,
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
    for (const building of yard.buildings) this.byId.set(building.id, building);

    // The base seed keeps one yard's grass the same between visits.
    this.ground.layout(yard.bounds, yard.savedAt || 1);
    void this.ground.loadTiles();

    this.buildings.show(yard, atlas);
    this.blueprint.show(yard);
    this.blueprint.setActive(this.currentView === YardView.BLUEPRINT);

    for (const mushroom of yard.mushrooms) {
      const sprite = new Sprite(mushroom.golden ? atlas.mushroomGolden : atlas.mushroom);
      sprite.anchor.set(0.5, 0.85);
      sprite.position.set(mushroom.worldX, mushroom.worldY);
      this.mushroomLayer.addChild(sprite);
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
    if (this.currentView === YardView.ISO) this.buildings.draw(visible, deltaSeconds);

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
      this.buildings.shadows,
      this.mushroomLayer,
      this.buildings.tops,
      this.buildings.markers,
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
   * Only the blueprint cares: its tile labels are 11 px of text drawn in yard
   * units, so past a certain zoom out they are noise rather than writing. The
   * isometric yard sizes nothing by zoom, so this is a no-op for it.
   */
  setZoom(zoom: number): void {
    this.blueprint.setZoom(zoom);
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
    const size = this.worldSize();
    return { x: 0, y: 0, width: size.width, height: size.height };
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
      return;
    }
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
  }

  /** Re-stacks the isometric draw list after a planner move is committed. */
  resortByDepth(): void {
    this.buildings.resortByDepth();
  }

  /** Puts every building back where the save had it, in both views. */
  resetPlacements(): void {
    for (const id of this.byId.keys()) this.buildings.offsetBuilding(id, 0, 0);
    this.blueprint.reset();
    this.buildings.resortByDepth();
  }

  /** A building's footprint corners where it is drawn now, in the active view. */
  cornersOf(id: number): Corners | null {
    if (this.currentView === YardView.BLUEPRINT) return this.blueprint.cornersOf(id);
    const shape = this.isoShapeOf(id);
    return shape ? diamondCorners(shape) : null;
  }

  /** The middle of a building's footprint where it is drawn now. */
  centreOf(id: number): Point | null {
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

  destroy(): void {
    this.clearMushrooms();
    this.planner.destroy();
    this.blueprint.destroy();
    this.byId.clear();
    this.yard = null;
    this.buildings.destroy();
    this.atlas?.destroy();
    this.atlas = null;
    this.ground.destroy();
    this.root.destroy({ children: true });
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
  }
}

/** Corners as the flat point list `Graphics.poly` wants. */
const flatten = (corners: Corners): number[] => corners.flatMap(([x, y]) => [x, y]);
