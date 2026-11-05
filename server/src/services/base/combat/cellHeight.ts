import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { BaseType } from "../../../enums/Base.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { postgres } from "../../../server.js";
import { mr2LandFeaturesEnabled } from "../../../config/MapRoom2Config.js";
import { activeLandFeature } from "../../maproom/v2/landFeature.js";

/**
 * The height of the map cell a defender's yard stands on, as the combat
 * engine reads it (issue #179).
 *
 * On a player's Map Room 2 outpost, every tower's range is scaled by the
 * cell's height: `int(h * range / 125)` from a height of 100 up
 * (`client/scripts/BTOWER.as:80-85`, `:94-99`; `stats.ts` `towerRange`).
 * Flash reads `h` off the map cell, whose `i` is this row's `terrainHeight`
 * (`MR2/MapRoomCell.as:322`; `controllers/maproom/v2/cells/userCell.ts`).
 *
 * Every engine run over one attack reads this same stored value: the attack
 * load serves it to the client as `cellheight`, and the attack save's loot
 * replay (`attackLoot.ts`) and the abandoned-attack replay
 * (`abandonedAttack.ts`) read it again, so an honest client and the server
 * fight the same battle. Only an outpost's towers stretch — a wild monster
 * camp loads as a main yard in Flash, so its towers never do — so any other
 * yard, and a Map Room 3 outpost, reads undefined and the engine uses the
 * table ranges.
 *
 * @param save - The defender's row.
 * @returns The cell's height, or undefined when the terrain changes nothing.
 */
export const combatCellHeight = async (
  save: { type: string; baseid: string }
): Promise<number | undefined> => {
  if (save.type !== BaseType.OUTPOST) return undefined;
  const cell = await postgres.em.findOne(
    WorldMapCell,
    { baseid: save.baseid, map_version: MapRoomVersion.V2 },
    { fields: ["terrainHeight"] }
  );
  return cell?.terrainHeight;
};

/**
 * The land feature of the map cell a defender's yard stands on
 * (`landFeature.ts`), for the yard's range rings: an outpost's or a wild
 * monster camp's on Map Room 2 with `MR2_LAND_FEATURES` on, else 0 (open).
 * The battle itself reads the copy frozen into the attack's defence (`land`).
 *
 * @param save - The defender's row.
 * @returns The feature id, 0 when it changes nothing.
 */
export const combatLandFeature = async (
  save: { type: string; baseid: string }
): Promise<number> => {
  if (!mr2LandFeaturesEnabled() || save.type === BaseType.MAIN) return 0;
  const cell = await postgres.em.findOne(
    WorldMapCell,
    { baseid: save.baseid, map_version: MapRoomVersion.V2 },
    { fields: ["x", "y", "terrainHeight", "world"] }
  );
  const worldid = cell?.world?.uuid;
  return cell && worldid ? activeLandFeature(worldid, cell.x, cell.y, cell.terrainHeight) : 0;
};
