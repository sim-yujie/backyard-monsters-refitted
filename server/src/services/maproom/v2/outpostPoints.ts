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
 *
 * Counted once (patch 8.1, owner's fix C, 20 Nov 2026): a level the owner
 * builds, upgrades or fortifies on an outpost also pays main points
 * (`save.points`, through `poolView`), so the board takes the main points
 * each outpost already paid, its `mainpointsearned`
 * (`outpostEarned.ts`), off that outpost's points, never below 0
 * ({@link netOutpostPoints}). `outpostPoints` itself stays the full formula.
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

/** The type a stored building counts as (a legacy Stone Block is a Block); null for one that never counts. */
const countedType = (type: number): number | null => {
  if (!type || NEVER_LOADED.has(type)) return null;
  const counted = type === LEGACY_STONE_BLOCK ? BLOCK : type;
  const props = costOf(counted, "outpost");
  return props && !NOT_COUNTED.has(props.kind) ? counted : null;
};

/**
 * Whether a building of this type counts towards an outpost's points: not a
 * trap, decoration, enemy or immovable building, not type 53 or 54. The main
 * points such a building's steps pay on an outpost are the ones its
 * `mainpointsearned` books (`outpostEarned.ts`); a trap's are not.
 */
export const countsOnBoard = (type: number): boolean => countedType(Math.trunc(Number(type))) !== null;

/** One stored building's part of the outpost's sum S; zeros when it does not count. */
export const buildingSum = (building: BuildingData | null | undefined): BuildingSum => {
  if (!building || typeof building !== "object") return NOTHING;

  const stored = Math.trunc(Number(building.t));
  const type = countedType(stored);
  if (type === null) return NOTHING;
  const level = stored === LEGACY_STONE_BLOCK ? 2 : loadedLevel(type, building);
  const props = costOf(type, "outpost")!;

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

/**
 * What one outpost adds to its owner's board score: its {@link outpostPoints}
 * less the main points it already paid (`mainpointsearned`), never below 0,
 * so no level counts twice (patch 8.1). A missing or unreadable
 * `mainpointsearned` is 0.
 */
export const netOutpostPoints = (
  buildingdata: BuildingDataMap | null | undefined,
  mainpointsearned: number | string | null | undefined,
): number => {
  const earned = Number(mainpointsearned);
  return Math.max(0, outpostPoints(buildingdata) - (Number.isFinite(earned) && earned > 0 ? earned : 0));
};

/** A player's outposts in all: how many, and their points added up. */
export interface OutpostTally {
  count: number;
  points: number;
}

/**
 * Adds up outposts per owner, from rows of `userid`, `buildingdata` and
 * `mainpointsearned` (one query over every outpost, not one per player);
 * each outpost adds its {@link netOutpostPoints}.
 */
export const tallyOutposts = (
  rows: readonly {
    userid: number | string;
    buildingdata: BuildingDataMap | string | null;
    mainpointsearned?: number | string | null;
  }[],
): Map<number, OutpostTally> => {
  const byUser = new Map<number, OutpostTally>();
  for (const row of rows) {
    const userid = Number(row.userid);
    const data = typeof row.buildingdata === "string" ? (JSON.parse(row.buildingdata) as BuildingDataMap) : row.buildingdata;
    const tally = byUser.get(userid) ?? { count: 0, points: 0 };
    tally.count++;
    tally.points += netOutpostPoints(data, row.mainpointsearned);
    byUser.set(userid, tally);
  }
  return byUser;
};
