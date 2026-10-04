import { Status } from "../../enums/StatusCodes.js";
import { TrapRearmSchema, type TrapPlacement } from "../../schemas/YardPlannerSchemas.js";
import { advanceBuildingTimers } from "../../services/base/advanceBuildingTimers.js";
import { Operation, updateResources } from "../../services/base/updateResources.js";
import { parseTrapPlacements, planTrapRearm } from "../../services/yardplanner/trapRearm.js";
import { syncBaseValue, syncDerivedLevels } from "../../services/yard/derivedLevels.js";
import { moveMushroomsOffBuildings } from "../../services/yard/mushrooms.js";
import { onPlannerYard } from "./plannerYard.js";
import { debitOf } from "./upgradeWalls.js";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `POST /bm/yardplanner/traps/rearm` — build a trap at each position the client
 * asks for, charged server-side and finished on the spot.
 *
 * The same shape as `upgradeWalls`: advance the countdowns, work out the plan,
 * then write buildings, resources, points and `savetime` in one `flush`. The
 * extra piece is `firedtraps`, the record of where traps were when they fired
 * (`controllers/base/save/handlers/buildingDataHandler.ts`); the entries these
 * traps answer are struck off as they are rebuilt, so the planner's "Re-arm
 * traps" count goes down rather than offering the same spot twice.
 *
 * Old `buildinghealthdata` zeros for the ids the fired traps used are left
 * where they are: the Flash client keys health by the buildings it holds and
 * ignores the rest (decision Q9).
 *
 * A trap may go where a mushroom stands: the mushroom pops up on free ground
 * (#263) and the answer carries `mushrooms`.
 *
 * With a `baseid` naming one of the caller's Map Room 2 outposts the traps go
 * into that outpost (25 Booby Traps and 5 Heavy Traps at most) and the charge
 * is the main pool's, both rows in one transaction (`plannerYard.ts`).
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const rearmTraps: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = TrapRearmSchema.parse(ctx.request.body ?? {});
  const traps = parseTrapPlacements(body.traps);

  const answer = await onPlannerYard(user, ctx.request.body, (save, now) =>
    rearmTrapsOn(save, traps, now)
  );

  ctx.status = Status.OK;
  ctx.body = answer;
};

/** The re-arm on one yard (the controller comment); writes nothing but the save it is handed. */
const rearmTrapsOn = (save: Save, traps: readonly TrapPlacement[], now: number) => {
  const elapsed = now - Number(save.savetime ?? now);
  save.buildingdata = advanceBuildingTimers(
    save.buildingdata ?? {},
    save.buildinghealthdata,
    elapsed
  );

  const plan = planTrapRearm(save, traps);

  save.buildingdata = plan.buildingdata;
  save.firedtraps = plan.firedtraps;
  save.resources = updateResources(
    debitOf(plan.cost),
    { ...(save.resources ?? {}) },
    Operation.SUBTRACT
  );
  save.points = String(Number(save.points ?? "0") + plan.points);
  moveMushroomsOffBuildings(save);
  syncDerivedLevels(save);
  syncBaseValue(save);
  save.savetime = now;

  return {
    error: 0,
    placed: plan.placed,
    ids: plan.ids,
    cost: plan.cost,
    resources: save.resources,
    buildingdata: save.buildingdata,
    firedtraps: save.firedtraps,
    mushrooms: save.mushrooms ?? {},
  };
};
