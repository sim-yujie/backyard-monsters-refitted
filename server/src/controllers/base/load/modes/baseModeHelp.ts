import { BaseType } from "../../../../enums/Base.js";
import { Save } from "../../../../database/models/save.model.js";
import { User } from "../../../../database/models/user.model.js";
import { postgres } from "../../../../server.js";
import { friendRefusedErr } from "../../../../errors/errors.js";
import { mayVisit } from "../../../../services/friends/friendFlags.js";

/**
 * Opens a friend's main yard to visit and help (`docs/design/friends.md` §3.3,
 * §6.2, issue #369). Served like a `view` of any player's yard, so it shows
 * nothing an attack view would not: no fog of war gate (a friend's yard is
 * always reachable), no write, no presence mark, and neither the owner's
 * protection nor their online state is touched.
 *
 * Refusals are the friends refusal `notFriends`, the same for a stranger, a
 * blocked pair, a missing or banned account and a yard that is not a player's
 * main yard, so the answer says nothing about who exists. A friend's outpost
 * id is simply not found (`null`).
 *
 * @param {User} user - The visitor.
 * @param {string} baseid - The friend's main yard id.
 * @returns {Promise<Save | null>} The friend's main save, or null for an outpost or unknown id.
 */
export const baseModeHelp = async (user: User, baseid: string): Promise<Save | null> => {
  const save = await postgres.em.findOne(Save, { baseid });
  if (!save) throw friendRefusedErr("notFriends");

  if (!(await mayVisit(postgres.em, user.userid, save.userid))) throw friendRefusedErr("notFriends");

  return save.type === BaseType.MAIN ? save : null;
};
