import {
  academyLevels,
  bucketCost,
  buildEngineYard,
  cagedChampions,
  dropRadius,
  ELLIPSE_SQUASH,
  flingCost,
  flingerPayload,
  GRID_CELL,
  GRID_HEIGHT,
  GRID_WIDTH,
  isAttackableBuilding,
  mulberry32,
  propsSizeOf,
  TICKS_PER_SECOND,
  toIso,
  type BuildingHealthMap,
  type CombatBuildingDataMap,
  type EngineBuilding,
  type FlingEvent,
  type MonsterLevels,
  type Rng,
  type Roster,
} from "../../game-rules/combat/index.js";
import { MAX_CHECKPOINT_TICK } from "../base/attackCheckpoint.js";
import type { AttackPlan } from "../base/autoAttack/attackPlan.js";
import { countsOf } from "../yard/attackRoster.js";

/**
 * Where and when a bot's revenge army lands (`docs/design/bot-neighbours.md`
 * §4.7 step 3, decision 12, issue #243). Pure and seeded: the revenge runner
 * (WP11) hands it the bot's army and the player's yard and writes the plan
 * into a checkpoint as auto-attack does (`autoAttack.ts`).
 *
 * ## The army
 *
 * What a real player at the bot's level could field (decision 12): the bot's
 * housed monsters, which the generator and the refill keep at 80-100% of its
 * Housing with monsters it has unlocked (`yardGenerator.ts`), and its caged
 * champion if it is at home with health left ({@link revengeArmyOf}). Nothing
 * is topped up for the attack (§4.7 step 2).
 *
 * ## The drops
 *
 * - **What:** the army is cut into one to six drops (more when it outgrows
 *   the Flinger), each monster type spread evenly over them, every drop
 *   within the Flinger payload (`flingerPayload`, the cap the web's bucket
 *   enforces). The champion goes with the first drop.
 * - **Where:** one to three points on the yard's edge. Rays from the middle
 *   of the yard's buildings are walked inwards from the grid's edge until the
 *   drop zone would touch a building; the point just outside is that ray's
 *   edge. The edges whose surroundings hold the most standing buildings win,
 *   kept well apart round the yard. Every point is clear of every footprint by
 *   Flash's own drop test (`BASE.BuildingOverlap`, see {@link zoneTouches}).
 * - **When:** the first drop 1-3 s in, then one every 2-8 s, the drops taking
 *   the points in turn, the densest first.
 * - **Nothing else:** no bombs, siege weapons or retreat. The plan's tick is
 *   the longest an attack can run, so the replay goes on until the engine
 *   ends the battle itself (the countdown, or every attacker gone after it).
 *
 * Numbers marked `[PLACEHOLDER]` have not been playtested.
 */

/** Drop points per attack (§4.7). */
export const DROP_POINTS = { min: 1, max: 3 } as const;

/** Drops per drop point, before the payload asks for more `[PLACEHOLDER]`. */
export const DROPS_PER_POINT = { min: 1, max: 2 } as const;

/** Seconds before the first drop `[PLACEHOLDER]`. */
export const FIRST_DROP_SECONDS = { min: 1, max: 3 } as const;

/** Seconds between drops (§4.7). */
export const DROP_GAP_SECONDS = { min: 2, max: 8 } as const;

/**
 * The last drop lands by this many seconds, well inside the 300 s countdown:
 * a schedule that would run past it is squeezed to fit `[PLACEHOLDER]`.
 */
export const LAST_DROP_SECONDS = 240;

/** Rays tried round the yard. */
export const RAY_COUNT = 16;

/** Two points at least this many rays apart (about 67 degrees). */
export const RAY_SEPARATION = 3;

/** How far from an edge point standing buildings count towards its pull, in yard units `[PLACEHOLDER]`. */
export const PULL_RADIUS = 400;

/** The step a ray is walked in, in yard units. */
const RAY_STEP = 10;

/** Clear space kept beyond the first point a drop zone fits, in yard units. */
export const EDGE_MARGIN = 20;

/** Pull is scaled by a random 90-110%, so two revenges on one yard need not pick the same edge. */
const PULL_JITTER = 0.2;

/**
 * How far from the yard's centre a drop may land, one cell short of the
 * pathing grid's edge, as the web clamps a tap (`AttackInput.clampDropPoint`).
 */
const DROP_REACH_X = (GRID_WIDTH / 2 - 1) * GRID_CELL;
const DROP_REACH_Y = (GRID_HEIGHT / 2 - 1) * GRID_CELL;

/** A point in yard units. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The champion that goes with the first drop. */
export interface RevengeChampion {
  readonly t: number;
  readonly l: number;
  readonly pl?: number;
}

/** What the bot attacks with. */
export interface RevengeArmy {
  /** Monsters by id, whole positive counts. */
  readonly monsters: Roster;
  readonly champion: RevengeChampion | null;
  /** The bot's academy levels, which its monsters fight and cost at. */
  readonly levels: MonsterLevels;
}

/** The player's yard, as the attack load serves it. */
export interface RevengeTarget {
  readonly buildingdata: CombatBuildingDataMap;
  readonly buildinghealthdata?: BuildingHealthMap | null;
}

/**
 * The bot's revenge army, read off its main save: everything housed and the
 * champion at home with health left (the defending champion's own rule,
 * the first of `cagedChampions`).
 *
 * @param save - The bot's `monsters`, `champion` and `academy`.
 */
export const revengeArmyOf = (save: {
  readonly monsters: unknown;
  readonly champion: unknown;
  readonly academy: unknown;
}): RevengeArmy => {
  const housed = (save.monsters as { housed?: unknown } | null | undefined)?.housed;
  const champion = cagedChampions(save.champion)[0];
  return {
    monsters: countsOf(housed),
    champion: champion ? { t: champion.t, l: champion.l, pl: champion.pl } : null,
    levels: academyLevels(save.academy),
  };
};

/** A uniform draw in `[min, max)`. */
const between = (rng: Rng, band: { readonly min: number; readonly max: number }): number =>
  band.min + (band.max - band.min) * rng.float();

/** A uniform whole draw in `[min, max]`. */
const wholeBetween = (rng: Rng, band: { readonly min: number; readonly max: number }): number =>
  band.min + rng.int(band.max - band.min + 1);

/* ── The drops ───────────────────────────────────────────────────────────── */

/** One drop before it has a point and a time. */
export interface Drop {
  monsters: Record<string, number>;
  champion?: RevengeChampion;
}

/**
 * The army cut into `wanted` drops or more: each monster type spread evenly
 * over them (the remainders landing on different drops per type), then any
 * drop past the payload shedding its costliest monsters into the cheapest
 * drop with room, or a new one. A monster too big for the payload on its own
 * cannot be flung and is left at home. Empty drops are dropped.
 *
 * @param monsters - The army's monsters.
 * @param levels - The academy levels they cost at.
 * @param wanted - How many drops to aim for.
 * @param payload - The most one drop may cost.
 */
export const splitArmy = (
  monsters: Roster,
  levels: MonsterLevels,
  wanted: number,
  payload: number
): Drop[] => {
  const unit = (id: string) => bucketCost({ [id]: 1 }, levels);
  const ids = Object.keys(monsters)
    .filter((id) => (monsters[id] ?? 0) > 0 && unit(id) <= payload)
    .sort();
  const units = ids.reduce((total, id) => total + (monsters[id] ?? 0), 0);
  const count = Math.max(1, Math.min(wanted, units));
  const drops: Drop[] = Array.from({ length: count }, () => ({ monsters: {} }));

  ids.forEach((id, index) => {
    const total = monsters[id] ?? 0;
    const base = Math.floor(total / count);
    const extra = total % count;
    for (let i = 0; i < count; i++) {
      const share = base + ((i - index + count * ids.length) % count < extra ? 1 : 0);
      if (share > 0) drops[i]!.monsters[id] = share;
    }
  });

  const cost = (drop: Drop) => bucketCost(drop.monsters, levels);
  for (let i = 0; i < drops.length; i++) {
    const drop = drops[i]!;
    while (cost(drop) > payload) {
      const id = Object.keys(drop.monsters).sort((a, b) => unit(b) - unit(a) || a.localeCompare(b))[0]!;
      drop.monsters[id] = (drop.monsters[id] ?? 0) - 1;
      if (drop.monsters[id] === 0) delete drop.monsters[id];
      let home = drops
        .filter((other) => other !== drop && cost(other) + unit(id) <= payload)
        .sort((a, b) => cost(a) - cost(b))[0];
      if (!home) {
        home = { monsters: {} };
        drops.push(home);
      }
      home.monsters[id] = (home.monsters[id] ?? 0) + 1;
    }
  }
  return drops.filter((drop) => Object.keys(drop.monsters).length > 0);
};

/* ── Where ───────────────────────────────────────────────────────────────── */

/** `BASE.EllipseEdgeDistance` (`BASE.as:4995-5006`), as `AttackInput.ts` transcribes it. */
const ellipseEdgeDistance = (angle: number, width: number, height: number): number => {
  const tan = Math.tan(angle);
  let x = Math.pow(Math.pow(width / 2, -2) + tan * tan * Math.pow(height / 2, -2), -0.5);
  const degrees = (angle * 180) / Math.PI;
  if (degrees < -90 || degrees > 90) x *= -1;
  const y = tan * x;
  return Math.sqrt(x * x + y * y);
};

/** A building a fling has to land clear of: standing, and neither a trap nor a decoration (`DROPZONE.as:64`). */
const blocksDrops = (building: EngineBuilding): boolean =>
  building.hp > 0 && building.kind !== "trap" && building.kind !== "decoration";

/**
 * Whether a drop zone of `size` (twice the fling's radius, Flash's `_size`)
 * at `point` touches any of `obstacles`: `BASE.BuildingOverlap`
 * (`client/scripts/BASE.as:4964-4993`), the test the web's drop input makes
 * (`web/src/game/attack/AttackInput.ts` `overlappingBuildings`), on isometric
 * ellipses squashed by 0.8.
 *
 * @param point - The drop point, yard units.
 * @param size - The zone's full size.
 * @param obstacles - The buildings that block a fling ({@link blocksDrops}).
 */
export const zoneTouches = (point: Point, size: number, obstacles: readonly EngineBuilding[]): boolean => {
  const at = toIso(point.x, point.y);
  for (const obstacle of obstacles) {
    const iso = toIso(obstacle.x, obstacle.y);
    const centreX = iso.x;
    const centreY = iso.y + obstacle.middle;
    const zoneEdge = ellipseEdgeDistance(Math.atan2(at.y - centreY, at.x - centreX), size, size * ELLIPSE_SQUASH);
    const footprint = propsSizeOf(obstacle.type) * 0.5;
    const buildingEdge = ellipseEdgeDistance(
      Math.atan2(centreY - at.y, centreX - at.x),
      footprint,
      footprint * ELLIPSE_SQUASH
    );
    const apart = Math.trunc(Math.hypot(at.x - centreX, at.y - centreY));
    if (apart < zoneEdge + buildingEdge) return true;
  }
  return false;
};

/** The middle of a building's footprint, yard units. */
const centreOf = (building: EngineBuilding): Point => ({ x: building.x + building.w / 2, y: building.y + building.h / 2 });

/** How far along `direction` from `from` a point stays inside the drop reach, less `clearance`. */
const reachAlong = (from: Point, direction: Point, clearance: number): number => {
  const limit = (position: number, step: number, reach: number) => {
    if (step === 0) return Infinity;
    const edge = step > 0 ? reach - clearance : -(reach - clearance);
    return (edge - position) / step;
  };
  return Math.max(
    0,
    Math.min(limit(from.x, direction.x, DROP_REACH_X), limit(from.y, direction.y, DROP_REACH_Y))
  );
};

/** A ray's edge point, or null when no clear point lies along it. */
const edgeAlong = (
  from: Point,
  direction: Point,
  size: number,
  obstacles: readonly EngineBuilding[]
): Point | null => {
  const at = (distance: number): Point => ({
    x: Math.round(from.x + direction.x * distance),
    y: Math.round(from.y + direction.y * distance),
  });
  const far = reachAlong(from, direction, size / 2);
  let distance = far;
  while (distance > 0 && !zoneTouches(at(distance), size, obstacles)) distance -= RAY_STEP;
  // Nothing in the way all the way in: the edge is where the buildings end, so
  // walk back out from the middle to the first clear point.
  if (distance <= 0) {
    distance = 0;
    while (distance <= far && zoneTouches(at(distance), size, obstacles)) distance += RAY_STEP;
  }
  distance = Math.min(far, distance + RAY_STEP + EDGE_MARGIN);
  const point = at(distance);
  return zoneTouches(point, size, obstacles) ? null : point;
};

/**
 * Up to `wanted` drop points on the yard's edge, the densest first, at least
 * {@link RAY_SEPARATION} rays apart, each clear of every footprint for a zone
 * of `size`. Empty when nothing on the yard can be attacked.
 *
 * @param buildings - The yard's buildings, as the engine builds them.
 * @param size - The biggest drop zone that lands at a point.
 * @param wanted - How many points to find.
 * @param rng - The plan's stream.
 */
export const edgePoints = (
  buildings: readonly EngineBuilding[],
  size: number,
  wanted: number,
  rng: Rng
): Point[] => {
  const targets = buildings.filter(isAttackableBuilding).map(centreOf);
  if (targets.length === 0) return [];
  const obstacles = buildings.filter(blocksDrops);
  const middle = {
    x: targets.reduce((sum, point) => sum + point.x, 0) / targets.length,
    y: targets.reduce((sum, point) => sum + point.y, 0) / targets.length,
  };

  const turn = rng.float();
  const rays = Array.from({ length: RAY_COUNT }, (_, index) => {
    const angle = ((index + turn) / RAY_COUNT) * 2 * Math.PI;
    const point = edgeAlong(middle, { x: Math.cos(angle), y: Math.sin(angle) }, size, obstacles);
    const jitter = 1 - PULL_JITTER / 2 + PULL_JITTER * rng.float();
    if (!point) return { index, point, pull: -1 };
    const pull = targets.reduce((sum, target) => {
      const near = 1 - Math.hypot(target.x - point.x, target.y - point.y) / PULL_RADIUS;
      return sum + Math.max(0, near);
    }, 0);
    return { index, point, pull: pull * jitter };
  });

  const chosen: { index: number; point: Point }[] = [];
  for (const ray of [...rays].sort((a, b) => b.pull - a.pull || a.index - b.index)) {
    if (chosen.length >= wanted || !ray.point || ray.pull < 0) continue;
    const apart = chosen.every((other) => {
      const gap = Math.abs(other.index - ray.index);
      return Math.min(gap, RAY_COUNT - gap) >= RAY_SEPARATION;
    });
    if (apart) chosen.push({ index: ray.index, point: ray.point });
  }
  return chosen.map((entry) => entry.point);
};

/* ── The plan ────────────────────────────────────────────────────────────── */

/**
 * The bot's revenge plan against a player's yard (see the file comment), in
 * the stored plan shape auto-attack runs (`AttackPlan`), so the runner hands
 * it to `planLog` under the attack's fresh seed. Null when there is nothing
 * to fling or nothing on the yard to attack.
 *
 * @param army - {@link revengeArmyOf} the bot's save.
 * @param target - The player's yard.
 * @param seed - The plan's own seed (not the battle's).
 */
export const planRevenge = (army: RevengeArmy, target: RevengeTarget, seed: number): AttackPlan | null => {
  const rng = mulberry32(Math.floor(seed) >>> 0);
  const payload = flingerPayload();

  const points = wholeBetween(rng, DROP_POINTS);
  const cost = bucketCost(army.monsters, army.levels);
  const wanted = Math.max(Math.ceil(cost / payload), points * wholeBetween(rng, DROPS_PER_POINT));
  const drops = splitArmy(army.monsters, army.levels, wanted, payload);
  if (army.champion) {
    if (drops.length === 0) drops.push({ monsters: {} });
    drops[0]!.champion = army.champion;
  }
  if (drops.length === 0) return null;

  const radii = drops.map((drop) => dropRadius(flingCost(drop, army.levels)));
  const size = 2 * Math.max(...radii);
  const yard = buildEngineYard({
    buildingdata: target.buildingdata,
    buildinghealthdata: target.buildinghealthdata ?? null,
    kind: "main",
  });
  const spots = edgePoints(yard.buildings, size, Math.min(points, drops.length), rng);
  if (spots.length === 0) return null;

  const gaps = drops.map((_, index) =>
    index === 0 ? between(rng, FIRST_DROP_SECONDS) : between(rng, DROP_GAP_SECONDS)
  );
  const span = gaps.reduce((sum, gap) => sum + gap, 0);
  const squeeze = span > LAST_DROP_SECONDS ? LAST_DROP_SECONDS / span : 1;

  let seconds = 0;
  const events: FlingEvent[] = drops.map((drop, index) => {
    seconds += gaps[index]! * squeeze;
    const spot = spots[index % spots.length]!;
    return {
      kind: "fling",
      t: Math.round(seconds * TICKS_PER_SECOND),
      x: spot.x,
      y: spot.y,
      r: radii[index]!,
      monsters: drop.monsters,
      ...(drop.champion && { champion: drop.champion }),
    };
  });
  return { v: 1, tick: MAX_CHECKPOINT_TICK, events };
};
