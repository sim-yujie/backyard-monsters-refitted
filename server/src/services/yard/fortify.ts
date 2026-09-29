import { fortifyStepsOf, hallTypeOf, type CostRequirement } from "../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { stepAmounts, type StorageCapSave } from "../base/economy/resourceBudget.js";
import { requirementDetail } from "../base/economy/transitions.js";
import {
  hallName,
  isShort,
  shortfall,
  townHallLevel,
  yardKindOf,
  type ResourceAmounts,
} from "../yardplanner/costs.js";
import { busyWorkers, sharperToolsMultiplier, workerCount } from "../yardplanner/workers.js";
import { buildingOrThrow, damagedErr, isDamaged } from "./buildingJobs.js";
import { fitCredit } from "./credit.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * Fortifying, `POST /bm/yard/fortify` and `POST /bm/yard/fortify/cancel`
 * (outposts WP3, issue #184).
 *
 * A Map Room 2 outpost can fortify its core (F1-F4) and its cannon, sniper,
 * laser, tesla, flak and railgun towers, each four steps up the outpost
 * table's fortify ladder (`fortifyStepsOf`, from `fortify_costs` in
 * `client/scripts/OUTPOST_YARD_PROPS.as`). A main yard has no ladder here
 * (fortifying one is a Map Room 3 feature), so every main-yard building is
 * refused `400 notFortifiable`.
 *
 * **Fortify** is `BFOUNDATION.Fortify` (`client/scripts/BFOUNDATION.as:2153-2216`)
 * with `BASE.CanFortify` (`client/scripts/BASE.as:3980-4110`): the step's
 * resources are charged up front and a countdown `cF = floor(time × bst)`
 * holds a worker (`workers.ts`: an outpost has one). The catch-up finishes it:
 * `fort` goes up by one and `Fortified()`'s points, a third of the step's time
 * and resources, are awarded (`catchUpBuildings.ts`). A fortifying building
 * can be sped up like an upgrade (`speedup.ts`).
 *
 * **Cancel** is `FortifyCancelC` (`:2227-2246`): the countdown goes and the
 * step's full price comes back, clamped to the storage cap by the wrapper.
 * Flash allows it in outposts (only cancelling a construction is refused
 * there).
 *
 * Both are pure: they read the caught-up yard the wrapper hands them and
 * return what should change, or throw the refusal.
 */

/** The slice of a save the two routes read. */
export interface FortifySave extends StorageCapSave {
  /** `BaseType`: only an outpost has fortify ladders. */
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
  storedata?: JsonObject | null;
}

/** `report` of `POST /bm/yard/fortify`. */
export interface FortifyReport {
  id: number;
  /** The fortification the building is at. */
  from: number;
  /** The fortification the step reaches when its countdown ends. */
  to: number;
  /** The countdown written, after Sharper Tools. */
  seconds: number;
  /** What the step cost: the ladder's `fortify[from]`. */
  cost: ResourceAmounts;
}

/** `report` of `POST /bm/yard/fortify/cancel`. */
export interface CancelFortifyReport {
  id: number;
  /** What came back: the step's full price, less whatever the storage cap turned away. */
  refund: ResourceAmounts;
}

/** A building's fortification, 0 when unset or unreadable. */
export const fortOf = (building: BuildingData): number => {
  const fort = Math.floor(Number(building.fort ?? 0));
  return Number.isFinite(fort) && fort > 0 ? fort : 0;
};

/** Whether a build, upgrade or fortify countdown runs on the building. */
const isBusy = (building: BuildingData): boolean =>
  Number(building.cB) > 0 || Number(building.cU) > 0 || Number(building.cF) > 0;

/**
 * Starts the next fortification of one building. Refuses, in this order:
 * `400 badRequest` (no such building), `400 notFortifiable` (no fortify
 * ladder in this yard), then `409` `busy`, `damaged`, `townHall` (no core),
 * `maxFortify {fort, max}` ("This building is fully fortified."),
 * `requirements`, `shortfall`, `workers`.
 *
 * @param save - The caught-up yard.
 * @param id - The building to fortify.
 * @param now - Unix seconds, for the Sharper Tools window.
 * @returns The new `buildingdata`, the debit and the report.
 */
export const planFortify = (save: FortifySave, id: number, now: number) => {
  const kind = yardKindOf(save);
  const buildings = save.buildingdata ?? {};
  const building = buildingOrThrow(buildings, id);
  const ladder = fortifyStepsOf(Number(building.t), kind);

  if (ladder.length === 0) {
    throw yardBadRequestErr("That building cannot be fortified.", { id }, "notFortifiable");
  }
  if (isBusy(building)) {
    throw yardRefusedErr("busy", "That building is already busy. Wait for its job to finish.");
  }
  if (isDamaged(building, save.buildinghealthdata)) throw damagedErr(id);

  const hall = townHallLevel(buildings, kind);
  if (hall <= 0) {
    throw yardRefusedErr("townHall", `You need a ${hallName(kind)} before you can fortify anything.`, {
      townHall: { have: 0, need: 1 },
    });
  }

  const from = fortOf(building);
  const step = ladder[from];
  if (!step) {
    throw yardRefusedErr("maxFortify", "This building is fully fortified.", {
      fort: from,
      max: ladder.length,
    });
  }

  const unmet = requirementDetail(step[5], buildings, hall, hallTypeOf(kind));
  if (unmet) {
    const gate = unmet.townHall as { have: number; need: number } | undefined;
    if (gate) {
      throw yardRefusedErr("townHall", `That needs a level ${gate.need} ${hallName(kind)}.`, {
        townHall: gate,
      });
    }
    throw yardRefusedErr("requirements", "That needs other buildings first.", {
      requirements: unmet.requirements as CostRequirement[],
    });
  }

  const cost = stepAmounts(step);
  const missing = shortfall(save.resources, cost);
  if (isShort(missing)) {
    throw yardRefusedErr("shortfall", "You do not have enough resources for that.", {
      shortfall: missing,
    });
  }

  const total = workerCount(save.storedata, kind);
  const busy = busyWorkers(buildings);
  if (busy >= total) {
    throw yardRefusedErr("workers", "All your workers are busy.", { workers: { total, busy } });
  }

  const seconds = Math.floor(step[4] * sharperToolsMultiplier(save.storedata, now));
  const report: FortifyReport = { id, from, to: from + 1, seconds, cost };

  return {
    report,
    slices: { buildingdata: { ...buildings, [String(id)]: { ...building, cF: seconds } } },
    debit: cost,
  };
};

/**
 * Cancels a running fortification: the countdown goes, the fortification
 * stays, and the step's full price comes back (`FortifyCancelC`,
 * `client/scripts/BFOUNDATION.as:2227-2246`), clamped by the wrapper.
 *
 * Refuses `400 badRequest` for no such building, `409 notFortifying` when no
 * `cF` is running.
 *
 * @param save - The caught-up yard.
 * @param id - The building whose fortification to cancel.
 * @returns The new `buildingdata`, the credit and the report.
 */
export const planCancelFortify = (save: FortifySave, id: number) => {
  const building = buildingOrThrow(save.buildingdata, id);
  if (!(Number(building.cF) > 0)) {
    throw yardRefusedErr("notFortifying", "That building is not being fortified.");
  }

  const { cF: _cancelled, ...rest } = building;
  const step = fortifyStepsOf(Number(building.t), yardKindOf(save))[fortOf(building)];
  const refund = step ? stepAmounts(step) : { r1: 0, r2: 0, r3: 0, r4: 0 };
  // What the wrapper's clamp will let through (`credit.ts`, T3), for the report.
  const report: CancelFortifyReport = { id, refund: fitCredit(save, refund).credited };

  return {
    report,
    slices: { buildingdata: { ...save.buildingdata, [String(id)]: rest as BuildingData } },
    credit: refund,
  };
};
