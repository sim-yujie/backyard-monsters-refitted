import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { PurchasePowerupSchema } from "../../schemas/AllianceSchemas.js";
import { requireAllianceMember } from "../../services/alliance/allianceAccess.js";
import { reducePowerupCharge, type PowerupPurchase } from "../../services/alliance/powerups.js";
import { isShinyLocked } from "../../services/user/shinyLock.js";
import { shinyLockedErr } from "../../errors/errors.js";
import { notMainYardErr } from "../../services/yard/yardErrors.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Fields loaded off the paying player's save: only its id. The balance is read
 * under the save's row lock (`reducePowerupCharge`).
 */
const PAYING_SAVE_FIELDS = ["save.basesaveid"] as const;

/**
 * Spends the caller's Shiny to shorten a power-up's charge for the whole alliance.
 *
 * Any member may do this - the leader-only rule covers activation, not
 * contributing towards it.
 *
 * @param {Context} ctx - Koa context.
 */
export const purchasePowerup: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const alliance = await requireAllianceMember(user);

  const shinyLock = await isShinyLocked(user);
  
  if (shinyLock) throw shinyLockedErr();

  const { powerup_id, purchase_hours } = PurchasePowerupSchema.parse(ctx.request.body);

  await postgres.em.populate(user, ["save"], { fields: PAYING_SAVE_FIELDS });

  const basesaveid = user.save?.basesaveid;
  if (basesaveid == null) throw notMainYardErr();

  const purchase: PowerupPurchase = {
    allianceId: alliance.id,
    author: user,
    basesaveid,
    powerupId: powerup_id,
    hours: purchase_hours
  };

  const { powerups: resolved, credits } = await reducePowerupCharge(purchase);

  const powerups = resolved.map(({ rules, status }) => ({
    powerup_id: rules.powerup_id,
    type: rules.type,
    active: status.active,
    endTime: status.end_time,
    hourly_cost: rules.hourly_cost,
    total_running_time: rules.running_time,
    total_recharge_time: rules.recharge_time,
  }));

  ctx.status = Status.OK;
  ctx.body = { error: 0, powerups, credits };
};
