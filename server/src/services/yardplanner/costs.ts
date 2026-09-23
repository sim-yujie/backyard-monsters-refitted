import {
  COSTS,
  type CostRequirement,
  type CostStep,
} from "../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";

/**
 * Reading the building cost table, server-side.
 *
 * The batch routes the Yard Planner calls are the first place this server
 * charges a player for anything, so it needs the same arithmetic the Flash
 * client does its charging with. The table is generated into
 * `server/src/game-data/buildingCosts.ts` from the client's props file, and
 * the web client gets a byte-identical copy of the rows
 * (`web/src/game/yard/buildingCostData.ts`), so a price the planner shows is
 * the price this file works out.
 *
 * Nothing here touches the database: callers hand in the save's `buildingdata`
 * and its `resources`, the same bargain `validateLayout.ts` makes.
 *
 * ## Levels
 *
 * `costs[k]` is the step that *leaves* level `k`, so `costs[0]` is the initial
 * build and a type's maximum level is `costs.length`
 * (`client/scripts/BFOUNDATION.as:2668-2700`). A saved building with no `l` is
 * at level 1, and one with a build countdown running has not been constructed
 * yet, so it counts as level 0 — which is what `_lvl` reads in the Flash client
 * until `Constructed()` sets it to 1 (`:2892-2901`).
 *
 * ## Prerequisites
 *
 * A step's `re` entries are `[type, count, level]`: the yard needs at least
 * `count` buildings of `type` at `level` or above
 * (`client/scripts/BASE.as:3884-3932`). The client compares `_lvl`, which is
 * why {@link levelOf} folds the build countdown in rather than this rule
 * testing `cB` separately.
 *
 * ## The free-finish rule
 *
 * A countdown of {@link FREE_FINISH_SECONDS} or less costs nothing to finish
 * (`client/scripts/BFOUNDATION.as:2063-2083`; spec
 * `docs/specs/base-building.md:809-836`). Every wall and trap step is 5
 * seconds, which is what lets the batch routes write a finished building in one
 * step instead of starting a job.
 */

/** A countdown at or below this many seconds is free to finish. */
export const FREE_FINISH_SECONDS = 300;

/** Town hall type id, `client/scripts/YARD_PROPS.as:1299`. */
export const TOWN_HALL_TYPE = 14;

/** The four resource totals and the total time of a run of cost steps. */
export interface CostTotals {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  /** Total worker seconds, before any free-finish rule is applied. */
  time: number;
}

/** Twigs, pebbles, putty and goo, with no time. */
export interface ResourceAmounts {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
}

/**
 * A save's `resources` column, which is jsonb and so untyped at the edge.
 *
 * Anything that is not a finite number reads as zero, because a save that has
 * lost a resource key must not be treated as having infinite of it.
 */
export type ResourcePool = Readonly<Record<string, unknown>> | null | undefined;

const amountOf = (pool: ResourcePool, key: string): number => {
  const raw = pool?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
};

/**
 * A saved building's level: absent `l` means 1, and a running build countdown
 * means 0.
 *
 * Mirrors `readYard` on the web side (`web/src/game/yard/yardModel.ts:202-204`)
 * so both ends agree on what a half-built building is worth.
 */
export const levelOf = (building: BuildingData | undefined): number => {
  if (!building) return 0;
  if (typeof building.cB === "number" && building.cB > 0) return 0;
  const level = Number(building.l);
  return Number.isFinite(level) && level > 0 ? level : 1;
};

/** Every building in the save, as an array; an absent or null column reads as empty. */
const buildingsOf = (buildingdata: BuildingDataMap | null | undefined): BuildingData[] =>
  buildingdata ? Object.values(buildingdata) : [];

/**
 * The save's Town Hall level, or 0 when it has none.
 *
 * A yard with no town hall cannot upgrade anything at all
 * (`client/scripts/BASE.as:3863-3866`). When a save somehow holds more than one
 * hall the highest wins, which is the most generous reading and matches the
 * `re` check counting every instance.
 */
export const townHallLevel = (buildingdata: BuildingDataMap | null | undefined): number => {
  let best = 0;
  for (const building of buildingsOf(buildingdata)) {
    if (Number(building.t) !== TOWN_HALL_TYPE) continue;
    best = Math.max(best, levelOf(building));
  }
  return best;
};

/** How many buildings of `type` the save holds, whatever their level. */
export const countOfType = (
  buildingdata: BuildingDataMap | null | undefined,
  type: number
): number => {
  let count = 0;
  for (const building of buildingsOf(buildingdata)) {
    if (Number(building.t) === type) count++;
  }
  return count;
};

/**
 * Whether the save satisfies every entry of a step's `re` list.
 *
 * Mirrors `BASE.CanUpgrade` (`:3884-3932`): count the buildings of that type at
 * or above the required level, and compare against the required count. A
 * building still counting its initial build down is level 0 here, so it unlocks
 * nothing.
 */
export const requirementsMet = (
  re: readonly CostRequirement[],
  buildingdata: BuildingDataMap | null | undefined
): boolean => {
  if (re.length === 0) return true;
  const buildings = buildingsOf(buildingdata);
  return re.every(([type, count, level]) => {
    let have = 0;
    for (const building of buildings) {
      if (Number(building.t) === type && levelOf(building) >= level) have++;
      if (have >= count) return true;
    }
    return have >= count;
  });
};

/**
 * The steps that take a building of `type` from level `from` to level `to`.
 *
 * Empty when `to` is not above `from`, and truncated at the top of the ladder
 * rather than throwing, so a caller asking for more than a type has gets what
 * it can have and the target check reports the real problem.
 */
export const upgradeSteps = (type: number, from: number, to: number): readonly CostStep[] => {
  const costs = COSTS[type]?.costs;
  if (!costs) return [];
  const first = Math.max(0, from);
  const last = Math.min(to, costs.length);
  const steps: CostStep[] = [];
  for (let level = first; level < last; level++) {
    const step = costs[level];
    if (step) steps.push(step);
  }
  return steps;
};

/** The four resource totals and the total time of a run of steps. */
export const sumCosts = (steps: Iterable<CostStep>): CostTotals => {
  const total: CostTotals = { r1: 0, r2: 0, r3: 0, r4: 0, time: 0 };
  for (const [r1, r2, r3, r4, time] of steps) {
    total.r1 += r1;
    total.r2 += r2;
    total.r3 += r3;
    total.r4 += r4;
    total.time += time;
  }
  return total;
};

/**
 * How much of each resource the pool is short of a cost, 0 where it is covered.
 *
 * Reported per resource rather than as a single flag so the client can say
 * which resource to go and get, which is what the 409 body carries
 * (`docs/server-api.md`, the Yard Planner batch rows).
 */
export const shortfall = (pool: ResourcePool, cost: Readonly<ResourceAmounts>): ResourceAmounts => ({
  r1: Math.max(0, cost.r1 - amountOf(pool, "r1")),
  r2: Math.max(0, cost.r2 - amountOf(pool, "r2")),
  r3: Math.max(0, cost.r3 - amountOf(pool, "r3")),
  r4: Math.max(0, cost.r4 - amountOf(pool, "r4")),
});

/** Whether a shortfall names anything at all. */
export const isShort = (missing: Readonly<ResourceAmounts>): boolean =>
  missing.r1 > 0 || missing.r2 > 0 || missing.r3 > 0 || missing.r4 > 0;

/**
 * Empire points awarded for completing one upgrade step.
 *
 * `BFOUNDATION.Upgraded()` (`:2456-2457`): a third of the step's time plus all
 * four resource amounts, floored. Points drive the base level
 * (`server/src/services/base/calculateBaseLevel.ts:11-20`), so a yard maxed
 * through a batch route has to read the same as one maxed in Flash.
 */
export const pointsForUpgrade = (step: CostStep): number => {
  const [r1, r2, r3, r4, time] = step;
  return Math.floor((time + r1 + r2 + r3 + r4) / 3);
};

/**
 * Empire points awarded for completing an initial build.
 *
 * `BFOUNDATION.Constructed()` (`:2913-2914`): half the time plus a tenth of the
 * resources, floored. The extra 100 points a Town Hall earns (`:2915-2916`) is
 * deliberately not applied here: nothing that builds through this file builds a
 * Town Hall, and folding a per-type bonus into a per-step formula would hide it.
 */
export const pointsForBuild = (step: CostStep): number => {
  const [r1, r2, r3, r4, time] = step;
  return Math.floor(time / 2 + (r1 + r2 + r3 + r4) / 10);
};
