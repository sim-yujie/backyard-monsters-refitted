import {
  maxLevel,
  OUTPOST_CORE_TYPE,
  OUTPOST_COSTS,
  OUTPOST_TRAITS,
} from "../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { pricingType } from "../base/economy/resourceBudget.js";
import { countOfType, levelOf, yardKindOf } from "../yardplanner/costs.js";
import { nextBuildingId } from "./build.js";

/**
 * Map Room 2 outposts as yards (outposts WP3, issue #184): the two things an
 * outpost's catch-up does that a main yard's does not.
 *
 * **The core.** An outpost that loads with no buildings at all gets its core,
 * the outpost's Town Hall (112), level 1, at (0, -50): Flash placed it in the
 * client when an outpost loaded empty (`client/scripts/BASE.as:1605-1614`). A
 * wild camp that was taken over arrives that way
 * (`controllers/maproom/v2/takeoverCell.ts`, which clears its buildings). As
 * in Flash, a yard holding anything at all is left alone, core or not.
 *
 * **Old rows.** Outposts that Flash-era owner saves wrote hold whatever the
 * client sent. {@link outpostProblems} lists where one breaks the outpost
 * props (a type the outpost table has no row for or blocks, more of a type
 * than `quantity[1]`, a level above the outpost ladder); the load logs them
 * once and changes nothing (`controllers/yard/yardAction.ts`).
 */

/** Where the core goes in an empty outpost (`client/scripts/BASE.as:1607-1612`). */
export const OUTPOST_CORE_SPOT = { x: 0, y: -50 } as const;

/** The slice of a save the core placement reads and writes. */
export interface OutpostCoreSave {
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}

/**
 * Gives an empty outpost its core. Pure apart from mutating the save.
 *
 * @param save - The outpost; a main yard or a yard with any building is left alone.
 * @returns Whether the core was placed.
 */
export const placeOutpostCore = (save: OutpostCoreSave): boolean => {
  if (yardKindOf(save) !== "outpost") return false;
  if (Object.keys(save.buildingdata ?? {}).length > 0) return false;

  const id = nextBuildingId(save);
  const core = {
    id,
    t: OUTPOST_CORE_TYPE,
    X: OUTPOST_CORE_SPOT.x,
    Y: OUTPOST_CORE_SPOT.y,
    l: 1,
  } as unknown as BuildingData;

  save.buildingdata = { [String(id)]: core };
  return true;
};

/** The main-yard data an outpost row may carry (#191). */
export interface OutpostCarryoverSave {
  type?: string;
  mushrooms?: JsonObject | null;
  storedata?: JsonObject | null;
}

/** What an outpost row carries that belongs to a main yard: `{ mushrooms, expansion }`. */
export interface OutpostCarryover {
  /** Mushrooms in `mushrooms.l`. */
  mushrooms: number;
  /** `storedata.ENL.q`, the yard expansion; 0 without one. */
  expansion: number;
}

/**
 * The main-yard data an outpost row carries (#191): a row copied from a main
 * save, by hand or by an old tool, can hold both.
 *
 * - **Mushrooms** grow and show on the main yard only: Flash's mushroom code
 *   returns at once on any other yard, both the spawn and the draw
 *   (`client/scripts/MUSHROOMS.as:40-42`, `:159-161`). An outpost's are data
 *   nobody can see or pick (the pick route refuses an outpost), so
 *   {@link clearOutpostMushrooms} drops them.
 * - **The expansion** is kept. Flash sizes whichever yard it loads from that
 *   yard's own `storedata.ENL` (`STORE.ProcessPurchases`,
 *   `client/scripts/STORE.as:2345-2366`), an outpost's included, although the
 *   outpost store never sells `ENL` (`STORE.as:198-199`). Shrinking the plot
 *   under buildings laid out for it would strand them, so it is only logged.
 */
export const outpostCarryover = (save: OutpostCarryoverSave): OutpostCarryover => {
  const list = save.mushrooms?.l;
  const expansion = Number(save.storedata?.ENL?.q);
  return {
    mushrooms: Array.isArray(list) ? list.length : 0,
    expansion: Number.isFinite(expansion) && expansion > 0 ? Math.floor(expansion) : 0,
  };
};

/**
 * Drops an outpost's mushrooms (see {@link outpostCarryover}); nothing on a
 * main yard or an outpost without any.
 *
 * @returns How many were dropped.
 */
export const clearOutpostMushrooms = (save: OutpostCarryoverSave): number => {
  if (yardKindOf(save) !== "outpost") return 0;
  const { mushrooms } = outpostCarryover(save);
  if (mushrooms > 0) save.mushrooms = { l: [] };
  return mushrooms;
};

/** One way an outpost row breaks the outpost props. */
export type OutpostProblem =
  | { problem: "unknownType"; id: number; t: number }
  | { problem: "blockedType"; id: number; t: number }
  | { problem: "overLimit"; t: number; have: number; allowed: number }
  | { problem: "overLevel"; id: number; t: number; level: number; max: number }
  | { problem: "cores"; have: number };

/**
 * Where an outpost row breaks the outpost props, for the log. Walls of the
 * legacy type 18 are read as type 17, as Flash rewrote them on load
 * (`client/scripts/BASE.as:1523-1526`). The core itself is blocked from the
 * build menu but belongs here, once.
 *
 * @param buildingdata - The outpost's buildings.
 */
export const outpostProblems = (buildingdata: BuildingDataMap | null | undefined): OutpostProblem[] => {
  const problems: OutpostProblem[] = [];
  const buildings = buildingdata ?? {};
  const types = new Set<number>();

  for (const [key, building] of Object.entries(buildings)) {
    const id = Number(building?.id ?? key);
    const t = pricingType(Number(building?.t));
    types.add(t);

    const row = OUTPOST_COSTS[t];
    if (!row) {
      problems.push({ problem: "unknownType", id, t });
      continue;
    }
    if (t !== OUTPOST_CORE_TYPE && OUTPOST_TRAITS[t]?.blocked) {
      problems.push({ problem: "blockedType", id, t });
      continue;
    }

    const level = levelOf(building);
    const max = maxLevel(t, "outpost");
    if (level > max) problems.push({ problem: "overLevel", id, t, level, max });
  }

  for (const t of types) {
    const row = OUTPOST_COSTS[t];
    if (!row || t === OUTPOST_CORE_TYPE || OUTPOST_TRAITS[t]?.blocked) continue;
    const allowed = row.quantity[1] ?? 0;
    const have = Object.values(buildings).filter((b) => pricingType(Number(b?.t)) === t).length;
    if (have > allowed) problems.push({ problem: "overLimit", t, have, allowed });
  }

  const cores = countOfType(buildings, OUTPOST_CORE_TYPE);
  if (cores !== 1 && Object.keys(buildings).length > 0) problems.push({ problem: "cores", have: cores });

  return problems;
};
