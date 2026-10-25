import { BaseType } from "../../enums/Base.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { storageCap } from "../base/economy/resourceBudget.js";

/**
 * The Inferno yard's load (`POST /bm/inferno/load`, `docs/design/inferno.md`
 * §3.1-3.2, WP 1.14): the purse the yard shows.
 *
 * The catch-up is the yard's own (`services/yard/catchUp.ts`,
 * `catchUpInferno`): the Inferno's Bone Cruncher, Coal Extractor, Sulfur
 * Swirler and Magma Pump are the original's harvesters
 * (`client/scripts/BRESOURCE.as`, with the Inferno table's figures,
 * `INFERNOYARDPROPS.as`): each fills its own buffer while the player is away
 * and stops when full; nothing reaches the purse until the player banks it
 * (yard actions, WP 1.16). The purse is the main save's `iresources` (Bone,
 * Coal, Sulfur, Magma), which the Descent loot, the yard actions (WP 1.15) and
 * the banking fill and spend; the yard's own `resources` stays empty.
 *
 * Pure: no database, no clock.
 */

/**
 * The Inferno purse's cap, one figure for all four resources
 * (`client/scripts/BASE.as:4705-4828`, `isMainYardOrInfernoMainYard`): 10,000,
 * plus each finished Resource Pod's capacity from the Inferno table, times the
 * Inferno yard's own Improved Packing Skills (Flash reads them off the loaded
 * yard's store data, `BASE.as:1082`, `STORE.as:2520-2524`, and the Inferno
 * shop sells them, `STORE.as:210`). Outposts add nothing to it. The same figure
 * the yard actions clamp to (`storageCap` on the Inferno view, `poolView.ts`).
 *
 * @param yard - The Inferno yard, whose Resource Pods and store data count.
 */
export const infernoStorageCap = (yard: {
  buildingdata?: BuildingDataMap | null;
  storedata?: JsonObject | null;
}): number =>
  storageCap({ type: BaseType.INFERNO, buildingdata: yard.buildingdata, storedata: yard.storedata });

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
 * uncapped, and the cap only stops what banking and refunds add.
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
