import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../types/BuildingData.js";
import { catchUpBuildings, type BuildingJob } from "./catchUpBuildings.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * Small pieces the Shiny building routes share (`speedup`, `upgrade/instant`):
 * finding the building a request names, the damaged test, and finishing a
 * countdown on the spot the same way the catch-up finishes one.
 */

/** The Map Room (`client/scripts/YARD_PROPS.as:1122`). */
export const MAP_ROOM_TYPE = 11;

/**
 * The building a request names, or a `400` with `reason` `badRequest`: an id
 * the yard does not hold is the client sending something it could not have
 * seen (`docs/design/yard-buildings.md` §2.1 "Errors").
 */
export const buildingOrThrow = (
  buildingdata: BuildingDataMap | null | undefined,
  id: number
): BuildingData => {
  const building = buildingdata?.[String(id)];
  if (!building) throw yardBadRequestErr("That building is not in your yard.", { id });
  return building;
};

/**
 * Whether the building is damaged or repairing, which pauses its countdown
 * (`services/base/advanceBuildingTimers.ts`, `isCountdownPaused`) and hides
 * Upgrade behind Repair (`client/scripts/BUILDINGINFO.as:98-107`). Read the
 * way the planner walk reads it, plus the repairing flag.
 */
export const isDamaged = (
  building: BuildingData,
  health: BuildingHealthData | null | undefined
): boolean =>
  building.hp != null || Boolean(building.rE) || (health != null && String(building.id) in health);

/** `409 damaged`: repair first. */
export const damagedErr = (id: number) =>
  yardRefusedErr("damaged", "Repair this building first.", { id });

/**
 * `409 mapRoom`: the Map Room's level is the map version (D16) and its L1 to
 * L2 step joins a world when it completes (§5.7, WP3.7). That hook lives in the
 * catch-up, so the Shiny routes do not finish or skip a Map Room step. The
 * original never offered Upgrade on a Map Room either
 * (`client/scripts/BUILDINGINFO.as:246-250`).
 */
export const mapRoomErr = (id: number) =>
  yardRefusedErr("mapRoom", "The Map Room cannot be rushed with Shiny.", { id });

/** The countdown that is running on a building, in the order the timers advance them. */
export const runningCountdown = (building: BuildingData): "cU" | "cB" | null => {
  if (Number(building.cU) > 0) return "cU";
  if (Number(building.cB) > 0) return "cB";
  return null;
};

/**
 * Finishes a building job now: `field` is treated as one second from done and
 * the catch-up's own building step is run over that single second, so the new
 * level, the Town Hall's build bonus, the points and the job record are
 * exactly what the catch-up would have produced had the countdown run out
 * (`services/yard/catchUpBuildings.ts`; `Upgraded()` / `Constructed()`,
 * `client/scripts/BFOUNDATION.as:2434-2461`, `:2892-2921`, which `STORE`'s
 * finishing branch calls directly, `client/scripts/STORE.as:2067-2090`).
 *
 * An idle building given `field` `cU` is upgraded one level: the instant
 * upgrade (`BFOUNDATION.DoInstantUpgrade`, `:2130-2140`, calls `Upgraded()`).
 *
 * The caller must already have refused a damaged building: a paused countdown
 * would not advance.
 *
 * @returns The finished building and the job as `completed` spells it.
 */
export const finishBuildingJob = (
  building: BuildingData,
  field: "cU" | "cB",
  now: number
): { building: BuildingData; job: BuildingJob } => {
  const key = String(building.id);
  const one = { buildingdata: { [key]: { ...building, [field]: 1 } as BuildingData } };

  const [job] = catchUpBuildings(one, now - 1, now) as BuildingJob[];
  return { building: one.buildingdata[key], job };
};
