import { BaseType } from "../../../enums/Base.js";
import { MapRoomCell } from "../../../enums/MapRoom.js";
import { isWildMonsterExpired } from "../wildMonsterExpiry.js";

/**
 * Who may take over a Map Room 2 cell (`POST /worldmapv2/takeoverCell`, issue #182).
 *
 * Flash decides this in the client, on the enemy info popup, and posts only the
 * outcome. The one test it runs, both to label the button and again on click
 * (`PopupInfoEnemy.as:160`, `:495`), is
 *
 *   _base != 2 && _destroyed && !_protected
 *     && (_locked == 0 || _locked == LOGIN._playerID) && MapRoom._flingerInRange
 *
 * and the taker must be under the outpost cap (`PopupInfoEnemy.as:485-487`,
 * `:498-501`, `GLOBAL.as:440`). The popup only opens on a cell that is not the
 * player's own (`MapRoomCell.as:1006-1012`). Each flag is what the map told the
 * client: `d`, `p` and `lo` from `userCell.ts` for an outpost, and `d` from
 * `wildMonsterCell.ts` for a camp, which reports a camp past its 12-hour
 * regeneration as untouched. These rules read the same rows the same way, so
 * the server refuses what the map would not have offered. Range is
 * `validateRange`, and the price `takeoverCost.ts`.
 *
 * A player outpost goes further than Flash, by the owner's rule (Q1,
 * `takeoverGrant.ts`): it can be taken only by the attacker who just destroyed
 * it, once, while that attacker's grant runs. The grant's own protection does
 * not stand in its holder's way; everyone else meets it as protection. Wild
 * camps keep Flash's rule: anyone in range, until the camp regenerates.
 */

/** A yard is destroyed, and so up for takeover, at this damage (`userCell.ts` `d`). */
export const TAKEOVER_DAMAGE = 90;

/** `GLOBAL.k_MAX_NUMBER_OF_OUTPOSTS` (`GLOBAL.as:440`). */
export const MAX_OUTPOSTS = 3500;

/** Why a takeover was refused. */
export type TakeoverRefusal =
  | "notFound"
  | "mainYard"
  | "ownYard"
  | "noTakeoverChance"
  | "notDestroyed"
  | "regenerated"
  | "protected"
  | "locked"
  | "underAttack"
  | "maxOutposts"
  | "notEnoughShiny"
  | "notEnoughResources";

export interface TakeoverTargetInput {
  /** The taker's userid. */
  takerId: number;
  /** How many outposts the taker holds now. */
  outpostCount: number;
  /** Server seconds. */
  now: number;
  cell: { uid: number; base_type: number };
  save: {
    userid: number;
    saveuserid: number;
    type: string;
    damage: number;
    protected: number;
    locked: number;
    wmid?: number | null;
    savetime?: number | null;
  };
  /** Whether an attack on the target is running right now, by anyone. */
  underAttack: boolean;
  /** Whether the taker holds a live takeover grant on this outpost (`takeoverGrant.ts`). */
  holdsGrant: boolean;
}

/**
 * Whether the taker may take the cell over, before range and price.
 *
 * An attack running on the target refuses the takeover even when it is the
 * taker's own: Flash only offers the button once its attack has ended and been
 * saved (`popup_attackend.as:82-98`), and taking the row over mid-attack would
 * leave that attack's save landing on a yard its sender now owns.
 *
 * @param {TakeoverTargetInput} input - The taker and the target.
 * @returns {TakeoverRefusal | null} Why not, or null when it may.
 */
export const takeoverRefusal = ({
  takerId,
  outpostCount,
  now,
  cell,
  save,
  underAttack,
  holdsGrant,
}: TakeoverTargetInput): TakeoverRefusal | null => {
  if (cell.base_type === MapRoomCell.HOMECELL || save.type === BaseType.MAIN) return "mainYard";

  if (cell.uid === takerId || save.userid === takerId || save.saveuserid === takerId) return "ownYard";

  const playerOutpost = cell.base_type === MapRoomCell.OUTPOST || save.type === BaseType.OUTPOST;

  if (playerOutpost) {
    if (!holdsGrant) return "noTakeoverChance";
  } else {
    if (isWildMonsterExpired(save, now)) return "regenerated";

    if (save.protected > now) return "protected";
  }

  if (!(save.damage >= TAKEOVER_DAMAGE)) return "notDestroyed";

  if (save.locked && save.locked !== takerId) return "locked";

  if (underAttack) return "underAttack";

  if (outpostCount >= MAX_OUTPOSTS) return "maxOutposts";

  return null;
};
