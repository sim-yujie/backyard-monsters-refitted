import { footprintOf } from "../../game-data/buildingFootprints.js";
import { decorationPrice } from "../../game-data/store/decorationsForSale.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { levelOf } from "../yardplanner/costs.js";
import { nextBuildingId, placementProblem, type BuildRequest, type BuildSave } from "./build.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * Decoration storage (`docs/design/yard-buildings.md` §8.3, WP6.3, #128).
 *
 * A decoration off the yard is a count in `researchdata["b<type>"]`, as the
 * original kept it (`InventoryManager.buildingStorageAdd`,
 * `client/scripts/com/monsters/inventory/InventoryManager.as:13-21`); the two
 * Wild Monster totems also keep their level in `"bl<type>"`
 * (`BTOTEM.as:264-270`). Recycling a decoration and a planner Apply that
 * leaves one unplaced put it here; `decor/place` and a planner Apply that
 * places one from the drawer take it out.
 *
 * Owner decisions of 2026-09-29: placing from storage is free and finished
 * at once, holds no worker, awards no points and has no Town Hall limit (the
 * count is the limit); it goes inside the plot, clear of buildings (a
 * mushroom moves out of the way, #263); main yard only. A totem comes back at its stored level, else
 * level 1, and `bl<type>` goes once its count is 0.
 *
 * Owner decision of 2026-11-04: the decorations Flash sold can be bought
 * again (`decor/buy`, {@link planBuyDecoration}), at Flash's price
 * (`game-data/store/decorationsForSale.ts`), charged when one is placed, as
 * Flash charged it (`BFOUNDATION.as:1690-1700`); the same placement rules
 * apply, and there is no limit (Flash's `quantity: [0]`).
 *
 * Owner decision of 6 Nov 2026 (beta 7 grill item 29): they cost EVENT
 * COINS, not Shiny: Flash's Shiny price as coins (a 50-Shiny decoration
 * costs 50 coins), `services/events/eventCoins.ts`. Decorations already
 * owned are kept.
 */

/** The Wild Monster totems keep their level in storage (`BTOTEM.as:264-270`). */
export const TOTEM_TYPES: ReadonlySet<number> = new Set([121, 131]);

/** Whether `type` is a decoration (the props `kind`, which the footprint table carries). */
export const isDecoration = (type: number): boolean => footprintOf(type).decoration === true;

/** How many of `type` are in storage. */
export const storedCount = (researchdata: JsonObject | null | undefined, type: number): number =>
  Math.max(0, Math.floor(Number(researchdata?.[`b${type}`]) || 0));

/** Storage with one more `building` in it: the count up, a totem's level kept. */
export const storeDecoration = (
  researchdata: JsonObject | null | undefined,
  building: BuildingData,
): JsonObject => {
  const type = Number(building.t);
  const next: JsonObject = { ...(researchdata ?? {}), [`b${type}`]: storedCount(researchdata, type) + 1 };
  if (TOTEM_TYPES.has(type)) next[`bl${type}`] = levelOf(building);
  return next;
};

/**
 * Storage with one `type` taken out, and the level it comes back at: a
 * totem's stored level, else 1. The count's key and a totem's level go once
 * none is left. The caller has checked there is one.
 */
export const takeDecoration = (
  researchdata: JsonObject | null | undefined,
  type: number,
): { researchdata: JsonObject; level: number } => {
  const next: JsonObject = { ...(researchdata ?? {}) };
  const left = storedCount(researchdata, type) - 1;
  const stored = Math.floor(Number(next[`bl${type}`]) || 0);
  const level = TOTEM_TYPES.has(type) && stored > 0 ? stored : 1;
  if (left > 0) {
    next[`b${type}`] = left;
  } else {
    delete next[`b${type}`];
    delete next[`bl${type}`];
  }
  return { researchdata: next, level };
};

/** A decoration placed from storage: finished, at `level` (absent `l` is level 1). */
export const placedDecoration = (id: number, request: BuildRequest, level: number): BuildingData =>
  ({
    id,
    t: request.type,
    X: request.x,
    Y: request.y,
    ...(level > 1 ? { l: level } : {}),
  }) as unknown as BuildingData;

/** The parts of a `Save` placing reads. */
export interface DecorSave extends BuildSave {
  researchdata?: JsonObject | null;
}

/** `report` of `POST /bm/yard/decor/place` and `/decor/buy`. */
export interface PlaceDecorationReport {
  id: number;
  t: number;
  x: number;
  y: number;
  /** Its level: a totem's stored one, else 1. */
  level: number;
  /** How many of the type are left in storage. */
  left: number;
  /** `decor/buy` only: the event coins charged (0 when one came out of storage instead). */
  coins?: number;
}

const PLACEMENT_MESSAGES = {
  outOfBounds: "That spot is outside your yard.",
  overlap: "Something is already there.",
} as const;

/**
 * Takes one decoration out of storage and puts it at `x`, `y`: `400
 * notDecoration` for a type that is not one, `409 notInStorage { type }` when
 * none is stored, `409 placement` (outside the plot, on a building), the
 * `build` route's placement rule and detail. A mushroom under it moves away
 * (#263, the action wrapper).
 */
export const planPlaceDecoration = (save: DecorSave, request: BuildRequest) => {
  const { type } = request;
  if (!isDecoration(type)) {
    throw yardBadRequestErr("That is not a decoration.", { type }, "notDecoration");
  }
  if (storedCount(save.researchdata, type) < 1) {
    throw yardRefusedErr("notInStorage", "You have none of those in storage.", { type });
  }
  const problem = placementProblem(save, request);
  if (problem) throw yardRefusedErr("placement", PLACEMENT_MESSAGES[problem.placement], problem);

  const id = nextBuildingId(save);
  const { researchdata, level } = takeDecoration(save.researchdata, type);
  const buildingdata: BuildingDataMap = {
    ...(save.buildingdata ?? {}),
    [String(id)]: placedDecoration(id, request, level),
  };
  const report: PlaceDecorationReport = {
    id,
    t: type,
    x: request.x,
    y: request.y,
    level,
    left: storedCount(researchdata, type),
  };
  return { report, slices: { buildingdata, researchdata } };
};

/**
 * Buys one decoration of `type` for event coins and puts it at `x`, `y`,
 * finished (owner decisions 2026-11-04 and 6 Nov): the price is the store
 * table's Shiny price as coins ({@link decorationPrice}), whatever the client
 * thinks it is, and the wrapper takes it (`409 coins`) only once the spot is
 * good, so a refused placement charges nothing. `400 notDecoration` for a type
 * that is not one, `400 notForSale { type }` for one Flash did not sell,
 * `409 placement` as `decor/place`. One already in storage is placed from
 * there for free instead, as Flash placed it (`BFOUNDATION.as:1691`), and
 * `coins` is 0.
 */
export const planBuyDecoration = (save: DecorSave, request: BuildRequest) => {
  const { type } = request;
  if (!isDecoration(type)) {
    throw yardBadRequestErr("That is not a decoration.", { type }, "notDecoration");
  }
  if (storedCount(save.researchdata, type) > 0) {
    const placed = planPlaceDecoration(save, request);
    return { ...placed, report: { ...placed.report, coins: 0 } };
  }
  const price = decorationPrice(type);
  if (price === undefined) {
    throw yardBadRequestErr("That decoration is not for sale.", { type }, "notForSale");
  }
  const problem = placementProblem(save, request);
  if (problem) throw yardRefusedErr("placement", PLACEMENT_MESSAGES[problem.placement], problem);

  const id = nextBuildingId(save);
  const buildingdata: BuildingDataMap = {
    ...(save.buildingdata ?? {}),
    [String(id)]: placedDecoration(id, request, 1),
  };
  const report: PlaceDecorationReport = {
    id,
    t: type,
    x: request.x,
    y: request.y,
    level: 1,
    left: 0,
    coins: price,
  };
  return { report, slices: { buildingdata }, coins: { amount: price, reason: `decor-${type}` } };
};
