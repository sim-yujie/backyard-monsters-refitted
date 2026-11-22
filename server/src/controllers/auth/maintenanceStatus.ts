import type { Context } from "koa";

import { isAdminUser } from "../../config/AdminConfig.js";
import { Status } from "../../enums/StatusCodes.js";
import { sessionUser } from "../../middleware/auth.js";
import { maintenanceNotice, maintenanceState } from "../../services/admin/maintenance.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `GET /api/:apiVersion/maintenance`: the maintenance switch as the game
 * needs it (`services/admin/maintenance.ts`), with no sign-in needed: the
 * sign-in screen's "Try again" asks it, and a game whose chat connection is
 * down asks it every half minute to hear of a countdown.
 *
 * Answered from memory. While maintenance is on, a session token sent along
 * is checked, and `exempt` says whether it is the owner's (never cut off).
 */
export const maintenanceStatus: KoaController = async (ctx: Context) => {
  const state = maintenanceState();
  let exempt = false;
  const auth = ctx.headers.authorization;
  if (state.on && auth?.startsWith("Bearer ")) {
    const signedIn = await sessionUser(auth.slice("Bearer ".length)).catch(() => null);
    exempt = isAdminUser(signedIn?.user.userid);
  }
  ctx.status = Status.OK;
  ctx.set("Cache-Control", "no-store");
  ctx.body = { error: 0, ...maintenanceNotice(state, Date.now(), exempt) };
};
