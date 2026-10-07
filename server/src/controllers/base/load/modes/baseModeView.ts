import { MapRoomVersion } from "../../../../enums/MapRoom.js";
import { Save } from "../../../../database/models/save.model.js";
import { User } from "../../../../database/models/user.model.js";
import { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../../server.js";
import { devConfig } from "../../../../config/GameConfig.js";
import { tribeSaveHandler } from "../../../../services/maproom/tribeSaveHandler.js";
import { cellCoordsFromBaseId, type CellCoords } from "../../../../services/maproom/v2/rangeCheck.js";
import { getCurrentDateTime } from "../../../../utils/getCurrentDateTime.js";
import { MR1_TRIBE_IDS } from "../../../../game-data/tribes/v1/index.js";
import { isWildMonsterExpired } from "../../../../services/maproom/wildMonsterExpiry.js";
import { isVisible } from "../../../../game-rules/maproom/sight.js";

/**
 * `baseid`'s cell, for the fog of war check below: a player base always has
 * a `world_map_cell` row; a wild monster camp never attacked does not, so
 * its coordinates are decoded from the id itself (`rangeCheck.ts`'s
 * `cellCoordsFromBaseId`, the same derivation the attack path uses before
 * that row exists).
 */
const cellCoordsOf = async (baseid: string): Promise<CellCoords | null> => {
  const row = await postgres.em.findOne(WorldMapCell, { baseid }, { fields: ["x", "y"] });
  return row ? { x: row.x, y: row.y } : cellCoordsFromBaseId(baseid);
};

/**
 * Whether `baseid`'s Map Room 2 cell is visible to `user` (issue #330,
 * `docs/design/fog-of-war.md` §5.3): own and alliance bases always pass,
 * since the sight rule already reveals them (§3 rules 2, 3) — no separate
 * ownership check is needed here. Fails open (visible) when the id carries
 * no decodable coordinates at all, rather than wrongly hiding a real base
 * over an id shape this was not expecting.
 */
const isCellVisibleTo = async (user: User, baseid: string): Promise<boolean> => {
  const cell = await cellCoordsOf(baseid);
  if (!cell) return true;

  // Imported on use: `sightService.ts` reaches the server's shared Redis
  // handle through a chain that loops back to this module, the same reason
  // `baseLoad.ts`'s own call into it is late too.
  const { getPlayerSight } = await import("../../../../services/maproom/sight/sightService.js");
  const sight = await getPlayerSight(user);

  return isVisible(cell, sight.sources, sight.revealed);
};

/**
 * Handles viewing the base mode for a given base ID.
 * If the save is outdated for a wild monster, it removes the old save and creates a new one.
 *
 * @param {string} baseid - The base identifier for the requested save.
 * @param {MapRoomVersion} mapversion - The version of the map to determine the save handling logic.
 * @param {string} worldid - The world UUID, passed through for MR3 player yard defender lookups.
 * @param {User} user - The requesting player, whose fog of war sight gates a Map Room 2 view (#330).
 * @returns {Promise<Loaded<Save, never> | null>} The save object, or null if no valid save is found
 *   or (Map Room 2 only) the cell is outside the requester's sight.
 */
export const baseModeView = async (baseid: string, mapversion: MapRoomVersion = MapRoomVersion.V2, worldid: string | null | undefined, user: User) => {
  if (mapversion === MapRoomVersion.V1 && MR1_TRIBE_IDS.has(baseid))
    return tribeSaveHandler(baseid, mapversion, worldid, user);

  if (mapversion === MapRoomVersion.V2 && !devConfig.disableFogOfWar && !(await isCellVisibleTo(user, baseid))) {
    return null;
  }

  let save = await postgres.em.findOne(Save, { baseid });

  if (!save) save = await tribeSaveHandler(baseid, mapversion, worldid, user);

  // Opening the yard is the one place allowed to write, so it reclaims the row and
  // regenerates the camp. Read-only paths share the same rule via isWildMonsterExpired
  // but only report the camp as fresh - see wildMonsterCell and worldSnapshot.
  if (mapversion !== MapRoomVersion.V3 && isWildMonsterExpired(save, getCurrentDateTime())) {
    postgres.em.remove(save!);
    await postgres.em.flush();
    save = await tribeSaveHandler(baseid, mapversion, worldid, user);
  }

  return save;
};
