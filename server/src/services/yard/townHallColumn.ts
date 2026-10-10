import type { BuildingDataMap } from "../../types/BuildingData.js";
import { townHallLevel } from "../yardplanner/costs.js";

/**
 * The value kept in `save.thlevel`: the main yard's Town Hall level, 0 when it
 * has none (an outpost, a blank save).
 *
 * `buildingdata` is jsonb, and MikroORM has stored it double-encoded as a JSON
 * string on some rows, so a string is parsed first; one that does not parse
 * reads as 0.
 */
export const townHallColumnValue = (buildingdata: unknown): number => {
  let data = buildingdata;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return 0;
    }
  }
  if (!data || typeof data !== "object") return 0;
  return townHallLevel(data as BuildingDataMap);
};
