import type { KoaController } from "../../utils/KoaController.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import { setAvatarFor } from "../../services/user/setAvatar.js";

/**
 * Controller to set the authenticated user's avatar to one of the twelve
 * critters (issue #175; the rules are in `services/user/setAvatar.ts`). The
 * stored path is echoed back.
 *
 * @param {Context} ctx - The Koa context object.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 * @throws {ClientSafeError} If the avatar is not on the allow-list.
 */
export const setAvatar: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const picSquare = await setAvatarFor(postgres.em, user, ctx.request.body);

  ctx.status = Status.OK;
  ctx.body = { error: 0, pic_square: picSquare };
};
