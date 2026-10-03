import { Status } from "../../enums/StatusCodes.js";
import { WallUpgradeSchema } from "../../schemas/YardPlannerSchemas.js";
import { advanceBuildingTimers } from "../../services/base/advanceBuildingTimers.js";
import {
  Operation,
  updateResources,
  type Resources,
} from "../../services/base/updateResources.js";
import { parseWallIds, planWallUpgrade } from "../../services/yardplanner/wallUpgrade.js";
import type { ResourceAmounts } from "../../services/yardplanner/costs.js";
import { syncBaseValue, syncDerivedLevels } from "../../services/yard/derivedLevels.js";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";
import { onPlannerYard } from "./plannerYard.js";

/**
 * `POST /bm/yardplanner/walls/upgrade` — take every listed wall to one level,
 * charged server-side and finished on the spot.
 *
 * This route and `rearmTraps` are the first server-authoritative cost logic in
 * the project: everywhere else the Flash client charged itself and the server
 * added the delta it was handed (`services/base/updateResources.ts`). Here the
 * client sends ids and a target level and nothing else, and
 * `services/yardplanner/wallUpgrade.ts` decides what that costs.
 *
 * Countdowns are brought forward *before* the plan is worked out, for two
 * reasons: the `busy` check has to see the yard as it is now rather than as it
 * was at the last save, and moving `savetime` afterwards without advancing them
 * would hand every running job the elapsed time a second time. Same sequence as
 * the attack path (`controllers/base/save/baseSave.ts:213-218`).
 *
 * Everything lands on one row in one `flush`, which MikroORM wraps in a
 * transaction, so resources and levels move together or not at all. With a
 * `baseid` naming one of the caller's Map Room 2 outposts the walls are the
 * outpost's (level 5 at most) and the charge is the main pool's, both rows in
 * one transaction (`plannerYard.ts`).
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const upgradeWalls: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = WallUpgradeSchema.parse(ctx.request.body ?? {});
  const ids = parseWallIds(body.ids);

  const answer = await onPlannerYard(user, ctx.request.body, (save, now) =>
    upgradeWallsOn(save, ids, body.level, now)
  );

  ctx.status = Status.OK;
  ctx.body = answer;
};

/** The batch on one yard (the controller comment); writes nothing but the save it is handed. */
const upgradeWallsOn = (save: Save, ids: readonly number[], level: number, now: number) => {
  const elapsed = now - Number(save.savetime ?? now);
  save.buildingdata = advanceBuildingTimers(
    save.buildingdata ?? {},
    save.buildinghealthdata,
    elapsed
  );

  const plan = planWallUpgrade(save, ids, level);

  save.buildingdata = plan.buildingdata;
  save.resources = updateResources(
    debitOf(plan.cost),
    { ...(save.resources ?? {}) },
    Operation.SUBTRACT
  );
  save.points = String(Number(save.points ?? "0") + plan.points);
  syncDerivedLevels(save);
  syncBaseValue(save);
  save.savetime = now;

  return {
    error: 0,
    upgraded: plan.upgraded,
    level: plan.level,
    cost: plan.cost,
    resources: save.resources,
    buildingdata: save.buildingdata,
  };
};

/**
 * The cost as a delta `updateResources` can apply.
 *
 * Resources the batch does not spend are left out entirely: `updateResources`
 * does `saveResources[key] -= delta`, so naming a key the save has never held
 * would turn it into `NaN` for the sake of subtracting nothing.
 */
export const debitOf = (cost: Readonly<ResourceAmounts>): Resources =>
  Object.fromEntries(Object.entries(cost).filter(([, amount]) => amount > 0));
