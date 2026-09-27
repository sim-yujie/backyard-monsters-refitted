import { costOf } from "../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { pricingType, refundOf, type StorageCapSave } from "../base/economy/resourceBudget.js";
import { levelOf, TOWN_HALL_TYPE, type ResourceAmounts } from "../yardplanner/costs.js";
import { MAP_ROOM_TYPE } from "./buildingJobs.js";
import { academyLevels, isMapRoom3Monsters } from "./catchUpMonsters.js";
import { fitCredit } from "./credit.js";
import { cullHousing, housingCapacity } from "./housing.js";
import { runningUnlock, LOCKER_TYPE } from "./locker.js";
import { readHoused, readProduction } from "./production.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * `POST /bm/yard/recycle`: taking a finished building off the yard
 * (`docs/design/yard-buildings.md` §5.4).
 *
 * What comes back (`BFOUNDATION.RecycleB` / `RecycleCost` / `RecycleC`,
 * `client/scripts/BFOUNDATION.as:2549-2666`):
 *
 * - an ordinary building: half of every level's cost paid so far, floored per
 *   resource (`refundOf`), credited under the storage cap like every other
 *   credit (T3). The cap is the one the yard has without the building, so a
 *   Storage Silo's own refund can meet a smaller cap;
 * - a decoration: nothing, and one more of its type in storage,
 *   `researchdata["b<type>"]` (`InventoryManager.buildingStorageAdd`,
 *   `client/scripts/com/monsters/inventory/InventoryManager.as:13-21`); the
 *   two Wild Monster totems also keep their level in `"bl<type>"`;
 * - a taunt or gift sign: nothing (`Recycle` → `RecycleC`, `:2521-2524`).
 *   No building type in the Map Room 2 props table is `rewarded`
 *   (`client/scripts/YARD_PROPS.as:7156` is the only mention, `false`), so the
 *   original's "reward buildings refund nothing" branch (`:2636-2638`) has
 *   nothing to act on.
 *
 * Refused, each with its own `reason` (409), in this order:
 *
 * - `isTownHall`: the Town Hall;
 * - `mapRoom`: the Map Room, whose level is the map version (D16) — recycling
 *   it in the original left Map Room 2 (`client/scripts/BUILDING11.as:190-212`);
 * - `busy`: a build, upgrade or fortify running (a build is cancelled, not
 *   recycled: WP3.3's `build/cancel`);
 * - `championInCage`: a Champion Cage with a champion in it (`CHAMPIONCAGE.as:898-906`);
 * - `championsFrozen`: a Champion Chamber holding frozen champions (`CHAMPIONCHAMBER.as:92-101`);
 * - `researching`: a Monster Lab researching (`MONSTERLAB.as:248-257`);
 * - `training`: a Monster Academy training (`BUILDING26.as:92-101`);
 * - `hatcheryBusy`: a Hatchery with a monster in production or a queue, or a
 *   Hatchery Control Centre with a queue — the player takes the queue out
 *   first, which refunds it;
 * - `unlocking`: the Monster Locker while an unlock runs (the original cancelled
 *   the unlock as part of the recycle, `BUILDING8.as:104-119`; here the player
 *   cancels it first, which refunds it).
 *
 * Recycling a Monster Housing building shrinks housing; if the army no longer
 * fits, the overflow cull runs at once (`housing.ts`, `cullHousing`) and the
 * report lists it. The original refused such a recycle outright
 * (`BUILDING15.as:45-52`); the design shows the cull before the confirmation
 * instead.
 */

/** Types with a refusal of their own. */
const CHAMPION_CAGE_TYPE = 114;
const CHAMPION_CHAMBER_TYPE = 119;
const ACADEMY_TYPE = 26;
const LAB_TYPE = 116;
const HATCHERY_TYPE = 13;
const HOUSING_TYPE = 15;
const HCC_TYPE = 16;

/** The Wild Monster totems keep their level in storage (`BTOTEM.as:264-270`). */
const TOTEM_TYPES: ReadonlySet<number> = new Set([121, 131]);

/** Kinds that come off the yard for nothing (`BFOUNDATION.as:2521-2524`). */
const NOTHING_BACK_KINDS: ReadonlySet<string> = new Set(["taunt", "gift"]);

/** Champion statuses (`ChampionBase.as:26-36`). */
const CHAMPION_ACTIVE = 0;
const CHAMPION_FROZEN = 1;

/** The slice of a save recycling reads. */
export interface RecycleSave extends StorageCapSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
  monsters?: JsonObject | null;
  academy?: JsonObject | null;
  lockerdata?: JsonObject | null;
  champion?: unknown;
  researchdata?: JsonObject | null;
  mapversion?: number;
}

/** `report` of `POST /bm/yard/recycle`. */
export interface RecycleReport {
  id: number;
  t: number;
  /** What came back, after the storage cap. */
  refund: ResourceAmounts;
  /** What the storage cap turned away. */
  lost: ResourceAmounts;
  /** A decoration put in storage: its type and how many of it are stored now. */
  stored: { type: number; count: number } | null;
  /** Monsters removed because housing shrank, per type. */
  culled: Record<string, number>;
}

/** The champion roster as an array, whatever shape the column holds. */
const championsOf = (raw: unknown): JsonObject[] => {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value.filter((one) => one && typeof one === "object") as JsonObject[]) : [];
};

/** The Chamber's `fz`: its frozen champions, a JSON string in the original (`CHAMPIONCHAMBER.as:313-378`). */
const frozenIn = (building: BuildingData): number => championsOf(building.fz).length;

/** Whether a building's type is `kind` in the cost table. */
const kindOf = (type: number): string => costOf(pricingType(type))?.kind ?? "";

/** Throws the refusal for a building that may not be recycled now, if any. */
const refuse = (save: RecycleSave, building: BuildingData, id: number, now: number): void => {
  const type = Number(building.t);
  const refused = (reason: string, message: string) => yardRefusedErr(reason, message, { id });

  if (type === TOWN_HALL_TYPE) throw refused("isTownHall", "The Town Hall cannot be recycled.");
  if (type === MAP_ROOM_TYPE) {
    throw refused("mapRoom", "The Map Room cannot be recycled: its level is your map.");
  }
  if (Boolean(building.cB) || Boolean(building.cU) || Boolean(building.cF)) {
    throw refused("busy", "Finish or cancel this building's job first.");
  }

  const champions = championsOf(save.champion);
  if (
    type === CHAMPION_CAGE_TYPE &&
    champions.some((champion) => Number(champion.status ?? CHAMPION_ACTIVE) === CHAMPION_ACTIVE)
  ) {
    throw refused("championInCage", "Your champion lives in this cage. It cannot be recycled.");
  }
  if (
    type === CHAMPION_CHAMBER_TYPE &&
    (frozenIn(building) > 0 || champions.some((champion) => Number(champion.status) === CHAMPION_FROZEN))
  ) {
    throw refused("championsFrozen", "Thaw the champions in this chamber first.");
  }
  if (type === LAB_TYPE && (building.upg || Number(building.upt) > now)) {
    throw refused("researching", "The Lab is researching. Cancel the research first.");
  }
  if (type === ACADEMY_TYPE && (building.upg || academyTraining(save, now))) {
    throw refused("training", "The Academy is training. Cancel the training first.");
  }
  if (type === HATCHERY_TYPE || type === HCC_TYPE) {
    const production = readProduction(save.monsters, type === HATCHERY_TYPE ? [id] : [], {});
    const busy =
      type === HCC_TYPE
        ? production.hcc.length > 0
        : production.hatcheries.some((hatchery) => hatchery.monster !== "" || hatchery.queue.length > 0);
    if (busy) {
      throw refused(
        "hatcheryBusy",
        type === HCC_TYPE
          ? "Take the monsters out of the queue first."
          : "Take the monsters out of this hatchery first."
      );
    }
  }
  if (type === LOCKER_TYPE && runningUnlock(save.lockerdata)) {
    throw refused("unlocking", "Cancel the unlock first.");
  }
};

/**
 * Whether any monster is training, when this yard has a single academy: the
 * training entry does not say which academy holds it, and the academy's own
 * `upg` is only written by Phase 4.
 */
const academyTraining = (save: RecycleSave, now: number): boolean => {
  const academies = Object.values(save.buildingdata ?? {}).filter(
    (building) => Number(building?.t) === ACADEMY_TYPE
  );
  if (academies.length !== 1) return false;
  return Object.values(save.academy ?? {}).some(
    (entry) => Number((entry as JsonObject | null)?.time) > now
  );
};

/** The Housing Expansion running at `now` (`storedata.EXH`). */
const expansionAt = (save: RecycleSave, now: number): boolean =>
  Number((save.storedata?.EXH as JsonObject | undefined)?.e) > now;

/**
 * The cull that removing Housing building `key` would run: what housing is
 * left, and the army that fits it. Measured as the catch-up measures it
 * (every Housing still standing, health above 0).
 */
export const cullAfterRemoving = (
  save: RecycleSave,
  key: string,
  now: number
): { capacity: number; housed: Record<string, number>; culled: Record<string, number> } => {
  const { [key]: _gone, ...rest } = save.buildingdata ?? {};
  const capacity = housingCapacity(
    { buildingdata: rest, buildinghealthdata: save.buildinghealthdata },
    expansionAt(save, now),
    0
  );
  const { housed, culled } = cullHousing(readHoused(save.monsters), capacity, academyLevels(save.academy));
  return { capacity, housed, culled };
};

/**
 * Recycles one building.
 *
 * @param save - The caught-up main yard (read only).
 * @param id - The building.
 * @param now - The request's moment.
 * @throws 400 `badRequest` for an id not in the yard; the 409s listed above.
 */
export const planRecycle = (save: RecycleSave, id: number, now: number) => {
  const key = String(id);
  const building = save.buildingdata?.[key];
  if (!building) throw yardBadRequestErr("That building is not in your yard.", { id });
  refuse(save, building, id, now);

  const type = Number(building.t);
  const kind = kindOf(type);

  const { [key]: _gone, ...buildingdata } = save.buildingdata ?? {};
  const buildinghealthdata: BuildingHealthData = { ...(save.buildinghealthdata ?? {}) };
  delete buildinghealthdata[key];

  let stored: RecycleReport["stored"] = null;
  let researchdata: JsonObject | undefined;
  if (kind === "decoration") {
    const count = Math.max(0, Math.floor(Number(save.researchdata?.[`b${type}`]) || 0)) + 1;
    researchdata = { ...(save.researchdata ?? {}), [`b${type}`]: count };
    if (TOTEM_TYPES.has(type)) researchdata[`bl${type}`] = levelOf(building);
    stored = { type, count };
  }

  const owed = kind === "decoration" || NOTHING_BACK_KINDS.has(kind) ? undefined : refundOf(building);
  // The cap the credit meets is the one without this building (the wrapper
  // applies the slices first), so work the report out against that yard.
  const fit = fitCredit({ ...save, buildingdata }, owed ?? {});

  let monsters: JsonObject | undefined;
  let culled: Record<string, number> = {};
  if (type === HOUSING_TYPE && save.mapversion !== 3 && !isMapRoom3Monsters(save.monsters)) {
    const cull = cullAfterRemoving(save, key, now);
    culled = cull.culled;
    if (Object.keys(culled).length > 0) {
      monsters = { ...(save.monsters ?? {}), housed: cull.housed, space: cull.capacity };
    }
  }

  const report: RecycleReport = { id, t: type, refund: fit.credited, lost: fit.overflow, stored, culled };
  return {
    report,
    slices: {
      buildingdata,
      buildinghealthdata,
      ...(researchdata && { researchdata }),
      ...(monsters && { monsters }),
    },
    ...(owed && { credit: owed }),
  };
};
