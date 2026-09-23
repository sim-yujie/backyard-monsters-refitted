import type { Loaded } from "@mikro-orm/core";
import { Save } from "../../../database/models/save.model.js";
import { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../server.js";
import { logReport } from "../../base/reportManager.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import {
  checkOutpostRange,
  planRangeCheck,
  type CellCoords,
  type NearbyOutpost,
  type RangeRefusal,
  type RangeVerdict,
} from "./rangeCheck.js";

type RangeOptions = {
  baseid?: string;
  attackCell?: Loaded<WorldMapCell, never>;
  /**
   * Coordinates of the cell under attack, when the caller already knows them.
   *
   * The attack path resolves the cell before anything is persisted, because the
   * `world_map_cell` row for a wild monster camp may not exist until the attack
   * creates it (issue #26).
   */
  cell?: CellCoords | null;
};

/**
 * Validates if the target is within the attack range of the user's base.
 * Delegates to the appropriate version-specific handler based on map version.
 *
 * The rule itself lives in `rangeCheck.ts` and is pure; this is the half that
 * loads what the rule needs and turns a refusal into the error the client
 * already handles — a raw `Error`, which the error interceptor renders as the
 * generic 500 the Flash client shows for an out-of-range attack.
 *
 * @param {User} user - The user object containing the save data
 * @param {Save} save - The save object containing the user's base and outposts
 * @param {MapRoomVersion} mapversion - The map room version
 * @param {RangeOptions} options - The options object
 * @returns {Promise<Save>} - The save object if the attack is valid
 */
export const validateRange = async (
  user: User,
  save: Save, mapversion: MapRoomVersion | undefined,
  options: RangeOptions) => {
  if (!mapversion) throw new Error("Map version is required for range validation.");

  switch (mapversion) {
    case MapRoomVersion.V1:
      return save;

    case MapRoomVersion.V2:
      return validateRangeV2(user, save, options);

    case MapRoomVersion.V3:
      return validateRangeV3(save);

    default:
      throw new Error(`validateRange: unhandled map version ${mapversion}`);
  }
};

/**
 * MR3 range validation.
 * Range is checked client-side before the attack request is sent.
 * TODO: Implement server-side validation for MR3 cost ranges. Right now we just return the save.
 *
 * @param {Save} save - The save being attacked
 * @returns {Save}
 */
const validateRangeV3 = (save: Save) => save;

/**
 * Validates if the target is within the attack range of the user's main base or any of their outposts.
 * Wiki: https://backyardmonsters.fandom.com/wiki/Flinger
 *
 * Invalidates an attack if:
 * 1| No attack cell is found
 * 2| No outposts are owned and the main base is out of range
 * 3| No outposts near attack cell
 * 4| No outposts are within attack range
 *
 * @param {User} user - The user object containing the save data
 * @param {Save} save - The save object containing the user's base and outposts
 * @param {RangeOptions} options - The options object
 *
 * @throws {Error} - attack invalidation error
 * @returns {Promise<Save>} - The save object if the attack is valid
 */
const validateRangeV2 = async (user: User, save: Save, options: RangeOptions) => {
  const { homebase, outposts, flinger } = user.save!;

  const cell = await resolveAttackCell(options);

  const plan = planRangeCheck({ homebase, flinger, cell, outposts });

  let verdict: RangeVerdict;

  if ("pending" in plan) {
    verdict = checkOutpostRange(plan.pending, await outpostFlingers(plan.pending));
  } else {
    verdict = plan;
  }

  if (verdict.ok) return save;

  // Only a target that really is out of reach is worth a report; the other
  // refusals are missing data, not a player reaching too far.
  if (verdict.reason === "out-of-range") {
    const target =
      options.attackCell?.baseid ??
      options.baseid ??
      (cell ? `${cell.x},${cell.y}` : "unknown");

    await logReport(user, `${user.username} attacked out of range base: ${target}`);
  }

  throw rangeError(user, verdict.reason);
};

/**
 * The cell under attack, from whichever the caller could supply.
 *
 * Takeover passes the row it already loaded. The attack path passes the
 * coordinates it resolved from the base id, because the row may not exist yet.
 * A bare `baseid` is still looked up, for any caller that has only that.
 *
 * @param {RangeOptions} options - What the caller knows about the target.
 * @returns {Promise<CellCoords | null>} The cell, or null if it could not be resolved.
 */
const resolveAttackCell = async (options: RangeOptions): Promise<CellCoords | null> => {
  if (options.cell) return options.cell;

  const attackCell =
    options.attackCell ??
    (options.baseid
      ? await postgres.em.findOne(WorldMapCell, { baseid: options.baseid })
      : null);

  return attackCell ? { x: attackCell.x, y: attackCell.y } : null;
};

/**
 * Flinger level of every outpost inside the sweep box.
 *
 * @param {NearbyOutpost[]} nearby - The outposts whose reach decides the attack.
 * @returns {Promise<Map<string, number | undefined>>} Flinger level per baseid.
 */
const outpostFlingers = async (
  nearby: readonly NearbyOutpost[]
): Promise<Map<string, number | undefined>> => {
  const outpostSaves = await postgres.em.find(
    Save,
    { baseid: { $in: nearby.map((outpost) => outpost.baseid) } },
    { fields: ["baseid", "flinger"] },
  );

  return new Map(outpostSaves.map(({ baseid, flinger }) => [baseid, flinger]));
};

/**
 * The error for a refusal, with the wording the client already gets today.
 *
 * @param {User} user - The attacker.
 * @param {RangeRefusal} reason - Why the attack was refused.
 * @returns {Error} The error to throw.
 */
const rangeError = (user: User, reason: RangeRefusal): Error => {
  switch (reason) {
    case "no-homebase":
      return new Error(`${user.username} has no homebase.`);

    case "no-attack-cell":
      return new Error("Attack cell not found.");

    case "no-outposts":
      return new Error("No outposts owned, and main base is out of range.");

    case "no-outposts-near-cell":
      return new Error("No outposts near attack cell.");

    case "out-of-range":
      return new Error("No outposts are within attack range.");
  }
};
