import { costOf } from "../../game-data/buildingCosts.js";
import type { BuildingData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  RESOURCE_KEYS,
  cancelRefund,
  storageCap,
  type StorageCapSave,
} from "../base/economy/resourceBudget.js";
import { levelOf, type ResourceAmounts } from "../yardplanner/costs.js";
import {
  planOneUpgrade,
  type OneUpgradeRefusal,
  type UpgradeWalkSave,
} from "../yardplanner/startUpgrades.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The building panel's upgrade and cancel, `POST /bm/yard/upgrade` and
 * `POST /bm/yard/upgrade/cancel` (`docs/design/yard-buildings.md` §3.2).
 *
 * Both are pure: they read the caught-up save the yard action wrapper hands
 * them and return what should change, or throw the refusal. The wrapper
 * (`controllers/yard/yardAction.ts`) charges, credits, awards the points and
 * writes.
 *
 * The upgrade rules are the planner's, not a copy of them: one step of
 * {@link planOneUpgrade}, the same function Apply's walk takes each step with,
 * so the panel and the planner cannot disagree about what a yard may start.
 * What the panel adds is the refusal: where the walk reports a row and carries
 * on, a single-building action refuses with the reason (§2.1 "Errors").
 */

/** The parts of a `Save` the two actions read. */
export type UpgradeActionSave = UpgradeWalkSave & StorageCapSave;

/** `report` of `POST /bm/yard/upgrade`. */
export interface UpgradeReport {
  id: number;
  /** The level the building was at. */
  from: number;
  /** The level the step reaches (already reached when `finished`). */
  to: number;
  /** The countdown written, after Sharper Tools; 0 when `finished`. */
  seconds: number;
  /** What the step cost: the ladder's `costs[from]`. */
  cost: ResourceAmounts;
  /** Whether the step was free to finish (≤ 300 s) and so is done already, with no worker used. */
  finished: boolean;
}

/** `report` of `POST /bm/yard/upgrade/cancel`. */
export interface CancelUpgradeReport {
  id: number;
  /** What came back: the step's full price, less whatever the storage cap turned away. */
  refund: ResourceAmounts;
}

/** Kinds `upgrade` sends elsewhere: the planner's batch routes upgrade them. */
const BATCH_KINDS: ReadonlySet<string> = new Set(["wall", "trap"]);

/** The building with this id, or a 400: the client named a building the yard does not have. */
const buildingOf = (save: UpgradeWalkSave, id: number): BuildingData => {
  const building = save.buildingdata?.[String(id)];
  if (!building) throw yardBadRequestErr("That building is not in your yard.", { id });
  return building;
};

/** The single-building refusal for a step {@link planOneUpgrade} would not take. */
const refusalErr = (refusal: OneUpgradeRefusal) => {
  switch (refusal.reason) {
    case "missing":
      return yardBadRequestErr("That building is not in your yard.", { id: refusal.id });
    case "noLadder":
      return yardBadRequestErr("That building cannot be upgraded.", { id: refusal.id });
    case "busy":
      return yardRefusedErr("busy", "That building is already busy. Wait for its job to finish.");
    case "damaged":
      return yardRefusedErr("damaged", "Repair that building before upgrading it.");
    case "townHall":
      return yardRefusedErr(
        "townHall",
        refusal.townHall!.have <= 0
          ? "You need a Town Hall before you can upgrade anything."
          : `That upgrade needs a level ${refusal.townHall!.need} Town Hall.`,
        { townHall: refusal.townHall }
      );
    case "maxLevel":
      return yardRefusedErr("maxLevel", "That building is already at its highest level.", {
        level: refusal.from,
      });
    case "requirements":
      return yardRefusedErr("requirements", "That upgrade needs other buildings first.", {
        requirements: refusal.requirements,
      });
    case "shortfall":
      return yardRefusedErr("shortfall", "You do not have enough resources for that.", {
        shortfall: refusal.shortfall,
      });
    case "workers":
      return yardRefusedErr("workers", "All your workers are busy.", {
        workers: refusal.workers,
      });
  }
};

/**
 * Starts the next upgrade step of one building, or finishes it on the spot
 * when it is free to finish.
 *
 * Refuses, in this order: `400 badRequest` (no such building, or one with no
 * ladder: decorations, mushrooms), `400 useBatchRoute` (walls and traps), then
 * `409` `busy`, `damaged`, `townHall`, `maxLevel`, `requirements`,
 * `shortfall`, `workers`.
 *
 * @param save - The caught-up main yard.
 * @param id - The building to upgrade.
 * @param now - Unix seconds, for the Sharper Tools window.
 * @returns The new `buildingdata`, the debit, the points (free steps only) and the report.
 */
export const planUpgradeAction = (save: UpgradeActionSave, id: number, now: number) => {
  const building = buildingOf(save, id);

  const kind = costOf(Number(building.t))?.kind;
  if (kind && BATCH_KINDS.has(kind)) {
    throw yardBadRequestErr(
      "Walls and traps are upgraded from the Yard Planner.",
      { id },
      "useBatchRoute"
    );
  }

  const step = planOneUpgrade(save, id, now);
  if (!step.ok) throw refusalErr(step);

  const report: UpgradeReport = {
    id,
    from: step.from,
    to: step.to,
    seconds: step.seconds,
    cost: step.cost,
    finished: step.finished,
  };

  return {
    report,
    slices: { buildingdata: { ...save.buildingdata, [String(id)]: step.building } },
    debit: step.cost,
    points: step.points,
  };
};

/** One resource as the save holds it; anything unreadable is zero, as the wrapper reads it. */
const heldOf = (resources: JsonObject | null | undefined, key: string): number => {
  const value = Number(resources?.[key]);
  return Number.isFinite(value) ? value : 0;
};

/**
 * What a credit actually adds once the storage cap has had its say: the
 * wrapper's clamp (`applyOutcome`, T3), worked out ahead so the report can say
 * it. A pool already at or over the cap takes nothing and loses nothing.
 */
const creditedOf = (save: UpgradeActionSave, credit: ResourceAmounts): ResourceAmounts => {
  const cap = storageCap(save);
  const credited = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const key of RESOURCE_KEYS) {
    const held = heldOf(save.resources, key);
    credited[key] = Math.max(held, Math.min(held + credit[key], cap)) - held;
  }
  return credited;
};

/**
 * Cancels a running upgrade: the countdown goes, the level stays, and the
 * step's full price comes back (`cancelRefund`, `client/scripts/BFOUNDATION.as:2401-2432`),
 * clamped to the storage cap by the wrapper. Progress is lost; Shiny spent on
 * it is not refunded (BB §5 "Cancel and refund").
 *
 * Refuses `400 badRequest` for no such building, `409 notUpgrading` when no
 * `cU` is running.
 *
 * @param save - The caught-up main yard.
 * @param id - The building whose upgrade to cancel.
 * @returns The new `buildingdata`, the credit and the report.
 */
export const planCancelUpgrade = (save: UpgradeActionSave, id: number) => {
  const building = buildingOf(save, id);

  if (!(Number(building.cU) > 0)) {
    throw yardRefusedErr("notUpgrading", "That building is not being upgraded.");
  }

  const { cU: _cancelled, ...rest } = building;
  const refund = cancelRefund(Number(building.t), levelOf(building));
  const report: CancelUpgradeReport = { id, refund: creditedOf(save, refund) };

  return {
    report,
    slices: { buildingdata: { ...save.buildingdata, [String(id)]: rest as BuildingData } },
    credit: refund,
  };
};
