import type { Loaded } from "@mikro-orm/core";
import type { Save } from "../../database/models/save.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { attackEndsAt } from "./attackWindow.js";

type AttackState = Loaded<Save, never, "attackid" | "attacks">;

/**
 * Determines whether a save is currently under an active attack.
 *
 * An attack is considered active if attackid is non-zero and the last attack
 * is still inside its window (`attackWindow.ts`): its countdown, the retreat
 * grace and a spare minute from its start. A non-zero attackid past that is
 * treated as stale — typically left over from an attacker who disconnected
 * mid-attack.
 *
 * @param {AttackState} save - The save to check
 * @returns {boolean} True if the save is currently under an active attack
 */
export const isAttackActive = (save: AttackState) => {
  if (save.attackid === 0) return false;

  const lastAttack = save.attacks.at(-1);

  if (!lastAttack) return false;

  return getCurrentDateTime() < attackEndsAt(lastAttack);
};
