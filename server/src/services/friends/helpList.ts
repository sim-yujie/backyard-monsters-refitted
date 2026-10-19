import type { BuildingData } from "../../types/BuildingData.js";

/**
 * The helper list on a building (`hl`, Flash's name; `docs/design/friends.md`
 * §4, issue #373): the user ids of the friends who sped up the job now
 * running, at most five. Kept apart from the rules so the job start and end
 * points in `services/yard` and `services/yardplanner` can clear it without
 * pulling in the friends code.
 */

/** The helpers' user ids kept on a building: whole numbers only. */
export const helpersOf = (building: BuildingData): number[] =>
  Array.isArray(building.hl) ? building.hl.map(Number).filter((id) => Number.isInteger(id)) : [];

/** The building with no helper list: a job ended or a new one started. */
export const withoutHelpers = <B extends BuildingData>(building: B): B => {
  if (!("hl" in building)) return building;
  const { hl: _helpers, ...rest } = building;
  return rest as B;
};
