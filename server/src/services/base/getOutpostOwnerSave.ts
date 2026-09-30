import type { Loaded } from "@mikro-orm/core";
import { BaseType } from "../../enums/Base.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";

export type OutpostOwnerSave = Loaded<Save, never, "resources">;

/**
 * Resolves the main yard save that owns an outpost.
 *
 * Outposts share their owner's main yard resource pool rather than holding one of
 * their own; the main save is the only writer, so both reads and loot writes for
 * an outpost have to be redirected here. Only `resources` is loaded from another
 * player's save, since that pool is all an outpost takes from it.
 *
 * @param {Save} save - The save to resolve, of any type
 * @param {User} user - The requesting user, whose own save is already populated
 * @returns {Promise<OutpostOwnerSave | null>} The owner's main save, or null if `save` is not an outpost
 */
export const getOutpostOwnerSave = async (save: Save, user: User): Promise<OutpostOwnerSave | null> => {
  if (save.type !== BaseType.OUTPOST) return null;

  if (save.saveuserid === user.userid) return user.save || null;

  return await postgres.em.findOne(
    Save,
    { saveuserid: save.saveuserid, type: BaseType.MAIN },
    { fields: ["resources"] },
  );
};

/** Where a yard's academy levels and Housing Expansion live. */
export type HousingOwner = Pick<Save, "academy" | "storedata">;

/**
 * The save whose academy levels and buffs measure a yard's housing (issue
 * #160): a main yard's own, an outpost's owner's main save. Read in a fork
 * of its own, so the owner's row that `getOutpostOwnerSave` loaded with only
 * `resources` is neither refreshed nor written by it.
 *
 * @param {Save} save - The yard
 * @returns {Promise<HousingOwner | null>} Its housing's owner, or null if an outpost's has gone
 */
export const getHousingOwner = async (save: Save): Promise<HousingOwner | null> => {
  if (save.type !== BaseType.OUTPOST) return save;

  return await postgres.em.fork().findOne(
    Save,
    { saveuserid: save.saveuserid, type: BaseType.MAIN },
    { fields: ["academy", "storedata"] },
  );
};
