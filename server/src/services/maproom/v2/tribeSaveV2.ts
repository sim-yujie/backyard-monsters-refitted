import { Save } from "../../../database/models/save.model.js";
import { postgres } from "../../../server.js";
import { Tribe, Tribes } from "../../../enums/Tribes.js";
import { calculateTribeLevel } from "./calculateTribeLevel.js";
import { tribeIdAt, tribeLayoutFor } from "./tribeLayouts.js";

/**
 * Generates a save for a wild monster on Map Room 2 based on the given base ID.
 *
 * The base ID is used to calculate the cell coordinates (`cellX`, `cellY`)
 * and derive a tribe index from the combined coordinates. Based on the tribe index,
 * it fetches tribe-specific save data and generates a `Save` object for a wild monster.
 *
 * @param {string} baseid - The base ID as a string, which will be converted to an integer.
 * @returns {Save} - A new `Save` object for the wild monster, with tribe-specific data.
 */
export const tribeSaveV2 = (baseid: string, worldid: string | null | undefined) =>
  // Return a new save for the wild monster.
  postgres.em.create(Save, { ...freshTribeData(baseid), baseid, worldid }, { partial: true });

/**
 * What a fresh camp at this base id's cell holds: its tribe's yard for its
 * level, with that level and the tribe's `wmid`. Plain data, written nowhere:
 * `tribeSaveV2` makes a new row of it, and `regrowCamp` resets a healed camp's
 * row to it in place.
 *
 * The template's nested objects are shared by every camp of that tribe and
 * level, so callers that change them must copy first (`regrowCamp` does).
 */
export const freshTribeData = (baseid: string) => {
  const cellX = parseInt(baseid.slice(-6, -3));
  const cellY = parseInt(baseid.slice(-3));

  const tribeIndex = (cellX + cellY) % Tribes.length;
  const tribe = Tribes[tribeIndex] as Tribe;
  const wmid = tribeIndex * 10 + 1;

  const level = calculateTribeLevel(cellX, cellY, tribe);

  const { tribeSave } = fetchTribeData(tribeIndex, level);

  return { ...tribeSave, level, wmid };
};

/**
 * Fetches the tribe data based on the given tribe index: the yard saved for
 * this level, or the nearest one below it (`tribeLayouts.ts`).
 *
 * @param {number} tribeIndex - The tribe index.
 * @param {number} level - The level of the wild monster.
 * @returns {object} - An object containing the tribe save data.
 */
export const fetchTribeData = (tribeIndex: number, level: number) => {
  const { save: tribeSave } = tribeLayoutFor(tribeIdAt(tribeIndex), level);
  return { tribeSave };
};
