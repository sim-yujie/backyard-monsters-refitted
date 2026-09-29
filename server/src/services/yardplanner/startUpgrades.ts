import {
  costOf,
  hallTypeOf,
  type CostRequirement,
  type CostStep,
  type YardKind,
} from "../../game-data/buildingCosts.js";
import type { LayoutNode } from "../../schemas/YardPlannerSchemas.js";
import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { requirementDetail } from "../base/economy/transitions.js";
import { ACADEMY_TYPE } from "../yard/academy.js";
import { LAB_TYPE, labResearch } from "../yard/lab.js";
import {
  FREE_FINISH_SECONDS,
  isShort,
  levelOf,
  pointsForUpgrade,
  shortfall,
  townHallLevel,
  yardKindOf,
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
 * ## Walls and traps finish at once; everything else runs a countdown
 *
 * A wall or trap step is 5 seconds, and decision Q1 (D13 of
 * `docs/design/yard-buildings.md`) writes those as a finished building rather
 * than a countdown: level up, points awarded now, no worker held. That is
 * exactly what the batch wall route does (`wallUpgrade.ts:263-273`), so a
 * Block planned from 1 to 5 finishes all four steps in one walk and reproduces
 * the batch route. A finished step does not end the building's turn.
 *
 * Every other step is a real job with a worker, however short (#137). A
 * harvester's 300-second level 1 to 2 step used to be written finished because
 * it is free to finish (`client/scripts/BFOUNDATION.as:2063-2083`); the owner
 * wants that free finish to be the player's own press of **Finish free**
 * (`POST /bm/yard/speedup` `SP1`, `services/yard/speedup.ts`), never automatic.
 *
 * ## One job per building
 *
 * The first step that is not a wall or trap step takes a worker, sets `cU`
 * and ends that building's turn. Whatever the plan still wants stays in the
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
 * (`services/base/economy/transitions.ts:258`). Beside it goes `cL`, the same
 * number kept as the job's total, which the countdown never touches: the save
 * has no other record of how long a job runs once Sharper Tools has shortened
 * it, and the client's progress bars need one (#136). A finished step leaves no
 * countdown to explain and its points are added by the controller, so they are
 * already inside `points` when the next save is measured
 * (`docs/design/planner-upgrades.md` §4).
 *
 * ## Outposts
 *
 * An outpost (`type` `outpost`) walks the outpost table: its own ladders and
 * level caps, the core (112) as its hall, one worker (`yardKindOf`).
 */

/** The parts of a `Save` the walk reads. */
export interface UpgradeWalkSave {
  /** `BaseType`: an outpost walks the outpost table. */
  type?: string;
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

/** A wall or trap step, written straight to its finished level (D13). */
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
  /** Empire points awarded now, which is the wall and trap steps only. */
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

/**
 * Whether a countdown of any kind is running on this building (spec `:774-782`),
 * or it is the Monster Lab with a research running: the original refuses to
 * upgrade the Lab then (`client/scripts/MONSTERLAB.as:241-247`).
 */
const isBusy = (building: BuildingData): boolean =>
  Boolean(building.cB) ||
  Boolean(building.cU) ||
  Boolean(building.cF) ||
  (Number(building.t) === LAB_TYPE && labResearch(building) !== null) ||
  academyTraining(building) !== null;

/**
 * The monster an Academy is training, or null: the original refuses to
 * upgrade an Academy while its `_upgrading` is set (`BUILDING26.Upgrade`,
 * `client/scripts/BUILDING26.as:85-91`, `acad_err_cantupgrade`, #145). That is
 * the building's `upg`; the catch-up drops one that names no running training
 * (`services/yard/catchUpTraining.ts`), so a caught-up save's `upg` is a
 * training.
 */
const academyTraining = (building: BuildingData): string | null => {
  if (Number(building.t) !== ACADEMY_TYPE) return null;
  const upg = building["upg"];
  return typeof upg === "string" && upg !== "" ? upg : null;
};

/**
 * Whether the building has to be repaired before it can be upgraded (spec
 * `:926-928`). Read exactly as `wallUpgrade.ts:101-102` reads it: damage lives
 * in `buildinghealthdata` on Map Room 3 and additionally as `hp` elsewhere.
 */
const isDamaged = (
  building: BuildingData,
  health: BuildingHealthData | null | undefined
): boolean => building.hp != null || (health != null && String(building.id) in health);

/** The kinds whose steps are written finished instead of started (D13, decision Q1). */
const AT_ONCE_KINDS: ReadonlySet<string> = new Set(["wall", "trap"]);

/**
 * Whether a step is written at its finished level rather than as a countdown:
 * a wall or trap step, all of which are 5 seconds. Any other step starts a
 * job, even one of {@link FREE_FINISH_SECONDS} or less (#137).
 */
const finishesAtOnce = (kind: string, step: CostStep): boolean =>
  AT_ONCE_KINDS.has(kind) && step[4] <= FREE_FINISH_SECONDS;

/** What {@link planOneUpgrade} refuses a step for. */
export type OneUpgradeReason =
  | Exclude<UpgradeSkipReason, "caughtUp">
  | "missing"
  | "maxLevel"
  | "workers";

/** The next step of one building, refused, with the detail for the reason. */
export interface OneUpgradeRefusal {
  ok: false;
  reason: OneUpgradeReason;
  id: number;
  /** The building's type; 0 when it is `missing`. */
  t: number;
  /** The level the building is at; 0 when it is `missing`. */
  from: number;
  /**
   * Whether the building as a whole is ruled out (missing, no ladder, busy,
   * damaged, no Town Hall, top of the ladder) or only the step it would take
   * next (requirements, shortfall, workers). The walk reports the first kind
   * against the planned level and the second against the next one.
   */
  scope: "building" | "step";
  shortfall?: ResourceAmounts;
  townHall?: { have: number; need: number };
  requirements?: CostRequirement[];
  /** `workers`: the yard's workers, every one of them on a job. */
  workers?: { total: number; busy: number };
  /** `busy` on an Academy that is training: the monster, for the panel's own words. */
  training?: string;
}

/** The next step of one building, taken. */
export interface OneUpgradeStep {
  ok: true;
  id: number;
  t: number;
  from: number;
  to: number;
  /** The countdown written, already multiplied by Sharper Tools; 0 for a finished step. */
  seconds: number;
  cost: ResourceAmounts;
  /** Whether the step was a wall or trap step and so written at its new level (D13). */
  finished: boolean;
  /** Empire points awarded now: the step's points when finished, 0 when started. */
  points: number;
  /** The building as the step leaves it: `cU` and `cL` set, or `l` raised. */
  building: BuildingData;
}

/** One step of one building, taken or refused. */
export type OneUpgrade = OneUpgradeStep | OneUpgradeRefusal;

/**
 * The cost row of a type that has an upgrade ladder at all, or null for one
 * that does not: an unknown type, a kind the planner cannot plan (decorations,
 * mushrooms, placeholders), or a row with no steps.
 */
export const upgradeLadder = (type: number, kind: YardKind = "main") => {
  const row = costOf(type, kind);
  if (!row || UNPLANNABLE_KINDS.has(row.kind) || row.costs.length === 0) return null;
  return row;
};

/**
 * Takes the next upgrade step of one building, or says why it cannot: the one
 * rule set the planner's walk and the building panel's `POST /bm/yard/upgrade`
 * share (`docs/design/yard-buildings.md` §3.2).
 *
 * The rules, in the order they are checked: the building exists and has a
 * ladder; it is not busy (`cB`/`cU`/`cF`); it is not damaged; the yard has a
 * Town Hall; the building is below the top of its ladder; the step's `re`
 * prerequisites are met; the yard can pay for it; and, unless it is a wall or
 * trap step, a worker is free. A step is written as a countdown of
 * `floor(time × bst)`, however short, with the same figure as its total `cL`
 * (#136); a wall or trap step straight to its new level, with its points (see
 * "Walls and traps finish at once" above).
 *
 * `save.buildingdata` must already be advanced to `now`, as for the walk.
 * Nothing is charged or written here: the caller takes the returned `building`
 * and `cost`. Walls and traps are not refused here, because the walk upgrades
 * them; the panel's route refuses them before it calls this.
 *
 * @param save - The yard as it stands, including anything an earlier step of the same walk spent or wrote.
 * @param id - The building's id in `save.buildingdata`.
 * @param now - Unix seconds, for the Sharper Tools window.
 */
export const planOneUpgrade = (save: UpgradeWalkSave, id: number, now: number): OneUpgrade => {
  const buildings = save.buildingdata ?? {};
  const building = buildings[String(id)] as BuildingData | undefined;
  if (!building) return { ok: false, reason: "missing", id, t: 0, from: 0, scope: "building" };

  const t = Number(building.t);
  const from = levelOf(building);
  const kind = yardKindOf(save);
  const refuse = (
    reason: OneUpgradeReason,
    scope: OneUpgradeRefusal["scope"],
    detail: Partial<OneUpgradeRefusal> = {}
  ): OneUpgradeRefusal => ({ ...detail, ok: false, reason, id, t, from, scope });

  const row = upgradeLadder(t, kind);
  if (!row) return refuse("noLadder", "building");
  if (isBusy(building)) {
    const training = academyTraining(building);
    return refuse("busy", "building", training ? { training } : {});
  }
  if (isDamaged(building, save.buildinghealthdata)) return refuse("damaged", "building");

  const hall = townHallLevel(buildings, kind);
  if (hall <= 0) return refuse("townHall", "building", { townHall: { have: 0, need: 1 } });

  const step = row.costs[from];
  if (!step) return refuse("maxLevel", "building");

  const unmet = requirementDetail(step[5], buildings, hall, hallTypeOf(kind));
  if (unmet) {
    const gate = unmet.townHall as { have: number; need: number } | undefined;
    return gate
      ? refuse("townHall", "step", { townHall: gate })
      : refuse("requirements", "step", {
          requirements: unmet.requirements as CostRequirement[],
        });
  }

  const cost = stepCost(step);
  const missing = shortfall(save.resources, cost);
  if (isShort(missing)) return refuse("shortfall", "step", { shortfall: missing });

  if (!finishesAtOnce(row.kind, step)) {
    // A job needs a worker of its own, and there is no queue.
    const total = workerCount(save.storedata, kind);
    const busy = busyWorkers(buildings);
    if (busy >= total) return refuse("workers", "step", { workers: { total, busy } });

    const seconds = Math.floor(step[4] * sharperToolsMultiplier(save.storedata, now));
    return {
      ok: true,
      id,
      t,
      from,
      to: from + 1,
      seconds,
      cost,
      finished: false,
      points: 0,
      building: { ...building, cU: seconds, cL: seconds },
    };
  }

  // A wall or trap step: written complete, points awarded now, no worker held.
  return {
    ok: true,
    id,
    t,
    from,
    to: from + 1,
    seconds: 0,
    cost,
    finished: true,
    points: pointsForUpgrade(step),
    building: { ...building, l: from + 1 },
  };
};

/**
 * Walks a layout's planned upgrades against the caller's yard and works out
 * what Apply should start, finish, hold back and skip.
 *
 * `save.buildingdata` must already have had its countdowns advanced to `now`
 * (`services/base/advanceBuildingTimers.ts`), or the busy check counts jobs
 * that finished minutes ago and the worker count comes out short.
 *
 * Each step is {@link planOneUpgrade}, taken against the yard as this walk has
 * already changed it: a gate a finished step just opened counts, a resource an
 * earlier job spent is gone, and a worker an earlier job took is busy.
 *
 * Throws only for a plan the cost table cannot price at all; everything that
 * depends on the yard's state is reported.
 */
export const walkUpgrades = (
  save: UpgradeWalkSave,
  nodes: readonly LayoutNode[],
  now: number
): UpgradeWalk => {
  const kind = yardKindOf(save);
  checkPlans([...nodes], save.buildingdata, { kind });

  const buildings: BuildingDataMap = { ...(save.buildingdata ?? {}) };

  const started: StartedUpgrade[] = [];
  const finished: FinishedUpgrade[] = [];
  const waiting: WaitingUpgrade[] = [];
  const skipped: SkippedUpgrade[] = [];
  const cost: ResourceAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
  let points = 0;

  const total = workerCount(save.storedata, kind);
  const busyBefore = busyWorkers(buildings);

  // The pool as the walk has spent it, so a later job sees what an earlier one
  // took. Only the four resource keys matter; everything else in the column is
  // left to the controller's `updateResources` call.
  const pool: Record<string, number> = {};
  for (const key of RESOURCE_KEYS) pool[key] = amountOf(save.resources, key);

  // What every step is measured against: the walk's own buildings and pool.
  const yard: UpgradeWalkSave = {
    type: save.type,
    buildingdata: buildings,
    buildinghealthdata: save.buildinghealthdata,
    resources: pool,
    storedata: save.storedata,
  };

  // The player's own order, ties broken by id so two plans made in the same
  // click are still walked the same way twice (§2.1).
  const candidates = nodes
    .filter((node) => node.plan != null)
    .sort((a, b) => (a.plan!.order - b.plan!.order) || (a.id - b.id));

  for (const node of candidates) {
    const building = buildings[String(node.id)];
    // `checkNodesOwned` has already proved every node names a building of the
    // caller's, so a miss here is a caller that skipped it. Nothing to upgrade
    // and nothing to report.
    if (!building) continue;

    const type = Number(building.t);
    const target = node.plan!.level;

    if (!upgradeLadder(type, kind)) {
      skipped.push({ id: node.id, t: type, reason: "noLadder" });
      continue;
    }

    let level = levelOf(building);

    if (target <= level) {
      skipped.push({ id: node.id, t: type, reason: "caughtUp", from: level, to: target });
      continue;
    }

    // Step by step, against the yard as this walk has already changed it.
    while (level < target) {
      const next = planOneUpgrade(yard, node.id, now);

      if (!next.ok) {
        // `maxLevel` is only reachable if the ladder is shorter than
        // `checkPlans` measured, which it cannot be; stopping is the harmless
        // reading.
        if (next.reason === "missing" || next.reason === "maxLevel") break;

        if (next.reason === "workers") {
          // Either it starts now or it waits for the next Apply.
          waiting.push({ id: node.id, t: type, from: level, to: level + 1, reason: "workers" });
          break;
        }

        const row: SkippedUpgrade = {
          id: node.id,
          t: type,
          reason: next.reason,
          from: level,
          to: next.scope === "building" ? target : level + 1,
        };
        if (next.townHall) row.townHall = next.townHall;
        if (next.requirements) row.requirements = next.requirements;
        if (next.shortfall) row.shortfall = next.shortfall;
        skipped.push(row);
        break;
      }

      buildings[String(node.id)] = next.building;
      charge(cost, pool, next.cost);

      if (!next.finished) {
        started.push({
          id: node.id,
          t: type,
          from: level,
          to: level + 1,
          seconds: next.seconds,
          cost: next.cost,
        });
        // One job per building: the rest of the ladder stays planned.
        break;
      }

      // A wall or trap step does not end the building's turn.
      points += next.points;
      finished.push({ id: node.id, t: type, from: level, to: level + 1, cost: next.cost });
      level += 1;
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
