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
import { damageOf, healed, repairSecondsLeft, type Damage } from "./repair.js";
import {
  FREE_SECONDS,
  SPEEDUP_SECONDS,
  speedupAllowed,
  speedupPrice,
  type SpeedupItem,
} from "./shiny.js";
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
 * A building being repaired takes `SP1` too (#279): with five minutes or less
 * of repair left it heals to full for free. The original offered Speed up on a
 * repairing building (`BUILDINGINFO.as:146-148`), priced its finish by the
 * repair time left, free at 300 s or less (`STORE.as:162-171`, `:354-355`),
 * and spent the item on the repair rather than the paused countdown
 * (`STORE.as:2056-2061`). The other items are not offered on a repair: Repair
 * now covers the paid finish.
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
  /** Set when the speed-up finished a repair instead of a job. */
  repaired?: true;
}

/** What the speed-up decided. */
export interface SpeedupPlan {
  buildingdata: BuildingDataMap;
  /** Only when a repair finished: the health map without the building. */
  buildinghealthdata?: BuildingHealthData;
  shiny: number;
  points: number;
  report: SpeedupReport;
}

/**
 * Works out a speed-up against a caught-up yard, or throws the refusal.
 *
 * Refusals, in order: an id the yard does not hold (`400 badRequest`); a
 * repairing building with an item other than `SP1`, or more than 300 s of
 * repair left (`409 itemRefused`, {@link planRepairFinish}); no build or
 * upgrade countdown running (`409 notRunning`); the building is damaged and
 * not repairing (`409 damaged` — its countdown is paused); a Map Room
 * (`409 mapRoom`); the item not allowed at this much time left
 * (`409 itemRefused`). Shiny lock and balance are the wrapper's.
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

  // A repair comes first, as the original's speed-up looked at it first.
  const damage = damageOf(save, String(id), building);
  if (damage?.repairing) return planRepairFinish(save, damage, item);

  const field = runningCountdown(building, true);
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

/**
 * `SP1` on a repairing building: full health now, free, when the repair has
 * {@link FREE_SECONDS} or less left. The time left is the server's own reading
 * of the caught-up save, `int((max − health) / rate)` (`repairSecondsLeft`),
 * the seconds the original priced the finish by (`BFOUNDATION.as:2858-2861`).
 * Healing clears `hp`, `rE` and the health entry, so a paused build or upgrade
 * countdown runs again from here.
 *
 * @throws 409 `itemRefused` for any other item, or more than 300 s left.
 */
const planRepairFinish = (save: SpeedupSave, damage: Damage, item: SpeedupItem): SpeedupPlan => {
  const { id, key } = damage;
  const remaining = repairSecondsLeft(damage);
  if (item !== "SP1") {
    throw yardRefusedErr(
      "itemRefused",
      "A repair can only be finished free, with 5 minutes or less to go. Repair now finishes it for Shiny.",
      { id, item, remaining }
    );
  }
  if (remaining > FREE_SECONDS) {
    throw yardRefusedErr("itemRefused", itemRefusedMessage(item), { id, item, remaining });
  }

  const buildinghealthdata: BuildingHealthData = { ...(save.buildinghealthdata ?? {}) };
  delete buildinghealthdata[String(id)];
  return {
    buildingdata: { ...save.buildingdata, [key]: healed(save.buildingdata![key]!) },
    buildinghealthdata,
    shiny: 0,
    points: 0,
    report: { id, item, credits: 0, remaining: 0, finished: null, repaired: true },
  };
};

/** The player-facing reason an item does not apply, as the original worded it (`STORE.as:1071-1082`). */
const itemRefusedMessage = (item: SpeedupItem): string =>
  item === "SP1"
    ? "Close enough only works with 5 minutes or less to go."
    : item === "SP4"
      ? "With 5 minutes or less to go, finishing is free: use Close enough."
      : "Not needed: there is less time left than this takes off.";
