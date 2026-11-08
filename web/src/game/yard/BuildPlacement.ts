import { AlphaFilter, Assets, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Camera } from "@/game/Camera";
import { cellTexture } from "@/game/textureLimit";
import { versionedArt } from "./retryLoad";
import { ArtState, resolveArt, restingLayers, type ResolvedImage } from "./buildingArt";
import type { YardKind } from "./buildingCostData";
import { nearbyArea, NEARBY_STROKE } from "./nearbyFootprints";
import {
  inBounds,
  Occupancy,
  plotBounds,
  snap,
  type PlanNode,
  type PlotBounds,
} from "./planner/placement";
import { footprintCorners, footprintOf, type Point } from "./YardGrid";
import type { Yard, YardBuilding } from "./yardModel";
import type { UpgradeCost } from "@/api/types";
import { planLine, polylinePath, snapAnchor, type LineBudget, type LinePlan } from "./wallLine";

/**
 * Putting a new building down (`docs/design/yard-buildings.md` §5.3): the
 * build menu hands over a type, and the building follows the pointer until the
 * player clicks a spot.
 *
 * The rules are the planner's, not a copy of them: the same 5-unit occupancy
 * bitmap and plot bounds (`planner/placement.ts`) that Apply is measured by,
 * with every building stamped in. The server checks the same rectangles again
 * (`server/src/services/yard/build.ts`), so a spot drawn green here is a spot
 * the build route accepts. Mushrooms are not stamped: they never block (#263);
 * the server moves one the new building lands on, and it pops up elsewhere.
 *
 * The carry is the planner's too: click to drop, a refused drop stays in hand,
 * Escape cancels. On a touch screen there is no hover to follow, so a tap only
 * moves the building to the spot, and the bar's Build here drops it
 * ({@link BuildPlacement.dropHere}, #157). A wall or trap
 * stays in hand after it lands, so a line of walls is one click per block
 * (§5.3); anything else is done after one, and it stays where it was
 * clicked, drawn as built, while the server answers rather than flashing red
 * on its own spot (#277). While it is in hand, whatever
 * stands near it is outlined faintly to line it up by (#231,
 * `nearbyFootprints.ts`).
 *
 * {@link PlacementGrid} is the arithmetic, testable without Pixi or a DOM;
 * {@link BuildPlacement} is the pointer handling and the ghost on the canvas.
 */

/** Pointer travel, in CSS pixels, above which a press is a pan rather than a click (as `YardInput`). */
const DRAG_SLOP = 6;

/**
 * The grid's own ids. A building is stamped under its own id; drops still
 * waiting for an answer get a range no building reaches, so a collision can
 * say which it was.
 */
const PENDING_ID_BASE = 1_500_000_000;

/** Why a spot is refused. */
export type SpotProblem = "outOfBounds" | "overlap";

/** A spot, and whether the building can go there. */
export interface SpotCheck {
  readonly x: number;
  readonly y: number;
  readonly problem: SpotProblem | null;
  /** With `overlap`, the building in the way. */
  readonly blockedBy: number | null;
}

/** A footprint standing near the spot in hand, for its outline (#231). */
export interface NearbyFootprint {
  readonly type: number;
  readonly x: number;
  readonly y: number;
}

/** A footprint as the occupancy grid takes one. */
const nodeOf = (id: number, type: number, x: number, y: number, kind: YardKind = "main"): PlanNode => {
  const [width, height] = footprintOf(type, kind);
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    level: 1,
    fort: 0,
    decoration: false,
    fixed: false,
    stored: false,
    busy: false,
    damaged: false,
  };
};

/**
 * The yard as the placement sees it: every footprint stamped into one
 * occupancy grid, plus the drops still waiting for the server's
 * answer, so two quick clicks on one spot are refused here rather than there.
 */
export class PlacementGrid {
  private readonly occupancy = new Occupancy();
  private plot: PlotBounds = plotBounds(0);
  private readonly pending = new Map<number, PlanNode>();
  private nextPending = PENDING_ID_BASE;
  private yard: Yard | null = null;
  /** The yard's props table, for the footprints that differ in the Inferno. */
  private kind: YardKind = "main";
  private byId = new Map<number, YardBuilding>();
  private changes = 0;

  constructor(yard: Yard) {
    this.rebase(yard);
  }

  /**
   * Goes up whenever what is stamped in changes: a rebase, a hold, a release.
   * The nearby outlines are redrawn when it or the spot does, and not otherwise.
   */
  get version(): number {
    return this.changes;
  }

  /** Restamps from a yard the server has just answered with. Pending drops stay. */
  rebase(yard: Yard): void {
    this.yard = yard;
    this.kind = yard.kind;
    this.changes++;
    this.plot = plotBounds(yard.expansionLevel);
    this.occupancy.clear();
    this.byId = new Map(yard.buildings.map((building) => [building.id, building]));
    for (const building of yard.buildings) {
      this.occupancy.stamp(nodeOf(building.id, building.type, building.x, building.y, this.kind));
    }
    for (const node of this.pending.values()) this.occupancy.stamp(node);
  }

  /**
   * The spot for a building of `type` with the pointer at `(x, y)` yard
   * units: the footprint centred on the pointer and snapped to the 5-unit grid.
   */
  spotAt(type: number, x: number, y: number): Point {
    const [width, height] = footprintOf(type, this.kind);
    return { x: snap(x - width / 2), y: snap(y - height / 2) };
  }

  /** Whether a building of `type` fits with its footprint's origin at `(x, y)`. */
  check(type: number, x: number, y: number): SpotCheck {
    const node = nodeOf(0, type, x, y, this.kind);
    if (!inBounds(node, x, y, this.plot)) {
      return { x, y, problem: "outOfBounds", blockedBy: null };
    }
    const other = this.occupancy.blockedBy(node, x, y);
    if (other === null) return { x, y, problem: null, blockedBy: null };
    if (other >= PENDING_ID_BASE) return { x, y, problem: "overlap", blockedBy: null };
    return { x, y, problem: "overlap", blockedBy: other };
  }

  /** The name of the building a spot collides with, for the hint. */
  nameOf(id: number): string | null {
    return this.byId.get(id)?.name ?? null;
  }

  /**
   * What stands near a building of `type` at `(x, y)` (#231): every building,
   * wall, trap and decoration with a cell inside its {@link nearbyArea}, and
   * the drops still waiting for an answer, so a wall just put down is
   * outlined before the server has said so. Mushrooms are not in the grid at
   * all (#263).
   */
  nearby(type: number, x: number, y: number): NearbyFootprint[] {
    const [width, height] = footprintOf(type, this.kind);
    const found: NearbyFootprint[] = [];
    for (const id of this.occupancy.occupantsIn([nearbyArea(x, y, width, height)])) {
      if (id >= PENDING_ID_BASE) {
        const node = this.pending.get(id);
        if (node) found.push({ type: node.type, x: node.x, y: node.y });
        continue;
      }
      const building = this.byId.get(id);
      if (building) found.push({ type: building.type, x: building.x, y: building.y });
    }
    return found;
  }

  /** Holds a spot for a drop the server has not answered yet. Returns its handle. */
  hold(type: number, x: number, y: number): number {
    const handle = this.nextPending++;
    const node = nodeOf(handle, type, x, y, this.kind);
    this.pending.set(handle, node);
    this.occupancy.stamp(node);
    this.changes++;
    return handle;
  }

  /** Lets a held spot go once its answer is in (the next `rebase` has the real building). */
  release(handle: number): void {
    const node = this.pending.get(handle);
    if (!node) return;
    this.pending.delete(handle);
    this.occupancy.erase(node);
    // Erasing may have cleared cells a real building shares; put them back.
    if (this.yard) this.rebase(this.yard);
  }
}

/** Whether a yard point lies inside a building's footprint placed at `spot`. */
export const insideFootprint = (
  type: number,
  spot: Point,
  point: Point,
  kind: YardKind = "main",
): boolean => {
  const [width, height] = footprintOf(type, kind);
  return point.x >= spot.x && point.x < spot.x + width && point.y >= spot.y && point.y < spot.y + height;
};

/** What a drop came to, as the placement's owner reports it. */
export type DropOutcome = "placed" | "refused";

/** Where a drawn wall line stands, for the bar. */
export interface LineStage {
  /** No corner yet: the next click or tap picks the first Block. */
  readonly empty: boolean;
  /** How many corners are down (↶ takes the last one away). */
  readonly anchors: number;
  /** ✓ was pressed and the server has not answered yet. */
  readonly busy: boolean;
}

/**
 * Line mode for wall Blocks (walls Option B, owner 8 Nov 2026; the maths is
 * `wallLine.ts`). Given only to a wall placement. A click or tap puts a
 * corner down and a drag pans, on a mouse and a finger alike; with a mouse
 * the next stretch follows the pointer, a double-click ends the line, and
 * Backspace or a right-click takes the last corner away.
 */
export interface LineModeOptions {
  /** On when the placement starts. */
  readonly on: boolean;
  /** Blocks the resources pay for and the hall still allows, read fresh for every preview. */
  readonly budget: () => LineBudget;
  /** One Block's price. */
  readonly unitCost: UpgradeCost;
  /** The preview changed: the plan (null with no line) and its stage. */
  readonly onPlan: (plan: LinePlan | null, stage: LineStage) => void;
  /**
   * ✓: builds the green Blocks, in order. Resolves once the server answered:
   * `placed` clears the line, `refused` keeps it on screen to try again.
   */
  readonly onBuild: (cells: readonly Point[]) => Promise<DropOutcome>;
}

export interface BuildPlacementOptions {
  readonly type: number;
  readonly yard: Yard;
  readonly camera: Camera;
  readonly canvas: HTMLCanvasElement;
  /** The renderer's root, which the ghost is drawn in on top of the yard. */
  readonly layer: Container;
  /** World pixels to yard units, in the isometric view. */
  readonly worldToYard: (x: number, y: number) => Point;
  /** Sends the build. Resolves once the server has answered. */
  readonly onDrop: (x: number, y: number) => Promise<DropOutcome>;
  /** The spot under the pointer changed, or a drop was refused locally. */
  readonly onSpot?: (check: SpotCheck | null) => void;
  /** Escape. The owner tears the placement down. */
  readonly onCancel: () => void;
  /**
   * Whether to keep the building in hand after a drop the server accepted.
   * Walls and traps do (§5.3); everything else is placed once.
   */
  readonly repeat: boolean;
  /** After an accepted drop that ends the placement. */
  readonly onDone?: () => void;
  /** A wall's line mode; absent for anything else. */
  readonly line?: LineModeOptions;
}

const VALID = 0x5cc26a;
const INVALID = 0xe05252;
/** A line's Blocks past the resources or the hall's limit. */
const SHORT = 0x9aa0a6;
/** The pictures' fade while the building is in hand. */
const GHOST_ALPHA = 0.7;

export class BuildPlacement {
  readonly grid: PlacementGrid;

  private readonly options: BuildPlacementOptions;
  private readonly ghost = new Container();
  /** The neighbours' outlines (#231), under the ghost's own. */
  private readonly nearby = new Graphics();
  /** The spot and grid version the outlines were last drawn for. */
  private nearbyFor = "";
  private nearbyDrawn: readonly NearbyFootprint[] = [];
  private readonly outline = new Graphics();
  /** The building's pictures, placed from the footprint's top corner. */
  private readonly art = new Container();
  /**
   * Fades the pictures as one, so the base does not show through the gun
   * stacked on it the way a fade per sprite would. Made once the art is in:
   * a filter wants a GPU context, which a placement with no art never needs.
   */
  private fade: AlphaFilter | null = null;
  private artDrawn: readonly ResolvedImage[] = [];
  private yard: Yard;
  private spot: SpotCheck | null = null;
  private pressX = 0;
  private pressY = 0;
  private pressed = false;
  /** Drops sent and not yet answered. */
  private inFlight = 0;
  /**
   * Where the last drop went down, until the building moves off it (#277).
   * The drop holds that spot in the grid, and so does the real building once
   * the answer is in; checked against either, the building in hand would turn
   * red on the very spot it was just put on.
   */
  private landed: Point | null = null;
  /**
   * A one-off building on its way down: it stays where it was clicked, drawn
   * as built, until the server answers (#277). A wall or trap is never pinned,
   * so the next block follows the pointer at once.
   */
  private pinned = false;
  private done = false;

  /* Line mode (walls Option B). */
  private lineOn = false;
  /** The corners clicked or tapped so far, in order, each on the Block its stretch ends on. */
  private lineAnchors: Point[] = [];
  /** The mouse's spot over the yard: the live stretch from the last corner runs to it. */
  private lineHover: Point | null = null;
  /** A double-click ended the line: no live stretch until the next click. */
  private lineFinished = false;
  private lineBusy = false;
  private linePlanNow: LinePlan | null = null;
  /** The line's Blocks: footprints, then pictures, drawn over the yard. */
  private readonly lineLayer = new Container();
  private readonly lineOutlines = new Graphics();
  private readonly linePictures = new Container();
  /** A dot on every corner, over the pictures, so the bends show. */
  private readonly lineMarks = new Graphics();
  /** The loaded picture layers, so every Block of a line can be drawn with them. */
  private artTextures: { texture: Texture; layer: ResolvedImage }[] = [];

  constructor(options: BuildPlacementOptions) {
    this.options = options;
    this.yard = options.yard;
    this.grid = new PlacementGrid(options.yard);

    this.ghost.eventMode = "none";
    this.ghost.addChild(this.nearby, this.outline, this.art);
    this.ghost.visible = false;
    options.layer.addChild(this.ghost);
    this.lineLayer.eventMode = "none";
    this.lineLayer.addChild(this.lineOutlines, this.linePictures, this.lineMarks);
    options.layer.addChild(this.lineLayer);
    void this.loadArt();

    const canvas = options.canvas;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("dblclick", this.onDoubleClick);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    if (options.line?.on) this.setLineMode(true);
  }

  get type(): number {
    return this.options.type;
  }

  /** The spot the building is showing at, or null before the pointer has been over the yard. */
  get current(): SpotCheck | null {
    return this.spot;
  }

  /** The yard changed under the placement (the server answered): restamp and recheck. */
  rebase(yard: Yard): void {
    this.yard = yard;
    this.grid.rebase(yard);
    if (this.spot) this.show(this.spot.x, this.spot.y);
    // The resources and the wall count moved too: the greens are guessed again.
    if (this.lineOn && !this.lineBusy) this.updateLine();
  }

  /** Puts the building at a spot directly (the keyboard, a test, a centred start). */
  moveTo(x: number, y: number): void {
    if (this.pinned) return;
    this.show(x, y);
  }

  /** Drops the building where it is showing now, as a click there would. */
  dropHere(): void {
    if (this.lineOn) return;
    if (this.spot) void this.drop(this.spot);
  }

  destroy(): void {
    if (this.done) return;
    this.done = true;
    const canvas = this.options.canvas;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("dblclick", this.onDoubleClick);
    canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    // The renderer's own teardown may already have destroyed the layer.
    if (!this.ghost.destroyed) this.ghost.destroy({ children: true });
    if (!this.lineLayer.destroyed) this.lineLayer.destroy({ children: true });
    this.fade?.destroy();
  }

  /* ── Line mode ──────────────────────────────────────────────────────── */

  /** Whether a wall line is drawn rather than one Block per click. */
  get lineMode(): boolean {
    return this.lineOn;
  }

  /** The line's preview now, or null with no line. */
  get linePlan(): LinePlan | null {
    return this.linePlanNow;
  }

  /**
   * Turns line mode on or off (the bar's Line toggle). Any line half drawn
   * goes. Either way a drag pans the yard; with it on, a click or tap puts
   * down a corner.
   */
  setLineMode(on: boolean): void {
    if (!this.options.line || this.done) return;
    this.lineOn = on;
    this.clearLine();
  }

  /** Lets the line go (✗, Escape); the Block in hand stays. */
  clearLine(): void {
    if (this.lineBusy) return;
    this.lineAnchors = [];
    this.lineHover = null;
    this.lineFinished = false;
    this.updateLine();
  }

  /** The corners put down so far. */
  get anchors(): readonly Point[] {
    return this.lineAnchors;
  }

  /**
   * Puts a corner down at a spot, as a click or tap there does: the first is
   * the start; each later one fixes the stretch from the corner before it.
   * The corner is kept on the Block that stretch really ends on, so the next
   * one starts there. A click on the last corner again adds nothing.
   */
  lineTap(x: number, y: number): void {
    if (!this.lineOn || this.lineBusy || this.done) return;
    const last = this.lineAnchors[this.lineAnchors.length - 1];
    const [width] = footprintOf(this.options.type, this.yard.kind);
    const anchor = last ? snapAnchor(last, { x, y }, width) : { x, y };
    this.lineFinished = false;
    if (!last || last.x !== anchor.x || last.y !== anchor.y) this.lineAnchors.push(anchor);
    this.updateLine();
  }

  /** Takes the last corner away (↶, Backspace, a right-click). */
  undoAnchor(): void {
    if (!this.lineOn || this.lineBusy || this.lineAnchors.length === 0) return;
    this.lineAnchors.pop();
    this.lineFinished = false;
    this.updateLine();
  }

  /** A double-click: the last corner ends the line; the live stretch stops following the mouse until the next click. */
  finishLine(): void {
    if (!this.lineOn || this.lineBusy || this.lineAnchors.length === 0) return;
    this.lineFinished = true;
    this.updateLine();
  }

  /** ✓: builds the green Blocks between the corners put down (never the live stretch to the mouse). */
  async confirmLine(): Promise<void> {
    const line = this.options.line;
    if (!line || this.lineBusy || this.done) return;
    const plan = this.planFor(false);
    if (!plan || plan.build.length === 0) return;
    this.lineBusy = true;
    this.lineHover = null;
    // What is on screen is what is built.
    this.linePlanNow = plan;
    this.drawLine(plan);
    const holds = plan.build.map((cell) => this.grid.hold(this.options.type, cell.x, cell.y));
    this.reportLine();
    const outcome = await line.onBuild(plan.build);
    if (this.done) return;
    for (const handle of holds) this.grid.release(handle);
    this.lineBusy = false;
    if (outcome === "placed") {
      this.lineAnchors = [];
      this.lineFinished = false;
    }
    this.updateLine();
  }

  /** The stage of the line, for the bar. */
  private get lineStage(): LineStage {
    return { empty: this.lineAnchors.length === 0, anchors: this.lineAnchors.length, busy: this.lineBusy };
  }

  private reportLine(): void {
    this.options.line?.onPlan(this.linePlanNow, this.lineStage);
  }

  /** The plan through the corners, with the live stretch to the mouse when `live`; null with no corner. */
  private planFor(live: boolean): LinePlan | null {
    const line = this.options.line;
    if (!line || !this.lineOn || this.lineAnchors.length === 0) return null;
    const [width] = footprintOf(this.options.type, this.yard.kind);
    const tail = live && !this.lineFinished ? this.lineHover : null;
    const path = polylinePath(this.lineAnchors, width, tail);
    return planLine(path, (x, y) => this.grid.check(this.options.type, x, y), line.budget(), line.unitCost);
  }

  /** Works the line out again from its corners, draws it and tells the bar. */
  private updateLine(): void {
    const line = this.options.line;
    if (!line || this.done) return;
    const plan = this.planFor(true);
    this.linePlanNow = plan;
    if (!plan) {
      this.lineOutlines.clear();
      this.lineMarks.clear();
      this.linePictures.removeChildren().forEach((child) => child.destroy({ children: true }));
      // The one Block in hand shows again where the next press goes.
      if (this.spot && !this.done) this.draw(this.spot);
      this.reportLine();
      return;
    }
    this.ghost.visible = false;
    this.drawLine(plan);
    this.reportLine();
  }

  private drawLine(plan: LinePlan): void {
    const g = this.lineOutlines;
    g.clear();
    this.linePictures.removeChildren().forEach((child) => child.destroy({ children: true }));
    // Back to front, so a nearer Block's picture covers the one behind it.
    const ordered = [...plan.cells].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const cell of ordered) {
      const corners = footprintCorners(this.yard.bounds, this.options.type, cell.x, cell.y, this.yard.kind);
      const [top, right, bottom, left] = corners;
      const colour = cell.state === "build" ? VALID : cell.state === "blocked" ? INVALID : SHORT;
      g.poly(corners.flatMap((point) => [point.x, point.y]))
        .fill({ color: colour, alpha: cell.state === "short" ? 0.22 : 0.3 })
        .stroke({ width: cell.state === "blocked" ? 3 : 2, color: colour, alpha: 0.95 });
      // A skipped Block is crossed out as well as red: colour is never the only channel.
      if (cell.state === "blocked" && top && right && bottom && left) {
        g.moveTo(top.x, top.y)
          .lineTo(bottom.x, bottom.y)
          .moveTo(left.x, left.y)
          .lineTo(right.x, right.y)
          .stroke({ width: 3, color: INVALID, alpha: 0.95 });
      }
      if (cell.state === "blocked" || !top || this.artTextures.length === 0) continue;
      const picture = new Container();
      for (const { texture, layer } of this.artTextures) {
        const sprite = new Sprite(texture);
        sprite.position.set(layer.x, layer.y);
        picture.addChild(sprite);
      }
      picture.position.set(top.x, top.y);
      // A grey Block is a faint, greyed picture: there, but not built.
      picture.alpha = cell.state === "build" ? GHOST_ALPHA : 0.35;
      if (cell.state === "short") for (const child of picture.children) (child as Sprite).tint = 0x808080;
      this.linePictures.addChild(picture);
    }
    // A dot on every corner, over the pictures, so the bends read at a glance.
    const marks = this.lineMarks;
    marks.clear();
    for (const anchor of this.lineAnchors) {
      const corners = footprintCorners(this.yard.bounds, this.options.type, anchor.x, anchor.y, this.yard.kind);
      if (corners.length === 0) continue;
      const cx = corners.reduce((sum, point) => sum + point.x, 0) / corners.length;
      const cy = corners.reduce((sum, point) => sum + point.y, 0) / corners.length;
      marks.circle(cx, cy, 5).fill({ color: 0xffffff, alpha: 0.95 }).stroke({ width: 2, color: 0x1d252d, alpha: 0.9 });
    }
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  /**
   * The building as it stands at rest: its top and the first cell of every
   * animation strip, each at its own offset (#256). The top alone left a
   * Sniper Tower without its rifle and a Railgun without its gun.
   */
  private async loadArt(): Promise<void> {
    const art = resolveArt(this.options.type, 1, ArtState.DEFAULT, this.yard.kind);
    if (!art) return;
    const layers = restingLayers(art);
    try {
      const textures = await Promise.all(
        layers.map((layer) => Assets.load<Texture>(versionedArt(layer.url))),
      );
      if (this.done) return;
      layers.forEach((layer, index) => {
        const texture = textures[index];
        if (!texture) return;
        const frame = layer.frame;
        // A strip bigger than the graphics card holds is cut (`cellTexture`), not drawn black.
        const shown = frame
          ? cellTexture(texture.source, { x: 0, y: 0, width: frame.width, height: frame.height }).texture
          : texture;
        const sprite = new Sprite(shown);
        sprite.position.set(layer.x, layer.y);
        this.art.addChild(sprite);
        this.artTextures.push({ texture: shown, layer });
      });
      this.fade = new AlphaFilter({
        alpha: this.pinned ? 1 : GHOST_ALPHA,
        resolution: "inherit",
      });
      this.art.filters = [this.fade];
      this.artDrawn = layers;
      // A line drawn before the pictures came in gets them now.
      if (this.linePlanNow) this.drawLine(this.linePlanNow);
    } catch {
      // No picture: the footprint alone still says where it goes.
    }
  }

  /** Whether a one-off building is on its way down: pinned where it was clicked, drawn as built. */
  get landing(): boolean {
    return this.pinned;
  }

  /** The pictures the ghost is drawn from, bottom to top; empty until they load. */
  get artShown(): readonly ResolvedImage[] {
    return this.artDrawn;
  }

  private show(x: number, y: number): void {
    if (this.done) return;
    if (this.landed && (this.landed.x !== x || this.landed.y !== y)) this.landed = null;
    // The spot just dropped on is fine: what fills it now is the drop itself.
    const check: SpotCheck = this.landed
      ? { x, y, problem: null, blockedBy: null }
      : this.grid.check(this.options.type, x, y);
    const changed =
      this.spot?.x !== check.x || this.spot?.y !== check.y || this.spot?.problem !== check.problem;
    this.spot = check;
    this.draw(check);
    if (changed) this.options.onSpot?.(check);
  }

  private draw(check: SpotCheck): void {
    // On its way down it is drawn as built: no footprint, no outlines, no fade.
    this.outline.visible = !this.pinned;
    this.nearby.visible = !this.pinned;
    if (this.fade) this.fade.alpha = this.pinned ? 1 : GHOST_ALPHA;
    this.drawNearby(check.x, check.y);
    const corners = footprintCorners(this.yard.bounds, this.options.type, check.x, check.y, this.yard.kind);
    const [top, right, bottom, left] = corners;
    const g = this.outline;
    g.clear();
    const colour = check.problem ? INVALID : VALID;
    g.poly(corners.flatMap((point) => [point.x, point.y]))
      .fill({ color: colour, alpha: 0.3 })
      .stroke({ width: check.problem ? 3 : 2, color: colour, alpha: 0.95 });
    // A refused spot is crossed out as well as red: colour is never the only channel.
    if (check.problem && top && right && bottom && left) {
      g.moveTo(top.x, top.y)
        .lineTo(bottom.x, bottom.y)
        .moveTo(left.x, left.y)
        .lineTo(right.x, right.y)
        .stroke({ width: 3, color: INVALID, alpha: 0.95 });
    }
    if (top) this.art.position.set(top.x, top.y);
    this.art.tint = check.problem ? 0xffb0b0 : 0xffffff;
    // A drawn line shows its own Blocks in place of the one in hand.
    this.ghost.visible = !(this.lineOn && this.lineAnchors.length > 0);
  }

  /**
   * Outlines what stands near the spot (#231). Only when the spot has moved
   * to another grid square or the grid has changed under it: a pointer
   * wandering inside one square redraws nothing.
   */
  private drawNearby(x: number, y: number): void {
    const key = `${x},${y},${this.grid.version}`;
    if (key === this.nearbyFor) return;
    this.nearbyFor = key;

    const g = this.nearby;
    g.clear();
    const found = this.grid.nearby(this.options.type, x, y);
    this.nearbyDrawn = found;
    if (found.length === 0) return;
    // One path and one stroke for the lot, as the planner's overlay does.
    for (const one of found) {
      const corners = footprintCorners(this.yard.bounds, one.type, one.x, one.y, this.yard.kind);
      g.poly(corners.flatMap((point) => [point.x, point.y]));
    }
    g.stroke(NEARBY_STROKE);
  }

  /** What the nearby outlines are drawn round now. A new array only when redrawn. */
  get nearbyShown(): readonly NearbyFootprint[] {
    return this.nearbyDrawn;
  }

  /* ── Input ──────────────────────────────────────────────────────────── */

  private yardPoint(event: { clientX: number; clientY: number }): Point {
    const rect = this.options.canvas.getBoundingClientRect();
    const world = this.options.camera.screenToWorld({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    return this.options.worldToYard(world.x, world.y);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.pressed = true;
    this.pressX = event.clientX;
    this.pressY = event.clientY;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    // A finger dragging is a pan, not a carry; only a mouse or pen hovers.
    if (event.pointerType === "touch" || this.pinned) return;
    const point = this.yardPoint(event);
    const spot = this.grid.spotAt(this.options.type, point.x, point.y);
    if (this.lineOn && this.lineAnchors.length > 0) {
      if (this.lineBusy) return;
      // The live stretch: from the last corner to the mouse, until a double-click ends the line.
      if (this.lineHover?.x !== spot.x || this.lineHover?.y !== spot.y) {
        this.lineHover = spot;
        if (!this.lineFinished) this.updateLine();
      }
      return;
    }
    this.show(spot.x, spot.y);
  };

  /** The mouse left the yard (for the bar's ✓, say): the live stretch goes, so the preview is what ✓ builds. */
  private readonly onPointerLeave = (): void => {
    if (!this.lineOn || this.lineHover === null) return;
    this.lineHover = null;
    if (!this.lineBusy) this.updateLine();
  };

  private readonly onDoubleClick = (): void => {
    if (this.lineOn) this.finishLine();
  };

  /** A right-click takes the last corner away rather than opening the browser's menu. */
  private readonly onContextMenu = (event: Event): void => {
    if (!this.lineOn) return;
    event.preventDefault();
    this.undoAnchor();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.lineOn && this.lineUp(event)) return;
    if (!this.pressed) return;
    this.pressed = false;
    if (this.pinned) return;
    if (Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY) > DRAG_SLOP) return;

    const point = this.yardPoint(event);
    const spot = this.grid.spotAt(this.options.type, point.x, point.y);
    this.show(spot.x, spot.y);
    // A touch only moves it: the bar's Build here puts it down (#157).
    if (event.pointerType === "touch") return;
    if (this.spot) void this.drop(this.spot);
  };

  /**
   * A release with line mode on; never drops a single Block. A click or tap
   * that did not travel puts a corner down; one that travelled was a pan.
   */
  private lineUp(event: PointerEvent): true {
    const pressed = this.pressed;
    this.pressed = false;
    if (!pressed || this.lineBusy) return true;
    if (Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY) > DRAG_SLOP) return true;
    const point = this.yardPoint(event);
    const spot = this.grid.spotAt(this.options.type, point.x, point.y);
    this.lineTap(spot.x, spot.y);
    return true;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" && event.key !== "Backspace") return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (event.key === "Backspace") {
      if (!this.lineOn || this.lineAnchors.length === 0) return;
      event.preventDefault();
      this.undoAnchor();
      return;
    }
    // Nothing to cancel once a one-off building is on its way down.
    if (this.pinned) return;
    // Escape lets a drawn line go first, then the Block in hand.
    if (this.lineOn && this.lineAnchors.length > 0 && !this.lineBusy) {
      this.clearLine();
      return;
    }
    this.options.onCancel();
  };

  private async drop(spot: SpotCheck): Promise<void> {
    if (this.done) return;
    // One building at a time unless it is a wall or trap, whose line is the point.
    if (!this.options.repeat && this.inFlight > 0) return;
    // Refused here: the hint already says why, and the building stays in hand.
    const check = this.grid.check(this.options.type, spot.x, spot.y);
    if (check.problem) {
      // A second click on the spot just built on: now it is plainly taken.
      this.landed = null;
      this.show(spot.x, spot.y);
      this.options.onSpot?.(check);
      return;
    }
    const handle = this.grid.hold(this.options.type, spot.x, spot.y);
    this.inFlight++;
    // It goes down now, not when the server answers (#277): the spot stays
    // green under it, and a one-off building stays put, drawn as built.
    const landed = { x: spot.x, y: spot.y };
    this.landed = landed;
    this.pinned = !this.options.repeat;
    this.show(spot.x, spot.y);
    const outcome = await this.options.onDrop(spot.x, spot.y);
    this.inFlight--;
    if (this.done) return;
    this.grid.release(handle);
    if (outcome === "placed" && !this.options.repeat) {
      this.options.onDone?.();
      return;
    }
    // Refused: back in hand, and the spot is checked again for real.
    this.pinned = false;
    if (outcome === "refused" && this.landed === landed) this.landed = null;
    if (this.spot) this.show(this.spot.x, this.spot.y);
  }
}
