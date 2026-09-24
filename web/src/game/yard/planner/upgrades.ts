import type {
  FinishedUpgrade,
  SkippedUpgrade,
  StartedUpgrade,
  UpgradeCost,
  UpgradeWorkers,
  WaitingUpgrade,
} from "@/api/types";
import { maxHealth } from "../buildingArt";
import type { CostRequirement, CostStep } from "../buildingCostData";
import {
  costOf,
  FREE_FINISH_SECONDS,
  instantCost,
  maxLevel,
  sumCosts,
  upgradeSteps,
  type CostTotals,
} from "../buildingCosts";
import type { Yard } from "../yardModel";
import { freeWorkers } from "../workers";
import type { PlanNode } from "./placement";
import { plannableType } from "./plan";
import {
  heldResources,
  shortfallOf,
  typeName,
  type ResourceAmounts,
  type SelectionTypeCost,
} from "./summary";

/**
 * Planned upgrades, as arithmetic over the cost table and the yard.
 *
 * Three answers live here and nothing else does:
 *
 * - {@link ladderFor}, what the inspector draws for one selected building;
 * - {@link planTotals}, what the bottom bar's cells add up to for the whole
 *   plan;
 * - {@link previewApply}, what Apply is about to do, so the dialog can say it
 *   before the click rather than the notice after it.
 *
 * ## Why the preview exists at all
 *
 * Apply is **partial by design** (`docs/design/planner-upgrades.md` §3.2): the
 * server walks the planned upgrades in the player's order and starts as many
 * as there are free workers and resources, reporting the rest. A player who
 * planned six towers and has five workers should be told "five start, one
 * waits" *before* they spend twenty million twigs, not after. So
 * {@link previewApply} runs the server's walk
 * (`server/src/services/yardplanner/startUpgrades.ts`) against the yard the
 * client holds, in the same order, with the same gates, in the same sequence:
 * no ladder, caught up, busy, damaged, no Town Hall, then per step the
 * prerequisites, the shortfall, and free-to-finish or one worker.
 *
 * It is not authoritative and never pretends to be — the response is what
 * happened, and `§5.5` has the dialog read the server's own report afterwards.
 * Where the two could disagree is written down at each site below.
 *
 * ## Damage
 *
 * The server refuses an upgrade on any building the save carries an `hp`
 * reading for, whatever that reading is; the yard's *art* only calls a
 * building damaged below half health. This file and `PlanNode.damaged` follow
 * the server, because the question being answered is "would Apply start this",
 * not "does it look wrecked".
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

/** One button on the inspector's ladder: a target level and what it takes. */
export interface LadderStep {
  /** The target this button plans. */
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
  /** Set when the ladder may be read but not planned. */
  readonly blocked: LadderBlock | null;
  readonly steps: readonly LadderStep[];
}

/** Town hall type id, `client/scripts/YARD_PROPS.as:1299`. */
const TOWN_HALL_TYPE = 14;

/** A building's type and the level the walk currently has it at. */
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

/** The highest Town Hall level in a list of buildings, or 0 for none. */
const hallLevelIn = (rows: readonly LevelRow[]): number => {
  let best = 0;
  for (const row of rows) {
    if (row.type === TOWN_HALL_TYPE && row.level > best) best = row.level;
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
  const townHall = unmet.find(([type]) => type === TOWN_HALL_TYPE);
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

/** The levels of every building in the yard, as the walk will mutate them. */
const levelRows = (yard: Yard): { rows: LevelRow[]; byId: Map<number, LevelRow> } => {
  const rows: LevelRow[] = [];
  const byId = new Map<number, LevelRow>();
  for (const building of yard.buildings) {
    const row: LevelRow = { type: building.type, level: building.level };
    rows.push(row);
    byId.set(building.id, row);
  }
  return { rows, byId };
};

/**
 * Everything the inspector draws for one building: where it is on its ladder,
 * what each target above it costs, and what stops it.
 *
 * A gated target is still returned with its gate rather than left out. A
 * player raising their Town Hall in the same plan wants the tower behind it
 * queued, and Apply reports what it could not start (§8, Q5). What is left out
 * is the impossible: a busy or damaged building, and a level a type cannot
 * reach.
 *
 * The cost on each step is **cumulative from the current level**, because that
 * is the question the button answers — "what does getting to level 5 cost" —
 * and not what the last step alone costs.
 */
export const ladderFor = (node: PlanNode, yard: Yard): Ladder => {
  const current = node.level;
  const max = plannableType(node.type) ? maxLevel(node.type) : 0;
  // A building still counting its initial build down reports level 0
  // (`yardModel.ts`), but its build is paid for: the honest first step is the
  // one that leaves level 1, not the one that pays for the building again.
  const from = Math.max(current, 1);
  const { rows } = levelRows(yard);
  const hall = hallLevelIn(rows);

  const steps: LadderStep[] = [];
  let gate: LadderGate | null = null;
  let firstStepGated = false;

  for (let level = from + 1; level <= max; level++) {
    const run = upgradeSteps(node.type, from, level);
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

/* ── The plan's totals ────────────────────────────────────────────────────── */

export interface PlanTotals {
  /** What every planned step costs, added up. */
  readonly needed: ResourceAmounts;
  /** What the yard holds. */
  readonly held: ResourceAmounts;
  /** Per resource, `needed - held` where that is positive. */
  readonly shortfall: ResourceAmounts;
  /** Total worker seconds across every planned step. */
  readonly seconds: number;
  /**
   * The longest single building's chain of steps, in seconds.
   *
   * The floor on wall-clock time however many workers there are: one building
   * takes one job at a time, so its steps cannot be run in parallel with each
   * other (§8, Q10).
   */
  readonly longest: number;
  /** Shiny to buy every planned step outright. Shown, never sold. */
  readonly shiny: number;
  /** The same cost split by building type, for the hover breakdown. */
  readonly byType: readonly SelectionTypeCost[];
  /** How many single-level steps the plan adds up to. */
  readonly steps: number;
  /** How many buildings have a plan. */
  readonly planned: number;
}

interface TypeAccumulator {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  count: number;
}

/**
 * What the whole plan costs: the bottom bar's four resource cells, its time
 * cell and its shiny cell (§5.3).
 *
 * Every step from each building's current level to its planned one, not just
 * the next: a Cannon Tower planned to level 3 costs both steps, because both
 * are what the player asked for even though Apply will only start the first.
 */
export const planTotals = (nodes: Iterable<PlanNode>, yard: Yard): PlanTotals => {
  const needed = { r1: 0, r2: 0, r3: 0, r4: 0 };
  const perType = new Map<number, TypeAccumulator>();
  let seconds = 0;
  let longest = 0;
  let shiny = 0;
  let steps = 0;
  let planned = 0;

  for (const node of nodes) {
    if (node.fixed || !node.plan) continue;
    planned++;

    // From level 1 at the lowest: a building mid-build reports level 0 and its
    // build is already paid for, so `costs[0]` is not part of what is planned.
    const run = upgradeSteps(node.type, Math.max(node.level, 1), node.plan.level);
    const total = sumCosts(run);

    needed.r1 += total.r1;
    needed.r2 += total.r2;
    needed.r3 += total.r3;
    needed.r4 += total.r4;
    seconds += total.time;
    if (total.time > longest) longest = total.time;
    steps += run.length;
    for (const step of run) shiny += instantCost(step);

    const entry = perType.get(node.type) ?? { r1: 0, r2: 0, r3: 0, r4: 0, count: 0 };
    entry.r1 += total.r1;
    entry.r2 += total.r2;
    entry.r3 += total.r3;
    entry.r4 += total.r4;
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
    longest,
    shiny,
    byType,
    steps,
    planned,
  };
};

/**
 * The shortest the plan could take in wall-clock seconds, with `free` workers.
 *
 * A lower bound and labelled as one: it assumes every worker is busy from the
 * first second to the last, which no real queue manages. The two terms are the
 * two things that cannot be got around — one building's own chain of steps,
 * and the total work divided between the workers there are.
 */
export const wallClockSeconds = (totals: PlanTotals, free: number): number =>
  Math.max(totals.longest, Math.ceil(totals.seconds / Math.max(free, 1)));

/* ── The Apply preview ────────────────────────────────────────────────────── */

/** What Apply would do, in the shapes the server's own report uses. */
export interface ApplyPreview {
  readonly started: StartedUpgrade[];
  readonly finished: FinishedUpgrade[];
  readonly waiting: WaitingUpgrade[];
  readonly skipped: SkippedUpgrade[];
  /** The total that would be charged, across started and finished steps. */
  readonly cost: UpgradeCost;
  /** Empire points awarded on the spot, which is the free-finish steps only. */
  readonly points: number;
  readonly workers: UpgradeWorkers;
  /** The four pools as they would be left. Never negative. */
  readonly remaining: ResourceAmounts;
}

/** The four resource keys, in the order every cost step spells them. */
const RESOURCE_KEYS = ["r1", "r2", "r3", "r4"] as const;

/** The four resource amounts of one cost step. */
const stepCost = (step: CostStep): UpgradeCost => ({
  r1: step[0],
  r2: step[1],
  r3: step[2],
  r4: step[3],
});

/** Per resource, what a price is still short of a pool. */
const missingFor = (
  pool: Record<string, number>,
  price: UpgradeCost,
): UpgradeCost => ({
  r1: Math.max(0, price.r1 - (pool["r1"] ?? 0)),
  r2: Math.max(0, price.r2 - (pool["r2"] ?? 0)),
  r3: Math.max(0, price.r3 - (pool["r3"] ?? 0)),
  r4: Math.max(0, price.r4 - (pool["r4"] ?? 0)),
});

/** Whether a shortfall names anything at all. */
const isShort = (missing: UpgradeCost): boolean =>
  missing.r1 > 0 || missing.r2 > 0 || missing.r3 > 0 || missing.r4 > 0;

/**
 * Empire points for completing one step, `BFOUNDATION.Upgraded()` (`:2456`).
 * Only a free-finish step earns them now; a long one earns them when it ends.
 */
const pointsForUpgrade = (step: CostStep): number =>
  Math.floor((step[4] + step[0] + step[1] + step[2] + step[3]) / 3);

/**
 * Runs Apply's upgrade walk against the yard the client holds.
 *
 * A line-for-line mirror of `walkUpgrades`
 * (`server/src/services/yardplanner/startUpgrades.ts`): same candidate order,
 * same refusal sequence, same free-finish rule, same one-long-step-per-
 * building rule, same running pool so a job earlier in the queue spends what a
 * later one then cannot. Where it reads a different source for the same fact,
 * it reads the fact the server will read — `PlanNode.damaged` is any `hp` at
 * all, `yard.buildTime` is the Sharper Tools multiplier from `storedata.BST.e`.
 *
 * Two things it cannot know, both harmless and both narrowing rather than
 * widening what it promises:
 *
 * - countdowns move on. The yard was read at `savedAt` and a job that has
 *   since finished still reads as busy here, so the preview can under-report
 *   what will start. The server advances every countdown before it walks.
 * - the resource pool grows. Harvesters have been producing since the load,
 *   so a shortfall the preview shows may not be one by the time Apply runs.
 */
export const previewApply = (nodes: Iterable<PlanNode>, yard: Yard): ApplyPreview => {
  const started: StartedUpgrade[] = [];
  const finished: FinishedUpgrade[] = [];
  const waiting: WaitingUpgrade[] = [];
  const skipped: SkippedUpgrade[] = [];
  const cost: UpgradeCost = { r1: 0, r2: 0, r3: 0, r4: 0 };
  let points = 0;

  const total = yard.workers.total;
  const busyBefore = yard.workers.busy;
  let free = freeWorkers(yard);

  const { rows, byId } = levelRows(yard);
  let hall = hallLevelIn(rows);

  const held = heldResources(yard.resources);
  const pool: Record<string, number> = { ...held };

  const candidates = [...nodes]
    .filter((node) => !node.fixed && node.plan !== null)
    .sort((a, b) => a.plan!.order - b.plan!.order || a.id - b.id);

  for (const node of candidates) {
    const target = node.plan!.level;
    const row = byId.get(node.id);
    // A building the yard no longer has: the walk on the server looks it up in
    // `buildingdata` and moves on for the same reason.
    if (!row) continue;

    if (!plannableType(node.type)) {
      skipped.push({ id: node.id, t: node.type, reason: "noLadder" });
      continue;
    }

    let level = row.level;

    if (target <= level) {
      skipped.push({ id: node.id, t: node.type, reason: "caughtUp", from: level, to: target });
      continue;
    }
    if (node.busy) {
      skipped.push({ id: node.id, t: node.type, reason: "busy", from: level, to: target });
      continue;
    }
    if (node.damaged) {
      skipped.push({ id: node.id, t: node.type, reason: "damaged", from: level, to: target });
      continue;
    }
    if (hall <= 0) {
      skipped.push({
        id: node.id,
        t: node.type,
        reason: "townHall",
        from: level,
        to: target,
        townHall: { have: 0, need: 1 },
      });
      continue;
    }

    while (level < target) {
      const step = costOf(node.type, level);
      // Unreachable while `target <= maxLevel`, which `setPlan` and the
      // server's `checkPlans` both enforce; stopping is the harmless reading.
      if (!step) break;

      const gate = gateFor(step[5], rows, hall);
      if (gate) {
        skipped.push(
          gate.townHall
            ? {
                id: node.id,
                t: node.type,
                reason: "townHall",
                from: level,
                to: level + 1,
                townHall: gate.townHall,
              }
            : {
                id: node.id,
                t: node.type,
                reason: "requirements",
                from: level,
                to: level + 1,
                requirements: [...(gate.requirements ?? [])],
              },
        );
        break;
      }

      const price = stepCost(step);
      const missing = missingFor(pool, price);
      if (isShort(missing)) {
        skipped.push({
          id: node.id,
          t: node.type,
          reason: "shortfall",
          from: level,
          to: level + 1,
          shortfall: missing,
        });
        break;
      }

      if (step[4] > FREE_FINISH_SECONDS) {
        // A long step takes a worker of its own, and there is no queue: it
        // starts now or it waits for the next Apply.
        if (free === 0) {
          waiting.push({
            id: node.id,
            t: node.type,
            from: level,
            to: level + 1,
            reason: "workers",
          });
          break;
        }

        for (const key of RESOURCE_KEYS) {
          cost[key] += price[key];
          pool[key] = (pool[key] ?? 0) - price[key];
        }
        free -= 1;
        started.push({
          id: node.id,
          t: node.type,
          from: level,
          to: level + 1,
          seconds: Math.floor(step[4] * yard.buildTime),
          cost: price,
        });
        // One job per building: the rest of the ladder stays planned.
        break;
      }

      for (const key of RESOURCE_KEYS) {
        cost[key] += price[key];
        pool[key] = (pool[key] ?? 0) - price[key];
      }
      points += pointsForUpgrade(step);
      finished.push({ id: node.id, t: node.type, from: level, to: level + 1, cost: price });

      level += 1;
      row.level = level;
      if (node.type === TOWN_HALL_TYPE) hall = hallLevelIn(rows);
    }
  }

  return {
    started,
    finished,
    waiting,
    skipped,
    cost,
    points,
    workers: { total, busyBefore, busyAfter: busyBefore + started.length },
    remaining: {
      r1: Math.max(0, held.r1 - cost.r1),
      r2: Math.max(0, held.r2 - cost.r2),
      r3: Math.max(0, held.r3 - cost.r3),
      r4: Math.max(0, held.r4 - cost.r4),
    },
  };
};
