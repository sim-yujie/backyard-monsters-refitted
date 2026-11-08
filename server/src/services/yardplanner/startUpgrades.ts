import {
  costOf,
  hallTypeOf,
  type CostRequirement,
  type CostStep,
  type YardKind,
} from "../../game-data/buildingCosts.js";
import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { withoutHelpers } from "../friends/helpList.js";
import { requirementDetail } from "../base/economy/transitions.js";
import { ACADEMY_TYPE } from "../yard/academy.js";
import { LAB_TYPE, labResearch } from "../yard/lab.js";
import { siegeHold, type SiegeHold } from "../yard/siege.js";
import { LOCKER_TYPE, monsterRealmOf, runningUnlock } from "../yard/locker.js";
import {
  isSurfaceInferno,
  purseShortfall,
  standingUnderHall,
  type SurfaceInfernoSave,
} from "../yard/surfaceInferno.js";
import type { SiegeId } from "../../game-rules/combat/siege.js";
import {
  FREE_FINISH_SECONDS,
  isShort,
  levelOf,
  pointsForUpgrade,
  shortfall,
  townHallLevel,
  UNDER_HALL_REQUIREMENT,
  yardKindOf,
  type ResourceAmounts,
} from "./costs.js";
import { UNPLANNABLE_KINDS } from "./validateLayout.js";
import { busyWorkers, sharperToolsMultiplier, workerCount } from "./workers.js";

/**
 * One building's next upgrade step: the rule set the building panel's
 * `POST /bm/yard/upgrade`, the instant upgrade and the bots share
 * (`docs/design/yard-buildings.md` §3.2).
 *
 * Until 2026-11-03 the Yard Planner's Apply also walked a layout's planned
 * upgrades through here, starting one job per building on as many buildings as
 * there were free workers. The owner removed that ("There shouldnt be a way to
 * queue upgrades at once"), so the walk is gone and Apply only moves
 * (`controllers/yardplanner/applyLayout.ts`). The file keeps its name.
 *
 * Nothing here touches the database. The caller hands in the slice of the save
 * it reads and writes the returned building, cost and points itself.
 *
 * ## Walls and traps finish at once; everything else runs a countdown
 *
 * A wall or trap step is 5 seconds, and decision Q1 (D13 of
 * `docs/design/yard-buildings.md`) writes those as a finished building rather
 * than a countdown: level up, points awarded now, no worker held. That is
 * exactly what the batch wall route does (`wallUpgrade.ts:263-273`).
 *
 * Every other step is a real job with a worker, however short (#137). A
 * harvester's 300-second level 1 to 2 step used to be written finished because
 * it is free to finish (`client/scripts/BFOUNDATION.as:2063-2083`); the owner
 * wants that free finish to be the player's own press of **Finish free**
 * (`POST /bm/yard/speedup` `SP1`, `services/yard/speedup.ts`), never automatic.
 *
 * ## What the audit will make of it
 *
 * A step is written server-side and so is not audited, but the player's *next*
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
 * An outpost (`type` `outpost`) reads the outpost table: its own ladders and
 * level caps, the core (112) as its hall, one worker (`yardKindOf`).
 */

/** The parts of a `Save` a step reads. */
export interface UpgradeWalkSave extends SurfaceInfernoSave {
  /** `BaseType`: an outpost reads the outpost table. */
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
  storedata?: JsonObject | null;
  /** The siege weapons: a Siege Factory holding one may not be upgraded. */
  siege?: JsonObject | null;
  /** The Monster Locker's unlocks: a Locker unlocking a monster may not be upgraded. */
  lockerdata?: JsonObject | null;
}

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
  | "shortfall"
  | "busy"
  | "damaged"
  | "townHall"
  | "requirements"
  | "noLadder"
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
   * next (requirements, shortfall, workers).
   */
  scope: "building" | "step";
  shortfall?: ResourceAmounts;
  townHall?: { have: number; need: number };
  requirements?: CostRequirement[];
  /** `workers`: the yard's workers, every one of them on a job. */
  workers?: { total: number; busy: number };
  /** `busy` on an Academy that is training: the monster, for the panel's own words. */
  training?: string;
  /** `busy` on a Monster Locker unlocking a monster: the monster, for the panel's own words. */
  unlocking?: string;
  /** `busy` on a Siege Lab or Factory at work or holding a weapon (`siegeHold`). */
  siege?: { hold: SiegeHold; weapon: SiegeId };
  /**
   * `requirements` on a main-yard Inferno building whose Under Hall entry is
   * unmet (Inferno WP 6.1): the Under Hall it has and needs.
   */
  underHall?: { have: number; need: number };
  /** `shortfall` from the Inferno purse, not the yard's resources. */
  purse?: "inferno";
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
 * Takes the next upgrade step of one building, or says why it cannot
 * (`docs/design/yard-buildings.md` §3.2).
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
 * `save.buildingdata` must already be advanced to `now`
 * (`services/base/advanceBuildingTimers.ts`), or the busy check counts jobs
 * that finished minutes ago and the worker count comes out short. Nothing is
 * charged or written here: the caller takes the returned `building` and
 * `cost`. Walls and traps are not refused here; the panel's route refuses them
 * before it calls this.
 *
 * @param save - The yard as it stands.
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
  // The Siege Lab researching, the Siege Factory making or holding a weapon
  // (`SiegeLab.Upgrade`, `SiegeFactory.Upgrade`).
  const siege = siegeHold(building, save.siege);
  if (siege) return refuse("busy", "building", { siege });
  // A Monster Locker unlocking a monster (`BUILDING8.Upgrade`,
  // `client/scripts/BUILDING8.as:97-103`, `cloc_err_cantupgrade`).
  if (t === LOCKER_TYPE) {
    const unlock = runningUnlock(save.lockerdata, monsterRealmOf(save));
    if (unlock) return refuse("busy", "building", { unlocking: unlock.monster });
  }
  if (isDamaged(building, save.buildinghealthdata)) return refuse("damaged", "building");

  const hall = townHallLevel(buildings, kind);
  if (hall <= 0) return refuse("townHall", "building", { townHall: { have: 0, need: 1 } });

  const step = row.costs[from];
  if (!step) return refuse("maxLevel", "building");

  // A main-yard Inferno building reads the Inferno Under Hall and pays from
  // the Inferno purse (`yard/surfaceInferno.ts`).
  const inferno = isSurfaceInferno(save, t);
  const unmet = requirementDetail(step[5], buildings, hall, hallTypeOf(kind), standingUnderHall(save));
  if (unmet) {
    const underHall = unmet.underHall as { have: number; need: number } | undefined;
    if (underHall) {
      return refuse("requirements", "step", {
        requirements: step[5].filter(([type]) => type === UNDER_HALL_REQUIREMENT).map((entry) => [...entry] as CostRequirement),
        underHall,
      });
    }
    const gate = unmet.townHall as { have: number; need: number } | undefined;
    return gate
      ? refuse("townHall", "step", { townHall: gate })
      : refuse("requirements", "step", {
          requirements: unmet.requirements as CostRequirement[],
        });
  }

  const cost = stepCost(step);
  const missing = inferno ? purseShortfall(save.iresources, cost) : shortfall(save.resources, cost);
  if (isShort(missing)) {
    return refuse("shortfall", "step", { shortfall: missing, ...(inferno && { purse: "inferno" as const }) });
  }

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
      building: { ...withoutHelpers(building), cU: seconds, cL: seconds },
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
