import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import type { Camera } from "@/game/Camera";
import { ArtState, resolveArt } from "./buildingArt";
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

/**
 * Putting a new building down (`docs/design/yard-buildings.md` §5.3): the
 * build menu hands over a type, and the building follows the pointer until the
 * player clicks a spot.
 *
 * The rules are the planner's, not a copy of them: the same 5-unit occupancy
 * bitmap and plot bounds (`planner/placement.ts`) that Apply is measured by,
 * with every building and mushroom stamped in. The server checks the same
 * rectangles again (`server/src/services/yard/build.ts`), so a spot drawn green
 * here is a spot the build route accepts.
 *
 * The carry is the planner's too: click to drop, a refused drop stays in hand,
 * Escape cancels. On a touch screen there is no hover to follow, so a tap only
 * moves the building to the spot, and the bar's Build here drops it
 * ({@link BuildPlacement.dropHere}, #157). A wall or trap
 * stays in hand after it lands, so a line of walls is one click per block
 * (§5.3); anything else is done after one. While it is in hand, whatever
 * stands near it is outlined faintly to line it up by (#231,
 * `nearbyFootprints.ts`).
 *
 * {@link PlacementGrid} is the arithmetic, testable without Pixi or a DOM;
 * {@link BuildPlacement} is the pointer handling and the ghost on the canvas.
 */

/** Pointer travel, in CSS pixels, above which a press is a pan rather than a click (as `YardInput`). */
const DRAG_SLOP = 6;

/**
 * The grid's own ids. A building is stamped under its own id; mushrooms and
 * drops still waiting for an answer get ranges no building reaches, so a
 * collision can say which it was.
 */
const MUSHROOM_ID_BASE = 1_000_000_000;
const PENDING_ID_BASE = 1_500_000_000;

/** Why a spot is refused. */
export type SpotProblem = "outOfBounds" | "overlap" | "mushroom";

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
const nodeOf = (id: number, type: number, x: number, y: number): PlanNode => {
  const [width, height] = footprintOf(type);
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
    plan: null,
    busy: false,
    damaged: false,
  };
};

/**
 * The yard as the placement sees it: every footprint and mushroom stamped
 * into one occupancy grid, plus the drops still waiting for the server's
 * answer, so two quick clicks on one spot are refused here rather than there.
 */
export class PlacementGrid {
  private readonly occupancy = new Occupancy();
  private plot: PlotBounds = plotBounds(0);
  private readonly pending = new Map<number, PlanNode>();
  private nextPending = PENDING_ID_BASE;
  private yard: Yard | null = null;
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
    this.changes++;
    this.plot = plotBounds(yard.expansionLevel);
    this.occupancy.clear();
    this.byId = new Map(yard.buildings.map((building) => [building.id, building]));
    for (const building of yard.buildings) {
      this.occupancy.stamp(nodeOf(building.id, building.type, building.x, building.y));
    }
    yard.mushrooms.forEach((mushroom, index) => {
      this.occupancy.stamp(nodeOf(MUSHROOM_ID_BASE + index, 7, mushroom.x, mushroom.y));
    });
    for (const node of this.pending.values()) this.occupancy.stamp(node);
  }

  /**
   * The spot for a building of `type` with the pointer at `(x, y)` yard
   * units: the footprint centred on the pointer and snapped to the 5-unit grid.
   */
  spotAt(type: number, x: number, y: number): Point {
    const [width, height] = footprintOf(type);
    return { x: snap(x - width / 2), y: snap(y - height / 2) };
  }

  /** Whether a building of `type` fits with its footprint's origin at `(x, y)`. */
  check(type: number, x: number, y: number): SpotCheck {
    const node = nodeOf(0, type, x, y);
    if (!inBounds(node, x, y, this.plot)) {
      return { x, y, problem: "outOfBounds", blockedBy: null };
    }
    const other = this.occupancy.blockedBy(node, x, y);
    if (other === null) return { x, y, problem: null, blockedBy: null };
    if (other >= PENDING_ID_BASE) return { x, y, problem: "overlap", blockedBy: null };
    if (other >= MUSHROOM_ID_BASE) return { x, y, problem: "mushroom", blockedBy: null };
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
   * outlined before the server has said so. Mushrooms are not: they are not
   * on the owner's list, and the planner leaves them out too.
   */
  nearby(type: number, x: number, y: number): NearbyFootprint[] {
    const [width, height] = footprintOf(type);
    const found: NearbyFootprint[] = [];
    for (const id of this.occupancy.occupantsIn([nearbyArea(x, y, width, height)])) {
      if (id >= PENDING_ID_BASE) {
        const node = this.pending.get(id);
        if (node) found.push({ type: node.type, x: node.x, y: node.y });
        continue;
      }
      if (id >= MUSHROOM_ID_BASE) continue;
      const building = this.byId.get(id);
      if (building) found.push({ type: building.type, x: building.x, y: building.y });
    }
    return found;
  }

  /** Holds a spot for a drop the server has not answered yet. Returns its handle. */
  hold(type: number, x: number, y: number): number {
    const handle = this.nextPending++;
    const node = nodeOf(handle, type, x, y);
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
export const insideFootprint = (type: number, spot: Point, point: Point): boolean => {
  const [width, height] = footprintOf(type);
  return point.x >= spot.x && point.x < spot.x + width && point.y >= spot.y && point.y < spot.y + height;
};

/** What a drop came to, as the placement's owner reports it. */
export type DropOutcome = "placed" | "refused";

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
}

const VALID = 0x5cc26a;
const INVALID = 0xe05252;

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
  private readonly art = new Sprite(Texture.EMPTY);
  private artOffset: Point = { x: 0, y: 0 };
  private yard: Yard;
  private spot: SpotCheck | null = null;
  private pressX = 0;
  private pressY = 0;
  private pressed = false;
  /** Drops sent and not yet answered. */
  private inFlight = 0;
  private done = false;

  constructor(options: BuildPlacementOptions) {
    this.options = options;
    this.yard = options.yard;
    this.grid = new PlacementGrid(options.yard);

    this.ghost.eventMode = "none";
    this.art.alpha = 0.7;
    this.ghost.addChild(this.nearby, this.outline, this.art);
    this.ghost.visible = false;
    options.layer.addChild(this.ghost);
    void this.loadArt();

    const canvas = options.canvas;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("keydown", this.onKeyDown);
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
  }

  /** Puts the building at a spot directly (the keyboard, a test, a centred start). */
  moveTo(x: number, y: number): void {
    this.show(x, y);
  }

  /** Drops the building where it is showing now, as a click there would. */
  dropHere(): void {
    if (this.spot) void this.drop(this.spot);
  }

  destroy(): void {
    if (this.done) return;
    this.done = true;
    const canvas = this.options.canvas;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("keydown", this.onKeyDown);
    // The renderer's own teardown may already have destroyed the layer.
    if (!this.ghost.destroyed) this.ghost.destroy({ children: true });
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private async loadArt(): Promise<void> {
    const art = resolveArt(this.options.type, 1, ArtState.DEFAULT);
    if (!art) return;
    try {
      const texture = await Assets.load<Texture>(art.top.url);
      if (this.done) return;
      const frame = art.top.frame;
      this.art.texture = frame
        ? new Texture({ source: texture.source, frame: new Rectangle(0, 0, frame.width, frame.height) })
        : texture;
      this.artOffset = { x: art.top.x, y: art.top.y };
      if (this.spot) this.show(this.spot.x, this.spot.y);
    } catch {
      // No picture: the footprint alone still says where it goes.
    }
  }

  private show(x: number, y: number): void {
    if (this.done) return;
    const check = this.grid.check(this.options.type, x, y);
    const changed =
      this.spot?.x !== check.x || this.spot?.y !== check.y || this.spot?.problem !== check.problem;
    this.spot = check;
    this.draw(check);
    if (changed) this.options.onSpot?.(check);
  }

  private draw(check: SpotCheck): void {
    this.drawNearby(check.x, check.y);
    const corners = footprintCorners(this.yard.bounds, this.options.type, check.x, check.y);
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
    if (top) this.art.position.set(top.x + this.artOffset.x, top.y + this.artOffset.y);
    this.art.tint = check.problem ? 0xffb0b0 : 0xffffff;
    this.ghost.visible = true;
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
      const corners = footprintCorners(this.yard.bounds, one.type, one.x, one.y);
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
    if (event.pointerType === "touch") return;
    const point = this.yardPoint(event);
    const spot = this.grid.spotAt(this.options.type, point.x, point.y);
    this.show(spot.x, spot.y);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pressed) return;
    this.pressed = false;
    if (Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY) > DRAG_SLOP) return;

    const point = this.yardPoint(event);
    const spot = this.grid.spotAt(this.options.type, point.x, point.y);
    this.show(spot.x, spot.y);
    // A touch only moves it: the bar's Build here puts it down (#157).
    if (event.pointerType === "touch") return;
    if (this.spot) void this.drop(this.spot);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    this.options.onCancel();
  };

  private async drop(spot: SpotCheck): Promise<void> {
    if (this.done) return;
    // Refused here: the hint already says why, and the building stays in hand.
    const check = this.grid.check(this.options.type, spot.x, spot.y);
    if (check.problem) {
      this.options.onSpot?.(check);
      return;
    }
    // One building at a time unless it is a wall or trap, whose line is the point.
    if (!this.options.repeat && this.inFlight > 0) return;

    const handle = this.grid.hold(this.options.type, spot.x, spot.y);
    this.inFlight++;
    this.show(spot.x, spot.y);
    const outcome = await this.options.onDrop(spot.x, spot.y);
    this.inFlight--;
    if (this.done) return;
    this.grid.release(handle);
    if (this.spot) this.show(this.spot.x, this.spot.y);
    if (outcome === "placed" && !this.options.repeat) this.options.onDone?.();
  }
}
