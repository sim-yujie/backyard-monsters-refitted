import { costOf, type CostRequirement, type CostStep } from "../../game-data/buildingCosts.js";
import type { LayoutNode } from "../../schemas/YardPlannerSchemas.js";
import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { requirementDetail } from "../base/economy/transitions.js";
import {
  FREE_FINISH_SECONDS,
  TOWN_HALL_TYPE,
  isShort,
  levelOf,
  pointsForUpgrade,
  shortfall,
  townHallLevel,
  type ResourceAmounts,
} from "./costs.js";
import { UNPLANNABLE_KINDS, checkPlans } from "./validateLayout.js";
import { busyWorkers, sharperToolsMultiplier, workerCount } from "./workers.js";

/**
 * The upgrade walk Apply runs over a layout's planned upgrades
 * (`docs/design/planner-upgrades.md` §3.4).
 *
 * The rule the whole file exists to express is decision Q1 of the redesign
 * (`docs/design/yard-planner-redesign.md` §8): **there is no job queue**. A
 * building takes one job and a job takes one worker, so Apply starts as many
 * planned upgrades as there are free workers, in the order the player planned
 * them, and *reports* the rest instead of refusing the request. A yard that
 * cannot afford the third tower still gets the first two and the cheap wall
 * behind them.
 *
 * That makes this walk partial by design, which is why almost nothing here
 * throws. A job the yard's state rules out — busy, damaged, unaffordable,
 * gated, already at the level — is a row in `skipped`; a job that only wants a
 * worker is a row in `waiting`. The one thing that does throw is a malformed
 * plan, a target past the top of a type's ladder, because that is the client
 * sending something it could have checked itself; {@link checkPlans} raises it
 * as the same 400 a bad position raises.
 *
 * Nothing here touches the database. The caller hands in the slice of the save
 * it reads and writes the returned `buildingdata`, cost and points itself,
 * which is the bargain `wallUpgrade.ts` and `validateLayout.ts` already make.
 *
 * ## Free to finish
 *
 * A step of {@link FREE_FINISH_SECONDS} or less is free to finish
 * (`client/scripts/BFOUNDATION.as:2063-2083`), so it is written as a finished
 * building rather than as a countdown: level up, points awarded now, no worker
 * held. That is exactly what the batch wall route does
 * (`wallUpgrade.ts:263-273`), applied wherever the rule holds rather than only
 * to walls; on the main yard the only non-wall cases are the four harvesters'
 * 300-second level 1 to 2 steps. A free step does not end the building's turn,
 * so a Block planned from 1 to 5 finishes all four steps in one walk and
 * reproduces the batch route exactly.
 *
 * ## One long step per building
 *
 * The first step too long to finish for free takes a worker, sets `cU` and
 * ends that building's turn. Whatever the plan still wants stays in the
 * layout's `plan` for a later Apply: writing a second countdown would be the
 * queue Q1 refused, and the Flash client cancels and refunds jobs beyond its
 * worker count on load (spec `docs/specs/base-building.md:804-815`).
 *
 * ## What the audit will make of it
 *
 * The walk writes server-side and so is not audited, but the player's *next*
 * save is (`services/base/economy/auditEconomySave.ts`). A started step is
 * therefore written exactly as the audit's `startUpgrade` rule expects one:
 * charged `costs[from]`, level left where it was, and
 * `cU = floor(time * bst)`, which is the upper bound that rule checks against
 * (`services/base/economy/transitions.ts:258`). A finished step leaves no
 * countdown to explain and its points are added by the controller, so they are
 * already inside `points` when the next save is measured
 * (`docs/design/planner-upgrades.md` §4).
 */

/** The parts of a `Save` the walk reads. */
export interface UpgradeWalkSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
  storedata?: JsonObject | null;
}

/** Why the walk could not start a planned upgrade (§3.2). */
export type UpgradeSkipReason =
  | "shortfall"
  | "busy"
  | "damaged"
  | "townHall"
  | "requirements"
  | "caughtUp"
  | "noLadder";

/** Fields every row of the report carries: which building, and of what type. */
interface UpgradeRow {
  id: number;
  t: number;
}

/** Fields a row carries when it names a step: the levels it spans. */
interface UpgradeStepRow extends UpgradeRow {
  from: number;
  to: number;
}

/** An upgrade now running: `cU` is set and a worker is on it. */
export interface StartedUpgrade extends UpgradeStepRow {
  /** The countdown written, already multiplied by the Sharper Tools buff. */
  seconds: number;
  cost: ResourceAmounts;
}

/** A step short enough to be written straight to its finished level. */
export interface FinishedUpgrade extends UpgradeStepRow {
  cost: ResourceAmounts;
}

/** A step that would have started had a worker been free. */
export interface WaitingUpgrade extends UpgradeStepRow {
  reason: "workers";
}

/** A planned upgrade the yard's state ruled out, with the detail for the reason. */
export interface SkippedUpgrade extends UpgradeRow {
  reason: UpgradeSkipReason;
  /** The level the building is at, where the reason names a step. */
  from?: number;
  /** The level that step would have reached. */
  to?: number;
  /** `shortfall`: how much of each resource the job was still short of. */
  shortfall?: ResourceAmounts;
  /** `townHall`: the hall level the yard has, and the one the step wants. */
  townHall?: { have: number; need: number };
  /** `requirements`: the `[type, count, level]` entries the yard does not meet. */
  requirements?: CostRequirement[];
}

/** How many workers the yard has, and how many were on a job either side of the walk. */
export interface UpgradeWorkers {
  total: number;
  busyBefore: number;
  busyAfter: number;
}

/** Everything one walk did, in the order the client's dialog reports it. */
export interface UpgradeWalk {
  /** A new `buildingdata` with the countdowns and levels the walk wrote. */
  buildingdata: BuildingDataMap;
  started: StartedUpgrade[];
  finished: FinishedUpgrade[];
  waiting: WaitingUpgrade[];
  skipped: SkippedUpgrade[];
  /** The total actually charged, across started and finished steps. */
  cost: ResourceAmounts;
  /** Empire points awarded now, which is the free-finish steps only. */
  points: number;
  workers: UpgradeWorkers;
}

/** The four resource keys, in the order every cost step spells them. */
const RESOURCE_KEYS = ["r1", "r2", "r3", "r4"] as const;

/** One resource off a save's `resources` column; anything unreadable is zero. */
const amountOf = (pool: JsonObject | null | undefined, key: string): number => {
  const raw = pool?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
};

/** The four resource amounts of one cost step. */
const stepCost = (step: CostStep): ResourceAmounts => ({
  r1: step[0],
  r2: step[1],
  r3: step[2],
  r4: step[3],
});

/** Whether a countdown of any kind is running on this building (spec `:774-782`). */
const isBusy = (building: BuildingData): boolean =>
  Boolean(building.cB) || Boolean(building.cU) || Boolean(building.cF);

/**
 * Whether the building has to be repaired before it can be upgraded (spec
 * `:926-928`). Read exactly as `wallUpgrade.ts:101-102` reads it: damage lives
 * in `buildinghealthdata` on Map Room 3 and additionally as `hp` elsewhere.
 */
const isDamaged = (
  building: BuildingData,
  health: BuildingHealthData | null | undefined
): boolean => building.hp != null || (health != null && String(building.id) in health);

/**
 * Walks a layout's planned upgrades against the caller's yard and works out
 * what Apply should start, finish, hold back and skip.
 *
 * `save.buildingdata` must already have had its countdowns advanced to `now`
 * (`services/base/advanceBuildingTimers.ts`), or the busy check counts jobs
 * that finished minutes ago and the worker count comes out short.
 *
 * Throws only for a plan the cost table cannot price at all; everything that
 * depends on the yard's state is reported.
 */
export const walkUpgrades = (
  save: UpgradeWalkSave,
  nodes: readonly LayoutNode[],
  now: number
): UpgradeWalk => {
  checkPlans([...nodes], save.buildingdata);

  const buildings: BuildingDataMap = { ...(save.buildingdata ?? {}) };
  const health = save.buildinghealthdata;

  const started: StartedUpgrade[] = [];
  const finished: FinishedUpgrade[] = [];
  const waiting: WaitingUpgrade[] = [];
  const skipped: SkippedUpgrade[] = [];
  const cost: ResourceAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
  let points = 0;

  const total = workerCount(save.storedata);
  const busyBefore = busyWorkers(buildings);
  let free = Math.max(0, total - busyBefore);

  const bst = sharperToolsMultiplier(save.storedata, now);

  // The pool as the walk has spent it, so a later job sees what an earlier one
  // took. Only the four resource keys matter; everything else in the column is
  // left to the controller's `updateResources` call.
  const pool: Record<string, number> = {};
  for (const key of RESOURCE_KEYS) pool[key] = amountOf(save.resources, key);

  // Recomputed only when a free step finishes on a Town Hall, which is the one
  // thing in a walk that can raise the gate the other steps are measured
  // against.
  let hall = townHallLevel(buildings);

  // The player's own order, ties broken by id so two plans made in the same
  // click are still walked the same way twice (§2.1).
  const candidates = nodes
    .filter((node) => node.plan != null)
    .sort((a, b) => (a.plan!.order - b.plan!.order) || (a.id - b.id));

  for (const node of candidates) {
    const key = String(node.id);
    const building = buildings[key];
    // `checkNodesOwned` has already proved every node names a building of the
    // caller's, so a miss here is a caller that skipped it. Nothing to upgrade
    // and nothing to report.
    if (!building) continue;

    const type = Number(building.t);
    const target = node.plan!.level;
    const row = costOf(type);

    if (!row || UNPLANNABLE_KINDS.has(row.kind) || row.costs.length === 0) {
      skipped.push({ id: node.id, t: type, reason: "noLadder" });
      continue;
    }

    let level = levelOf(building);

    if (target <= level) {
      skipped.push({ id: node.id, t: type, reason: "caughtUp", from: level, to: target });
      continue;
    }
    if (isBusy(building)) {
      skipped.push({ id: node.id, t: type, reason: "busy", from: level, to: target });
      continue;
    }
    if (isDamaged(building, health)) {
      skipped.push({ id: node.id, t: type, reason: "damaged", from: level, to: target });
      continue;
    }
    if (hall <= 0) {
      skipped.push({
        id: node.id,
        t: type,
        reason: "townHall",
        from: level,
        to: target,
        townHall: { have: 0, need: 1 },
      });
      continue;
    }

    // Step by step, against the yard as this walk has already changed it: a
    // gate a free step just opened counts, and a resource an earlier job spent
    // is gone.
    let current = building;

    while (level < target) {
      const step = row.costs[level];
      // Only reachable if the ladder is shorter than `checkPlans` measured,
      // which it cannot be; stopping is the harmless reading.
      if (!step) break;

      const unmet = requirementDetail(step[5], buildings, hall);
      if (unmet) {
        const gate = unmet.townHall as { have: number; need: number } | undefined;
        skipped.push(
          gate
            ? {
                id: node.id,
                t: type,
                reason: "townHall",
                from: level,
                to: level + 1,
                townHall: gate,
              }
            : {
                id: node.id,
                t: type,
                reason: "requirements",
                from: level,
                to: level + 1,
                requirements: unmet.requirements as CostRequirement[],
              }
        );
        break;
      }

      const price = stepCost(step);
      const missing = shortfall(pool, price);
      if (isShort(missing)) {
        skipped.push({
          id: node.id,
          t: type,
          reason: "shortfall",
          from: level,
          to: level + 1,
          shortfall: missing,
        });
        break;
      }

      if (step[4] > FREE_FINISH_SECONDS) {
        // A long step needs a worker of its own, and there is no queue: either
        // it starts now or it waits for the next Apply.
        if (free === 0) {
          waiting.push({ id: node.id, t: type, from: level, to: level + 1, reason: "workers" });
          break;
        }

        const seconds = Math.floor(step[4] * bst);
        current = { ...current, cU: seconds };
        buildings[key] = current;

        charge(cost, pool, price);
        free -= 1;
        started.push({ id: node.id, t: type, from: level, to: level + 1, seconds, cost: price });
        // One job per building: the rest of the ladder stays planned.
        break;
      }

      // Free to finish: written complete, points awarded now, no worker held.
      current = { ...current, l: level + 1 };
      buildings[key] = current;

      charge(cost, pool, price);
      points += pointsForUpgrade(step);
      finished.push({ id: node.id, t: type, from: level, to: level + 1, cost: price });

      level += 1;
      if (type === TOWN_HALL_TYPE) hall = townHallLevel(buildings);
    }
  }

  return {
    buildingdata: buildings,
    started,
    finished,
    waiting,
    skipped,
    cost,
    points,
    workers: { total, busyBefore, busyAfter: busyBefore + started.length },
  };
};

/** Adds one step's price to the running total and takes it out of the pool. */
const charge = (
  total: ResourceAmounts,
  pool: Record<string, number>,
  price: Readonly<ResourceAmounts>
): void => {
  for (const key of RESOURCE_KEYS) {
    total[key] += price[key];
    pool[key] -= price[key];
  }
};
