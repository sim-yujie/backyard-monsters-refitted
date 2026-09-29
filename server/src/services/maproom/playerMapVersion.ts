import type { EntityManager } from "@mikro-orm/core";
import { World } from "../../database/models/world.model.js";
import type { Save } from "../../database/models/save.model.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";

/**
 * The Map Room a player is in, from their own main save and world, never
 * from the request (issue #165).
 *
 * The base load used to take `mapversion` from the client, and every rule it
 * picks follows it: a Map Room 2 player who sent 3 or 1 had their attack's
 * range check skipped (`validateRange` does nothing for either). The world
 * decides: a player placed on one is in that world's Map Room, whatever their
 * save's `mapversion` says (`setmapversion` 1 keeps the world, and seeded
 * players carry the default 1). Without a world, the save's own `mapversion`
 * stands: Map Room 1 for anyone who never moved on.
 *
 * @param {EntityManager} em - The entity manager to read the world through.
 * @param {Pick<Save, "worldid" | "mapversion">} save - The player's main save.
 * @returns {Promise<MapRoomVersion>} The player's Map Room.
 */
export const playerMapVersion = async (
  em: EntityManager,
  save: Pick<Save, "worldid" | "mapversion">,
): Promise<MapRoomVersion> => {
  if (save.worldid) {
    const world = await em.findOne(World, { uuid: save.worldid }, { fields: ["map_version"] });
    if (world) return world.map_version as MapRoomVersion;
  }
  return save.mapversion as MapRoomVersion;
};
