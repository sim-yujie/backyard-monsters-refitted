import type { Container } from "pixi.js";
import { CELL_HEIGHT, CELL_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import type { Point } from "@/game/HexGrid";
import type { Tilt } from "./tilt";

/**
 * Upright markers on the tilted map (MR2 look plan step 4, second round).
 *
 * With the tilt on, the map is drawn flat into a texture and warped
 * (`TiltView.ts`), which squashes anything that stands on the ground: a tribe
 * portrait, a Town Hall, a level circle or a name tag comes out short and
 * leaning back. So those markers are kept out of the texture and drawn on a
 * layer over it, in screen pixels: each cell's markers are pinned to one
 * ground point, their foot, which goes through the camera and the tilt like
 * the ground does, and everything pinned there is scaled evenly by the size
 * one map pixel has at that height of the screen. The markers stand straight
 * up, keep their shape, and shrink with distance exactly as the ground under
 * them does.
 *
 * Each marker keeps the place and size it was built with relative to its foot
 * (`add`), so with the tilt off it is put back exactly where the flat map has
 * always drawn it.
 */

/** Where a foot lands on the screen and how much its markers are scaled there. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/**
 * A foot's place on the screen, or null when it is behind the camera (never drawn). `boxShown`,
 * when given, answers false only for a box of feet (map pixels) every one of which the projector
 * would answer null for, so a chunk entirely off the screen is skipped whole (map lag, 25 Nov
 * 2026: the tilted view's chunks reach well past the screen's lower corners).
 */
export type Projector = ((footX: number, footY: number) => Placement | null) & {
  boxShown?: (x0: number, y0: number, x1: number, y1: number) => boolean;
};

/**
 * Smallest and largest scale a marker is drawn at on the tilted screen,
 * relative to the flat map at the same zoom. Points so far below the screen
 * that they would come out larger than this, or behind the camera (the scale
 * turns negative), are hidden: they are never on screen anyway.
 */
const MIN_TILT_SCALE = 0.05;
const MAX_TILT_SCALE = 8;

/**
 * How far past the screen's edge, in map pixels at the foot's scale, a foot
 * may be and still have its markers placed: a cell's markers reach about one
 * cell up (a tower under its dome) and half a cell across (a name tag), so a
 * cell's width covers them. Feet further out are hidden instead, which keeps
 * the per-frame work to what is on screen: the chunks cover the tilted view's
 * bounding box, whose lower corners are off screen.
 */
const CULL_MARGIN = CELL_WIDTH;

/**
 * How much smaller than the ground's own scale markers stand, so a cell's
 * markers still fit under the cell behind it.
 *
 * The markers were drawn for flat-top's 75 px rows (`CELL_HEIGHT`). Standing
 * upright they keep their full height while the rows behind them are
 * squashed by the tilt (cos(pitch)), so on flat-top cells a star would come
 * up over the name tag of the player cell just behind (owner's yards stacked
 * in a column). Shrunk by that squash they fill the same share of a row as on
 * the flat map, at the middle of the screen. Pointy-top's Modern rows are
 * 112.5 px, roomy enough to stand at full size.
 */
export const markerFit = (tilt: Tilt, rowStep: number): number =>
  Math.min(1, (tilt.squash * rowStep) / CELL_HEIGHT);

/**
 * The upright placement of a ground point: the camera's flat screen point
 * (`world - position) * zoom`) seen through the tilt, and the zoom times the
 * tilt's local scale there (times `fit`, see {@link markerFit}). Null for a
 * point the tilted camera cannot show, or whose markers would all be off the
 * screen.
 */
export const uprightPlacement = (
  tilt: Tilt,
  camera: { readonly zoom: number; readonly position: Point },
  foot: Point,
  fit = 1,
): Placement | null => {
  const flat = {
    x: (foot.x - camera.position.x) * camera.zoom,
    y: (foot.y - camera.position.y) * camera.zoom,
  };
  // The tilt's horizontal scale there, 1 + k·v on the screen, equals
  // 1 / (1 − k·c·Y) for the flat point: negative behind the camera and
  // without bound at the horizon, both caught by the limits.
  const screen = tilt.toScreen(flat);
  const local = tilt.scaleAt(screen.y);
  if (!Number.isFinite(local) || local < MIN_TILT_SCALE || local > MAX_TILT_SCALE) return null;
  const scale = camera.zoom * local * fit;
  const margin = CULL_MARGIN * scale;
  if (screen.x < -margin || screen.x > tilt.width + margin || screen.y < -margin || screen.y > tilt.height + margin) {
    return null;
  }
  return { x: screen.x, y: screen.y, scale };
};

/**
 * Whether any foot in a box of map pixels could be placed (`uprightPlacement` not null). The tilt
 * is a perspective of the flat map: with every corner in front of the camera the box comes out as
 * the four-sided shape between its corners, and the tilt's scale anywhere in it lies between the
 * corners' (it follows the screen's height), so the corners' screen box grown by the largest
 * corner margin holds every foot's test. A corner behind the camera or past the scale limits
 * answers true: the feet are then tested one by one, as before.
 */
export const uprightBoxShown = (
  tilt: Tilt,
  camera: { readonly zoom: number; readonly position: Point },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fit = 1,
): boolean => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let margin = 0;
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ] as const) {
    const screen = tilt.toScreen({ x: (x - camera.position.x) * camera.zoom, y: (y - camera.position.y) * camera.zoom });
    const local = tilt.scaleAt(screen.y);
    if (!Number.isFinite(local) || local < MIN_TILT_SCALE || local > MAX_TILT_SCALE) return true;
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return true;
    minX = Math.min(minX, screen.x);
    maxX = Math.max(maxX, screen.x);
    minY = Math.min(minY, screen.y);
    maxY = Math.max(maxY, screen.y);
    margin = Math.max(margin, CULL_MARGIN * camera.zoom * local * fit);
  }
  return !(maxX < -margin || minX > tilt.width + margin || maxY < -margin || minY > tilt.height + margin);
};

/** A projector for {@link MarkerPins.place} from a tilt and the camera. */
export const uprightProjector = (
  tilt: Tilt,
  camera: { readonly zoom: number; readonly position: Point },
  fit = 1,
): Projector =>
  Object.assign((footX: number, footY: number) => uprightPlacement(tilt, camera, { x: footX, y: footY }, fit), {
    boxShown: (x0: number, y0: number, x1: number, y1: number) => uprightBoxShown(tilt, camera, x0, y0, x1, y1, fit),
  });

/** One marker as the flat map draws it: its foot, and its offset and scale from there. */
interface Pinned {
  readonly item: Container;
  readonly footX: number;
  readonly footY: number;
  readonly dx: number;
  readonly dy: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** Whether it was shown when added; a marker hidden behind the camera comes back to this. */
  readonly visible: boolean;
  /** Its cell (`cellKey`), or -1 when not told: the clustering may stand in for it. */
  readonly cell: number;
  /** A wild monster camp's marker: left out when zoomed out (`MarkerFilter.campsShown`). */
  readonly camp: boolean;
}

/**
 * Where a cell's markers stand, and which cell that is (map pin clustering, beta 9): a chunk makes
 * one per cell and pins every marker of the cell to it, text added later included.
 */
export interface Foot extends Point {
  /** `cellKey(col, row)`. */
  readonly cell?: number;
  /** The cell is a wild monster camp. */
  readonly camp?: boolean;
}

/**
 * Which markers are left out (map pin clustering, `cluster/clusterRules.ts`): the cells a plaque
 * or crest stands for, and every camp's when zoomed out. One object shared by every chunk;
 * `version` goes up on every change, so a chunk looks again only then.
 */
export class MarkerFilter {
  /** One flag per world cell (`cellKey`): 1 = a token stands for it. */
  readonly hidden = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT);
  private hiddenKeys: number[] = [];
  campsShown = true;
  version = 0;

  /** Hides exactly these cells' markers (the previous set comes back). */
  setHidden(keys: readonly number[]): void {
    for (const key of this.hiddenKeys) this.hidden[key] = 0;
    for (const key of keys) this.hidden[key] = 1;
    this.hiddenKeys = keys.slice();
    this.version++;
  }

  setCampsShown(shown: boolean): void {
    if (shown === this.campsShown) return;
    this.campsShown = shown;
    this.version++;
  }

  /** One flag per world cell: 1 = under a plaque, so its relation border is not drawn either. */
  readonly quiet = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT);
  private quietKeys: number[] = [];

  /** The cells whose relation borders are left out (the tile map's border sprites, `MapChunk`). */
  setQuiet(keys: readonly number[]): void {
    for (const key of this.quietKeys) this.quiet[key] = 0;
    for (const key of keys) this.quiet[key] = 1;
    this.quietKeys = keys.slice();
    this.version++;
  }

  /** Alliance and neutral borders as one outline round joined tiles (zoomed out, `ZOOMED_OUT_BORDERS`). */
  groupBorders = false;

  setGroupBorders(on: boolean): void {
    if (on === this.groupBorders) return;
    this.groupBorders = on;
    this.version++;
  }

  /** How many cells are hidden now. */
  get hiddenCount(): number {
    return this.hiddenKeys.length;
  }

  /** Whether a marker is left out. */
  leaves(cell: number, camp: boolean): boolean {
    return (camp && !this.campsShown) || (cell >= 0 && this.hidden[cell] === 1);
  }
}

/** Which markers come and go together: a chunk's sprites, or its text (laid out and handed back on its own). */
export type PinGroup = "body" | "text";

/**
 * One chunk's markers and their feet. The chunk adds each marker right after
 * placing it for the flat map; the renderer calls {@link place} each frame
 * for the chunks on screen, which does nothing unless the camera, the tilt or
 * the markers changed.
 */
export class MarkerPins {
  private readonly pins: Record<PinGroup, Pinned[]> = { body: [], text: [] };
  /** What the markers were last placed for: null while they sit where the flat map puts them. */
  private placedKey: string | null = null;
  /** A marker came or went since the last placement. */
  private changed = false;
  /** Every marker is hidden because the whole chunk is off the screen (`Projector.boxShown`). */
  private culled = false;
  /** The box round every foot, map pixels. */
  private footX0 = Infinity;
  private footY0 = Infinity;
  private footX1 = -Infinity;
  private footY1 = -Infinity;
  /** The markers left out (clustering), shared by every chunk, and its version last applied. */
  private filter: MarkerFilter | null = null;
  private filterVersion = -1;

  /** How many markers are pinned, for tests and the speed readout. */
  get size(): number {
    return this.pins.body.length + this.pins.text.length;
  }

  /** Whether the markers stand on the tilted screen right now, rather than on the flat map. */
  get tilted(): boolean {
    return this.placedKey !== null;
  }

  /**
   * Pins a marker to a foot on the map, as it stands now: its position and
   * scale are taken as the flat map's, relative to the foot.
   */
  add(foot: Foot, item: Container, group: PinGroup = "body"): void {
    this.pins[group].push({
      item,
      footX: foot.x,
      footY: foot.y,
      dx: item.position.x - foot.x,
      dy: item.position.y - foot.y,
      scaleX: item.scale.x,
      scaleY: item.scale.y,
      visible: item.visible,
      cell: foot.cell ?? -1,
      camp: foot.camp ?? false,
    });
    if (this.filter?.leaves(foot.cell ?? -1, foot.camp ?? false)) item.visible = false;
    this.footX0 = Math.min(this.footX0, foot.x);
    this.footY0 = Math.min(this.footY0, foot.y);
    this.footX1 = Math.max(this.footX1, foot.x);
    this.footY1 = Math.max(this.footY1, foot.y);
    this.changed = true;
  }

  /**
   * Forgets the markers of a group, or all. Their objects are destroyed or
   * pooled by the caller; each gets its own visibility back first, because a
   * pooled text hidden off screen here would otherwise come out hidden in the
   * next chunk that borrows it.
   */
  clear(group?: PinGroup): void {
    for (const name of group ? [group] : (["body", "text"] as const)) {
      for (const pin of this.pins[name]) pin.item.visible = pin.visible;
      this.pins[name].length = 0;
    }
    if (this.size === 0) {
      this.footX0 = Infinity;
      this.footY0 = Infinity;
      this.footX1 = -Infinity;
      this.footY1 = -Infinity;
    }
  }

  /**
   * Leaves out the markers a filter names (map pin clustering). Cheap to call every frame: it does
   * something only when the filter changed. On the tilted screen the next `place` applies it.
   */
  applyFilter(filter: MarkerFilter | null): void {
    const version = filter?.version ?? -1;
    if (filter === this.filter && version === this.filterVersion) return;
    this.filter = filter;
    this.filterVersion = version;
    if (this.placedKey !== null) {
      this.changed = true;
      return;
    }
    for (const pin of this.all()) pin.item.visible = pin.visible && !this.leftOut(pin);
  }

  private leftOut(pin: Pinned): boolean {
    return this.filter !== null && this.filter.leaves(pin.cell, pin.camp);
  }

  /** How many markers are drawn: shown, not left out, in a shown layer (speed readout). */
  get drawnCount(): number {
    let count = 0;
    for (const pin of this.all()) if (pin.item.visible && pin.item.parent?.visible !== false) count++;
    return count;
  }

  /**
   * Stands every marker upright on the tilted screen, or puts them back on
   * the flat map when `project` is null. `key` names the view (camera and
   * tilt): the same key and no new markers means nothing to do.
   */
  place(project: Projector | null, key: string): void {
    if (!project) {
      if (this.placedKey === null) return;
      this.placedKey = null;
      this.changed = false;
      this.culled = false;
      for (const pin of this.all()) {
        pin.item.position.set(pin.footX + pin.dx, pin.footY + pin.dy);
        pin.item.scale.set(pin.scaleX, pin.scaleY);
        pin.item.visible = pin.visible && !this.leftOut(pin);
      }
      return;
    }
    if (key === this.placedKey && !this.changed) return;
    this.placedKey = key;
    // A chunk wholly off the screen: its markers are hidden once, then skipped while it stays off.
    if (project.boxShown && this.size > 0 && !project.boxShown(this.footX0, this.footY0, this.footX1, this.footY1)) {
      if (!this.culled || this.changed) for (const pin of this.all()) pin.item.visible = false;
      this.culled = true;
      this.changed = false;
      return;
    }
    this.culled = false;
    this.changed = false;
    let lastX = Number.NaN;
    let lastY = Number.NaN;
    let at: Placement | null = null;
    const filter = this.filter;
    for (const pin of this.all()) {
      // Left out (a plaque or crest stands for it, or a camp when zoomed out): not placed at all.
      if (filter !== null && filter.leaves(pin.cell, pin.camp)) {
        if (pin.item.visible) pin.item.visible = false;
        continue;
      }
      // A cell's markers are added one after another on the same foot.
      if (pin.footX !== lastX || pin.footY !== lastY) {
        lastX = pin.footX;
        lastY = pin.footY;
        at = project(pin.footX, pin.footY);
      }
      if (!at) {
        pin.item.visible = false;
        continue;
      }
      pin.item.visible = pin.visible;
      pin.item.position.set(at.x + pin.dx * at.scale, at.y + pin.dy * at.scale);
      pin.item.scale.set(pin.scaleX * at.scale, pin.scaleY * at.scale);
    }
  }

  private *all(): Iterable<Pinned> {
    yield* this.pins.body;
    yield* this.pins.text;
  }
}
