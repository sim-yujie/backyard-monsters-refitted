import { REPAIR_CAP_SECONDS, repairTimeOf } from "../../game-data/repairTimes.js";
import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { levelOf, yardKindOf } from "../yardplanner/costs.js";
import { harvesterHealth } from "./catchUpHarvesters.js";
import { repairAllPrice } from "./shiny.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * Repairing buildings: `POST /bm/yard/repair` and `POST /bm/yard/repair/instant`
 * (`docs/design/yard-buildings.md` §5.5), and the arithmetic the catch-up heals
 * by (`catchUpRepairs.ts`).
 *
 * Damage lives in two places, kept in step: `buildinghealthdata[id]` and the
 * building's own `hp`, both written only below full health
 * (`client/scripts/BFOUNDATION.as:3023-3025`, `client/scripts/BASE.as:3169`);
 * `rE: 1` marks a building being repaired (`BFOUNDATION.as:2956-2958`).
 *
 * - **Repair** is free, holds no worker, and is opt-in: it sets `rE` on each
 *   damaged building (`BFOUNDATION.Repair`, `:2017-2022`). From then on the
 *   building heals `ceil(max / min(3600, repairTime))` health a second
 *   (`:1367-1370`), so no repair takes longer than an hour; the catch-up does
 *   the healing. While it heals, its build or upgrade countdown stays paused
 *   (`:1364-1394`; `services/base/advanceBuildingTimers.ts`).
 * - **Repair all** is the post-attack popup's button: every damaged building
 *   not already repairing (`client/scripts/BASE.as:2064-2081`).
 * - **Repair now** (`FIX`) heals every damaged building at once for
 *   `timeCost(sum of repair times over 300 s) + 10 × how many` Shiny
 *   (`client/scripts/STORE.as:381-395`, `:2149-2161`). The original's
 *   "Repair Now" first started a repair on everything damaged and then priced
 *   `FIX` over everything repairing (`BASE.as:2082-2096`), so the price here
 *   covers every damaged building, repairing or not. A repair of five minutes
 *   or less is neither charged nor counted, so the price can be 0.
 *
 * Everything here is pure: it reads the caught-up save and returns the new
 * slices, or throws the refusal.
 */

/** The slice of a save repairs read and write. */
export interface RepairSave {
  /** `BaseType`: an outpost's buildings heal to the outpost table's health. */
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}

/** One damaged building, read once. */
export interface Damage {
  /** Key in `buildingdata`. */
  key: string;
  id: number;
  type: number;
  /** Current health, below `max`. */
  health: number;
  max: number;
  /** Health healed per second while repairing. */
  rate: number;
  /** Whether `rE` is set. */
  repairing: boolean;
}

/**
 * Health a repairing building heals per second:
 * `ceil(max / min(3600, repairTime[lvl − 1]))` (`BFOUNDATION.as:1367-1370`).
 * A building still under construction reads `repairTime[0]`, as the original's
 * level 0 does.
 */
export const repairRate = (type: number, level: number, max: number): number =>
  Math.max(1, Math.ceil(max / Math.max(1, Math.min(REPAIR_CAP_SECONDS, repairTimeOf(type, level)))));

/**
 * Seconds a repair has left, as the original counted them for the `FIX` price
 * and the worker queue: `int((max − health) / rate)` (`BFOUNDATION.as:2858-2861`).
 */
export const repairSecondsLeft = (damage: Pick<Damage, "health" | "max" | "rate">): number =>
  Math.trunc(Math.max(0, damage.max - damage.health) / damage.rate);

/**
 * A building's damage, or null at full health.
 *
 * Health is `buildinghealthdata[id]` first, then `hp` (the reading the
 * harvesters and the planner walk take). A type with no health ladder cannot
 * be damaged. Full health is the combat engine's for the yard's kind, so an
 * outpost heals to the outpost ladder its attacks were fought on.
 */
export const damageOf = (save: RepairSave, key: string, building: BuildingData): Damage | null => {
  const health = harvesterHealth(save, key, building);
  if (health === undefined) return null;
  const type = Number(building.t);
  const level = levelOf(building);
  const max = maxHp(type, level, yardKindOf(save));
  if (!(max > 0) || health >= max) return null;
  return {
    key,
    id: Number(building.id ?? key),
    type,
    health: Math.max(0, Math.floor(health)),
    max,
    rate: repairRate(type, level, max),
    repairing: Boolean(building.rE),
  };
};

/** Every damaged building in the yard, in id order. */
export const damagedBuildings = (save: RepairSave): Damage[] =>
  Object.entries(save.buildingdata ?? {})
    .flatMap(([key, building]) => {
      const damage = building ? damageOf(save, key, building) : null;
      return damage ? [damage] : [];
    })
    .sort((a, b) => a.id - b.id);

/** A building written back at full health: no `hp`, no `rE`. */
export const healed = (building: BuildingData): BuildingData => {
  const { hp: _hp, rE: _repairing, ...rest } = building;
  return rest;
};

/** What the route was asked to repair. */
export type RepairRequest = { all: true } | { ids: readonly number[] };

/** Why a named building was not started. */
export type RepairSkip = "notDamaged" | "repairing";

/** `report` of `POST /bm/yard/repair`. */
export interface RepairReport {
  /** Buildings that started repairing, in id order. */
  started: number[];
  /** Named buildings that were not started, and why. `all` never lists any. */
  skipped: { id: number; reason: RepairSkip }[];
  /** Unix seconds by which every repair now running is done. */
  doneBy: number;
}

/** `report` of `POST /bm/yard/repair/instant`. */
export interface RepairInstantReport {
  /** Buildings brought to full health, in id order. */
  repaired: number[];
  /** Shiny charged. */
  credits: number;
}

/** `409 notDamaged`: nothing to repair. */
const notDamagedErr = (detail: object = {}) =>
  yardRefusedErr("notDamaged", "Nothing needs repairing.", detail);

/**
 * Starts repairs: sets `rE` on each chosen damaged building. Batch by design:
 * `all` takes every damaged building not already repairing; `ids` takes each
 * named one that is damaged and not repairing and lists the rest in `skipped`
 * (§2.1). Refused `409 notDamaged` when nothing at all was started.
 *
 * @param save - The caught-up main yard (read only).
 * @param request - `{ all: true }` or `{ ids }`.
 * @param now - The request's moment; repairs heal from here.
 * @throws 400 `badRequest` for an id that is not a building in the yard.
 */
export const planRepair = (save: RepairSave, request: RepairRequest, now: number) => {
  const damaged = new Map(damagedBuildings(save).map((damage) => [damage.id, damage]));

  const chosen: Damage[] = [];
  const skipped: RepairReport["skipped"] = [];
  if ("all" in request) {
    for (const damage of damaged.values()) if (!damage.repairing) chosen.push(damage);
  } else {
    for (const id of new Set(request.ids)) {
      if (!save.buildingdata?.[String(id)]) {
        throw yardBadRequestErr("That building is not in your yard.", { id });
      }
      const damage = damaged.get(id);
      if (!damage) skipped.push({ id, reason: "notDamaged" });
      else if (damage.repairing) skipped.push({ id, reason: "repairing" });
      else chosen.push(damage);
    }
    chosen.sort((a, b) => a.id - b.id);
  }

  if (chosen.length === 0) throw notDamagedErr({ skipped });

  const buildingdata: BuildingDataMap = { ...(save.buildingdata ?? {}) };
  for (const damage of chosen) buildingdata[damage.key] = { ...buildingdata[damage.key]!, rE: 1 };

  const running = [...damaged.values()].filter(
    (damage) => damage.repairing || chosen.includes(damage)
  );
  const doneBy =
    now + Math.max(0, ...running.map((damage) => Math.ceil((damage.max - damage.health) / damage.rate)));

  const report: RepairReport = { started: chosen.map((damage) => damage.id), skipped, doneBy };
  return { report, slices: { buildingdata } };
};

/**
 * Repair now (`FIX`): every damaged building to full health at once, for
 * {@link repairAllPrice} over every damaged building's repair time left.
 *
 * @throws 409 `notDamaged` when nothing is damaged (`STORE.as:1094-1098`).
 */
export const planRepairInstant = (save: RepairSave) => {
  const damaged = damagedBuildings(save);
  if (damaged.length === 0) throw notDamagedErr();

  const credits = repairAllPrice(damaged.map(repairSecondsLeft));

  const buildingdata: BuildingDataMap = { ...(save.buildingdata ?? {}) };
  const buildinghealthdata: BuildingHealthData = { ...(save.buildinghealthdata ?? {}) };
  for (const damage of damaged) {
    buildingdata[damage.key] = healed(buildingdata[damage.key]!);
    delete buildinghealthdata[String(damage.id)];
  }

  const report: RepairInstantReport = { repaired: damaged.map((damage) => damage.id), credits };
  return { report, slices: { buildingdata, buildinghealthdata }, shiny: credits };
};
