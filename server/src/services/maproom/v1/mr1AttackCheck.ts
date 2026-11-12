import { Maproom } from "../../../database/models/maproom.model.js";
import type { Save } from "../../../database/models/save.model.js";
import { AttackPermission } from "../../../enums/MapRoom.js";
import { mr1LevelGapErr, notMr1NeighbourErr } from "../../../errors/errors.js";
import { postgres } from "../../../server.js";
import { calculateBaseLevel } from "../../base/calculateBaseLevel.js";
import { MR1_ATTACK_LEVEL_GAP, mr1LevelPermission, vengeanceOwed } from "./mr1AttackRules.js";

type LevelSave = Pick<Save, "points" | "basevalue">;

/** Why a Map Room 1 attack on a player's main yard is refused, or what kind of attack it is. */
export type Mr1AttackVerdict =
  | { readonly ok: true; readonly permission: AttackPermission }
  | { readonly ok: false; readonly reason: "notNeighbour" | "levelGap" };

/**
 * The Map Room 1 rules (`mr1AttackRules.ts`) for one attack on a player's
 * main yard: the defender must be on the attacker's neighbour list, and not
 * more than the gap below them unless the attacker has vengeance on them.
 *
 * @param attackerId - The attacking player.
 * @param attackerSave - Their main save.
 * @param defenderId - The yard's owner.
 * @param defenderSave - The yard.
 * @param now - Unix seconds.
 */
export const mr1AttackVerdict = async (
  attackerId: number,
  attackerSave: LevelSave,
  defenderId: number,
  defenderSave: LevelSave,
  now: number
): Promise<Mr1AttackVerdict> => {
  const maproom = await postgres.em.findOne(Maproom, { userid: attackerId });
  const entry = maproom?.neighbors.find((neighbour) => neighbour.userid === defenderId);

  if (!entry) return { ok: false, reason: "notNeighbour" };

  const permission = mr1LevelPermission({
    attackerLevel: calculateBaseLevel(attackerSave.points, attackerSave.basevalue),
    defenderLevel: calculateBaseLevel(defenderSave.points, defenderSave.basevalue),
    vengeance: vengeanceOwed(entry, now),
  });

  if (permission === AttackPermission.LEVEL_RESTRICTION) return { ok: false, reason: "levelGap" };

  return { ok: true, permission };
};

/**
 * {@link mr1AttackVerdict} for the attack load: throws its refusal, and
 * otherwise says what kind of attack it is, for `registerAttacker` to move
 * the vengeance counters by.
 */
export const requireMr1Attack = async (...args: Parameters<typeof mr1AttackVerdict>): Promise<AttackPermission> => {
  const verdict = await mr1AttackVerdict(...args);

  if (verdict.ok) return verdict.permission;

  throw verdict.reason === "notNeighbour" ? notMr1NeighbourErr() : mr1LevelGapErr(MR1_ATTACK_LEVEL_GAP);
};
