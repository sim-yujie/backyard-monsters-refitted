import { Status } from "../../enums/StatusCodes.js";
import type { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { blocksIgnoringStaff, findMailRecipient, isMailStaff } from "../../services/mail/modMail.js";
import { readMailStatus } from "../../services/mail/mailStatus.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `GET /player/mailstatus` (owner, beta 7): the unread count and the newest
 * unread message, for the game's live mail pop-up (`services/mail/mailStatus.ts`).
 */
export const getMailStatus: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  // Mail from moderators and admins counts even if the player blocked them (owner, 8 Nov).
  const blocked = await blocksIgnoringStaff(postgres.em, user.blockedUsers ?? []);
  const status = await readMailStatus(postgres.em, user.userid, blocked);
  ctx.status = Status.OK;
  ctx.body = { error: 0, ...status };
};

/** What a player not on the moderators list is told. */
export const NOT_MODERATOR_TEXT = "Only moderators can write to any player.";
/** What a moderator is told when no player has that name or number. */
export const NO_SUCH_PLAYER_TEXT = "No player has that name or number.";

/**
 * `POST /player/mail/findplayer` `{ player }` (owner, beta 7): a moderator's
 * New message finds any player by whole name or account number
 * (`services/mail/modMail.ts`). Anyone not on the moderators list right now
 * is refused with 403, whatever their game claims.
 */
export const findMailPlayer: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  // Moderators and admins (owner, 8 Nov: "allow mods and admins to mail anyone").
  if (!(await isMailStaff(postgres.em, user.userid))) {
    ctx.status = Status.FORBIDDEN;
    ctx.body = { error: NOT_MODERATOR_TEXT, message: NOT_MODERATOR_TEXT, reason: "notModerator" };
    return;
  }
  const body = (ctx.request.body ?? {}) as { player?: unknown };
  const found = await findMailRecipient(postgres.em, body.player, user.userid);
  ctx.status = Status.OK;
  ctx.body = found ? { error: 0, player: found } : { error: 1, message: NO_SUCH_PLAYER_TEXT };
};
