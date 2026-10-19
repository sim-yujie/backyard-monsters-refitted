import type { KoaController } from "../../utils/KoaController.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import { UpdateSettingsSchema } from "../../schemas/AuthSchemas.js";

/** The account's settings block, as `/player/settings` and `/player/account` send it. */
export const settingsOf = (user: User) => ({
  shinyLocked: user.shiny_locked,
  // The privacy part (`docs/design/friends.md` §3.6, issue #368).
  hideOnline: user.hide_online,
  friendRequests: !user.friend_requests_off,
});

/**
 * Controller to update the authenticated user's account settings.
 *
 * Callers send the settings they change (the web client sends the whole block)
 * and the whole block is echoed back, so the caller can render the resulting
 * state without a second request. A setting left out stays as it is. Clients
 * that never call this - the Android and raw builds - are unaffected: the
 * columns default to off, and every guard reads them from the account rather
 * than from the request.
 *
 * @param {Context} ctx - The Koa context object.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const updateSettings: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { shinyLocked, hideOnline, friendRequests } = UpdateSettingsSchema.parse(ctx.request.body);

  if (shinyLocked !== undefined) user.shiny_locked = shinyLocked;
  if (hideOnline !== undefined) user.hide_online = hideOnline;
  if (friendRequests !== undefined) user.friend_requests_off = !friendRequests;
  await postgres.em.flush();

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    settings: settingsOf(user),
  };
};
