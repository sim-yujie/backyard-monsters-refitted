import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { Status } from "../../enums/StatusCodes.js";
import { LAYOUT_SLOTS } from "../../schemas/YardPlannerSchemas.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { advanceBuildingTimers } from "../base/advanceBuildingTimers.js";
import { levelOf, yardKindOf } from "./costs.js";

/**
 * The Yard Planner building's gate on the planner's tools (owner, beta 8,
 * grilling of 19 Nov 2026).
 *
 * Layout mode stays every player's (moving, Apply, undo, Stored, re-arm), but
 * several tools now need a built Yard Planner **in the yard they act on**:
 * the main yard and the Inferno each need their own, and an outpost can never
 * have one, so there they stay locked even if a tribe's outpost came with a
 * Yard Planner already standing. The server holds two of those lines:
 *
 * - layout slots: one slot without a Yard Planner, {@link LAYOUT_SLOTS} with
 *   one. Saves already in the higher slots are kept (never deleted), but
 *   cannot be written or deleted until the yard has a Yard Planner again;
 * - the batch wall upgrade (`walls/upgrade`, many walls at once, finished on
 *   the spot): a Yard Planner tool. One wall at a time goes through the
 *   ordinary upgrade route for everyone, as in Flash.
 *
 * "Built" is the Blueprint rule the client has used since 2026-10-26: a type
 * 10 whose first build has finished. Damage, an upgrade countdown or
 * fortifying never matter. The build countdown is brought forward to `now`
 * here, as a route that has not caught the yard up would otherwise read a
 * Yard Planner finished minutes ago as still building.
 */

/** Yard Planner type id (`client/scripts/YARD_PROPS.as:1084`). */
export const YARD_PLANNER_TYPE = 10;

/** Layout slots a yard without a Yard Planner may use: slot 1 (index 0). */
export const FREE_LAYOUT_SLOTS = 1;

/** The parts of a save this file reads. */
export interface PlannerGateSave {
  type?: string | null;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  savetime?: number | string | null;
}

/** Whether the yard holds a finished Yard Planner: never in an outpost (the file comment). */
export const hasBuiltPlanner = (save: PlannerGateSave, now: number): boolean => {
  if (yardKindOf(save as { type?: string | null }) === "outpost") return false;
  const elapsed = now - Number(save.savetime ?? now);
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    if (Number(building?.t) !== YARD_PLANNER_TYPE) continue;
    const caught = advanceBuildingTimers({ [key]: building }, save.buildinghealthdata, elapsed)[key];
    if (levelOf(caught) >= 1) return true;
  }
  return false;
};

/** How many layout slots, from slot 1 up, this yard may write. */
export const usableLayoutSlots = (save: PlannerGateSave, now: number): number =>
  hasBuiltPlanner(save, now) ? LAYOUT_SLOTS : FREE_LAYOUT_SLOTS;

/** `403 plannerNeeded`: a Yard Planner tool used in a yard without one. */
export const plannerNeededErr = (message: string, data: object = {}) =>
  new ClientSafeError({
    message,
    status: Status.FORBIDDEN,
    data: { reason: "plannerNeeded", ...data },
    isClientFriendly: true,
  });

/**
 * Refuses a write to (or delete of) a slot this yard cannot use yet.
 *
 * @throws `403 plannerNeeded` for slot 2 or higher without a Yard Planner.
 */
export const requireUsableSlot = (save: PlannerGateSave, slot: number, now: number): void => {
  const usable = usableLayoutSlots(save, now);
  if (slot >= usable) {
    throw plannerNeededErr("Build a Yard Planner to use more layout slots.", { slot, usable });
  }
};

/**
 * Refuses the batch wall upgrade in a yard without a Yard Planner.
 *
 * @throws `403 plannerNeeded`.
 */
export const requirePlannerForWallBatch = (save: PlannerGateSave, now: number): void => {
  if (!hasBuiltPlanner(save, now)) {
    throw plannerNeededErr(
      yardKindOf(save as { type?: string | null }) === "outpost"
        ? "Walls in an outpost are upgraded one at a time."
        : "Build a Yard Planner to upgrade many walls at once."
    );
  }
};
