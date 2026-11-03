import type { KoaController } from "../../utils/KoaController.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import { UpdateSettingsSchema } from "../../schemas/AuthSchemas.js";
import { countryChannelFor } from "../../config/ChatConfig.js";
import { disconnectCountryChat } from "../../chat/chatControl.js";

/** The account's settings block, as `/player/settings` and `/player/account` send it. */
export const settingsOf = (user: User) => ({
  shinyLocked: user.shiny_locked,
  // The privacy part (`docs/design/friends.md` §3.6, issue #368).
  hideOnline: user.hide_online,
  friendRequests: !user.friend_requests_off,
  // The player's country (owner 3 Nov 2026): null until picked. `countryAsked`
  // says the one-time prompt was answered or put off; `countryChannel` is the
  // country's chat room (every country has one), null while no country is set.
  country: user.country ?? null,
  countryAsked: user.country_asked || !!user.country,
  countryChannel: countryChannelFor(user.country),
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
  const { shinyLocked, hideOnline, friendRequests, country, countryAsked } = UpdateSettingsSchema.parse(
    ctx.request.body,
  );

  if (shinyLocked !== undefined) user.shiny_locked = shinyLocked;
  if (hideOnline !== undefined) user.hide_online = hideOnline;
  if (friendRequests !== undefined) user.friend_requests_off = !friendRequests;
  if (countryAsked) user.country_asked = true;

  const oldCountry = user.country ?? null;

  if (country !== undefined) {
    user.country = country;
    user.country_asked = true;
  }

  await postgres.em.flush();

  // A new country may close the old country room: the chat server lets go of it.
  const newCountry = user.country ?? null;

  if (newCountry !== oldCountry) await disconnectCountryChat(user.userid, countryChannelFor(newCountry));

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    settings: settingsOf(user),
  };
};
