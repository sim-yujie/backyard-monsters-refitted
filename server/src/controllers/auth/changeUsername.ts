import type { KoaController } from "../../utils/KoaController.js";
import { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { ChangeUsernameSchema } from "../../schemas/AuthSchemas.js";
import { invalidAccountErr, usernameCooldownErr } from "../../errors/errors.js";
import { getUsernameCooldown, renameUser } from "../../services/user/renameUser.js";
import { assertUsernameAllowed } from "../../services/user/usernameFilter.js";

/**
 * Controller to change the authenticated user's username.
 *
 * Holds the new name to the same rules as a sign-up (issue #213): the shared account
 * rules, reserved names included, then the word filter. Enforces the rename cooldown,
 * then hands off to the rename service, which owns every write involved. A running game
 * client keeps the old name in memory until it is restarted.
 *
 * @param {Context} ctx - The Koa context object.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 * @throws {ClientSafeError} If the name breaks a rule, the cooldown has not elapsed or the username is taken.
 */
export const changeUsername: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const parsed = ChangeUsernameSchema.safeParse(ctx.request.body ?? {});

  if (!parsed.success) throw invalidAccountErr(parsed.error.issues[0].message, "username");

  const { username } = parsed.data;
  assertUsernameAllowed(username);

  const cooldown = getUsernameCooldown(user);

  if (cooldown) throw usernameCooldownErr(cooldown);

  const nextChangeAt = await renameUser(user, username);

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    username: user.username,
    nextChangeAt: nextChangeAt.toISOString(),
  };
};
