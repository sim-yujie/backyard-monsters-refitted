import { Sprite, type Container } from "pixi.js";
import { creepZIndex, MonsterSheetTextures } from "@/game/attack/AttackBattleLayer";
import { anchorOffset, frameRow, sheetColumn, spriteFor } from "@/game/attack/monsterSprites";
import {
  buildEngineYard,
  buildPathGrid,
  mulberry32,
  type CombatBuildingData,
  type EngineBuilding,
} from "@/game/combat/rules";
import { boxAround } from "./StagedRaidLayer";
import type { YardPoint } from "./stagedRaid";

/**
 * New monsters walking into the yard to their Housing (issue #227): Bob's 15
 * free Pokeys in the guided start (`docs/design/tutorial.md` §2.3 step 8),
 * and, for the Goals package, a monster reward arriving. Hatched monsters walk
 * the same way from their Hatchery (#228, {@link walkOutOfHatchery}). Drawing
 * only: the server houses them.
 *
 * They start in a loose line past `from` and walk to `to`, then fade there,
 * as if going in. Ends by itself; {@link destroy} takes it down early.
 *
 * They stand among the buildings, sorted as the pens' monsters and the attack
 * screen's creeps are (`creepZIndex`), so a building they pass behind hides
 * them (#272), as Flash's hatched monsters were: it spawns them into the
 * buildings' own layer (`MAP._BUILDINGTOPS`, `client/scripts/HOUSING.as:131`).
 * They used to be drawn over every building.
 *
 * They walk round the buildings in their way rather than through them, on the
 * route Flash's pathing gives a monster heading home ({@link routeBetween}),
 * in single file. With no route they walk straight, in a loose line.
 */

/** Yard units a second. */
const SPEED = 110;
/** Seconds between one monster setting off and the next. */
const STAGGER = 0.18;
/** Seconds a monster takes to fade at the door. */
const FADE = 0.35;
const TICKS_PER_SECOND = 80;

export interface WalkInOptions {
  /** Monster id, e.g. `C1`. */
  readonly monster: string;
  /** How many walk in (a few at most are drawn; the rest is implied). */
  readonly count: number;
  /** Where they come from: the yard's edge. */
  readonly from: YardPoint;
  /** The Housing's centre. */
  readonly to: YardPoint;
  /**
   * Yard points from `from` to `to` round the buildings ({@link routeBetween}),
   * or absent for the straight walk.
   */
  readonly route?: readonly YardPoint[] | null;
  /**
   * Called once when the walk is over: the last has gone in, or it was taken
   * down before that. The caller lets the pens show them from here (#228).
   */
  readonly onEnd?: () => void;
}

/** The most drawn at once; more read as a crowd anyway. */
export const MAX_WALKERS = 15;

/** Walkers' depth tie-break ids start here, clear of the pens' walkers. */
const WALK_IN_DEPTH_ID = 800;

/** What a walk is drawn on: the yard renderer. */
export interface WalkInHost {
  yardToWorld(x: number, y: number): { x: number; y: number };
  /** Puts a sprite among the buildings, sorted by its `zIndex`, until `leaveBuildings`. */
  standAmongBuildings(child: Container): void;
  leaveBuildings(child: Container): void;
}

/** The depth-sort key of walker `index` standing at world `ground` (#272). */
export const walkerZIndex = (ground: { x: number; y: number }, index: number): number =>
  creepZIndex(ground.x, ground.y, WALK_IN_DEPTH_ID + index);

/** Yard units ahead a walker on a route looks to face its way, over the route's 10-unit steps. */
const LOOK_AHEAD = 30;

/** How long a route is, in yard units. */
const lengthOf = (route: readonly YardPoint[]): number => {
  let total = 0;
  for (let index = 1; index < route.length; index++) {
    const from = route[index - 1]!;
    const to = route[index]!;
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
};

/** The point `distance` yard units along a route, clamped to its ends. */
const pointAlong = (route: readonly YardPoint[], distance: number): YardPoint => {
  let left = Math.max(0, distance);
  for (let index = 1; index < route.length; index++) {
    const from = route[index - 1]!;
    const to = route[index]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length > 0 && left <= length) {
      const k = left / length;
      return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    }
    left -= length;
  }
  return route[route.length - 1]!;
};

/** Walker `index` on a route: single file, each `STAGGER` behind the one before. */
const walkerOnRoute = (
  route: readonly YardPoint[],
  index: number,
  t: number,
): { x: number; y: number; alpha: number; done: boolean; heading: number } => {
  const total = lengthOf(route);
  const walked = Math.max(0, t - index * STAGGER) * SPEED;
  const at = pointAlong(route, walked);
  // Facing a point a little ahead smooths the route's stair steps; at the end,
  // the last step's way.
  let ahead = pointAlong(route, walked + LOOK_AHEAD);
  let back = at;
  if (Math.hypot(ahead.x - at.x, ahead.y - at.y) < 1) {
    ahead = route[route.length - 1]!;
    back = pointAlong(route, total - LOOK_AHEAD);
  }
  const over = Math.max(0, walked - total) / SPEED;
  return {
    x: at.x,
    y: at.y,
    alpha: over <= 0 ? 1 : Math.max(0, 1 - over / FADE),
    done: over >= FADE,
    heading: Math.atan2(ahead.y - back.y, ahead.x - back.x),
  };
};

/** Where walker `index` is `t` seconds in, and whether it has gone in. */
export const walkerAt = (
  options: Pick<WalkInOptions, "from" | "to" | "route">,
  index: number,
  t: number,
): { x: number; y: number; alpha: number; done: boolean; heading: number } => {
  if (options.route && options.route.length >= 2) return walkerOnRoute(options.route, index, t);
  const dx = options.to.x - options.from.x;
  const dy = options.to.y - options.from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  // A loose column: each one a little to the side of the line.
  const side = ((index % 3) - 1) * 18;
  const start = { x: options.from.x - uy * side, y: options.from.y + ux * side };
  const walked = Math.max(0, t - index * STAGGER) * SPEED;
  const travel = Math.hypot(options.to.x - start.x, options.to.y - start.y);
  const along = Math.min(walked, travel);
  const k = travel > 0 ? along / travel : 1;
  const over = Math.max(0, walked - travel) / SPEED;
  return {
    x: start.x + (options.to.x - start.x) * k,
    y: start.y + (options.to.y - start.y) * k,
    alpha: over <= 0 ? 1 : Math.max(0, 1 - over / FADE),
    done: over >= FADE,
    heading: Math.atan2(uy, ux),
  };
};

/** Monster Housing (`YARD_PROPS.as`). */
const HOUSING_TYPE = 15;

/** One building as the walk reads it. */
export interface WalkInBuilding {
  readonly id?: number;
  readonly type: number;
  readonly x: number;
  readonly y: number;
  readonly footprint: readonly [number, number];
  /** Health; null or absent is whole. A Housing at zero is no pen (`yardLifeModel`). */
  readonly hp?: number | null;
  /** What the pathing grid prices a wall block at; absent is level 1. */
  readonly level?: number;
}

/** The yard as the walk-in reads it: where Housing stands and how wide the plot is. */
export interface WalkInYard {
  readonly buildings: readonly WalkInBuilding[];
  readonly bounds: { readonly yardWidth: number };
}

const centreOf = (building: WalkInBuilding): YardPoint => ({
  x: building.x + building.footprint[0] / 2,
  y: building.y + building.footprint[1] / 2,
});

/** Side of the square a route floods out of at its end, as Flash's 10 x 10 target rectangle. */
const ROUTE_TARGET = 10;

/**
 * A route from `from` to `to` round the buildings, in yard units, or null when
 * the grid finds none (the walk is then straight).
 *
 * It is the path Flash gives a monster heading for Housing
 * (`CreepBase.as:152-160`, `MonsterBase.changeModeHousing`): `PATHING.GetPath`
 * to a 10 x 10 square in the pen, walls ignored. The same grid the attack
 * engine walks creeps on (`combat/rules/grid.ts`) prices every cell at 10 and
 * a building's middle at 200 or more, so the route skirts buildings and goes
 * into a Housing by its gate; with walls ignored a wall block costs 20, which
 * Flash's monsters crossed too. Flash starts the walk at the Hatchery's top
 * corner; ours steps out of its front corner (#228).
 */
export const routeBetween = (yard: WalkInYard, from: YardPoint, to: YardPoint): YardPoint[] | null => {
  const buildingdata: CombatBuildingData[] = [];
  const buildinghealthdata: Record<string, number> = {};
  yard.buildings.forEach((building, index) => {
    // Ids only have to be unique here: the grid never looks a building up.
    const id = building.id ?? 1_000_000 + index;
    buildingdata.push({ id, t: building.type, X: building.x, Y: building.y, l: building.level ?? 1 });
    if (building.hp != null) buildinghealthdata[String(id)] = building.hp;
  });
  const grid = buildPathGrid(buildEngineYard({ buildingdata, buildinghealthdata }));
  // The flood reads only where the target is and how big: a square, not a building.
  const target = {
    cx: Math.trunc(to.x) - ROUTE_TARGET / 2,
    cy: Math.trunc(to.y) - ROUTE_TARGET / 2,
    w: ROUTE_TARGET,
    h: ROUTE_TARGET,
  } as EngineBuilding;
  // Walls ignored, nothing scatters: the stream only jiggles each waypoint.
  const result = grid.path({ fromX: from.x, fromY: from.y, target, ignoreWalls: true }, mulberry32(1));
  if (!result.reached || result.waypoints.length < 2) return null;
  // The first waypoint is the start's own cell and the last is pushed twice
  // (`grid.ts` fidelity note 4): the walk's real ends replace them.
  return [from, ...result.waypoints.slice(1, -1), to];
};

/**
 * New monsters walking into the yard's first Housing from the plot's east
 * edge, started at once: the guided start's Pokeys and Goals' monster
 * rewards. Null when there is no Housing to walk to; `onEnd` is then never
 * called.
 */
export const walkIntoHousing = (
  host: WalkInHost,
  yard: WalkInYard,
  monster: string,
  count: number,
  onEnd?: () => void,
): MonsterWalkIn | null => {
  const housing = yard.buildings.find((building) => building.type === HOUSING_TYPE);
  if (!housing || count <= 0) return null;
  const to = centreOf(housing);
  const from = { x: yard.bounds.yardWidth / 2, y: to.y };
  const route = routeBetween(yard, from, to);
  const walk = new MonsterWalkIn(host, { monster, count, from, to, route, ...(onEnd ? { onEnd } : {}) });
  walk.start();
  return walk;
};

/**
 * Where a hatched monster comes out and where it goes (#228): from the front
 * corner of its Hatchery's footprint, the one nearest the viewer, so it steps
 * out in front of the building rather than over it, to the middle of the
 * standing Housing nearest that Hatchery. Null when either is missing.
 */
export const hatcheryWalk = (
  yard: WalkInYard,
  hatchery: number,
): { from: YardPoint; to: YardPoint } | null => {
  const source = yard.buildings.find((building) => building.id === hatchery);
  if (!source) return null;
  const start = centreOf(source);
  let to: YardPoint | null = null;
  let best = Infinity;
  for (const building of yard.buildings) {
    if (building.type !== HOUSING_TYPE || (building.hp != null && building.hp <= 0)) continue;
    const centre = centreOf(building);
    const distance = Math.hypot(centre.x - start.x, centre.y - start.y);
    if (distance < best) {
      best = distance;
      to = centre;
    }
  }
  if (!to) return null;
  return { from: { x: source.x + source.footprint[0], y: source.y + source.footprint[1] }, to };
};

/**
 * Hatched monsters walking from their Hatchery to the nearest Housing (#228),
 * started at once. Null when there is nobody to walk, or no Hatchery or
 * Housing to walk between; `onEnd` is then never called.
 */
export const walkOutOfHatchery = (
  host: WalkInHost,
  yard: WalkInYard,
  hatchery: number,
  monster: string,
  count: number,
  onEnd?: () => void,
): MonsterWalkIn | null => {
  const route = count > 0 ? hatcheryWalk(yard, hatchery) : null;
  if (!route) return null;
  const path = routeBetween(yard, route.from, route.to);
  const walk = new MonsterWalkIn(host, { monster, count, ...route, route: path, ...(onEnd ? { onEnd } : {}) });
  walk.start();
  return walk;
};

export class MonsterWalkIn {
  private readonly sprites: Sprite[] = [];
  private readonly textures = new MonsterSheetTextures();
  private frame: number | null = null;
  private started: number | null = null;
  private ended = false;

  constructor(
    private readonly host: WalkInHost,
    private readonly options: WalkInOptions,
  ) {
    const sheet = spriteFor(options.monster);
    if (sheet) this.textures.preload(sheet);
  }

  /** The world rectangle the walk crosses, for Bob's spotlight (fixed for the walk). */
  worldBox(): { x: number; y: number; width: number; height: number } | null {
    if (this.ended) return null;
    const { from, to, route } = this.options;
    const points = route && route.length >= 2 ? route : [from, to];
    return boxAround(
      points.map((point) => this.host.yardToWorld(point.x, point.y)),
      60,
    );
  }

  start(): void {
    if (this.frame !== null || this.ended) return;
    const shown = Math.max(1, Math.min(MAX_WALKERS, this.options.count));
    const sheet = spriteFor(this.options.monster);
    const step = (time: number): void => {
      this.started ??= time;
      const t = (time - this.started) / 1000;
      let all = true;
      for (let index = 0; index < shown; index++) {
        const at = walkerAt(this.options, index, t);
        if (!at.done) all = false;
        let sprite = this.sprites[index];
        if (!sheet) continue;
        const ground = this.host.yardToWorld(at.x, at.y);
        const ahead = this.host.yardToWorld(at.x + Math.cos(at.heading) * 10, at.y + Math.sin(at.heading) * 10);
        const column = sheetColumn(sheet, Math.atan2(ahead.y - ground.y, ahead.x - ground.x));
        const texture = this.textures.frame(sheet, column, frameRow(sheet, "walk", Math.floor(t * TICKS_PER_SECOND)));
        if (!texture) continue;
        if (!sprite) {
          sprite = new Sprite(texture);
          sprite.eventMode = "none";
          this.sprites[index] = sprite;
          this.host.standAmongBuildings(sprite);
        }
        const anchor = anchorOffset(sheet);
        sprite.texture = texture;
        sprite.position.set(ground.x + anchor.x, ground.y + anchor.y);
        sprite.zIndex = walkerZIndex(ground, index);
        sprite.alpha = at.alpha;
        // Not yet set off: still off the edge, not drawn.
        sprite.visible = t >= index * STAGGER && !at.done;
      }
      if (all) {
        this.frame = null;
        this.finish();
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    const ending = !this.ended;
    this.ended = true;
    if (ending) this.options.onEnd?.();
    for (const sprite of this.sprites) {
      if (!sprite) continue;
      this.host.leaveBuildings(sprite);
      sprite.destroy();
    }
    this.sprites.length = 0;
    this.textures.destroy();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    for (const sprite of this.sprites) if (sprite) sprite.visible = false;
    this.options.onEnd?.();
  }
}
