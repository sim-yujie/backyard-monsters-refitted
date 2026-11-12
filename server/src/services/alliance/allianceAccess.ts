import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { permissionErr } from "../../errors/errors.js";
import { can, type AllianceAction } from "./permissions.js";

interface AllianceLookupOptions { withStats?: boolean; }

/**
 * Loads the alliance a user belongs to.
 *
 * Standing - member count, empire points, average level, both ranks - lives in the
 * bym.alliance_stats view and is left unjoined by default, so the base-load and
 * updatesaved paths that poll through here cost nothing extra.
 *
 * Pass withStats wherever those numbers are displayed. Forgetting it is not caught by
 * the compiler: an unpopulated relation is an empty reference rather than undefined, so
 * reading through it yields undefined for every field and the response quietly loses
 * them rather than failing.
 *
 * @param {User} user - The user whose membership is being resolved.
 * @param {AllianceLookupOptions} options - Whether to join the alliance's standing.
 * @returns {Promise<Alliance | null>} The alliance, or null when the user is unaffiliated.
 */
export const getUserAlliance = async (user: User, options: AllianceLookupOptions = {}): Promise<Alliance | null> => {
  if (!user.alliance_id) return null;

  const where = { id: user.alliance_id };

  if (options.withStats) return await postgres.em.findOne(Alliance, where, { populate: ["stats"] });

  return await postgres.em.findOne(Alliance, where);
};

/**
 * Loads the alliance a player is a member of. The guard for every action that
 * only makes sense from inside an alliance; a leader passes it too.
 *
 * @param {User} user - The user whose membership is being resolved.
 * @returns {Promise<Alliance>} The alliance the player is a member of.
 * @throws {ClientSafeError} When the player is not in an alliance.
 */
export const requireAllianceMember = async (user: User): Promise<Alliance> => {
  const alliance = await getUserAlliance(user);

  if (!alliance) throw permissionErr();

  return alliance;
};

/**
 * Loads the alliance of a player whose rank may take the given action
 * (`permissions.ts`), rejecting other ranks and unaffiliated players alike.
 * Services that change membership check the rank again under their locks.
 *
 * @param {User} user - The user whose membership is being resolved.
 * @param {AllianceAction} action - What they want to do.
 * @returns {Promise<Alliance>} The player's alliance.
 * @throws {ClientSafeError} When the player is in no alliance or their rank may not.
 */
export const requireAlliancePermission = async (user: User, action: AllianceAction): Promise<Alliance> => {
  if (!can(user.alliance_role, action)) throw permissionErr();

  return await requireAllianceMember(user);
};
