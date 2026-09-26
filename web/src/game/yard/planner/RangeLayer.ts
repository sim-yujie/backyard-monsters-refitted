import { Container, Graphics } from "pixi.js";
import { buildingClass, flyerMode, towerStats } from "@/game/combat/rules";
import type { Point } from "../YardGrid";
import { YardView } from "../YardRenderer";

/**
 * The planner's defence overlays: what each tower covers, and where the middle
 * of the yard is.
 *
 * Two answers to two questions a layout cannot be judged without. "Is that
 * corner defended?" is the range disc — every placed tower's reach, land and
 * air kept apart because a Cannon and an Aerial Defense Tower are not
 * interchangeable. "Is this thing in the middle?" is the centre mark, because
 * a yard is symmetric about its origin and nothing on screen said so.
 *
 * This is the cheap half of design §3's F4. F4 proper samples the yard on the
 * pathing grid and shades cells by damage per second; this draws the circles
 * that F4 was going to replace, because the owner asked for them and because a
 * heat map answers "how strong" while a ring answers "how far", which is the
 * question you have while a tower is in your hand.
 *
 * ## The geometry
 *
 * A tower's range is a plain circle around the middle of its footprint in yard
 * units (`BTOWER.targetInRange`, `client/scripts/BTOWER.as:234-249`; design §3,
 * F4). The two views draw that circle differently, and both come from
 * {@link rangeRadii}: the blueprint is one world pixel to one yard unit, so the
 * circle is a circle, and the isometric view squashes it into the same 2:1
 * ellipse the footprints are drawn with.
 *
 * ## The cost
 *
 * Two `Graphics` — one for land, one for air — hold every disc in the yard, and
 * they are rebuilt only when the plan moves, the selection changes or a toggle
 * is flipped, never per frame. A yard with 23 towers is 46 ellipses in two
 * geometry batches, which is cheaper than the selection chrome already is.
 */

/* ── The stats ────────────────────────────────────────────────────────────── */

/**
 * A tower's reach at one level, in yard units.
 *
 * `land` and `air` come from `_targetFlyerMode` through `getOldStyleTargets`
 * (`client/scripts/Targeting.as:175-190`), which is what decides whether a
 * tower may fire at a flyer at all: mode 0 is ground only, 1 is both and 2 is
 * air only.
 */
export interface TowerRange {
  /** Maximum range, the radius of the disc. */
  readonly range: number;
  /** Radius of the hole in the middle, or null where there is none. */
  readonly minRange: number | null;
  /** This tower can hit creeps on the ground. */
  readonly land: boolean;
  /** This tower can hit flyers. */
  readonly air: boolean;
}

/**
 * Types with a dead zone around their own footprint, by yard units.
 *
 * Empty, and correct: no `stats` block in `YARD_PROPS.as` carries a minimum
 * range, `BTOWER.targetInRange` tests one bound and not two, and the engine's
 * scan is a single `inRange` call (`web/src/game/combat/rules/engine.ts`). The
 * table is here rather than the idea being left out because a minimum range is
 * the one part of a range that a picture has to show — a player cannot deduce a
 * hole — so the ring is drawn the moment a row appears, and
 * `RangeLayer.test.ts` holds it to being empty until one does.
 */
export const TOWER_MIN_RANGE: Readonly<Record<number, number>> = {};

/**
 * What to draw for a building, or null when it is not a defence tower.
 *
 * `buildingClass` rather than "has a stats block": the Siege Works (134) and
 * the cages carry a `range` and are not defences, and drawing a disc around a
 * building that never shoots at an attacker would be a lie. The Monster Bunker
 * (22) is kept — it is a `tower` and its range is the ground it answers for —
 * even though it fires monsters rather than shots.
 */
export const towerRange = (type: number, level: number): TowerRange | null => {
  if (buildingClass(type) !== "tower") return null;
  const range = towerStats(type, level)?.range;
  if (range === undefined || range <= 0) return null;

  const mode = flyerMode(type);
  const min = TOWER_MIN_RANGE[type];
  return {
    range,
    minRange: min !== undefined && min > 0 && min < range ? min : null,
    land: mode !== 2,
    air: mode !== 0,
  };
};

/**
 * A radius in yard units as world-pixel semi-axes, in the view that is showing.
 *
 * The blueprint is a translation of yard units (`blueprint.ts`), so a circle
 * stays a circle. The isometric view is `toIso`, which sends
 * `(cos t, sin t)` to `(cos t - sin t, (cos t + sin t) / 2)` — an axis-aligned
 * ellipse with semi-axes `r√2` and `r√2 / 2`, the same 2:1 the footprint
 * diamonds are drawn with.
 */
export const rangeRadii = (
  range: number,
  view: YardView,
): { readonly rx: number; readonly ry: number } =>
  view === YardView.BLUEPRINT
    ? { rx: range, ry: range }
    : { rx: range * Math.SQRT2, ry: (range * Math.SQRT2) / 2 };

/* ── Remembering the toggles ──────────────────────────────────────────────── */

/** Which overlays are on. */
export interface OverlayToggles {
  /** The parent switch: off, and neither range family is drawn. */
  readonly ranges: boolean;
  readonly land: boolean;
  readonly air: boolean;
  readonly centre: boolean;
}

/** Where the toggles are remembered, namespaced like the rest of the client. */
export const OVERLAY_KEY = "bymr.planner.overlays";

/**
 * Ranges start off, the centre mark starts on.
 *
 * A yard full of discs is the first thing a new player would see otherwise,
 * and it is an answer to a question they have not asked yet. The centre mark
 * is one faint cross and is wanted by everyone laying a base out symmetrically,
 * which is most of them.
 */
export const DEFAULT_OVERLAYS: OverlayToggles = {
  ranges: false,
  land: true,
  air: true,
  centre: true,
};

/** The store, or null where there is none. Reading the property can throw. */
const defaultStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * What was remembered, falling back to the defaults field by field.
 *
 * Field by field rather than all or nothing so a key written by an older build
 * — or half-edited by hand — still gives up whatever it does say. Anything that
 * is not a boolean is not an answer, so it takes the default.
 */
export const loadOverlays = (storage: Storage | null = defaultStorage()): OverlayToggles => {
  try {
    const raw = storage?.getItem(OVERLAY_KEY);
    if (!raw) return DEFAULT_OVERLAYS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_OVERLAYS;
    const held = parsed as Partial<Record<keyof OverlayToggles, unknown>>;
    const pick = (key: keyof OverlayToggles): boolean => {
      const value = held[key];
      return typeof value === "boolean" ? value : DEFAULT_OVERLAYS[key];
    };
    return {
      ranges: pick("ranges"),
      land: pick("land"),
      air: pick("air"),
      centre: pick("centre"),
    };
  } catch {
    return DEFAULT_OVERLAYS;
  }
};

/** Remembers them. A blocked or full store is not worth an error. */
export const saveOverlays = (
  toggles: OverlayToggles,
  storage: Storage | null = defaultStorage(),
): void => {
  try {
    storage?.setItem(OVERLAY_KEY, JSON.stringify(toggles));
  } catch {
    // The only consequence is that they are back at their defaults next time.
  }
};

/* ── The discs ────────────────────────────────────────────────────────────── */

/**
 * Land and air, from the planner's palette.
 *
 * Warm for the ground and cold for the sky, which is the way round every
 * strategy game has taught players to read them. Both are picked to sit on the
 * yard's grass (0x669633) and the blueprint's (the same green) without going
 * muddy, and neither is the selection's amber (0xf0a12e) or the fault red
 * (0xe05252) — a disc is never the thing that says something is wrong.
 *
 * Colour is not the only channel either: the two families are named in the menu
 * that turns them on, and a tower's own outline stays whatever the selection
 * made it.
 */
export const RANGE_LAND = 0xff7a18;
export const RANGE_AIR = 0x3fb9ff;

/** Fill alpha for a disc, and for one whose tower is selected. */
const FILL_ALPHA = 0.1;
const FILL_ALPHA_SELECTED = 0.24;
/** Edge alpha, and its width in world pixels. */
const EDGE_ALPHA = 0.55;
const EDGE_ALPHA_SELECTED = 0.95;
const EDGE_WIDTH = 1.5;

/** One tower the layer should draw. */
export interface RangeNode {
  readonly id: number;
  readonly type: number;
  /** The level to read the range at: the planned one where there is a plan. */
  readonly level: number;
}

export interface RangeDrawOptions {
  /** Every placed building; the layer picks the towers out itself. */
  readonly nodes: Iterable<RangeNode>;
  /** Where a building is drawn now, in world pixels, or null if nowhere. */
  readonly centreOf: (id: number) => Point | null;
  readonly selected: ReadonlySet<number>;
  readonly view: YardView;
  readonly land: boolean;
  readonly air: boolean;
}

/** One disc, resolved to world pixels. */
interface Disc {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  /** The hole's semi-axes, or null. */
  readonly hole: { readonly rx: number; readonly ry: number } | null;
  readonly selected: boolean;
}

export class RangeLayer {
  /** The container to hand to whichever view is showing. */
  readonly root = new Container();

  private readonly land = new Graphics();
  private readonly air = new Graphics();

  constructor() {
    this.root.eventMode = "none";
    this.root.addChild(this.land, this.air);
  }

  /** Draws every visible disc. Call on a plan, selection, view or toggle change. */
  draw(options: RangeDrawOptions): void {
    if (!options.land && !options.air) {
      this.clear();
      return;
    }

    const land: Disc[] = [];
    const air: Disc[] = [];
    for (const node of options.nodes) {
      const reach = towerRange(node.type, node.level);
      if (!reach) continue;
      if (!(reach.land && options.land) && !(reach.air && options.air)) continue;

      const centre = options.centreOf(node.id);
      if (!centre) continue;

      const outer = rangeRadii(reach.range, options.view);
      const disc: Disc = {
        x: centre.x,
        y: centre.y,
        rx: outer.rx,
        ry: outer.ry,
        hole: reach.minRange === null ? null : rangeRadii(reach.minRange, options.view),
        selected: options.selected.has(node.id),
      };
      if (reach.land && options.land) land.push(disc);
      if (reach.air && options.air) air.push(disc);
    }

    paint(this.land, land, RANGE_LAND);
    paint(this.air, air, RANGE_AIR);
  }

  /** Hides every disc and forgets what it drew. */
  clear(): void {
    this.land.clear();
    this.air.clear();
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/**
 * Every disc of one family, in as few geometry batches as the shapes allow.
 *
 * Four passes, not four per tower: the unselected fills, the selected fills,
 * the unselected edges and the selected edges, so 23 towers cost four batches
 * rather than 92. A disc with a hole cannot join a batch — `cut` subtracts the
 * last subpath from the one before it, and batching would subtract it from the
 * wrong disc — so those are drawn one at a time, which today is none of them.
 */
const paint = (g: Graphics, discs: readonly Disc[], colour: number): void => {
  g.clear();
  if (discs.length === 0) return;

  for (const pass of [false, true]) {
    let drew = false;
    for (const disc of discs) {
      if (disc.selected !== pass || disc.hole) continue;
      g.ellipse(disc.x, disc.y, disc.rx, disc.ry);
      drew = true;
    }
    if (drew) {
      g.fill({ color: colour, alpha: pass ? FILL_ALPHA_SELECTED : FILL_ALPHA });
    }
  }

  for (const disc of discs) {
    if (!disc.hole) continue;
    g.ellipse(disc.x, disc.y, disc.rx, disc.ry)
      .ellipse(disc.x, disc.y, disc.hole.rx, disc.hole.ry)
      .cut()
      .fill({ color: colour, alpha: disc.selected ? FILL_ALPHA_SELECTED : FILL_ALPHA });
  }

  // Edges last and selected edges last of all, so a disc the player is working
  // on is never buried under the fill of the one beside it.
  for (const pass of [false, true]) {
    let drew = false;
    for (const disc of discs) {
      if (disc.selected !== pass) continue;
      g.ellipse(disc.x, disc.y, disc.rx, disc.ry);
      if (disc.hole) g.ellipse(disc.x, disc.y, disc.hole.rx, disc.hole.ry);
      drew = true;
    }
    if (drew) {
      g.stroke({
        width: EDGE_WIDTH,
        color: colour,
        alpha: pass ? EDGE_ALPHA_SELECTED : EDGE_ALPHA,
      });
    }
  }
};

/* ── The middle of the yard ───────────────────────────────────────────────── */

/**
 * The plot's centre, as a crosshair and two dashed lines along its axes.
 *
 * The plot spans `[-w/2, w/2) x [-h/2, h/2)` in yard units (docs/specs/
 * base-building.md §2), so the centre is yard (0, 0) exactly, and both half
 * sizes are whole multiples of the grid step at every expansion — the mark
 * lands on a cell corner and not between two.
 *
 * The lines are the yard's own axes rather than the screen's, so they are
 * horizontal and vertical on the blueprint and the diamond's two diagonals in
 * the isometric view. That is what makes them useful: a building is centred
 * when it straddles one of them, in either drawing.
 *
 * Drawn twice, dark then light, because the mark crosses grass, tiles and the
 * blueprint's green in one stroke and a single colour would vanish over one of
 * them.
 */
export class CentreMarker {
  readonly root = new Container();

  /** The axes, in world pixels: they measure the plot, so they scale with it. */
  private readonly lines = new Graphics();
  /**
   * The crosshair, drawn around its own origin inside a container that is
   * counter-scaled by the zoom.
   *
   * A mark, not a measurement: it says "here", and a thing that says "here" has
   * to stay legible at the zoom that shows the whole plot as well as at the one
   * that shows four tiles. In world pixels it would be nine screen pixels
   * across at the fit zoom, which is a smudge.
   */
  private readonly pin = new Container();
  private readonly cross = new Graphics();

  constructor() {
    this.root.eventMode = "none";
    this.pin.addChild(this.cross);
    this.root.addChild(this.lines, this.pin);
    this.drawCross();
  }

  /** Draws the mark, or clears it when passed null. */
  draw(
    geometry: {
      /** Yard (0, 0) in world pixels. */
      readonly centre: Point;
      /** The plot's two axes, end to end, in world pixels. */
      readonly axes: readonly (readonly [Point, Point])[];
    } | null,
  ): void {
    const g = this.lines;
    g.clear();
    this.pin.visible = geometry !== null;
    if (!geometry) return;

    // Twice, dark then light: the axes cross grass, tiles and the blueprint's
    // green in one stroke, and no single colour survives all three.
    for (const [from, to] of geometry.axes) dashedLine(g, from, to);
    g.stroke({ width: 2, color: SHADE, alpha: 0.3 });
    for (const [from, to] of geometry.axes) dashedLine(g, from, to);
    g.stroke({ width: 1, color: MARK, alpha: 0.5 });

    this.pin.position.set(geometry.centre.x, geometry.centre.y);
  }

  /** Keeps the crosshair the same size on screen whatever the camera does. */
  setZoom(zoom: number): void {
    const scale = zoom > 0 ? 1 / zoom : 1;
    this.pin.scale.set(scale);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  /** The crosshair itself, once: it never changes, only where it is drawn. */
  private drawCross(): void {
    const g = this.cross;
    for (const width of [4, 2]) {
      g.circle(0, 0, RING);
      for (const [dx, dy] of ARMS) {
        g.moveTo(dx * (RING + 2), dy * (RING + 2)).lineTo(dx * (RING + ARM), dy * (RING + ARM));
      }
      g.stroke({
        width,
        color: width === 4 ? SHADE : MARK,
        alpha: width === 4 ? 0.5 : 0.95,
      });
    }
  }
}

/** The mark, and the dark stroke laid under it so it reads on pale ground. */
const MARK = 0xf3f6fa;
const SHADE = 0x101418;
/** The crosshair's ring and arms, in screen pixels: the pin is zoom-invariant. */
const RING = 8;
const ARM = 10;

/** The four directions the crosshair's arms point in. */
const ARMS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** A dashed segment. `Graphics` has no primitive for one; nor has the overlay. */
const dashedLine = (g: Graphics, from: Point, to: Point, dash = 24, gap = 16): void => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  for (let at = 0; at < length; at += dash + gap) {
    const end = Math.min(at + dash, length);
    g.moveTo(from.x + ux * at, from.y + uy * at).lineTo(from.x + ux * end, from.y + uy * end);
  }
};
