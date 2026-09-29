import type { Save } from "../../database/models/save.model.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";

/**
 * The Map Room a player is in: the one their own main save records, never
 * the request's (issue #165).
 *
 * The base load used to take `mapversion` from the client, and every rule it
 * picks follows it: a Map Room 2 player who sent 3 or 1 had their attack's
 * range check skipped (`validateRange` does nothing for either). Only
 * `setmapversion` changes the stored value.
 *
 * The world is no guide: Map Room 1 accounts sit on a world too (every seeded
 * player, and a Town Hall 1 account), so the save's own value decides. That a
 * player on Map Room 1 cannot reach a Map Room 2 base is the attack load's
 * target check (`baseModeAttack.ts`).
 *
 * @param {Pick<Save, "mapversion"> | null | undefined} save - The player's main save; none yet for a new account.
 * @returns {MapRoomVersion} The player's Map Room.
 */
export const playerMapVersion = (save: Pick<Save, "mapversion"> | null | undefined): MapRoomVersion =>
  (save?.mapversion as MapRoomVersion | undefined) ?? MapRoomVersion.V1;
