import { Tribe } from "../../enums/Tribes.js";
import { buildPathGrid } from "../../game-rules/combat/grid.js";
import { towerRange, towerStats } from "../../game-rules/combat/stats.js";
import { distance, towerScanPoint, type Cart, type EngineBuilding, type EngineYard } from "../../game-rules/combat/yard.js";
import type { Rng } from "../../game-rules/combat/rng.js";
import { RAID_MAP_WIDTH } from "./raidArmy.js";

/**
 * Where a wild monster raid comes in from (#226 WP1,
 * `docs/design/wild-raids.md` §5.2).
 *
 * Flash tries 16 ways in, every 22.5 degrees on a circle 800 out
 * (`Solution.as:44-48`, `WMATTACK.as:30`). From each it paths to the tribe's
 * first target, the building of the right kind nearest that way in, and adds
 * up the tower fire along the route: every third waypoint adds
 * `200 x 3 x` the damage per second of every tower in range of it
 * (`PROCESS3.as:90-99`, `WMATTACK.dpsAtPoint`, `:1011-1030`). The ways in are
 * sorted by fire, then route length, both descending, and with intelligence 1
 * the last is taken (`PROCESS3.as:75-88`): the least-defended way in, the
 * shortest on a tie. Abunakki sorts a third key, what its target is worth,
 * ascending, so on a full tie it takes the richest (`PROCESS5.as:80`).
 *
 * The owner chose what Flash meant over what it did (Q4):
 *
 * - **Every tower counts.** Flash's `dpsAtPoint` only counted a tower whose
 *   fortify countdown was running, so every way in scored 0 on almost every
 *   yard and the raid simply came the shortest way.
 * - **Range from the tower's middle.** `dpsAtPoint` meant to measure from the
 *   middle of the footprint but threw the sum away (`Point.add` returns a new
 *   point, `:1021`), so it measured from the corner. The middle used here is
 *   the engine's own range centre ({@link towerScanPoint}).
 * - **Abunakki targets the Town Hall too.** Its target test reads
 *   `_loc3_ in BUILDING14` where the others read `is` (`PROCESS5.as:45`), so
 *   its Town Hall never qualified.
 *
 * Routes come from the engine's own pathing grid, so a route stops at the
 * first wall in the way, as a creep's does (`grid.ts`, `PATHING.as:445-452`).
 * Like the engine, nothing here reads build, upgrade or fortify countdowns: a
 * yard handed to the planner is current, and a raid never starts while
 * anything is damaged or repairing (Q5).
 */

/** Ways in tried (`WMATTACK._attackResolution`). */
export const RAID_ENTRY_POINTS = 16;

/** `WMATTACK._damageBias`. */
export const RAID_DAMAGE_BIAS = 200;

/** Every third waypoint is sampled (`processStepResolution`). */
export const RAID_PATH_STEP = 3;

/** Flash's degrees-to-radians constant, kept so the ways in land where Flash's did. */
export const DEGREES = 0.0174532925;

/** Most a target can be worth to Abunakki's tie-break (`PROCESS5.as:62-64`). */
export const RAID_LOOT_CAP = 10000;

/** One way in, scored (Flash's `Solution`). */
export interface RaidSolution {
  /** Degrees, 0 to 337.5. */
  readonly bearing: number;
  /** Yard units, 800 out on the bearing. */
  readonly entry: Cart;
  /** The building the route leads to. */
  readonly target: EngineBuilding;
  /** Waypoints on the route, Flash's `distanceToTarget`. */
  readonly distanceToTarget: number;
  /** Tower fire along the route, Flash's `damageTaken`. */
  readonly damageTaken: number;
  /** What the target is worth, Flash's `resourcesGained`. */
  readonly resourcesGained: number;
}

/** The way in on a bearing (`Solution.as:44-48`). */
export const raidEntryPoint = (bearing: number): Cart => ({
  x: RAID_MAP_WIDTH * Math.cos(bearing * DEGREES),
  y: RAID_MAP_WIDTH * Math.sin(bearing * DEGREES),
});

/** A tower that shoots: one with a damage and a rate (a bunker sends defenders and has neither). */
const isShootingTower = (building: EngineBuilding): boolean => {
  if (building.kind !== "tower") return false;
  const stats = towerStats(building.type, building.level);
  return stats?.damage !== undefined && stats.rate !== undefined && stats.rate > 0;
};

/** A harvester, silo or Town Hall that still has something to give (`PROCESS4.as:45`). */
const isLootTarget = (building: EngineBuilding): boolean =>
  (building.kind === "resource" || building.type === 6 || building.type === 14) && !building.looted;

/**
 * Who a tribe's route leads to. Legionnaire goes for towers; the others for
 * loot. With none of its own kind standing, Legionnaire goes for loot, and
 * any tribe with no loot left goes for any building it could attack, so a
 * yard never stalls the planner the way it stalled Flash's (whose callback
 * never fired).
 */
const candidatesFor = (tribe: Tribe, standing: readonly EngineBuilding[]): EngineBuilding[] => {
  const towers = standing.filter(isShootingTower);
  if (tribe === Tribe.LEGIONNAIRE && towers.length > 0) return towers;
  const loot = standing.filter(isLootTarget);
  if (loot.length > 0) return loot;
  return standing.filter(
    (building) =>
      building.kind === "resource" || building.kind === "special" || building.kind === "tower",
  );
};

/** The candidate nearest the way in, measured to its anchor (`PROCESS3.as:46-58`); ties to the lower id. */
const nearest = (entry: Cart, candidates: readonly EngineBuilding[]): EngineBuilding | undefined => {
  let best: EngineBuilding | undefined;
  let bestDistance = Infinity;
  for (const building of candidates) {
    const away = distance(entry.x, entry.y, building.cx, building.cy);
    if (away < bestDistance) {
      best = building;
      bestDistance = away;
    }
  }
  return best;
};

/** What a target is worth: 4% of the twigs bank for a silo or Town Hall, else 10% of the harvester's buffer, at most 10,000. */
const worth = (yard: EngineYard, target: EngineBuilding): number =>
  Math.min(RAID_LOOT_CAP, target.type === 6 || target.type === 14 ? 0.04 * yard.resources.r1 : 0.1 * target.stored);

/** `dpsAtPoint`: damage per tick of every shooting tower in range of a point. */
const fireAt = (towers: readonly EngineBuilding[], point: Cart): number => {
  let fire = 0;
  for (const tower of towers) {
    const stats = towerStats(tower.type, tower.level);
    const range = towerRange(tower.type, tower.level);
    if (!stats?.damage || !stats.rate || range === undefined) continue;
    const middle = towerScanPoint(tower);
    if (distance(middle.x, middle.y, point.x, point.y) < range) fire += stats.damage / stats.rate;
  }
  return fire;
};

/**
 * Score all 16 ways in, in bearing order; none when the yard has nothing a
 * raid could head for. `rng` feeds each route's scatter and jiggle, as a
 * creep's route draws them, so the same seed gives the same scores.
 */
export const raidSolutions = (tribe: Tribe, yard: EngineYard, rng: Rng): RaidSolution[] => {
  const standing = yard.buildings.filter((building) => building.hp > 0);
  const candidates = candidatesFor(tribe, standing);
  if (candidates.length === 0) return [];
  const towers = standing.filter(isShootingTower);
  const grid = buildPathGrid(yard);

  const solutions: RaidSolution[] = [];
  for (let index = 0; index < RAID_ENTRY_POINTS; index += 1) {
    const bearing = (360 / RAID_ENTRY_POINTS) * index;
    const entry = raidEntryPoint(bearing);
    const target = nearest(entry, candidates);
    if (!target) continue;
    const route = grid.path({ fromX: entry.x, fromY: entry.y, target }, rng).waypoints;
    let damageTaken = 0;
    for (let step = 0; step < route.length; step += RAID_PATH_STEP) {
      damageTaken += RAID_DAMAGE_BIAS * RAID_PATH_STEP * fireAt(towers, route[step] as Cart);
    }
    solutions.push({
      bearing,
      entry,
      target,
      distanceToTarget: route.length,
      damageTaken,
      resourcesGained: worth(yard, target),
    });
  }
  return solutions;
};

/**
 * Flash's pick: `sortOn([damageTaken, distanceToTarget(, resourcesGained)],
 * [DESC, DESC(, ASC)])`, then the last. The sort is stable, so on a full tie
 * the later bearing wins.
 */
export const pickRaidSolution = (tribe: Tribe, solutions: readonly RaidSolution[]): RaidSolution | null => {
  const ranked = [...solutions].sort(
    (one, other) =>
      other.damageTaken - one.damageTaken ||
      other.distanceToTarget - one.distanceToTarget ||
      (tribe === Tribe.ABUNAKKI ? one.resourcesGained - other.resourcesGained : 0),
  );
  return ranked[ranked.length - 1] ?? null;
};

/** The way in a raid takes, or null when the yard has nothing a raid could head for. */
export const chooseRaidDirection = (tribe: Tribe, yard: EngineYard, rng: Rng): RaidSolution | null =>
  pickRaidSolution(tribe, raidSolutions(tribe, yard, rng));
