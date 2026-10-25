import { siloCapacity } from "../../game-data/buildingCosts.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { BASE_STORAGE, SILO_TYPE, packingMultiplier } from "../base/economy/resourceBudget.js";
import { levelOf } from "../yardplanner/costs.js";
import { catchUpHarvesters, type CatchUpHarvestersSave } from "../yard/catchUpHarvesters.js";

/**
 * The Inferno yard's load (`POST /bm/inferno/load`, `docs/design/inferno.md`
 * §3.1-3.2, WP 1.14): the harvester catch-up and the purse the yard shows.
 *
 * The Inferno's Bone Cruncher, Coal Extractor, Sulfur Swirler and Magma Pump
 * are the original's harvesters (`client/scripts/BRESOURCE.as`, with the
 * Inferno table's figures, `INFERNOYARDPROPS.as`): each fills its own buffer
 * while the player is away and stops when full; nothing reaches the purse
 * until the player banks it (yard actions, WP 1.16). The purse is the main
 * save's `iresources` (Bone, Coal, Sulfur, Magma), which the Descent loot and
 * the banking fill; the yard's own `resources` stays empty.
 *
 * Pure: no database, no clock.
 */

/** The slice of the Inferno yard the catch-up reads and writes. */
export interface InfernoCatchUpSave extends CatchUpHarvestersSave {
  savetime?: number | null;
  createtime?: number | null;
}

/**
 * Catches the Inferno yard up to `now`: every harvester's buffer grows at
 * the Inferno rates from the last catch-up (`savetime`, else the moment the
 * yard was made), and `savetime` moves to `now`. A yard with neither starts
 * its clock now. Idempotent at the same `now`.
 *
 * Only the harvesters for now: the Inferno's build, upgrade and repair
 * countdowns come with its yard actions (WP 1.15-1.16), and until then none
 * is ever started, so a harvester never waits on one.
 */
export const catchUpInfernoYard = (save: InfernoCatchUpSave, now: number): void => {
  const stored = Number(save.savetime) || Number(save.createtime);
  const from = Number.isFinite(stored) && stored > 0 ? Math.min(stored, now) : now;
  catchUpHarvesters(save, from, now, [], "inferno");
  save.savetime = now;
};

/**
 * The Inferno purse's cap, one figure for all four resources
 * (`client/scripts/BASE.as:4705-4828`, `isMainYardOrInfernoMainYard`): 10,000,
 * plus each finished Resource Pod's capacity from the Inferno table, times the
 * player's Improved Packing Skills (bought on the main yard, so read off its
 * `storedata`). Outposts add nothing to it.
 *
 * @param yard - The Inferno yard, whose Resource Pods count.
 * @param mainStoredata - The main yard's `storedata`.
 */
export const infernoStorageCap = (
  yard: { buildingdata?: BuildingDataMap | null },
  mainStoredata: JsonObject | null | undefined
): number => {
  let capacity = BASE_STORAGE;
  for (const building of Object.values(yard.buildingdata ?? {})) {
    if (Number(building?.t) !== SILO_TYPE) continue;
    const level = levelOf(building);
    if (level > 0) capacity += siloCapacity(level, "inferno");
  }
  return Math.floor(capacity * packingMultiplier(mainStoredata));
};

/** The purse as the Inferno yard shows it: `r1`..`r4` and their caps. */
export interface InfernoPurse {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  r1max: number;
  r2max: number;
  r3max: number;
  r4max: number;
}

/** A purse amount, whole and never negative; anything else reads as 0. */
const amount = (raw: unknown): number => {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/**
 * The purse (the main save's `iresources`) with the Inferno cap. The amounts
 * are answered as they are, above the cap too: the Descent's loot goes in
 * uncapped, and the cap only stops what banking adds (WP 1.16).
 */
export const infernoPurse = (iresources: JsonObject | null | undefined, cap: number): InfernoPurse => ({
  r1: amount(iresources?.r1),
  r2: amount(iresources?.r2),
  r3: amount(iresources?.r3),
  r4: amount(iresources?.r4),
  r1max: cap,
  r2max: cap,
  r3max: cap,
  r4max: cap,
});
