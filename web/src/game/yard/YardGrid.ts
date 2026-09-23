/**
 * Yard geometry: the three coordinate spaces the base screen moves between, the
 * plot's size at each expansion level, and building footprints.
 *
 * ## Spaces
 *
 * **Yard units** are what `buildingdata` stores as `X` and `Y`: a logical plot
 * coordinate with the origin at the centre of the plot. **Isometric pixels**
 * are what the Flash client held in `_mc.x` / `_mc.y` and what every art offset
 * in `buildingArtData.ts` is measured against. **World pixels** are isometric
 * pixels shifted so the whole plot sits in the positive quadrant, which is what
 * `Camera` wants: its bounds clamp assumes a rectangle anchored at the origin.
 *
 * The isometric conversion is `client/scripts/GRID.as:135-144`, reproduced
 * exactly, floors and ceilings included — `Export()` writes `FromISO(_mc.x,
 * _mc.y)` and `Setup()` reads `ToISO(X, Y, 0)` back
 * (`client/scripts/BFOUNDATION.as:2970-2972`, `:3040`), so the pair has to round
 * the way the original did or a saved yard would drift a pixel every load.
 */

import { propsSize } from "./buildingArt";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ── Isometric conversion ─────────────────────────────────────────────────── */

/**
 * Yard units to isometric pixels. `z` lifts the result, for art that sits above
 * the ground plane; the yard screen always passes 0.
 *
 * `client/scripts/GRID.as:135-139`.
 */
export const toIso = (x: number, y: number, z = 0): Point => ({
  x: Math.floor(x - y) + 0,
  y: Math.floor((x + y) * 0.5 - z) + 0,
});

/**
 * Isometric pixels back to yard units.
 *
 * `client/scripts/GRID.as:141-145`. Note this is `ceil`, not `floor`: the pair
 * round in opposite directions, which is what makes the round trip exact.
 */
export const fromIso = (x: number, y: number): Point => ({
  // `+ 0` only turns -0 into 0. `Math.ceil` returns -0 for anything in (-1, 0],
  // which is numerically the same but compares unequal under Object.is and
  // survives into anything that round-trips through JSON.
  x: Math.ceil(x * 0.5 + y) + 0,
  y: Math.ceil(y - x * 0.5) + 0,
});

/**
 * Depth-sort key: a building's isometric y.
 *
 * Equivalently `(X + Y) / 2`, so drawing in ascending order is the painter's
 * order for this projection — anything further down the screen is nearer the
 * viewer and goes on top. Isometric x breaks ties so the order is stable
 * between loads, and the building id breaks the remaining ones so two buildings
 * sharing a tile never swap places between frames.
 */
export const depthKey = (isoX: number, isoY: number, id: number): number =>
  isoY * 4_000_000 + isoX * 1_000 + (id % 1_000);

/* ── Plot size ────────────────────────────────────────────────────────────── */

/** The most "More Yardage" purchases an account can hold: the `ENL` ladder has
 * six prices (`server/src/game-data/store/storeItems.ts:39-46`). */
const MAX_EXPANSIONS = 6;

/**
 * Plot dimensions in yard units, indexed by `storedata.ENL.q`, the number of
 * "More Yardage" purchases.
 *
 * `STORE.ProcessPurchases` starts from 1000 x 800, multiplies **both axes by
 * 1.1 once per purchase with no rounding in between**, and rounds up to a
 * multiple of 20 only at the end (`client/scripts/STORE.as:2346-2365`). Doing
 * it that way rather than rounding each step matters: the compounding is
 * carried in a double, and at one rung the accumulated error changes the
 * answer.
 *
 * That rung is the height at one purchase. Rounding per step gives 880; the
 * original's product is 880.00000000000011, which rounds up to **900**. The
 * Yard Planner's own hardcoded table
 * (`client/scripts/com/monsters/baseplanner/PlannerDesignView.as:106`) says 880
 * there and agrees with the live formula everywhere else, so the two disagree
 * in the game itself — the planner would draw its bounds 20 units short of the
 * plot a one-purchase player actually has. `GLOBAL._mapWidth` /
 * `_mapHeight` is what the yard is built against, so this follows the formula
 * and not the planner's table.
 *
 * Both languages are IEEE 754 doubles running the same operations in the same
 * order, so computing it here reproduces the original bit for bit rather than
 * approximating it.
 */
export const YARD_SIZES: readonly (readonly [width: number, height: number])[] = (() => {
  const sizes: [number, number][] = [];
  for (let purchases = 0; purchases <= MAX_EXPANSIONS; purchases++) {
    let width = 1000;
    let height = 800;
    for (let i = 0; i < purchases; i++) {
      width *= 1.1;
      height *= 1.1;
    }
    sizes.push([Math.ceil(width / 20) * 20, Math.ceil(height / 20) * 20]);
  }
  return sizes;
})();

/** Plot size in yard units for an expansion level, clamped to the ladder. */
export const yardSize = (expansionLevel: number): readonly [number, number] => {
  const index = Math.min(Math.max(Math.trunc(expansionLevel) || 0, 0), YARD_SIZES.length - 1);
  return YARD_SIZES[index] ?? YARD_SIZES[0]!;
};

/**
 * Isometric pixels of headroom around the plot.
 *
 * Building art is anchored by its top-left corner at an offset that reaches up
 * to about 70 px above and 60 px left of the building's origin, and a building
 * may sit flush against the plot edge. Without the margin the camera's clamp
 * would cut the top off the outermost town hall at the closest zoom.
 */
export const YARD_MARGIN = 120;

/**
 * The plot, in every form the scene needs.
 *
 * A rectangle in yard units is a diamond in isometric pixels, so `corners` is
 * what the ground is clipped to while `width`/`height` describe the axis-aligned
 * box the camera is allowed to roam, margin included.
 */
export interface YardBounds {
  /** Plot size in yard units. */
  readonly yardWidth: number;
  readonly yardHeight: number;
  /** World-pixel extent, including `YARD_MARGIN` on every side. */
  readonly width: number;
  readonly height: number;
  /** World pixels to add to an isometric pixel. */
  readonly originX: number;
  readonly originY: number;
  /** The plot's four corners in world pixels, clockwise from the top. */
  readonly corners: readonly Point[];
}

/**
 * Geometry for one expansion level.
 *
 * The plot spans `[-w/2, w/2) x [-h/2, h/2)` in yard units
 * (docs/specs/base-building.md §2), so its isometric diamond is symmetric about
 * the origin and half as tall as it is wide.
 */
export const yardBounds = (expansionLevel: number): YardBounds => {
  const [yardWidth, yardHeight] = yardSize(expansionLevel);
  const halfW = yardWidth / 2;
  const halfH = yardHeight / 2;

  // Corners in yard units, then in isometric pixels. Top, right, bottom, left.
  const iso = [
    toIso(-halfW, -halfH),
    toIso(halfW, -halfH),
    toIso(halfW, halfH),
    toIso(-halfW, halfH),
  ];

  // The diamond's extremes: x is +/- (w + h) / 2, y is +/- (w + h) / 4.
  const extentX = halfW + halfH;
  const extentY = (halfW + halfH) / 2;

  const originX = extentX + YARD_MARGIN;
  const originY = extentY + YARD_MARGIN;

  return {
    yardWidth,
    yardHeight,
    width: extentX * 2 + YARD_MARGIN * 2,
    height: extentY * 2 + YARD_MARGIN * 2,
    originX,
    originY,
    corners: iso.map((point) => ({ x: point.x + originX, y: point.y + originY })),
  };
};

/** A building's position in world pixels. */
export const yardToWorld = (bounds: YardBounds, x: number, y: number): Point => {
  const iso = toIso(x, y);
  return { x: iso.x + bounds.originX, y: iso.y + bounds.originY };
};

/* ── Footprints ───────────────────────────────────────────────────────────── */

/**
 * Footprint side length in yard units, by building type.
 *
 * Footprints are set per building class in its constructor rather than in the
 * props table, so this mirrors the table assembled in
 * docs/specs/base-building.md §2 ("Footprints"), which cites each
 * `client/scripts/BUILDING*.as` in turn. The `size` field in the props table is
 * a build-menu size class and is *not* the footprint except for decorations.
 */
const FOOTPRINT_GROUPS: readonly (readonly [size: number, types: readonly number[]])[] = [
  // Walls and traps.
  [20, [17, 18, 24, 117]],
  // Mushrooms (client/scripts/BUILDING7.as:9-10).
  [30, [7]],
  // Taunt sign.
  [40, [52]],
  // Harvesters, the general store and the small towers.
  [70, [1, 2, 3, 4, 12, 20, 21, 23, 25, 115, 118, 129, 130, 132, 136, 137]],
  [80, [6, 9, 19, 113]],
  [90, [5, 11, 22, 51]],
  [100, [8, 10, 13, 16, 26, 116, 119, 133, 134]],
  [130, [14, 112, 138, 139, 140]],
  [140, [27]],
  [160, [15, 114, 128]],
];

const FOOTPRINTS = new Map<number, number>();
for (const [size, types] of FOOTPRINT_GROUPS) {
  for (const type of types) FOOTPRINTS.set(type, size);
}

/**
 * The only non-square footprint: the Inferno Portal
 * (`client/scripts/INFERNOPORTAL.as:37`).
 */
const PORTAL: readonly [number, number] = [190, 160];

/**
 * Footprint for a type with no entry above and no `size` in the props table.
 *
 * Only one id reaches this: 111, the small Halloween pumpkin, which has no
 * `cls` at all (`client/scripts/YARD_PROPS.as:5901-5932`). `BASE.addBuildingB`
 * falls back to a bare `BFOUNDATION` when `cls` is missing, and that never
 * assigns a footprint, so the original has no answer either.
 */
export const DEFAULT_FOOTPRINT = 40;

/**
 * Footprint in yard units, as `[width, height]`.
 *
 * Decorations are not in the table above because they do not set a footprint in
 * a class constructor: `BDECORATION` takes the props table's `size` field
 * instead (`client/scripts/BDECORATION.as:20-25`). So anything the table does
 * not name falls through to that, which covers ids 28–50, 55–111, 120, 121, 131
 * and 135.
 */
export const footprintOf = (type: number): readonly [width: number, height: number] => {
  if (type === 127) return PORTAL;
  const size = FOOTPRINTS.get(type) ?? propsSize(type) ?? DEFAULT_FOOTPRINT;
  return [size, size];
};

/**
 * The footprint as an isometric diamond, in world pixels, for a building placed
 * at `(x, y)` yard units.
 *
 * `_footprint` rectangles start at the building's origin and extend positively
 * on both axes (`client/scripts/GRID.as:86-98` samples `x + rect.x` upwards), so
 * the origin is the footprint's *top* corner on screen, not its centre.
 */
export const footprintCorners = (
  bounds: YardBounds,
  type: number,
  x: number,
  y: number,
): Point[] => {
  const [width, height] = footprintOf(type);
  return [
    yardToWorld(bounds, x, y),
    yardToWorld(bounds, x + width, y),
    yardToWorld(bounds, x + width, y + height),
    yardToWorld(bounds, x, y + height),
  ];
};

/** The axis-aligned box of a footprint diamond, in world pixels. */
export const footprintBox = (
  bounds: YardBounds,
  type: number,
  x: number,
  y: number,
): Rect => {
  const [width, height] = footprintOf(type);
  const origin = yardToWorld(bounds, x, y);
  // Right corner is +width on x, bottom is +height on y; in isometric pixels
  // that is +width right and +width/2 down, and -height left and +height/2 down.
  const left = origin.x - height;
  const right = origin.x + width;
  const top = origin.y;
  const bottom = origin.y + (width + height) / 2;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/**
 * The centre of a footprint, in world pixels.
 *
 * Both diagonals of the diamond meet here, so it is the midpoint of the origin
 * and the far corner.
 */
export const footprintCentre = (
  bounds: YardBounds,
  type: number,
  x: number,
  y: number,
): Point => {
  const [width, height] = footprintOf(type);
  return yardToWorld(bounds, x + width / 2, y + height / 2);
};
