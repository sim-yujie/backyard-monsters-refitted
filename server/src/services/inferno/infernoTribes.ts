import { UNDER_HALL_TYPE } from "../../game-data/buildingCosts.js";
import { molochTribes } from "../../game-data/tribes/inferno/molochTribes.js";
import { INFERNO_TRIBES } from "../../enums/Tribes.js";
import { InfernoTribeScale } from "../../enums/Tribes.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { baseValueOf } from "../base/economy/resourceBudget.js";
import { HOUSING_BUNKER_BUILDING_TYPE, HOUSING_BUNKER_CAPACITY } from "../monsters/transferRules.js";
import { levelOf } from "../yardplanner/costs.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { SaveData } from "../../types/EntityData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { TribeData } from "../../types/TribeData.js";
import { DECLARE_WAR_PAYLOAD } from "./descent.js";

/**
 * The Moloch tribes of the Inferno map (`docs/design/inferno.md` §2.7, WP
 * 2.7-2.8), pure: which seven a player faces, their levels, when a wrecked one
 * is back, what one fling may carry from the Inferno yard, and when an attack
 * on one is won. `infernoTribeMap.ts` reads and writes the rows; the attack
 * start and landing (`controllers/inferno/tribeAttack.ts`,
 * `infernoTribeLanding.ts`) fight by these.
 *
 * Every player fights their own copy of the 21 tribe yards
 * (`game-data/tribes/inferno/molochTribes.ts`, base ids 214-234), as with Map
 * Room 1's tribes: what an attack did to one is kept in the player's
 * `maproom_inferno.tribedata` until it respawns.
 */

/** The first and last Moloch tribe base ids (214-220, 221-227, 228-234). */
export const INFERNO_TRIBE_FIRST_BASEID = 214;
export const INFERNO_TRIBE_LAST_BASEID = 234;

/** A wrecked tribe is back an hour after it fell (the old server's `createInfernoTribes.ts`). */
export const INFERNO_TRIBE_RESPAWN_SECONDS = 60 * 60;

/** The seven tribes' levels next to the player's, in base id order. */
export const INFERNO_TRIBE_LEVEL_OFFSETS = [-2, -1, 0, 0, 0, 1, 3] as const;

/** Whether `baseid` names one of the 21 Moloch tribe yards. */
export const isInfernoTribeBaseid = (baseid: unknown): boolean => {
  const text = String(baseid ?? "");
  if (!/^\d+$/.test(text)) return false;
  const id = Number(text);
  return id >= INFERNO_TRIBE_FIRST_BASEID && id <= INFERNO_TRIBE_LAST_BASEID;
};

/** A tribe yard's data, or undefined for any other base id. */
export const infernoTribeYardOf = (baseid: string): SaveData | undefined =>
  isInfernoTribeBaseid(baseid) ? molochTribes.find((yard) => yard.baseid === baseid) : undefined;

/**
 * The Inferno yard's level, which picks the tribes: its own points and the
 * value of its buildings at the Inferno prices (`BASE.BaseLevel()` on the
 * Inferno yard, `BASE.as:4830-4861`, `:4867`; Flash keeps the higher of the
 * stored value and what the buildings are worth).
 */
export const infernoYardLevel = (yard: {
  points?: string | null;
  basevalue?: string | null;
  buildingdata?: BuildingDataMap | null;
}): number => {
  const stored = Number(yard.basevalue);
  const value = Math.max(Number.isFinite(stored) ? stored : 0, baseValueOf(yard.buildingdata, "inferno"));
  return calculateBaseLevel(yard.points ?? "0", String(value));
};

/** The tier's first base id for an Inferno yard level: up to 10, 214; up to 20, 221; then 228. */
export const infernoTribeFirstBaseid = (level: number): number => {
  if (level <= INFERNO_TRIBES[InfernoTribeScale.LOW].maxLevel) return INFERNO_TRIBES[InfernoTribeScale.LOW].minTribeId;
  if (level <= INFERNO_TRIBES[InfernoTribeScale.MID].maxLevel) return INFERNO_TRIBES[InfernoTribeScale.MID].minTribeId;
  return INFERNO_TRIBES[InfernoTribeScale.HIGH].minTribeId;
};

/** One of the seven tribes a player faces now. */
export interface InfernoTribeSlot {
  baseid: string;
  /** The level the map shows: the player's Inferno level with the slot's offset, at least 1. */
  level: number;
}

/** The seven tribes an Inferno yard of `level` faces, in base id order. */
export const currentInfernoTribes = (level: number): InfernoTribeSlot[] => {
  const first = infernoTribeFirstBaseid(level);
  const own = Math.max(1, level);
  return INFERNO_TRIBE_LEVEL_OFFSETS.map((offset, index) => ({
    baseid: String(first + index),
    level: Math.max(1, own + offset),
  }));
};

/** When a wrecked tribe is back, or 0 when it is standing. One with no time on it is back already. */
export const infernoTribeRespawnAt = (tribe: Pick<TribeData, "destroyed" | "destroyedAt"> | undefined): number => {
  if (!tribe?.destroyed) return 0;
  return (tribe.destroyedAt ?? 0) + INFERNO_TRIBE_RESPAWN_SECONDS;
};

/** Whether a wrecked tribe has come back by `now`. */
export const infernoTribeRespawned = (tribe: Pick<TribeData, "destroyed" | "destroyedAt">, now: number): boolean =>
  Boolean(tribe.destroyed) && now >= infernoTribeRespawnAt(tribe);

/** Stands a wrecked tribe back up: fresh health, nothing looted yet. */
export const respawnInfernoTribe = (tribe: TribeData): void => {
  tribe.destroyed = 0;
  tribe.destroyedAt = undefined;
  tribe.tribeHealthData = {};
  tribe.monsters = undefined;
  tribe.damage = undefined;
  tribe.looted = undefined;
};

/**
 * What one fling may carry from the Inferno yard (owner decision R11, §2.5
 * "Map"): what a Housing Bunker of the yard's best finished level holds
 * (200/300/520/780/1,140/1,820), a quarter more under Declare War
 * (`ATTACK.as:592-594`). Flash read the Flinger table at the Housing Bunker's
 * level (`GLOBAL.as:836-838`, `ATTACK.as:588`), whose level 4 is 640: R11
 * takes the bunker's own 780. Flash took the level of whichever finished
 * bunker loaded last (`HOUSING.AddHouse`); we take the best. 0 with no
 * finished bunker.
 */
export const infernoTribeFlingCapacity = (buildingdata: BuildingDataMap | null | undefined, declareWar: boolean): number => {
  let level = 0;
  for (const building of Object.values(buildingdata ?? {})) {
    if (Number(building?.t) !== HOUSING_BUNKER_BUILDING_TYPE) continue;
    level = Math.max(level, levelOf(building));
  }
  const base = level >= 1 ? HOUSING_BUNKER_CAPACITY[Math.min(level, HOUSING_BUNKER_CAPACITY.length) - 1]! : 0;
  return declareWar ? base + Math.floor(base * DECLARE_WAR_PAYLOAD) : base;
};

/**
 * Whether the tribe's Under Hall has fallen, which wins the attack: Flash's
 * wild-monster rule (`ATTACK.as:957-967`, any Town Hall, `BUILDING14`, at 0
 * health), with no damage threshold outside the Descent. Health missing from
 * `health` is a standing building.
 */
export const underHallFallen = (
  buildingdata: JsonObject | BuildingDataMap | null | undefined,
  health: Readonly<Record<string, unknown>> | null | undefined
): boolean => {
  for (const [key, row] of Object.entries(buildingdata ?? {})) {
    if (!row || typeof row !== "object" || Number((row as { t?: unknown }).t) !== UNDER_HALL_TYPE) continue;
    const id = String((row as { id?: unknown }).id ?? key);
    const left = health?.[id] ?? health?.[key];
    if (left !== undefined && Number(left) <= 0) return true;
  }
  return false;
};
