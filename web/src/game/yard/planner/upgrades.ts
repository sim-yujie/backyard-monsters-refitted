import type { CostRequirement } from "../buildingCostData";
import {
  HALL_TYPES,
  instantCost,
  maxLevel,
  sumCosts,
  upgradeSteps,
  type CostTotals,
} from "../buildingCosts";
import { maxHealth } from "../buildingArt";
import type { Yard } from "../yardModel";
import type { PlanNode } from "./placement";
import { plannableType } from "./plan";

/**
 * One building's upgrade ladder, as arithmetic over the cost table and the
 * yard: where it is, what each level above it costs, and what stops it.
 *
 * The yard's own Upgrade button reads it (`ui/yard/buildingActions.ts`). The
 * Layout screen used to plan upgrades with it as well; that was removed on
 * 2026-11-03 (owner: there should be no way to queue upgrades at once), so
 * Apply in Layout only moves buildings.
 *
 * ## Damage
 *
 * The server refuses an upgrade on any building the save carries an `hp`
 * reading for, whatever that reading is; the yard's *art* only calls a
 * building damaged below half health. This file and `PlanNode.damaged` follow
 * the server, because the question being answered is "would an upgrade
 * start", not "does it look wrecked".
 *
 * Nothing here touches the DOM, Pixi or the network.
 */

/* ── The ladder ───────────────────────────────────────────────────────────── */

/**
 * A prerequisite a target's steps do not meet yet.
 *
 * `townHall` when the Town Hall entry is the one that failed, which is the
 * common case and the one worth a sentence of its own; `requirements`
 * otherwise, in the `[type, count, level]` shape the cost table spells them.
 * The server splits them the same way (`requirementDetail`,
 * `server/src/services/base/economy/transitions.ts`).
 */
export interface LadderGate {
  readonly townHall?: { readonly have: number; readonly need: number };
  readonly requirements?: readonly CostRequirement[];
}

/** One rung of the ladder: a target level and what it takes. */
export interface LadderStep {
  /** The target level. */
  readonly level: number;
  /** Cumulative cost and worker seconds from the building's current level. */
  readonly cost: CostTotals;
  /** Shiny to buy every one of those steps outright. Shown, never sold. */
  readonly shiny: number;
  /** The gate the run of steps trips now, or null when it is clear. */
  readonly gate: LadderGate | null;
  /**
   * Whether the *first* step is gated, which is the difference between
   * "nothing will start until Town Hall 8" and "the first step starts now".
   */
  readonly firstStepGated: boolean;
}

/** Why a building has no ladder to offer. */
export type LadderBlock = "busy" | "damaged" | "maxed";

export interface Ladder {
  readonly current: number;
  readonly max: number;
  /** Maximum health now and one level up, or null for a type with no ladder. */
  readonly healthNow: number | null;
  readonly healthNext: number | null;
  /** Set when the ladder may be read but not climbed now. */
  readonly blocked: LadderBlock | null;
  readonly steps: readonly LadderStep[];
}

/** A building's type and level. */
interface LevelRow {
  readonly type: number;
  level: number;
}

/** Whether a list of buildings satisfies every entry of a step's `re` list. */
const requirementsMetIn = (
  re: readonly CostRequirement[],
  rows: readonly LevelRow[],
): boolean =>
  re.every(([type, count, level]) => {
    let have = 0;
    for (const row of rows) {
      if (row.type === type && row.level >= level) have++;
      if (have >= count) return true;
    }
    return have >= count;
  });

/**
 * The highest Town Hall level in a list of buildings, or 0 for none. An
 * outpost's core stands in for the hall (`buildingCosts.ts`, `HALL_TYPES`).
 */
const hallLevelIn = (rows: readonly LevelRow[]): number => {
  let best = 0;
  for (const row of rows) {
    if (HALL_TYPES.includes(row.type) && row.level > best) best = row.level;
  }
  return best;
};

/**
 * The unmet half of a step's `re` list, or null when the yard satisfies it.
 *
 * Blames the Town Hall only when the Town Hall entry is the one that failed,
 * exactly as the server does, so a skipped row and a ladder tooltip say the
 * same thing about the same step.
 */
const gateFor = (
  re: readonly CostRequirement[],
  rows: readonly LevelRow[],
  hall: number,
): LadderGate | null => {
  if (requirementsMetIn(re, rows)) return null;

  const unmet = re.filter((entry) => !requirementsMetIn([entry], rows));
  const townHall = unmet.find(([type]) => HALL_TYPES.includes(type));
  if (townHall) return { townHall: { have: hall, need: townHall[2] } };
  return { requirements: unmet };
};

/** Merges a later step's gate into the one a run of steps has collected. */
const mergeGates = (into: LadderGate | null, next: LadderGate | null): LadderGate | null => {
  if (!next) return into;
  if (!into) return next;

  const hall =
    into.townHall && next.townHall
      ? into.townHall.need >= next.townHall.need
        ? into.townHall
        : next.townHall
      : (into.townHall ?? next.townHall);

  const requirements = [...(into.requirements ?? []), ...(next.requirements ?? [])];
  return {
    ...(hall ? { townHall: hall } : {}),
    ...(requirements.length > 0 ? { requirements } : {}),
  };
};

/** The levels of every building in the yard. */
const levelRows = (yard: Yard): LevelRow[] =>
  yard.buildings.map((building) => ({ type: building.type, level: building.level }));

/**
 * One building's ladder: where it is, what each target above it costs, and
 * what stops it.
 *
 * A gated target is still returned with its gate rather than left out, so the
 * Upgrade button can say what it waits for. What is left out is the
 * impossible: a level a type cannot reach.
 *
 * The cost on each step is **cumulative from the current level**, because that
 * is the question a target answers — "what does getting to level 5 cost" —
 * and not what the last step alone costs.
 *
 * The ladder is the yard's own: on an outpost its prices and its lower level
 * caps come from the outpost table (`yard.kind`).
 */
export const ladderFor = (node: PlanNode, yard: Yard): Ladder => {
  const current = node.level;
  const max = plannableType(node.type, yard.kind) ? maxLevel(node.type, yard.kind) : 0;
  // A building still counting its initial build down reports level 0
  // (`yardModel.ts`), but its build is paid for: the honest first step is the
  // one that leaves level 1, not the one that pays for the building again.
  const from = Math.max(current, 1);
  const rows = levelRows(yard);
  const hall = hallLevelIn(rows);

  const steps: LadderStep[] = [];
  let gate: LadderGate | null = null;
  let firstStepGated = false;

  for (let level = from + 1; level <= max; level++) {
    const run = upgradeSteps(node.type, from, level, yard.kind);
    if (run.length === 0) break;

    const step = run[run.length - 1]!;
    gate = mergeGates(gate, gateFor(step[5], rows, hall));
    if (level === from + 1) firstStepGated = gate !== null;

    steps.push({
      level,
      cost: sumCosts(run),
      shiny: run.reduce((total, one) => total + instantCost(one), 0),
      gate,
      firstStepGated,
    });
  }

  const blocked: LadderBlock | null =
    steps.length === 0 ? "maxed" : node.busy ? "busy" : node.damaged ? "damaged" : null;

  return {
    current,
    max,
    healthNow: maxHealth(node.type, from),
    healthNext: from < max ? maxHealth(node.type, from + 1) : null,
    blocked,
    steps,
  };
};
