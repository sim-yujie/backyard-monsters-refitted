import type { AcademyData, BaseLoadResponse } from "@/api/types";
import { capacity } from "@/game/combat/rules";
import { housingSpace } from "./monsterCatalogue";

/**
 * Housing used and total, for the Monsters screen's header
 * (`docs/design/yard-buildings.md` §4.1).
 *
 * The same arithmetic the server uses for transfers and catch-up
 * (`deriveHousingCapacity` and `housingUsed`,
 * `server/src/services/monsters/transferRules.ts`): every finished Housing
 * building at its level's Map Room 2 room, none at 10 health or below, 1.25x
 * while Housing Expansion (`EXH`) runs; each housed monster at its academy
 * level's space. The Housing tab (WP2.7) owns the per-building breakdown.
 */

/** Housing type id (`client/scripts/YARD_PROPS.as:1553`). */
export const HOUSING_TYPE = 15;

/** A Housing building at or below this health houses nothing (`client/scripts/HOUSING.as:66-67`). */
const MIN_HEALTH = 10;

/** `EXH`: 1.25x housing for a day (`client/scripts/STORE.as:2423-2431`). */
const EXPANSION_MULTIPLIER = 1.25;

export interface HousingSummary {
  readonly used: number;
  readonly total: number;
}

/** The academy level a monster hatches and houses at; absent means 1. */
export const academyLevel = (academy: AcademyData | null | undefined, id: string): number => {
  const level = Number(academy?.[id]?.level);
  return Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
};

/** Housing capacity from the yard's own Housing buildings. */
export const housingCapacity = (save: BaseLoadResponse, now: number): number => {
  const expansion = Number(save.storedata?.["EXH"]?.e);
  const expanded = Number.isFinite(expansion) && expansion > now;
  let total = 0;
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    if (!building || Number(building.t) !== HOUSING_TYPE) continue;
    if (Number(building.cB ?? 0) > 0) continue;
    const health = save.buildinghealthdata?.[String(building.id ?? key)] ?? building.hp;
    if (health !== undefined && Number(health) <= MIN_HEALTH) continue;
    // `l` moves only when an upgrade finishes: mid-upgrade it houses at the old level.
    const room = capacity(HOUSING_TYPE, Math.max(1, Math.floor(Number(building.l ?? 1)) || 1));
    total += expanded ? Math.trunc(room * EXPANSION_MULTIPLIER) : room;
  }
  return total;
};

/** Space the housed army takes. */
export const housingUsed = (save: BaseLoadResponse): number => {
  let used = 0;
  for (const [id, raw] of Object.entries(save.monsters?.housed ?? {})) {
    const count = Number(raw);
    if (!Number.isFinite(count) || count <= 0) continue;
    used += (housingSpace(id, academyLevel(save.academy, id)) ?? 0) * count;
  }
  return used;
};

export const housingSummary = (save: BaseLoadResponse, now: number): HousingSummary => ({
  used: housingUsed(save),
  total: housingCapacity(save, now),
});
