import { EnumYardType } from "../../enums/EnumYardType.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { calculateBaseLevel } from "./calculateBaseLevel.js";
import type { Save } from "../../database/models/save.model.js";

/**
 * Determines whether an attacker is allowed to attack a given base.
 * Returns false if any restriction applies, true otherwise.
 *
 * @param {Save} attackerSave - The attacker's save.
 * @param {Save} defenderSave - The defender's save.
 * @param {MapRoomVersion} [mapversion] - The map room version.
 * @returns {boolean} Whether the attack is permitted.
 */
export const canAttack = (attackerSave: Save, defenderSave: Save, mapversion?: MapRoomVersion): boolean => {
  const attackerLevel = calculateBaseLevel(attackerSave.points, attackerSave.basevalue);

  /**
   * Tribe resource outpost restriction: high-level players (32+) cannot attack
   * low-level (≤20) MR3 resource outposts.
   */
  if (
    mapversion === MapRoomVersion.V3 &&
    attackerLevel >= 32 &&
    defenderSave.wmid === EnumYardType.RESOURCE &&
    defenderSave.level <= 20
  ) return false;

  // The PvP level rule, with vengeance, is Map Room 1's alone (owner,
  // 11 Nov 2026): `services/maproom/v1/mr1AttackRules.ts`, applied with the
  // neighbour rule by the attack load and by `baseLoad`'s `canattack`.

  return true;
};
