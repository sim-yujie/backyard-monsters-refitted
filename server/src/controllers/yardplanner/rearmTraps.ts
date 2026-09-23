import { Status } from "../../enums/StatusCodes.js";
import { TrapRearmSchema } from "../../schemas/YardPlannerSchemas.js";
import { advanceBuildingTimers } from "../../services/base/advanceBuildingTimers.js";
import { Operation, updateResources } from "../../services/base/updateResources.js";
import { parseTrapPlacements, planTrapRearm } from "../../services/yardplanner/trapRearm.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { postgres } from "../../server.js";
import { debitOf } from "./upgradeWalls.js";
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
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const rearmTraps: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"]);
  const save = user.save!;

  const body = TrapRearmSchema.parse(ctx.request.body ?? {});
  const traps = parseTrapPlacements(body.traps);

  const now = getCurrentDateTime();
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
  save.savetime = now;

  postgres.em.persist(save);
  await postgres.em.flush();

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    placed: plan.placed,
    ids: plan.ids,
    cost: plan.cost,
    resources: save.resources,
    buildingdata: save.buildingdata,
    firedtraps: save.firedtraps,
  };
};
