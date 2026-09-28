import { damagePercent } from "../../game-rules/combat/damagePercent.js";
import { toCombatYard, type BuildingHealthMap, type CombatTargetKind } from "../../game-rules/combat/types.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { BaseType } from "../../enums/Base.js";
import { storedDamage } from "../base/storedDamage.js";

/**
 * The last catch-up step: `save.damage` follows the repairs down.
 *
 * `damage` is the percentage an attack left (`storedDamage.ts`), and the map
 * shows it as it is until the owner repairs (the owner's rule, issue #182 B):
 * it no longer reads as 0 once damage protection ends. Nothing else lowered it
 * since owner saves were retired (#101), so this step works it out again from
 * the health the repairs have left, the way the client and the attack audit
 * do (`game-rules/combat/damagePercent.ts`), and keeps the lower of the two.
 * It never raises it: only an attack can, and the attack's own figure is the
 * one on record.
 *
 * Runs at the end of `catchUpYard`, after `catchUpRepairs`, and after every
 * yard action, so a repair that finished or was paid for shows on the map at
 * the next load or action. Pure apart from mutating the save.
 */

/** The slice of a save this step reads and writes. */
export interface CatchUpDamageSave {
  type?: string;
  damage?: number;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}

const kindOf = (type: string | undefined): CombatTargetKind =>
  type === BaseType.OUTPOST ? "outpost" : type === BaseType.TRIBE ? "wild" : "main";

/**
 * The yard's damage percentage from its buildings' health as it stands.
 *
 * @param save - The yard.
 * @returns The percentage, 0-100, not yet cut to a whole number.
 */
export const yardDamage = (save: CatchUpDamageSave): number => {
  const yard = toCombatYard({
    kind: kindOf(save.type),
    buildingdata: save.buildingdata as Parameters<typeof toCombatYard>[0]["buildingdata"],
    buildinghealthdata: save.buildinghealthdata as BuildingHealthMap | null | undefined,
  });

  // Every building below full, with the health `toCombatYard` resolved from
  // either map; an id it leaves out is whole.
  const health: Record<string, number> = {};
  for (const building of yard.buildings) {
    if (building.hp < building.maxHp) health[String(building.id)] = building.hp;
  }

  return damagePercent(yard, health);
};

/**
 * Lowers `save.damage` to what the yard's health now says, if that is lower.
 *
 * @param save - The yard, mutated in place.
 */
export const catchUpDamage = (save: CatchUpDamageSave): void => {
  const stored = Number(save.damage ?? 0);
  if (!(stored > 0)) return;

  const current = storedDamage(yardDamage(save));
  if (current !== null && current < stored) save.damage = current;
};
