import { flingCost, dropRadius, type FlingDrop } from "./engine.js";
import { ELLIPSE_SQUASH, isTower, propsSizeOf } from "./stats.js";
import type {
  CombatBuildingDataMap,
  CombatTargetKind,
  FlingEvent,
  MonsterLevels,
} from "./types.js";
import { buildingClass, footprintOf, screenOf, type BuildingClass, type Cart } from "./yard.js";

/**
 * Where a fling may land: its drop zone may not overlap a standing building
 * (`docs/design/attack-flow.md` §F3, §F4; `docs/design/server-combat.md`
 * §3.10's `x`/`y` row, which cites `DROPZONE.as:64`, `BASE.BuildingOverlap`,
 * `client/scripts/BASE.as:4964-4993`).
 *
 * The test runs in isometric pixels, the `_mc.x/y` space ({@link screenOf} of
 * a yard position), and approximates both the drop zone and every building as
 * an ellipse squashed by `BASE._angle` ({@link ELLIPSE_SQUASH}), overlapping
 * when the centres are closer than the two edge distances along the line
 * between them (`EllipseEdgeDistance`, `BASE.as:4995-5006`). Traps, destroyed
 * buildings and decorations are skipped (`DROPZONE.as` passes `true, true,
 * true`).
 *
 * One rule, two callers (beta 9, owner's fix 2 on desk card
 * repeat-record-fix, 22 Nov 2026): the web's tap-to-drop
 * (`game/attack/AttackInput.ts`) refuses a hand-played drop with it, and the
 * server's Repeat attack checks a saved plan's flings with it against the
 * camp's fresh layout (`autoAttack/planCheck.ts`) before it runs.
 *
 * A fling's zone is what the Flash client called `_size`:
 * `max(200, bucket / 4)`, twice {@link dropRadius} (`ATTACK.as:667-671`).
 */

/**
 * `BASE.EllipseEdgeDistance`: how far from the centre of an ellipse of the
 * given full width and height its edge lies along `angle`.
 */
export const ellipseEdgeDistance = (angle: number, width: number, height: number): number => {
  const tan = Math.tan(angle);
  let x = Math.pow(Math.pow(width / 2, -2) + tan * tan * Math.pow(height / 2, -2), -0.5);
  const degrees = (angle * 180) / Math.PI;
  if (degrees < -90 || degrees > 90) x *= -1;
  const y = tan * x;
  return Math.sqrt(x * x + y * y);
};

/** A building as the overlap test sees it. */
export interface DropObstacle {
  readonly id: number;
  readonly type: number;
  /** Yard units, as `buildingdata.X/Y`. */
  readonly x: number;
  readonly y: number;
  /**
   * The props `size`, `BFOUNDATION._size` (`BFOUNDATION.as:659`): an `int`, so
   * 0 for the few types whose props entry has none (the Laser and Tesla
   * towers among them).
   */
  readonly size: number;
  /** Half the footprint height, `BFOUNDATION._middle` (`:678`). */
  readonly middle: number;
  readonly kind: BuildingClass;
  readonly tower: boolean;
  /** Standing: at or above one health. */
  readonly alive: boolean;
}

/** Whether `BuildingOverlap(…, true, true, true)` would even look at this one. */
export const blocksDrop = (obstacle: DropObstacle): boolean =>
  obstacle.alive && obstacle.kind !== "trap" && obstacle.kind !== "decoration";

/**
 * Every standing building a drop zone of `size` at `point` overlaps, in the
 * obstacles' order. `point` is in yard units; the test is in isometric pixels.
 */
export const overlappingBuildings = <T extends DropObstacle>(
  point: Cart,
  size: number,
  obstacles: readonly T[],
): T[] => {
  const at = screenOf(point.x, point.y);
  const hits: T[] = [];
  for (const obstacle of obstacles) {
    if (!blocksDrop(obstacle)) continue;
    const iso = screenOf(obstacle.x, obstacle.y);
    const centreX = iso.x;
    const centreY = iso.y + obstacle.middle;
    const toObstacle = Math.atan2(at.y - centreY, at.x - centreX);
    const zoneEdge = ellipseEdgeDistance(toObstacle, size, size * ELLIPSE_SQUASH);
    const toPoint = Math.atan2(centreY - at.y, centreX - at.x);
    const buildingEdge = ellipseEdgeDistance(
      toPoint,
      obstacle.size * 0.5,
      obstacle.size * 0.5 * ELLIPSE_SQUASH,
    );
    const apart = Math.trunc(Math.hypot(at.x - centreX, at.y - centreY));
    if (apart < zoneEdge + buildingEdge) hits.push(obstacle);
  }
  return hits;
};

const numberOf = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * A stored yard's buildings as obstacles, in id order: standing unless its
 * `hp`, or its entry in `health`, is below one, or it is in `destroyed`. The
 * web builds the same from its yard model (`AttackInput.obstaclesOf`).
 *
 * @param buildingdata - The yard's `buildingdata`.
 * @param health - Its `buildinghealthdata`; absent, every building is whole.
 * @param destroyed - Ids a battle has flattened since.
 * @param kind - The kind of yard, for the Inferno's own footprints.
 */
export const dropObstaclesOf = (
  buildingdata: CombatBuildingDataMap,
  health: Readonly<Record<string, unknown>> | null = null,
  destroyed: Iterable<number> = [],
  kind: CombatTargetKind = "main",
): DropObstacle[] => {
  const down = new Set(destroyed);
  const obstacles: DropObstacle[] = [];
  for (const [key, data] of Object.entries(buildingdata)) {
    if (!data || typeof data !== "object") continue;
    const type = Math.floor(numberOf(data.t));
    if (!(type > 0)) continue;
    const id = Math.floor(numberOf(data.id ?? key));
    const stored = data.hp ?? health?.[String(id)];
    const hp = stored === undefined || stored === null ? null : numberOf(stored);
    obstacles.push({
      id,
      type,
      x: numberOf(data.X),
      y: numberOf(data.Y),
      size: propsSizeOf(type),
      middle: footprintOf(type, kind).h * 0.5,
      kind: buildingClass(type),
      tower: isTower(type),
      alive: !down.has(id) && (hp === null || hp > 0),
    });
  }
  return obstacles.sort((one, other) => one.id - other.id);
};

/**
 * A fling's drop zone, `_size`: twice its drop radius at the attacker's
 * academy levels, champion included (`flingCost`).
 */
export const flingZoneSize = (
  drop: Pick<FlingDrop, "monsters" | "champion">,
  levels: MonsterLevels | undefined,
): number => 2 * dropRadius(flingCost(drop, levels));

/** A fling of a log whose drop zone touches a standing building. */
export interface FlingClash {
  /** Its index in the log's events. */
  readonly index: number;
  readonly t: number;
  readonly x: number;
  readonly y: number;
  /** The buildings it touches, by id. */
  readonly buildings: readonly number[];
}

/**
 * Every fling in `events` that a hand-played attack would have refused on a
 * yard whose buildings all stand as `obstacles` says: its zone, at the
 * attacker's `levels`, overlaps a standing building.
 *
 * @param events - A fling log's events, in its order.
 * @param obstacles - {@link dropObstaclesOf} the yard.
 * @param levels - The attacker's academy levels, which size each zone.
 */
export const flingClashes = (
  events: readonly FlingEvent[],
  obstacles: readonly DropObstacle[],
  levels: MonsterLevels | undefined,
): FlingClash[] => {
  const clashes: FlingClash[] = [];
  events.forEach((event, index) => {
    if (event.kind !== "fling") return;
    const size = flingZoneSize(event, levels);
    const hits = overlappingBuildings({ x: event.x, y: event.y }, size, obstacles);
    if (hits.length === 0) return;
    clashes.push({
      index,
      t: event.t,
      x: event.x,
      y: event.y,
      buildings: hits.map((hit) => hit.id),
    });
  });
  return clashes;
};
