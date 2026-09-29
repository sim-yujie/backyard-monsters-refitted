import type { Loaded } from "@mikro-orm/core";
import { Save } from "../../../database/models/save.model.js";
import { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../server.js";
import { logReport } from "../../base/reportManager.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { AlliancePowerupType } from "../../../enums/Alliance.js";
import { runningPowerups } from "../../alliance/powerups.js";
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
 * `mapversion` is the attacker's own Map Room (`playerMapVersion`), never the
 * request's: Map Rooms 1 and 3 check nothing here (issue #165).
 *
 * @param {User} user - The user object containing the save data
 * @param {MapRoomVersion} mapversion - The attacker's Map Room
 * @param {RangeOptions} options - The options object
 * @returns {Promise<void>} - Resolves when the attack is in range
 */
export const validateRange = async (
  user: User,
  mapversion: MapRoomVersion | undefined,
  options: RangeOptions): Promise<void> => {
  if (!mapversion) throw new Error("Map version is required for range validation.");

  switch (mapversion) {
    case MapRoomVersion.V1:
      return;

    case MapRoomVersion.V2:
      return validateRangeV2(user, options);

    case MapRoomVersion.V3:
      return validateRangeV3();

    default:
      throw new Error(`validateRange: unhandled map version ${mapversion}`);
  }
};

/**
 * MR3 range validation.
 * Range is checked client-side before the attack request is sent.
 * TODO: Implement server-side validation for MR3 cost ranges. Right now nothing is checked.
 */
const validateRangeV3 = (): void => {};

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
 * @param {RangeOptions} options - The options object
 *
 * @throws {Error} - attack invalidation error
 * @returns {Promise<void>} - Resolves when the attack is in range
 */
const validateRangeV2 = async (user: User, options: RangeOptions): Promise<void> => {
  const { cell, verdict } = await rangeCheckV2(user, options);

  if (verdict.ok) return;

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
 * The Map Room 2 range rule's answer without the throw: whether the user's
 * main yard or one of their outposts reaches the cell. `validateRange` turns a
 * refusal into an error; the takeover quote (`takeoverQuote.ts`) reports it
 * as a reason instead.
 *
 * @param {User} user - The user, with their main save populated.
 * @param {RangeOptions} options - What the caller knows about the target.
 * @returns {Promise<{ cell: CellCoords | null; verdict: RangeVerdict }>} The cell and the verdict.
 */
export const rangeCheckV2 = async (
  user: User,
  options: RangeOptions
): Promise<{ cell: CellCoords | null; verdict: RangeVerdict }> => {
  const { homebase, outposts, flinger } = user.save!;

  const cell = await resolveAttackCell(options);

  const declareWar = await declareWarRunning(user.alliance_id);

  const plan = planRangeCheck({ homebase, flinger, cell, outposts, declareWar });

  const verdict =
    "pending" in plan
      ? checkOutpostRange(plan.pending, await outpostFlingers(plan.pending), declareWar)
      : plan;

  return { cell, verdict };
};

/**
 * Whether the user's alliance has Declare War running, the only time its two
 * extra cells of reach count (issue #190, as in Flash: `POWERUPS.as:140-160`).
 *
 * @param {User["alliance_id"]} allianceId - The user's alliance, if any.
 * @returns {Promise<boolean>} True while Declare War runs.
 */
const declareWarRunning = async (allianceId: User["alliance_id"]): Promise<boolean> =>
  (await runningPowerups(allianceId)).some(({ id }) => id === AlliancePowerupType.DECLARE_WAR);

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
