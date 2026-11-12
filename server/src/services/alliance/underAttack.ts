import { AllianceMessageType } from "../../enums/Alliance.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import type { User } from "../../database/models/user.model.js";
import type { ShoutDraft } from "./allianceMessages.js";
import { underAttackBody } from "./shoutText.js";

/** What an attack start knows that the alert needs. */
export interface UnderAttackInput {
  /** The yard's owner: the line goes to their alliance, in their name. */
  defender: User;
  attacker: Pick<User, "userid" | "username">;
  /** The attacked base's type: only a main yard or an outpost raises the alert. */
  baseType: BaseType | string;
  mapversion?: MapRoomVersion;
  /** The attacked yard's Map Room 2 cell, for Show on map. */
  cell: { x: number; y: number } | null | undefined;
}

/**
 * The under-attack line an attack start raises (beta 7 design v5 §12), or
 * null when it raises none: "Ana_B's outpost (12, 40) is under attack by
 * Bob!" in the defender's Alliance chat room, one line per yard per attack.
 *
 * Only Map Room 2 (alliances live there), only a player's main yard or
 * outpost, only when the owner is in an alliance, never a player's own yard,
 * and only with the cell known (the line's Show on map needs it).
 *
 * @param {UnderAttackInput} input - The attack being started.
 * @returns {ShoutDraft | null} The line to raise, or null.
 */
export const underAttackShout = ({ defender, attacker, baseType, mapversion, cell }: UnderAttackInput): ShoutDraft | null => {
  if (mapversion === MapRoomVersion.V1) return null;

  if (baseType !== BaseType.MAIN && baseType !== BaseType.OUTPOST) return null;

  if (!defender.alliance_id || defender.userid === attacker.userid || !cell) return null;

  return {
    allianceId: defender.alliance_id,
    author: defender,
    type: AllianceMessageType.UNDER_ATTACK,
    body: underAttackBody({ x: cell.x, y: cell.y, outpost: baseType === BaseType.OUTPOST, by: attacker.username }),
  };
};
