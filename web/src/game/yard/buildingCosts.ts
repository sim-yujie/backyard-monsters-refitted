import { BUILDING_COST_ROWS, type CostRequirement, type CostRow, type CostStep } from "./buildingCostData";
import type { Yard } from "./yardModel";

/**
 * Reading the building cost table.
 *
 * The table itself is generated — see `buildingCostData.ts` — because it is a
 * few hundred cost steps lifted out of the Flash client's props file. What
 * lives here is the handful of rules that turn those rows into an answer the
 * planner can show.
 *
 * ## Which step a level costs
 *
 * `costs[k]` is what it takes to *leave* level `k`, so `costs[0]` is the
 * initial build and a type's maximum level is `costs.length`
 * (`client/scripts/BFOUNDATION.as:2668-2700`; spec
 * `docs/specs/base-building.md:412-413`). A Wooden Block therefore has five
 * steps and tops out at level 5, and taking one from level 1 to level 5 pays
 * `costs[1]` through `costs[4]`.
 *
 * ## Prerequisites
 *
 * Every step carries `re`, a list of `[type, count, level]`: the yard needs at
 * least `count` buildings of `type` at `level` or above before the step is
 * allowed (`client/scripts/BASE.as:3884-3932`). The middle element is the
 * count, not a spare.
 *
 * A building still counting its initial build down does not count towards a
 * prerequisite, because the Flash client compares `_lvl`, which is 0 until
 * `Constructed()` runs. `readYard` already models that — it reports level 0
 * while `cB` is running (`yardModel.ts:202-204`) — so the rule needs no extra
 * test here. The server has to check `cB` itself, since its `buildingdata` rows
 * keep whatever level the client last wrote.
 *
 * ## The free-finish rule
 *
 * A countdown of 300 seconds or less costs nothing to finish
 * (`client/scripts/BFOUNDATION.as:2063-2083`, `client/scripts/STORE.as:162-171`;
 * spec `:809-836`). Every wall and trap step is 5 seconds, which is what lets
 * the planner's batch actions complete in one step.
 *
 * Nothing here touches the DOM or Pixi: it is arithmetic over a table, which is
 * what lets the bottom bar re-summarise a 400-wall selection on every pointer
 * move without a frame budget worth worrying about.
 */

/** Twigs, pebbles, putty and goo. */
export interface CostTotals {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  /** Total worker seconds, before any free-finish rule is applied. */
  time: number;
}

/** A countdown at or below this many seconds is free to finish. */
export const FREE_FINISH_SECONDS = 300;

/**
 * The wall types.
 *
 * 18 is a legacy entry the Flash client rewrites to `t: 17, l: 2` on load
 * (`client/scripts/BASE.as:1523-1526`), so its own single cost step is never
 * charged for an upgrade; type 17's ladder is.
 */
export const WALL_TYPES: readonly number[] = [17, 18];

/** The trap types: Booby Trap and Heavy Trap. Both have a single level. */
export const TRAP_TYPES: readonly number[] = [24, 117];

/** Town hall type id, `client/scripts/YARD_PROPS.as:1299`. */
const TOWN_HALL_TYPE = 14;

const ROWS: ReadonlyMap<number, CostRow> = new Map(
  BUILDING_COST_ROWS.map((row) => [row[0], row]),
);

/** The whole row for a type, or null for a type the props table has no costs for. */
export const rowOf = (type: number): CostRow | null => ROWS.get(type) ?? null;

/**
 * The step that leaves `level`, or null past the end of the ladder.
 *
 * `costOf(17, 0)` is the cost of building a wall, `costOf(17, 4)` the cost of
 * taking one from level 4 to level 5, and `costOf(17, 5)` is null.
 */
export const costOf = (type: number, level: number): CostStep | null => {
  const costs = ROWS.get(type)?.[4];
  if (!costs || level < 0) return null;
  return costs[level] ?? null;
};

/** The highest level a type can reach. 0 for a type with no row. */
export const maxLevel = (type: number): number => ROWS.get(type)?.[4].length ?? 0;

/** The props `type` string: `wall`, `trap`, `tower`, `decoration`, … Empty for an unknown type. */
export const kindOf = (type: number): string => ROWS.get(type)?.[2] ?? "";

/** The display name from the game's string table. Empty for a type with no row. */
export const nameOf = (type: number): string => ROWS.get(type)?.[1] ?? "";

/**
 * How many of `type` a yard may hold at Town Hall level `hall`.
 *
 * 0 when the type has no cap ladder or the hall is past its end, which is the
 * honest answer for a type the build menu never offers at that level.
 */
export const quantityOf = (type: number, hall: number): number => {
  const quantity = ROWS.get(type)?.[5];
  if (!quantity || hall < 0) return 0;
  return quantity[hall] ?? 0;
};

/**
 * The steps that take a building of `type` from level `from` to level `to`.
 *
 * Empty when `to` is not above `from`, and truncated at the top of the ladder
 * rather than throwing, so a caller asking for more than a type has gets what
 * it can have.
 */
export const upgradeSteps = (type: number, from: number, to: number): readonly CostStep[] => {
  const costs = ROWS.get(type)?.[4];
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
 * The shiny a countdown of `seconds` costs to skip.
 *
 * `STORE.GetTimeCost` (`client/scripts/STORE.as:162-171`): free at or below the
 * free-finish threshold, otherwise the smaller of a linear and a square-root
 * term, both truncated to whole shiny. `free` is the AS3 second parameter,
 * which a couple of call sites pass false to bypass the threshold.
 */
export const timeCost = (seconds: number, free = true): number => {
  if (free && seconds <= FREE_FINISH_SECONDS) return 0;
  return Math.min(Math.ceil((seconds * 20) / 60 / 60), Math.trunc(Math.sqrt(seconds * 0.8)));
};

/**
 * The shiny it costs to buy one step outright.
 *
 * `BFOUNDATION.InstantUpgradeCost` (`:2114-2128`), which is the same arithmetic
 * as `InstantBuildCost` (`:2085-2098`): goo is not counted, the time term drops
 * out entirely under the free-finish threshold, and the total takes a 5%
 * discount truncated to a whole number.
 */
export const instantCost = (step: CostStep): number => {
  const [r1, r2, r3, , time] = step;
  const seconds = time <= FREE_FINISH_SECONDS ? 0 : time;
  const resources = Math.ceil(Math.sqrt((r1 + r2 + r3) / 2) ** 0.75);
  return Math.trunc((resources + timeCost(seconds)) * 0.95);
};

/**
 * Whether the yard satisfies every entry of a step's `re` list.
 *
 * Mirrors `BASE.CanUpgrade` (`:3884-3932`): count the buildings of that type at
 * or above the required level and compare against the required count.
 * `yard.buildings` reports a building still under construction as level 0, so a
 * half-built Town Hall does not unlock anything.
 */
export const requirementsMet = (re: readonly CostRequirement[], yard: Yard): boolean =>
  re.every(([type, count, level]) => {
    let have = 0;
    for (const building of yard.buildings) {
      if (building.type === type && building.level >= level) have++;
      if (have >= count) return true;
    }
    return have >= count;
  });

/**
 * The yard's Town Hall level, or 0 when it has none.
 *
 * `readYard` picks the hall out once (`yardModel.ts:104-105`); a yard without
 * one cannot upgrade anything at all (`BASE.as:3863-3866`).
 */
export const townHallLevel = (yard: Yard): number =>
  yard.townHall?.type === TOWN_HALL_TYPE ? yard.townHall.level : 0;
