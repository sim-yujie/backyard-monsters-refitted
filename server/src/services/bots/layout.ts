import { footprintOf } from "../../game-data/buildingFootprints.js";
import { mulberry32, type Rng } from "../../game-rules/combat/rng.js";
import { MAX_EXPANSIONS, rectOf, withinBounds, yardSize } from "../yardplanner/layoutGeometry.js";
import { TOWN_HALL_TYPE } from "../yardplanner/costs.js";
import type { Persona } from "./progression.js";

/**
 * Where a bot's buildings stand (`docs/design/bot-neighbours.md` §4.2 step 2,
 * issue #238): a seeded layout that reads as a player's yard.
 *
 * ## The plan
 *
 * Each seed draws one plan up front: the Town Hall's spot near the middle of
 * the plot, and two rectangular wall rings round it (an inner ring round the
 * core, an outer one round the middle of the yard). Each ring is a path of
 * 20-unit wall cells cut into segments with one or two cell openings, filled
 * from a seeded start round the ring. Both rings are kept clear from the
 * first building on (plus a 10-unit walkway either side), so walls built
 * later always find their path free and nothing ever straddles a wall line.
 * The space between the rings takes the biggest buildings, so the outer ring
 * runs past the smallest plots; a wall cell outside the plot is skipped until
 * the plot grows to it. A third, larger ring takes walls the first two cannot
 * hold. Most bots never close the outer ring: it reads as broken segments.
 *
 * ## Zones
 *
 * A building's zone is measured as how far out it sits, as a share of the
 * outer ring (1 is on the outer ring, under 1 inside it):
 *
 * - the Town Hall in the middle, storage and the core buildings inside the
 *   inner ring;
 * - towers spread for coverage between the middle and the outer ring;
 * - Housing, Hatcheries, Bunkers and the other monster buildings in the ring
 *   between the walls;
 * - the Flinger, Catapult, Map Room and the like round the outer ring;
 * - harvesters outside it (nearer in while the yard is young, as a player
 *   who has not spread out yet);
 * - walls on the rings, traps in the ring openings and next to towers, a few
 *   decorations here and there.
 *
 * Each building tries a few dozen jittered spots in its zone, plus spots
 * lined up beside buildings of its own kind (players build rows), and keeps
 * the best by its zone, its neighbours (and for a tower, its distance from
 * the other towers) and a random share. Every spot is on the 5-unit build
 * grid real players' spots are on, inside the plot the bot owned when the
 * building was placed (`withinBounds`), and clear of every other footprint: the rule
 * the build route and the Yard Planner's Apply measure by
 * (`placementProblem`, `checkNodePlacement`). When the zone is full the
 * building looks further out, then takes the best free spot anywhere; only
 * a full plot makes the layout throw.
 *
 * ## Growth never moves a building
 *
 * Buildings are placed one at a time in id order, which is build order, and
 * each spot depends only on the seed, the buildings placed before it and the
 * plot the bot had at the level it was built at: each building draws from its
 * own stream of the seed. The progression's yard at a smaller target is a
 * prefix of its yard at a bigger one (`progression.ts`), so the layout of the
 * smaller yard is a prefix of the bigger one's too.
 *
 * ## Expansions
 *
 * The plot grows with the "More Yardage" purchases a player of that level
 * usually holds ({@link expansionFor}, `storedata.ENL.q`, at most 6 like the
 * sandbox yard). A building placed at a level uses the plot of that level.
 * In the rare yard whose free ground is too broken up for a big building, the
 * bot buys its next expansion early, as a player would, and keeps it: every
 * later building uses that plot too, and the yard's `ENL` counts it.
 *
 * ## Decorations
 *
 * A few decorations ({@link DECORATION_TYPES}) appear as the yard grows, one
 * after every few dozen buildings, up to {@link MAX_DECORATIONS}.
 *
 * ## Ids
 *
 * A player's building takes the next free id when it is placed
 * (`nextBuildingId`), decorations included, so the layout numbers the yard
 * the same way: buildings and decorations in the order they went up, from 1.
 * A decoration's place in that order depends only on how many buildings
 * stood before it, so a grown yard keeps every id the smaller one had.
 */

/** Every spot is snapped to the build grid (`mapRoom.ts`, `client/scripts/GRID.as`). */
export const GRID = 5;

/** The step of the first search over the whole plot: twice the grid, as `mapRoom.ts` searches. */
const SCAN_STEP = 10;

/** A wall block's side (`buildingFootprints.ts`, type 17). */
const WALL_CELL = 20;

/** Wall Block and the two traps (`buildingFootprints.ts`). */
export const WALL_TYPE = 17;
export const TRAP_TYPES: ReadonlySet<number> = new Set([24, 117]);

/** Past this distance from the nearest tower a tower gains nothing more by spreading `[PLACEHOLDER]`. */
const TOWER_SPREAD = 200;

/** How far a crowded zone looks past its band before trying every spot of the plot. */
const WIDEN = 0.4;

/** How much a trap prefers a ring opening to a spot by a tower `[PLACEHOLDER]`. */
const OPENING_BONUS = 1;

/** Walkway kept clear either side of a reserved wall line. */
const WALL_MARGIN = 10;

/** The most decorations a bot puts out `[PLACEHOLDER]`. */
export const MAX_DECORATIONS = 6;

/**
 * Decorations a bot may own: the flags, gnomes, flowers and garden pieces a
 * player picks up early, nothing from an event and no totem (they keep a
 * level) `[PLACEHOLDER]`.
 */
export const DECORATION_TYPES: readonly number[] = [
  28, 29, 30, 33, 35, 37, 41, 43, 45, 49, 50, 56, 57, 60, 61, 62, 63, 64, 67, 69, 70, 71, 87, 88, 91, 92, 93,
  94, 95, 105,
];

/**
 * The empire levels at which a player usually holds one more expansion
 * `[PLACEHOLDER]`; each seed shifts them all by -2 to +2 levels.
 */
export const EXPANSION_LEVELS: readonly number[] = [12, 18, 23, 28, 33, 37];

/** Salts that split the seed into independent streams. */
const SALT = {
  plan: 0x1b873593,
  expansion: 0x5bd1e995,
  building: 0x7feb352d,
  decorations: 0x846ca68b,
} as const;

/** A stream of the seed for `salt` and `index`, independent of every other. */
const streamOf = (seed: number, salt: number, index = 0): Rng =>
  mulberry32((Math.imul((Math.floor(seed) ^ salt) >>> 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca77)) >>> 0);

/** A uniform draw in `[min, max)`. */
const between = (rng: Rng, min: number, max: number): number => min + (max - min) * rng.float();

const snap = (value: number, step = GRID): number => Math.round(value / step) * step || 0;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** The yard expansions (`storedata.ENL.q`) a bot of `level` holds, for its seed. */
export const expansionFor = (seed: number, level: number): number => {
  const shift = streamOf(seed, SALT.expansion).int(5) - 2;
  const held = EXPANSION_LEVELS.filter((at) => level >= at + shift).length;
  return Math.min(held, MAX_EXPANSIONS);
};

/** What a building is laid out as. */
type Role = "hall" | "core" | "tower" | "bunker" | "army" | "utility" | "harvester" | "wall" | "trap" | "decoration";

const ROLE_OF: Readonly<Record<number, Role>> = {
  [TOWN_HALL_TYPE]: "hall",
  // Storage Silo, General Store, Monster Locker, Monster Academy.
  6: "core",
  12: "core",
  8: "core",
  26: "core",
  // Towers.
  20: "tower",
  21: "tower",
  23: "tower",
  25: "tower",
  115: "tower",
  118: "tower",
  22: "bunker",
  // Monster buildings.
  9: "army",
  13: "army",
  15: "army",
  16: "army",
  114: "army",
  116: "army",
  119: "army",
  // Flinger, Yard Planner, Map Room, Wild Monster Baiter, Catapult.
  5: "utility",
  10: "utility",
  11: "utility",
  19: "utility",
  51: "utility",
  // Harvesters.
  1: "harvester",
  2: "harvester",
  3: "harvester",
  4: "harvester",
  [WALL_TYPE]: "wall",
  24: "trap",
  117: "trap",
};

const roleOf = (type: number): Role => ROLE_OF[type] ?? (footprintOf(type).decoration ? "decoration" : "utility");

/** Types laid out as one group: built side by side, as players do. Hatcheries keep their control centre. */
const groupOf = (type: number): number => (type === 16 ? 13 : type);

/** Roles that line up beside their own kind. */
const CLUSTERED: ReadonlySet<Role> = new Set(["core", "army", "harvester", "decoration"]);

/** One cell of a wall ring's path. */
interface WallSlot {
  x: number;
  y: number;
  opening: boolean;
}

/** A rectangular wall ring round the plan's centre. */
interface Ring {
  /** Half extents of its outer edge. */
  hx: number;
  hy: number;
  /** Its cells, in the order walls fill them. */
  slots: WallSlot[];
}

/** A seed's layout plan (see the file comment). */
interface Plan {
  cx: number;
  cy: number;
  /** Inner, outer, overflow. */
  rings: [Ring, Ring, Ring];
  /** How strongly buildings line up beside their own kind. */
  align: number;
  /** How far out each role sits, in shares of the outer ring. */
  bands: Readonly<Record<Role, { min: number; max: number }>>;
}

/**
 * The cells of a ring with outer half extents `hx`, `hy` round `cx`, `cy`,
 * from a seeded start, round the ring, cut into segments by openings.
 */
const ringSlots = (rng: Rng, cx: number, cy: number, hx: number, hy: number): WallSlot[] => {
  const left = cx - hx;
  const right = cx + hx - WALL_CELL;
  const top = cy - hy;
  const bottom = cy + hy - WALL_CELL;
  const path: { x: number; y: number }[] = [];
  for (let x = left; x < right; x += WALL_CELL) path.push({ x, y: top });
  for (let y = top; y < bottom; y += WALL_CELL) path.push({ x: right, y });
  for (let x = right; x > left; x -= WALL_CELL) path.push({ x, y: bottom });
  for (let y = bottom; y > top; y -= WALL_CELL) path.push({ x: left, y });

  const start = rng.int(path.length);
  const slots: WallSlot[] = [];
  let run = 5 + rng.int(10);
  let gap = 0;
  for (let i = 0; i < path.length; i++) {
    const cell = path[(start + i) % path.length]!;
    if (gap > 0) {
      slots.push({ ...cell, opening: true });
      if (--gap === 0) run = 5 + rng.int(10);
      continue;
    }
    slots.push({ ...cell, opening: false });
    if (--run === 0) gap = 1 + rng.int(2);
  }
  return slots;
};

/** The seed's plan: centre, rings, bands. */
const planFor = (seed: number, persona: Persona): Plan => {
  const rng = streamOf(seed, SALT.plan);
  const cx = snap(between(rng, -40, 40), GRID);
  const cy = snap(between(rng, -40, 40), GRID);
  // The space between the rings takes the biggest buildings (160) with a walkway
  // either side. The outer ring runs past the smallest plots: its walls go up
  // once the plot has grown to them, by which time a player has that many.
  const hx1 = snap(between(rng, 220, 270), 10);
  const hy1 = snap(between(rng, 180, 220), 10);
  const hx2 = hx1 + snap(between(rng, 230, 270), 10);
  const hy2 = hy1 + snap(between(rng, 230, 270), 10);
  const hx3 = hx2 + snap(between(rng, 90, 130), 10);
  const hy3 = hy2 + snap(between(rng, 90, 130), 10);
  const rings: [Ring, Ring, Ring] = [
    { hx: hx1, hy: hy1, slots: ringSlots(rng, cx, cy, hx1, hy1) },
    { hx: hx2, hy: hy2, slots: ringSlots(rng, cx, cy, hx2, hy2) },
    { hx: hx3, hy: hy3, slots: ringSlots(rng, cx, cy, hx3, hy3) },
  ];
  const core = Math.max(hx1 / hx2, hy1 / hy2);
  const towersIn = persona === "towers" ? 0.15 : 0;
  return {
    cx,
    cy,
    rings,
    align: between(rng, 0.5, 1.2),
    bands: {
      hall: { min: 0, max: 0.1 },
      core: { min: 0.1, max: core - 0.1 },
      tower: { min: 0.25 - towersIn / 2, max: 1.2 - towersIn },
      bunker: { min: 0.55, max: 0.95 },
      army: { min: core + 0.05, max: persona === "army" ? 0.9 : 1 },
      utility: { min: 0.8, max: 1.3 },
      harvester: { min: 1.1, max: persona === "economy" ? 1.6 : 1.9 },
      wall: { min: 0.9, max: 1.4 },
      trap: { min: 0.3, max: 1 },
      decoration: { min: 0.2, max: 1.3 },
    },
  };
};

/**
 * How far out a young yard's harvesters and utility buildings sit, as a share
 * of their band: 0.65 at level 1 to the whole band by level 25.
 */
const reachAt = (level: number): number => 0.65 + 0.35 * clamp((level - 1) / 24, 0, 1);

/** Cell marks: what may stand on a cell of the reserved wall lines. */
const FREE = 0;
const WALKWAY = 1;
const WALL_LINE = 2;
const OPENING = 3;

/** What each kind of thing may stand on. */
const ON_FREE = 1 << FREE;
const ON_WALKWAY = 1 << WALKWAY;
const ON_WALL_LINE = 1 << WALL_LINE;
const ON_OPENING = 1 << OPENING;
const ANYWHERE = ON_FREE | ON_WALKWAY | ON_WALL_LINE | ON_OPENING;

/** The occupancy grid over the largest plot, one cell per {@link GRID} units. */
class Grid {
  private readonly ox: number;
  private readonly oy: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly taken: Uint8Array;
  private readonly marks: Uint8Array;

  constructor() {
    const [width, height] = yardSize(MAX_EXPANSIONS);
    this.ox = -width / 2;
    this.oy = -height / 2;
    this.cols = width / GRID;
    this.rows = height / GRID;
    this.taken = new Uint8Array(this.cols * this.rows);
    this.marks = new Uint8Array(this.cols * this.rows);
  }

  /** The cell span of a rectangle, or null when it leaves the grid. */
  private span(x: number, y: number, w: number, h: number): [number, number, number, number] | null {
    const c0 = Math.floor((x - this.ox) / GRID);
    const r0 = Math.floor((y - this.oy) / GRID);
    const c1 = Math.ceil((x + w - this.ox) / GRID);
    const r1 = Math.ceil((y + h - this.oy) / GRID);
    if (c0 < 0 || r0 < 0 || c1 > this.cols || r1 > this.rows) return null;
    return [c0, r0, c1, r1];
  }

  /** Marks a rectangle of a reserved wall line; a stronger mark wins. */
  mark(x: number, y: number, w: number, h: number, mark: number): void {
    const span = this.span(x, y, w, h);
    if (!span) return;
    const [c0, r0, c1, r1] = span;
    for (let r = r0; r < r1; r++) {
      for (let i = r * this.cols + c0, end = r * this.cols + c1; i < end; i++) {
        if (this.marks[i]! < mark) this.marks[i] = mark;
      }
    }
  }

  /** Whether a footprint is free and every cell's mark is one `allowed` lets it stand on. */
  free(x: number, y: number, w: number, h: number, allowed: number): boolean {
    const span = this.span(x, y, w, h);
    if (!span) return false;
    const [c0, r0, c1, r1] = span;
    for (let r = r0; r < r1; r++) {
      for (let i = r * this.cols + c0, end = r * this.cols + c1; i < end; i++) {
        if (this.taken[i] || ((1 << this.marks[i]!) & allowed) === 0) return false;
      }
    }
    return true;
  }

  take(x: number, y: number, w: number, h: number): void {
    const span = this.span(x, y, w, h);
    if (!span) return;
    const [c0, r0, c1, r1] = span;
    for (let r = r0; r < r1; r++) this.taken.fill(1, r * this.cols + c0, r * this.cols + c1);
  }
}

/** One building the layout places, in build order: its type and the empire level it was built at. */
export interface LayoutEntry {
  t: number;
  /** The empire level the yard stood at when it was built (`builtAtLevel`). */
  level: number;
}

/** A placed footprint origin, with the yard id it went up with. */
export interface PlacedSpot {
  id: number;
  t: number;
  X: number;
  Y: number;
}

/** The layout of a bot's yard. */
export interface BotLayout {
  /** Every building's spot and id, in the order given. */
  buildings: PlacedSpot[];
  /** The decorations, in id order. */
  decorations: PlacedSpot[];
  /** `storedata.ENL.q`: what the yard's level usually holds, or more if the bot bought early. */
  expansion: number;
}

/** A spot being weighed. */
interface Candidate {
  x: number;
  y: number;
  score: number;
}

/** The layout run: one plan, one grid, buildings placed one at a time. */
class Layout {
  private readonly grid = new Grid();
  private readonly towers: { x: number; y: number }[] = [];
  private readonly byGroup = new Map<number, PlacedSpot[]>();
  private readonly slotUsed: boolean[][];
  /** Expansions bought early because a building found no room (see the file comment). */
  bought = 0;

  constructor(
    private readonly seed: number,
    private readonly plan: Plan
  ) {
    this.slotUsed = plan.rings.map((ring) => ring.slots.map(() => false));
    // The inner and outer rings are kept clear from the start (see the file comment).
    for (const ring of plan.rings.slice(0, 2)) {
      for (const slot of ring.slots) {
        this.grid.mark(
          slot.x - WALL_MARGIN,
          slot.y - WALL_MARGIN,
          WALL_CELL + 2 * WALL_MARGIN,
          WALL_CELL + 2 * WALL_MARGIN,
          WALKWAY
        );
      }
      for (const slot of ring.slots) {
        this.grid.mark(slot.x, slot.y, WALL_CELL, WALL_CELL, slot.opening ? OPENING : WALL_LINE);
      }
    }
  }

  /** How far out a footprint's centre sits, in shares of the outer ring. */
  private reach(type: number, x: number, y: number): number {
    const { w, h } = footprintOf(type);
    const outer = this.plan.rings[1];
    const dx = Math.abs(x + w / 2 - this.plan.cx) / outer.hx;
    const dy = Math.abs(y + h / 2 - this.plan.cy) / outer.hy;
    return Math.max(dx, dy);
  }

  private fits(type: number, x: number, y: number, expansion: number, allowed: number): boolean {
    const { w, h } = footprintOf(type);
    return withinBounds(rectOf(type, x, y), expansion) && this.grid.free(x, y, w, h, allowed);
  }

  private put(id: number, type: number, x: number, y: number): PlacedSpot {
    const { w, h } = footprintOf(type);
    this.grid.take(x, y, w, h);
    const spot = { id, t: type, X: x, Y: y };
    if (roleOf(type) === "tower") this.towers.push({ x: x + w / 2, y: y + h / 2 });
    const group = this.byGroup.get(groupOf(type)) ?? [];
    group.push(spot);
    this.byGroup.set(groupOf(type), group);
    return spot;
  }

  /** The band a building of `type` built at `level` aims for. */
  private bandOf(role: Role, level: number): { min: number; max: number } {
    const band = this.plan.bands[role];
    if (role !== "harvester" && role !== "utility") return band;
    const reach = reachAt(level);
    return { min: band.min * reach, max: band.max * reach };
  }

  /** A spot's score: lower is better (see the file comment). */
  private score(rng: Rng, type: number, role: Role, level: number, x: number, y: number): number {
    const { w, h } = footprintOf(type);
    const band = this.bandOf(role, level);
    const reach = this.reach(type, x, y);
    let score = 0;
    if (reach < band.min) score += (band.min - reach) / 0.05;
    if (reach > band.max) score += (reach - band.max) / 0.05;
    score += rng.float() * 0.6;

    const cx = x + w / 2;
    const cy = y + h / 2;
    if (CLUSTERED.has(role) || role === "wall") {
      const kin = this.byGroup.get(groupOf(type)) ?? [];
      let nearest = Number.POSITIVE_INFINITY;
      for (const other of kin) {
        const size = footprintOf(other.t);
        const gapX = Math.max(other.X - (x + w), x - (other.X + size.w), 0);
        const gapY = Math.max(other.Y - (y + h), y - (other.Y + size.h), 0);
        nearest = Math.min(nearest, Math.max(gapX, gapY));
      }
      if (Number.isFinite(nearest)) score += (Math.min(nearest, 200) / 100) * this.plan.align;
    }
    if (role === "tower" && this.towers.length > 0) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const tower of this.towers) nearest = Math.min(nearest, Math.hypot(tower.x - cx, tower.y - cy));
      // Spread out, but a tower hard by another reads as a mistake, not cover.
      score -= Math.min(nearest, TOWER_SPREAD) / 100;
      if (nearest < TOWER_SPREAD / 2) score += 3;
    }
    if ((role === "bunker" || role === "trap") && this.towers.length > 0) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const tower of this.towers) nearest = Math.min(nearest, Math.hypot(tower.x - cx, tower.y - cy));
      score += nearest / (role === "trap" ? 80 : 250);
    }
    return score;
  }

  /** Jittered spots in a building's band (widened by `widen` both ways), round the plan's centre. */
  private zoneSpots(
    rng: Rng,
    type: number,
    role: Role,
    level: number,
    count: number,
    widen = 0
  ): { x: number; y: number }[] {
    const { w, h } = footprintOf(type);
    const own = this.bandOf(role, level);
    const band = { min: Math.max(0, own.min - widen), max: own.max + widen };
    const outer = this.plan.rings[1];
    const spots: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const reach = between(rng, band.min, Math.max(band.max, band.min + 0.01));
      // A point on the rectangle `reach` of the way out, anywhere round it.
      const along = rng.float() * 4;
      const side = Math.floor(along);
      const t = (along - side) * 2 - 1;
      const [ux, uy] = side === 0 ? [t, -1] : side === 1 ? [1, t] : side === 2 ? [-t, 1] : [-1, -t];
      const x = this.plan.cx + ux * reach * outer.hx - w / 2 + between(rng, -15, 15);
      const y = this.plan.cy + uy * reach * outer.hy - h / 2 + between(rng, -15, 15);
      spots.push({ x: snap(x), y: snap(y) });
    }
    return spots;
  }

  /** Spots lined up beside buildings of the same group: touching or a walkway apart. */
  private besideKin(rng: Rng, type: number, count: number): { x: number; y: number }[] {
    const kin = this.byGroup.get(groupOf(type)) ?? [];
    if (kin.length === 0) return [];
    const { w, h } = footprintOf(type);
    const spots: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const other = kin[rng.int(kin.length)]!;
      const size = footprintOf(other.t);
      const gap = [0, 0, 10, 20][rng.int(4)]!;
      const side = rng.int(4);
      if (side === 0) spots.push({ x: other.X + size.w + gap, y: other.Y });
      else if (side === 1) spots.push({ x: other.X - w - gap, y: other.Y });
      else if (side === 2) spots.push({ x: other.X, y: other.Y + size.h + gap });
      else spots.push({ x: other.X, y: other.Y - h - gap });
    }
    return spots;
  }

  /** Spots next to towers, for a trap. */
  private besideTowers(rng: Rng, count: number): { x: number; y: number }[] {
    if (this.towers.length === 0) return [];
    const spots: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const tower = this.towers[rng.int(this.towers.length)]!;
      const angle = rng.float() * Math.PI * 2;
      const distance = between(rng, 50, 90);
      spots.push({
        x: snap(tower.x + Math.cos(angle) * distance - 10),
        y: snap(tower.y + Math.sin(angle) * distance - 10),
      });
    }
    return spots;
  }

  /** The best of `spots` that fits, or null. */
  private best(
    rng: Rng,
    type: number,
    role: Role,
    level: number,
    expansion: number,
    allowed: number,
    spots: readonly { x: number; y: number; bonus?: number }[]
  ): Candidate | null {
    let best: Candidate | null = null;
    for (const spot of spots) {
      if (!this.fits(type, spot.x, spot.y, expansion, allowed)) continue;
      const score = this.score(rng, type, role, level, spot.x, spot.y) - (spot.bonus ?? 0);
      if (!best || score < best.score) best = { x: spot.x, y: spot.y, score };
    }
    return best;
  }

  /** Every spot of the plot `step` apart, for the last resort. */
  private everySpot(type: number, expansion: number, step: number): { x: number; y: number }[] {
    const [width, height] = yardSize(expansion);
    const { w, h } = footprintOf(type);
    const spots: { x: number; y: number }[] = [];
    for (let y = -height / 2; y + h <= height / 2; y += step) {
      for (let x = -width / 2; x + w <= width / 2; x += step) spots.push({ x, y });
    }
    return spots;
  }

  /** The next wall cell along the rings that is still free, or null. */
  private wallSlot(expansion: number): { x: number; y: number } | null {
    for (let r = 0; r < this.plan.rings.length; r++) {
      const ring = this.plan.rings[r]!;
      const used = this.slotUsed[r]!;
      for (let i = 0; i < ring.slots.length; i++) {
        const slot = ring.slots[i]!;
        if (used[i] || slot.opening) continue;
        if (!this.fits(WALL_TYPE, slot.x, slot.y, expansion, ON_FREE | ON_WALKWAY | ON_WALL_LINE)) continue;
        used[i] = true;
        return slot;
      }
    }
    return null;
  }

  /** The ring openings still free, for a trap. */
  private openings(): { x: number; y: number }[] {
    const spots: { x: number; y: number }[] = [];
    for (const ring of this.plan.rings.slice(0, 2)) {
      for (const slot of ring.slots) if (slot.opening) spots.push(slot);
    }
    return spots;
  }

  /** Places one building (see the file comment) and returns its spot. */
  place(id: number, type: number, level: number): PlacedSpot {
    const expansion = Math.max(expansionFor(this.seed, level), this.bought);
    const role = roleOf(type);
    const rng = streamOf(this.seed, SALT.building, id);
    const { w, h } = footprintOf(type);

    if (role === "hall") {
      const x = snap(this.plan.cx - w / 2);
      const y = snap(this.plan.cy - h / 2);
      if (this.fits(type, x, y, expansion, ON_FREE)) return this.put(id, type, x, y);
    }
    if (role === "wall") {
      const slot = this.wallSlot(expansion);
      if (slot) return this.put(id, type, slot.x, slot.y);
    }

    const allowed = role === "wall" ? ON_FREE | ON_WALKWAY : role === "trap" ? ON_FREE | ON_WALKWAY | ON_OPENING : ON_FREE;
    const spots: { x: number; y: number; bonus?: number }[] = this.zoneSpots(rng, type, role, level, 40);
    if (CLUSTERED.has(role) || role === "wall") spots.push(...this.besideKin(rng, type, 24));
    if (role === "trap") {
      spots.push(...this.besideTowers(rng, 24));
      const openings = this.openings();
      for (let i = 0; i < 8 && openings.length > 0; i++) {
        spots.push({ ...openings[rng.int(openings.length)]!, bonus: OPENING_BONUS });
      }
    }

    let found =
      this.best(rng, type, role, level, expansion, allowed, spots) ??
      this.best(rng, type, role, level, expansion, allowed, this.zoneSpots(rng, type, role, level, 160, WIDEN)) ??
      this.best(rng, type, role, level, expansion, allowed, this.everySpot(type, expansion, SCAN_STEP)) ??
      // A gap a footprint just fills may start on an odd 5: try every grid spot before giving up.
      this.best(rng, type, role, level, expansion, ANYWHERE, this.everySpot(type, expansion, GRID));
    for (let more = expansion + 1; !found && more <= MAX_EXPANSIONS; more++) {
      found = this.best(rng, type, role, level, more, allowed, this.everySpot(type, more, SCAN_STEP));
      if (found) this.bought = more;
    }
    if (!found) throw new Error(`No room in the bot's yard for building ${id} (type ${type}).`);
    return this.put(id, type, found.x, found.y);
  }
}

/**
 * The decorations' place in the build order: decoration `k` is put out once
 * `after` buildings stand, the first after 10 to 29, each next 20 to 59 later.
 */
const decorationPlan = (seed: number): { after: number; t: number }[] => {
  const rng = streamOf(seed, SALT.decorations);
  const plan: { after: number; t: number }[] = [];
  let after = 10 + rng.int(20);
  for (let k = 0; k < MAX_DECORATIONS; k++) {
    plan.push({ after, t: DECORATION_TYPES[rng.int(DECORATION_TYPES.length)]! });
    after += 20 + rng.int(40);
  }
  return plan;
};

/**
 * Lays out and numbers a bot's yard (see the file comment). Pure: the same
 * seed, persona and buildings always give the same spots and ids, and the
 * result for a prefix of `entries` is a prefix of the result for the whole.
 *
 * @param seed - `bot.seed`.
 * @param persona - `bot.persona`.
 * @param entries - Every building in build order, with the level it was built at.
 * @param level - The yard's empire level now, for its expansions.
 */
export const layoutBotYard = (
  seed: number,
  persona: Persona,
  entries: readonly LayoutEntry[],
  level: number
): BotLayout => {
  const layout = new Layout(seed, planFor(seed, persona));
  const decorations = decorationPlan(seed);
  const buildings: PlacedSpot[] = [];
  const placedDecorations: PlacedSpot[] = [];
  let nextId = 1;
  for (const entry of entries) {
    buildings.push(layout.place(nextId++, entry.t, entry.level));
    const next = decorations[placedDecorations.length];
    if (next && buildings.length >= next.after) {
      placedDecorations.push(layout.place(nextId++, next.t, entry.level));
    }
  }
  return {
    buildings,
    decorations: placedDecorations,
    expansion: Math.max(expansionFor(seed, level), layout.bought),
  };
};
