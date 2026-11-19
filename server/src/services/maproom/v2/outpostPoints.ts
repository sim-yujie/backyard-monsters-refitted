import { costOf, fortifyStepsOf, OUTPOST_CORE_TYPE, type CostStep } from "../../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";

/**
 * An outpost's leaderboard points (beta 8, owner 17 Nov 2026: the "outpost
 * race"). The empire board ranks a player by their main yard's empire points
 * plus these points for every outpost they hold when the board is built
 * (`services/leaderboard/empireBoard.ts`), so bigger outposts, and more of
 * them, climb the board. Nothing here is stored: a lost or abandoned outpost
 * stops counting at the next build, and its new owner gains what stands on it.
 *
 * Not Flash's outpost value (`outpostValue.ts`, which prices a takeover from
 * the one cost step that reached each building's level): these points add
 * every step a building climbed.
 *
 * The rules:
 * - the same buildings count as in `outpostValue.ts`: all but those whose
 *   props `type` is `decoration`, `enemy`, `immovable` or `trap`, types 53
 *   and 54 never count, and a legacy Stone Block (18) is a level 2 Block;
 * - the same level: the core is always 1, a missing or zero `l` is 1, and a
 *   Starter Kit prefab counts at its `prefab` level from the moment it is
 *   placed, while its countdown still runs;
 * - a building adds every cost step from level 1 up to its level, each step
 *   `time + r1 + r2 + r3 + r4` from the outpost table, plus every fortify
 *   step up to its `fort` level, summed the same way;
 * - damaged or destroyed buildings count in full;
 * - the outpost's points are `ceil(S / 3)` on the whole sum S, rounded once.
 *
 * Measured on the three Starter Kits (tests): Regular 12,823,091, Mega
 * 65,947,149 and Ultra 299,272,162 points, so Ultra gives the most points per
 * resource it costs, then Mega, then Regular.
 */

/** The outpost's sum is divided by this, then rounded up. */
export const OUTPOST_POINTS_DIVISOR = 3;

/** Props `type` strings that never count (`BASE.as:4842`, as `outpostValue.ts`). */
const NOT_COUNTED: ReadonlySet<string> = new Set(["decoration", "enemy", "immovable", "trap"]);

/** Types the yard load never builds (`BASE.as:1536`). */
const NEVER_LOADED: ReadonlySet<number> = new Set([53, 54]);

const LEGACY_STONE_BLOCK = 18;

const BLOCK = 17;

/** The level a stored building loads at (`BFOUNDATION.as:3041-3056`), as `outpostValue.ts` reads it. */
const loadedLevel = (type: number, building: BuildingData): number => {
  const stored = type === OUTPOST_CORE_TYPE ? 1 : Math.trunc(Number(building.l));
  let level = Number.isFinite(stored) && stored !== 0 ? stored : 1;
  const prefab = Math.trunc(Number(building.prefab));
  if (Number.isFinite(prefab) && prefab !== 0) level = prefab;
  return level <= 0 ? 1 : level;
};

/** `time + r1 + r2 + r3 + r4` for every step in `steps` below `count`. */
const sumSteps = (steps: readonly CostStep[], count: number): number => {
  let sum = 0;
  for (let i = 0; i < count && i < steps.length; i++) {
    const [r1, r2, r3, r4, time] = steps[i]!;
    sum += time + r1 + r2 + r3 + r4;
  }
  return sum;
};

/** What one stored building adds to an outpost's sum, its build steps and its fortify steps apart. */
export interface BuildingSum {
  readonly build: number;
  readonly fortify: number;
}

const NOTHING: BuildingSum = { build: 0, fortify: 0 };

/** One stored building's part of the outpost's sum S; zeros when it does not count. */
export const buildingSum = (building: BuildingData | null | undefined): BuildingSum => {
  if (!building || typeof building !== "object") return NOTHING;

  let type = Math.trunc(Number(building.t));
  if (!type || NEVER_LOADED.has(type)) return NOTHING;

  let level: number;
  if (type === LEGACY_STONE_BLOCK) {
    type = BLOCK;
    level = 2;
  } else {
    level = loadedLevel(type, building);
  }

  const props = costOf(type, "outpost");
  if (!props || NOT_COUNTED.has(props.kind)) return NOTHING;

  const fortLevel = Math.max(0, Math.floor(Number(building.fort ?? 0)) || 0);
  return {
    build: sumSteps(props.costs, level),
    fortify: sumSteps(fortifyStepsOf(type, "outpost"), fortLevel),
  };
};

/** The whole sum S of an outpost's stored buildings, before the division. */
export const outpostSum = (buildingdata: BuildingDataMap | null | undefined): number => {
  let sum = 0;
  for (const building of Object.values(buildingdata ?? {})) {
    const part = buildingSum(building);
    sum += part.build + part.fortify;
  }
  return sum;
};

/**
 * One outpost's leaderboard points from its stored `buildingdata`:
 * `ceil(S / 3)`, 0 for an empty one.
 */
export const outpostPoints = (buildingdata: BuildingDataMap | null | undefined): number =>
  Math.ceil(outpostSum(buildingdata) / OUTPOST_POINTS_DIVISOR);

/** A player's outposts in all: how many, and their points added up. */
export interface OutpostTally {
  count: number;
  points: number;
}

/**
 * Adds up outposts per owner, from rows of `userid` and `buildingdata` (one
 * query over every outpost, not one per player).
 */
export const tallyOutposts = (
  rows: readonly { userid: number | string; buildingdata: BuildingDataMap | string | null }[],
): Map<number, OutpostTally> => {
  const byUser = new Map<number, OutpostTally>();
  for (const row of rows) {
    const userid = Number(row.userid);
    const data = typeof row.buildingdata === "string" ? (JSON.parse(row.buildingdata) as BuildingDataMap) : row.buildingdata;
    const tally = byUser.get(userid) ?? { count: 0, points: 0 };
    tally.count++;
    tally.points += outpostPoints(data);
    byUser.set(userid, tally);
  }
  return byUser;
};
