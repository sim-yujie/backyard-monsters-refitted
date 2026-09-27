import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  ACADEMY_TYPE,
  RELATIVE_TRAINING_LIMIT,
  academyTraining,
  clearedUpg,
  trainedAcademy,
  trainingLevel,
} from "./academy.js";

/**
 * Catch-up step 4: Monster Academy training (`docs/design/yard-buildings.md`
 * §6 "Catch-up", §2.5).
 *
 * A training ends on wall-clock time (`academy[id].time`, absolute), so it
 * finishes while the player is away. The Flash client scanned every entry
 * each tick (`client/scripts/ACADEMY.as:205-217`) and finished the expired
 * ones (`FinishMonsterUpgrade`, `:148-174`); this does the same for the whole
 * window at once:
 *
 * - **Legacy relative time**: a `time` at or below 162 hours is a remainder
 *   relative to the save (`client/scripts/com/monsters/player/Player.as:170-177`)
 *   and is made absolute once, `time + savetime` (§2.5).
 * - **Legacy id**: `C100` is `C12` (`client/scripts/BUILDING26.as:112-114`),
 *   rewritten once in `academy` and in an academy's `upg`.
 * - **Completion** once `time` has passed: `level + 1`, `time` and `duration`
 *   removed, the academy's `upg` cleared, and a `completed` entry.
 * - **Stale slots**: an academy whose `upg` names a monster with no running
 *   training is idle (`BUILDING26.Click`, `:26-31`); its `upg` is dropped.
 *
 * Only surface `C` ids are read (D19). Pure apart from mutating the save it is
 * handed. Idempotent: a second run at the same moment finds nothing expired,
 * nothing relative and nothing stale.
 */

/** A training the catch-up finished. */
export interface TrainJob {
  kind: "train";
  /** The monster, e.g. `C5`. */
  id: string;
  t: null;
  /** Unix seconds at which the training ended: its `time`. */
  at: number;
  detail: {
    /** The level the monster reached. */
    level: number;
    /** The academy that trained it, or null when no academy named it. */
    academy: number | null;
  };
}

/** The slice of a save this step reads and writes. */
export interface CatchUpTrainingSave {
  buildingdata?: BuildingDataMap | null;
  academy?: JsonObject | null;
}

/** The ids the original rewrote on load (`BUILDING26.as:112-114`; MH §12.2 item 9). */
const LEGACY_IDS: Readonly<Record<string, string>> = { C100: "C12" };

/** Rewrites legacy ids in `academy` and in academies' `upg`, once. */
const migrateLegacyIds = (save: CatchUpTrainingSave): void => {
  for (const [legacy, id] of Object.entries(LEGACY_IDS)) {
    if (save.academy && legacy in save.academy) {
      const { [legacy]: old, ...rest } = save.academy;
      save.academy = id in rest ? rest : { ...rest, [id]: old };
    }
    for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
      if (Number(building?.t) === ACADEMY_TYPE && building["upg"] === legacy) {
        save.buildingdata = { ...save.buildingdata, [key]: { ...building, upg: id } };
      }
    }
  }
};

/** The academy whose `upg` names `monster`, by building id, or null. */
const academyFor = (buildingdata: BuildingDataMap | null | undefined, monster: string): number | null => {
  for (const [key, building] of Object.entries(buildingdata ?? {})) {
    if (Number(building?.t) === ACADEMY_TYPE && building["upg"] === monster) {
      const id = Number(building.id ?? key);
      return Number.isFinite(id) ? id : null;
    }
  }
  return null;
};

/**
 * Finishes every training that ended by `now`.
 *
 * @param save - The yard, mutated in place: `academy` and `buildingdata` may change.
 * @param from - The save's `savetime`, which a legacy relative `time` counts from.
 * @param now - The moment to advance to.
 */
export const catchUpTraining = (save: CatchUpTrainingSave, from: number, now: number): TrainJob[] => {
  migrateLegacyIds(save);

  const jobs: TrainJob[] = [];
  for (const [monster, raw] of Object.entries(save.academy ?? {})) {
    if (!/^C\d+$/.test(monster) || !raw || typeof raw !== "object") continue;
    const entry = raw as JsonObject;
    let time = Number(entry.time);
    if (entry.time == null || !Number.isFinite(time) || time <= 0) continue;

    if (time <= RELATIVE_TRAINING_LIMIT) {
      time += from;
      save.academy = { ...save.academy, [monster]: { ...entry, time } };
    }
    if (time > now) continue;

    const academy = academyFor(save.buildingdata, monster);
    const buildingdata = clearedUpg(save.buildingdata, monster);
    save.academy = trainedAcademy(save.academy, monster);
    if (buildingdata) save.buildingdata = buildingdata;
    jobs.push({
      kind: "train",
      id: monster,
      t: null,
      at: time,
      detail: { level: trainingLevel(save.academy, monster), academy },
    });
  }

  // An academy left naming a monster that is not training is idle.
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    if (Number(building?.t) !== ACADEMY_TYPE || building["upg"] === undefined) continue;
    if (academyTraining(building, save.academy) !== null) continue;
    const { upg: _upg, ...rest } = building;
    save.buildingdata = { ...save.buildingdata, [key]: rest as BuildingData };
  }

  return jobs;
};
