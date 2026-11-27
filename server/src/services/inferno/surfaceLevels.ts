import { Save } from "../../database/models/save.model.js";
import { isInfernoMonster } from "../../game-data/monsterCatalogue.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { EntryHoused } from "../yard/attackRoster.js";
import { academyLevels } from "../base/combat/abandonedAttack.js";
import { postgres } from "../../server.js";

/**
 * The academy levels a surface army fights at (beta 10, owner, desk
 * b10-numbers, 27 Nov 2026): the main yard's Academy for its surface
 * monsters, and for an Inferno monster brought up through the Cavern
 * (`services/inferno/transfer.ts`) its Inferno Academy level. Before beta 10
 * the surface read only the main Academy, which never trains an Inferno
 * monster, so one always fought at level 1.
 *
 * Only the levels: Infernal Lab ranks stay on the Inferno yard, and the
 * defender's side is unchanged (a Spurtz Cannon's hatchlings read the
 * defender's main Academy, so they stay at level 1 on a main yard).
 *
 * @param main - The main yard's `academy`.
 * @param inferno - The Inferno yard's `academy`, or null when the player has none.
 */
export const withInfernoLevels = (
  main: JsonObject | null | undefined,
  inferno: JsonObject | null | undefined
): Record<string, number> => {
  const levels = academyLevels(main);
  for (const [id, level] of Object.entries(academyLevels(inferno))) {
    if (isInfernoMonster(id) && level >= 1) levels[id] = Math.floor(level);
  }
  return levels;
};

/** Whether any yard the attacker can fling from holds an Inferno monster; unknown counts as yes. */
const bringsInferno = (entryHoused: EntryHoused | undefined): boolean =>
  !entryHoused ||
  Object.values(entryHoused).some((housed) =>
    Object.entries(housed ?? {}).some(([id, count]) => isInfernoMonster(id) && Number(count) > 0)
  );

/**
 * {@link withInfernoLevels} for an attack start: reads the attacker's Inferno
 * yard only when the army can fling an Inferno monster, so an attack without
 * one costs no extra query.
 *
 * @param attacker - The attacker's main yard.
 * @param entryHoused - What the attacker's yards housed at the attack's start.
 */
export const surfaceArmyLevels = async (
  attacker: Pick<Save, "academy" | "baseid_inferno">,
  entryHoused: EntryHoused | undefined
): Promise<Record<string, number>> => {
  const infernoId = Number(attacker.baseid_inferno);
  if (!(infernoId > 0) || !bringsInferno(entryHoused)) return academyLevels(attacker.academy);
  const inferno = await postgres.em.findOne(Save, { baseid: String(infernoId) }, { fields: ["academy"] });
  return withInfernoLevels(attacker.academy, inferno?.academy);
};
