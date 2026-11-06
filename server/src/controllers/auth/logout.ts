import type { KoaController } from "../../utils/KoaController.js";
import { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { verifyJwtToken } from "../../middleware/auth.js";
import { endSession } from "../../services/auth/sessions.js";

/**
 * Controller to sign the current session out (security audit 2026-10-29,
 * L4). Runs after `verifyUserAuth`, so the Bearer token is the one stored;
 * dropping it makes the token useless at once, rather than at the end of its
 * lifetime (`SESSION_LIFETIME`, 30 days by default).
 *
 * @param {Context} ctx - The Koa context object.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const logout: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const token = ctx.headers.authorization!.replace("Bearer ", "");
  const { sessionType } = verifyJwtToken(token).user;

  await endSession(sessionType, user);

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
