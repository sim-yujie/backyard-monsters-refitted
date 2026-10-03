import type { AcademyData, BaseLoadResponse } from "@/api/types";
import { capacity } from "@/game/combat/rules";
import { compareListOrder, housingSpace, monsterEntry, type MonsterEntry } from "./monsterCatalogue";

/**
 * Monster Housing on the client: the Housing tab's roster and building list
 * and the Monsters screen header's used/total (`docs/design/yard-buildings.md`
 * §4.1, §4.5).
 *
 * The same arithmetic the server uses (`deriveHousingCapacity` and
 * `housingUsed`, `server/src/services/monsters/transferRules.ts`, which
 * `server/src/services/yard/housing.ts` wraps): every finished Housing
 * building at its level's Map Room 2 room, none at 10 health or below, 1.25x
 * while Housing Expansion (`EXH`) runs; each housed monster at its academy
 * level's space. A building part-way through an upgrade houses at its old
 * level, because `l` only moves when the upgrade finishes. The server has no
 * separate "under repair" rule: a damaged building counts by its health alone.
 */

/** Housing type id (`client/scripts/YARD_PROPS.as:1553`). */
export const HOUSING_TYPE = 15;

/** A Housing building at or below this health houses nothing (`client/scripts/HOUSING.as:66-67`). */
export const HOUSING_MIN_HEALTH = 10;

/**
 * Housing Expansion: 375 Shiny for 1.25x housing over 24 hours
 * (`server/src/game-data/store/storeItems.ts` `EXH`, `client/scripts/STORE.as:2423-2431`).
 * The shop refuses it while one runs (`409 alreadyActive`).
 */
export const HOUSING_EXPANSION = {
  item: "EXH",
  price: 375,
  seconds: 86_400,
  multiplier: 1.25,
} as const;

/** The `hstage` value of a hatchery whose monster is done and waits for room (`production.ts`). */
const STAGE_WAITING = 2;

export interface HousingSummary {
  readonly used: number;
  readonly total: number;
}

/** Why a Housing building houses nothing, or null when it counts. */
export type HousingZeroReason = "building" | "damaged";

/** One Housing building as the tab lists it. */
export interface HousingBuildingRow {
  readonly id: number;
  /** The level it houses at: the old one while an upgrade runs. */
  readonly level: number;
  /** What it houses now, EXH included; 0 when {@link zero} says why. */
  readonly capacity: number;
  readonly zero: HousingZeroReason | null;
  /** True while an upgrade runs: it still houses at {@link level}. */
  readonly upgrading: boolean;
}

/** One monster type in the housed army. */
export interface HousedRow {
  readonly monster: MonsterEntry;
  readonly count: number;
  /** Space one takes at its academy level. */
  readonly each: number;
  readonly total: number;
}

/** The academy level a monster hatches and houses at; absent means 1. */
export const academyLevel = (academy: AcademyData | null | undefined, id: string): number => {
  const level = Number(academy?.[id]?.level);
  return Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
};

/** How many of one monster are housed: 0 for none or a count that is not a number. */
export const housedCount = (save: Pick<BaseLoadResponse, "monsters">, id: string): number => {
  const count = Math.floor(Number(save.monsters?.housed?.[id] ?? 0));
  return Number.isFinite(count) && count > 0 ? count : 0;
};

/** When the running Housing Expansion ends (unix seconds), or null when none runs. */
export const expansionEndsAt = (save: BaseLoadResponse, now: number): number | null => {
  const ends = Number(save.storedata?.[HOUSING_EXPANSION.item]?.e);
  return Number.isFinite(ends) && ends > now ? ends : null;
};

/** Every Housing building in the yard, by id, with what each houses and why not. */
export const housingBuildings = (save: BaseLoadResponse, now: number): HousingBuildingRow[] => {
  const expanded = expansionEndsAt(save, now) !== null;
  const rows: HousingBuildingRow[] = [];
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    if (!building || Number(building.t) !== HOUSING_TYPE) continue;
    const id = Number(building.id ?? key);
    const level = Math.max(1, Math.floor(Number(building.l ?? 1)) || 1);
    const health = save.buildinghealthdata?.[String(building.id ?? key)] ?? building.hp;
    const zero: HousingZeroReason | null =
      Number(building.cB ?? 0) > 0
        ? "building"
        : health !== undefined && Number(health) <= HOUSING_MIN_HEALTH
          ? "damaged"
          : null;
    const room = capacity(HOUSING_TYPE, level);
    rows.push({
      id,
      level,
      capacity: zero ? 0 : expanded ? Math.trunc(room * HOUSING_EXPANSION.multiplier) : room,
      zero,
      upgrading: zero === null && Number(building.cU ?? 0) > 0,
    });
  }
  return rows.sort((a, b) => a.id - b.id);
};

/** Housing capacity from the yard's own Housing buildings. */
export const housingCapacity = (save: BaseLoadResponse, now: number): number =>
  housingBuildings(save, now).reduce((total, row) => total + row.capacity, 0);

/** The housed army, one row per type in the hatchery and housing list order. */
export const housedRows = (save: BaseLoadResponse): HousedRow[] => {
  const rows: HousedRow[] = [];
  for (const [id, raw] of Object.entries(save.monsters?.housed ?? {})) {
    const count = Number(raw);
    const monster = monsterEntry(id);
    if (!monster || !Number.isFinite(count) || count <= 0) continue;
    const each = housingSpace(id, academyLevel(save.academy, id)) ?? 0;
    rows.push({ monster, count, each, total: each * count });
  }
  return rows.sort((a, b) => compareListOrder(a.monster, b.monster));
};

/** Space the housed army takes. */
export const housingUsed = (save: BaseLoadResponse): number =>
  housedRows(save).reduce((used, row) => used + row.total, 0);

export const housingSummary = (save: BaseLoadResponse, now: number): HousingSummary => ({
  used: housingUsed(save),
  total: housingCapacity(save, now),
});

/**
 * How many hatcheries have a finished monster waiting for room: `hstage` 2
 * with a monster in its `h` entry (`server/src/services/yard/production.ts`,
 * `readProduction`).
 */
export const stalledHatcheries = (save: BaseLoadResponse): number => {
  const stages = save.monsters?.hstage ?? [];
  const entries = save.monsters?.h ?? [];
  let stalled = 0;
  stages.forEach((stage, i) => {
    const monster = entries[i]?.[0];
    if (Number(stage) === STAGE_WAITING && typeof monster === "string" && monster !== "") stalled++;
  });
  return stalled;
};
