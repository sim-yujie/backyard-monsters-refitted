import type { Resources } from "@/api/types";
import { buildingName } from "../buildingArt";
import type { CostStep } from "../buildingCostData";
import {
  costOf,
  instantCost,
  maxLevel,
  nameOf,
  sumCosts,
  townHallLevel,
  upgradeSteps,
  WALL_TYPES,
  type CostTotals,
} from "../buildingCosts";
import type { Yard } from "../yardModel";
import type { PlanNode } from "./placement";

/**
 * What a selection would cost, and what a batch wall upgrade would do.
 *
 * Both answers are arithmetic over the cost table and the plan, with no DOM and
 * no network: the bottom bar re-summarises on every pointer move and the wall
 * panel re-previews on every click of a level button, so neither may do
 * anything more expensive than adding up a few hundred rows.
 *
 * ## Why the summary is selection-based
 *
 * Phase 1 nodes carry no planned upgrades — a node's `level` is what the yard
 * has, not what the player intends — so "what does the plan cost" has no
 * answer yet. What does have one is "what would it cost to take everything
 * selected one level up", which is the number the wall flow needs anyway and
 * which becomes the plan summary once planned upgrades land (plan §6, Q5).
 *
 * ## Levels
 *
 * `costs[k]` leaves level `k`, so a building at level `n` pays `costOf(type, n)`
 * for its next level and a building at `maxLevel(type)` pays nothing and is
 * counted as maxed. A building still counting its initial build down reports
 * level 0 (`yardModel.ts:202-204`); it is read as level 1 here, because its
 * build is already paid for and the honest next step is the one after it.
 */

/** Twigs, pebbles, putty and goo, with no field left out. */
export interface ResourceAmounts {
  readonly r1: number;
  readonly r2: number;
  readonly r3: number;
  readonly r4: number;
}

/** One line of the cost breakdown: every selected building of one type. */
export interface SelectionTypeCost {
  readonly type: number;
  readonly name: string;
  /** How many of this type are selected and have a next level. */
  readonly count: number;
  readonly needed: ResourceAmounts;
}

export interface SelectionSummary {
  /** What the next level of everything selected costs. */
  readonly needed: ResourceAmounts;
  /** What the yard holds. */
  readonly held: ResourceAmounts;
  /** Per resource, `needed - held` when that is positive, otherwise 0. */
  readonly shortfall: ResourceAmounts;
  /** Total worker seconds, before any free-finish rule. */
  readonly seconds: number;
  /** Shiny to buy every step outright. Shown, never purchasable in phase 1. */
  readonly shiny: number;
  /** The same cost split by building type, for the hover breakdown. */
  readonly byType: readonly SelectionTypeCost[];
  /** How many of the selected buildings have no next level to cost. */
  readonly maxed: number;
}

/** What a batch wall upgrade to one target level would do. */
export interface WallBatchPreview {
  /** Wall ids below the target: the ones the call would raise. */
  readonly eligible: number[];
  /** Wall ids already at or above the target. */
  readonly skipped: number[];
  /** How many single-level steps the eligible walls add up to. */
  readonly steps: number;
  /** The cost and the worker seconds of every one of those steps. */
  readonly cost: CostTotals;
  readonly shortfall: ResourceAmounts;
  /**
   * The Town Hall gate the target trips, or null when it is clear.
   *
   * `level` is the target asked for and `need` the Town Hall level its last
   * step requires — `costs[k].re` is `[[14, 1, k + 2]]` for a wall, so level 5
   * wants Town Hall 6.
   */
  readonly gate: { readonly level: number; readonly need: number } | null;
}

/** Town hall type id, `client/scripts/YARD_PROPS.as:1299`. */
const TOWN_HALL_TYPE = 14;

/**
 * A building type's display name.
 *
 * The art table is the first source because it is the one the rest of the yard
 * screen reads from; the cost table's own copy covers a type with no art, and
 * the type id covers a type in neither.
 */
export const typeName = (type: number): string =>
  buildingName(type) || nameOf(type) || `Type ${type}`;

/** The four resources a yard holds, with absent fields read as zero. */
export const heldResources = (resources: Resources): ResourceAmounts => ({
  r1: resources.r1 ?? 0,
  r2: resources.r2 ?? 0,
  r3: resources.r3 ?? 0,
  r4: resources.r4 ?? 0,
});

/** Per resource, what is missing. Never negative: a surplus is not a shortfall. */
export const shortfallOf = (needed: ResourceAmounts, held: ResourceAmounts): ResourceAmounts => ({
  r1: Math.max(0, needed.r1 - held.r1),
  r2: Math.max(0, needed.r2 - held.r2),
  r3: Math.max(0, needed.r3 - held.r3),
  r4: Math.max(0, needed.r4 - held.r4),
});

/** True when any of the four is short. */
export const isShort = (shortfall: ResourceAmounts): boolean =>
  shortfall.r1 > 0 || shortfall.r2 > 0 || shortfall.r3 > 0 || shortfall.r4 > 0;

/**
 * The level a node's next step leaves.
 *
 * A legacy type 18 wall is a type 17 at level 2 or better, which is how the
 * Flash client reads one on load (`BASE.as:1523-1526`) and how the server will
 * charge one.
 */
export const effectiveLevel = (node: PlanNode): number =>
  node.type === 18 ? Math.max(node.level, 2) : Math.max(node.level, 1);

/** The ladder a node upgrades along; a type 18 wall climbs type 17's. */
const ladderType = (type: number): number => (type === 18 ? 17 : type);

interface Accumulator {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  count: number;
}

/**
 * What the next level of everything selected costs, against what is held.
 *
 * Mushrooms and anything else fixed are skipped: they are obstacles rather than
 * buildings and have no ladder to climb.
 */
export const summariseSelection = (
  nodes: Iterable<PlanNode>,
  yard: Yard,
): SelectionSummary => {
  const needed = { r1: 0, r2: 0, r3: 0, r4: 0 };
  const perType = new Map<number, Accumulator>();
  let seconds = 0;
  let shiny = 0;
  let maxed = 0;

  for (const node of nodes) {
    if (node.fixed) continue;

    const type = ladderType(node.type);
    const step = costOf(type, effectiveLevel(node));
    if (!step) {
      maxed++;
      continue;
    }

    const [r1, r2, r3, r4, time] = step;
    needed.r1 += r1;
    needed.r2 += r2;
    needed.r3 += r3;
    needed.r4 += r4;
    seconds += time;
    shiny += instantCost(step);

    const entry = perType.get(node.type) ?? { r1: 0, r2: 0, r3: 0, r4: 0, count: 0 };
    entry.r1 += r1;
    entry.r2 += r2;
    entry.r3 += r3;
    entry.r4 += r4;
    entry.count++;
    perType.set(node.type, entry);
  }

  const held = heldResources(yard.resources);
  const byType: SelectionTypeCost[] = [...perType.entries()]
    .map(([type, entry]) => ({
      type,
      name: typeName(type),
      count: entry.count,
      needed: { r1: entry.r1, r2: entry.r2, r3: entry.r3, r4: entry.r4 },
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.type - b.type);

  return {
    needed,
    held,
    shortfall: shortfallOf(needed, held),
    seconds,
    shiny,
    byType,
    maxed,
  };
};

/**
 * What raising every selected wall to `target` would cost and refuse.
 *
 * Only walls are considered: a selection is usually a marquee over a run of
 * blocks and whatever else it caught is none of this call's business. Walls
 * already at or above the target are reported as skipped rather than silently
 * dropped, because the panel's sentence names them ("6 already at level 6 or
 * higher") and because the server refuses a batch that includes one.
 *
 * The gate is computed from the table rather than from `target + 1` so that a
 * regenerated cost table moves it without this file being edited.
 */
export const wallBatchPreview = (
  nodes: Iterable<PlanNode>,
  target: number,
  yard: Yard,
): WallBatchPreview => {
  const eligible: number[] = [];
  const skipped: number[] = [];
  const steps: CostStep[] = [];
  let need = 0;

  for (const node of nodes) {
    if (node.fixed || !WALL_TYPES.includes(node.type)) continue;

    const level = effectiveLevel(node);
    if (level >= target) {
      skipped.push(node.id);
      continue;
    }

    eligible.push(node.id);
    for (const step of upgradeSteps(ladderType(node.type), level, target)) {
      steps.push(step);
      for (const [type, , required] of step[5]) {
        if (type === TOWN_HALL_TYPE && required > need) need = required;
      }
    }
  }

  const cost = sumCosts(steps);
  const held = heldResources(yard.resources);
  const hall = townHallLevel(yard);

  return {
    eligible,
    skipped,
    steps: steps.length,
    cost,
    shortfall: shortfallOf(cost, held),
    gate: need > hall ? { level: target, need } : null,
  };
};

/**
 * The target levels a wall batch may be asked for, 2 up to the top of the
 * ladder, with the Town Hall level each one needs.
 *
 * The panel draws a button per entry and disables the ones the yard has not
 * earned, so the reason is in the data rather than in the panel's arithmetic.
 */
export const wallTargets = (): readonly { level: number; need: number }[] => {
  const targets: { level: number; need: number }[] = [];
  for (let level = 2; level <= maxLevel(17); level++) {
    const step = costOf(17, level - 1);
    let need = 0;
    for (const [type, , required] of step?.[5] ?? []) {
      if (type === TOWN_HALL_TYPE && required > need) need = required;
    }
    targets.push({ level, need });
  }
  return targets;
};
