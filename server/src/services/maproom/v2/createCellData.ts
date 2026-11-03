import type { Loaded } from "@mikro-orm/core";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import type { Context } from "koa";
import { Terrain } from "../../../enums/MapRoom.js";
import { activeLandFeature } from "./landFeature.js";
import { activeRiverEdges } from "./rivers.js";
import { userCell, type UserCellFields, type UserCellOwner } from "../../../controllers/maproom/v2/cells/userCell.js";
import { wildMonsterCell, type WildMonsterCellFields } from "../../../controllers/maproom/v2/cells/wildMonsterCell.js";

export type MapCell = Loaded<WorldMapCell, "save", UserCellFields | WildMonsterCellFields>;

/**
 * Constructs the necessary data object of a cell on the world map.
 *
 * @param {MapCell} cell - The world map cell, with every save field its handlers read.
 * @param {string} worldid - The world ID.
 * @param {Context} ctx - The Koa context object.
 * @param {Map<number, UserCellOwner>} cellOwners - Pre-loaded map of user IDs to cell owners (optional for in-memory cells).
 * @returns {Promise<Object>} - The data object for the cell.
 */
export const createCellData = async (
  cell: MapCell,
  worldid: string,
  ctx: Context,
  cellOwners: Map<number, UserCellOwner> = new Map(),
) => {
  if (cell.terrainHeight <= Terrain.WATER3) return { i: cell.terrainHeight };

  // If it's a homebase cell or outpost, otherwise a wild monster cell
  const data = cell.base_type >= 2 ? await userCell(ctx, cell, cellOwners) : await wildMonsterCell(cell, worldid);
  if (!data) return data;

  // The cell's land feature (`landFeature.ts`), with the switch on and not open
  // ground: the map draws it and the cell pop-up lists what it does. Left out
  // otherwise, so the switch off sends exactly what it always did.
  const feature = activeLandFeature(worldid, cell.x, cell.y, cell.terrainHeight);
  // The river edges on the cell's own three sides (`rivers.ts`), with the
  // rivers switch on: look only, drawn by the Modern map. Left out otherwise.
  const rivers = activeRiverEdges(worldid, cell.x, cell.y, cell.terrainHeight);
  if (feature === 0 && rivers === 0) return data;
  return { ...data, ...(feature !== 0 && { lf: feature }), ...(rivers !== 0 && { rv: rivers }) };
};
