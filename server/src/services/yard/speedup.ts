import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../types/BuildingData.js";
import {
  MAP_ROOM_TYPE,
  buildingOrThrow,
  damagedErr,
  finishBuildingJob,
  isDamaged,
  mapRoomErr,
  runningCountdown,
} from "./buildingJobs.js";
import type { BuildingJob } from "./catchUpBuildings.js";
import { yardKindOf } from "../yardplanner/costs.js";
import { SPEEDUP_SECONDS, speedupAllowed, speedupPrice, type SpeedupItem } from "./shiny.js";
import { yardRefusedErr } from "./yardErrors.js";

/**
 * `POST /bm/yard/speedup`: take time off a building's build or upgrade
 * countdown with a store speed-up (`docs/design/yard-buildings.md` §3.2;
 * `docs/specs/base-building.md` §5 "Speed-ups").
 *
 * | Item | Effect | Price | Only when |
 * | --- | --- | --- | --- |
 * | `SP1` | finish (−5 min) | free | ≤ 300 s left |
 * | `SP2` | −1 h | 20 | ≥ 1 h left |
 * | `SP3` | −2 h | 40 | ≥ 2 h left |
 * | `SP4` | finish | `timeCost(remaining)` | > 300 s left |
 *
 * (`client/scripts/STORE.as:1071-1082`, `:2043-2090`.) A countdown taken to
 * zero, and every `SP1`/`SP4`, finishes the job on the spot through the
 * catch-up's own completion (`finishBuildingJob`): level, points, record.
 * On an outpost a fortification's countdown can be sped up too (the building
 * panel offers Speed up on it, `client/scripts/BUILDINGINFO.as:124-127`).
 *
 * Pure: no database, no clock. The route's wrapper charges the Shiny.
 */

/** The slice of a save the speed-up reads. */
export interface SpeedupSave {
  /** `BaseType`: an outpost speeds up fortifications too. */
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}

/** What the route sends back as `report`. */
export interface SpeedupReport {
  id: number;
  item: SpeedupItem;
  /** Shiny charged. */
  credits: number;
  /** Seconds left on the countdown afterwards; 0 when the job finished. */
  remaining: number;
  /** The finished job, as `completed` spells one; null while the countdown still runs. */
  finished: BuildingJob | null;
}

/** What the speed-up decided. */
export interface SpeedupPlan {
  buildingdata: BuildingDataMap;
  shiny: number;
  points: number;
  report: SpeedupReport;
}

/**
 * Works out a speed-up against a caught-up yard, or throws the refusal.
 *
 * Refusals, in order: an id the yard does not hold (`400 badRequest`); no
 * build or upgrade countdown running (`409 notRunning`); the building is
 * damaged or repairing (`409 damaged` — its countdown is paused, and the
 * original spent the speed-up on the repair instead, `STORE.as:2056-2066`;
 * repairs are Phase 3); a Map Room (`409 mapRoom`); the item not allowed at
 * this much time left (`409 itemRefused`). Shiny lock and balance are the
 * wrapper's.
 *
 * @param save - The yard, already caught up to `now`.
 */
export const planSpeedup = (
  save: SpeedupSave,
  id: number,
  item: SpeedupItem,
  now: number
): SpeedupPlan => {
  const building = buildingOrThrow(save.buildingdata, id);
  const kind = yardKindOf(save);

  const field = runningCountdown(building, kind === "outpost");
  if (!field) {
    throw yardRefusedErr("notRunning", "This building is not building or upgrading.", { id });
  }
  if (isDamaged(building, save.buildinghealthdata)) throw damagedErr(id);
  if (Number(building.t) === MAP_ROOM_TYPE) throw mapRoomErr(id);

  const remaining = Math.floor(Number(building[field]));
  if (!speedupAllowed(item, remaining)) {
    throw yardRefusedErr("itemRefused", itemRefusedMessage(item), { id, item, remaining });
  }

  const shiny = speedupPrice(item, remaining);
  const left = item === "SP1" || item === "SP4" ? 0 : Math.max(0, remaining - SPEEDUP_SECONDS[item]);

  let next: BuildingData;
  let finished: BuildingJob | null = null;
  if (left > 0) {
    next = { ...building, [field]: left };
  } else {
    const done = finishBuildingJob(building, field, now, kind);
    next = done.building;
    finished = done.job;
  }

  return {
    buildingdata: { ...save.buildingdata, [String(id)]: next },
    shiny,
    points: finished?.detail.points ?? 0,
    report: { id, item, credits: shiny, remaining: left, finished },
  };
};

/** The player-facing reason an item does not apply, as the original worded it (`STORE.as:1071-1082`). */
const itemRefusedMessage = (item: SpeedupItem): string =>
  item === "SP1"
    ? "Close enough only works with 5 minutes or less to go."
    : item === "SP4"
      ? "With 5 minutes or less to go, finishing is free: use Close enough."
      : "Not needed: there is less time left than this takes off.";
