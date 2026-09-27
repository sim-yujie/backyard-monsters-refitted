import {
  maxTrainingLevel,
  monsterEntry,
  trainingStep,
  type MonsterEntry,
  type PaidStep,
} from "../../game-data/monsterCatalogue.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { StorageCapSave } from "../base/economy/resourceBudget.js";
import { levelOf } from "../yardplanner/costs.js";
import { isDamaged } from "./buildingJobs.js";
import { fitCredit } from "./credit.js";
import { instantTrainPrice, timeCost } from "./shiny.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The Monster Academy's training: `POST /bm/yard/academy/train`, `/cancel`,
 * `/finish`, `/instant` (`docs/design/yard-buildings.md` §6 "Train tab";
 * `docs/specs/monsters-and-hatchery.md` §4.1).
 *
 * The rules are `ACADEMY.StartMonsterUpgrade` (`client/scripts/ACADEMY.as:54-131`)
 * with the prices from the monster catalogue (`trainingCosts`), checked in the
 * original's order: the academy is idle, the monster is not already training,
 * it is unlocked, it is not at its highest level, its level is at most the
 * academy's, then putty (the wrapper's `409 shortfall`). One academy trains
 * one monster, so two academies are two slots.
 *
 * Storage is the original's (§6 "Storage unchanged"): the training is
 * `academy[id].time` (absolute unix end) and `.duration`, and the academy
 * doing it names the monster in its own `buildingdata[id].upg`
 * (`client/scripts/BUILDING26.as:103-121`). `academy[id].time` is the source
 * of truth; `upg` only says which slot is taken, and one that names a monster
 * with no running training is stale and reads as idle (`BUILDING26.Click`,
 * `:26-31`). Completion on the clock is the catch-up's (`catchUpTraining.ts`).
 *
 * Everything here is pure: it reads the caught-up save the yard action wrapper
 * hands it and returns what should change, or throws the refusal. The wrapper
 * charges the putty and the Shiny, clamps the refund and writes.
 */

/** Monster Academy type id (`client/scripts/ACADEMY.as:8`). */
export const ACADEMY_TYPE = 26;

/**
 * An academy `time` at or below 162 hours is a legacy remainder relative to
 * the save, not a date (`client/scripts/com/monsters/player/Player.as:170-177`).
 * The catch-up converts one once (design §2.5).
 */
export const RELATIVE_TRAINING_LIMIT = 60 * 60 * 162;

/** The slice of a save the academy routes read. */
export interface AcademySave extends StorageCapSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
  lockerdata?: JsonObject | null;
  academy?: JsonObject | null;
}

/** A finite number off a jsonb field, or null. */
const finite = (raw: unknown): number | null => {
  const value = Number(raw);
  return raw != null && Number.isFinite(value) ? value : null;
};

/** One `academy` entry as an object, `{}` when absent or unreadable. */
const entryOf = (academy: JsonObject | null | undefined, monster: string): JsonObject => {
  const entry = academy?.[monster];
  return entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as JsonObject) : {};
};

/** A monster's academy level, 1 when absent (`Player.as:185`, `ACADEMY.as:55-57`). */
export const trainingLevel = (academy: JsonObject | null | undefined, monster: string): number => {
  const level = Math.floor(Number(entryOf(academy, monster).level));
  return Number.isFinite(level) && level >= 1 ? level : 1;
};

/** When `monster`'s running training ends (unix s), or null when it is not training. */
export const trainingEndsAt = (
  academy: JsonObject | null | undefined,
  monster: string
): number | null => {
  const time = finite(entryOf(academy, monster).time);
  return time !== null && time > 0 ? time : null;
};

/** One Monster Academy in the yard. */
export interface AcademyBuilding {
  id: number;
  building: BuildingData;
  /** Its level; 0 while it is still being built. */
  level: number;
}

/** Every Monster Academy in the yard, by building id. */
export const academiesOf = (buildingdata: BuildingDataMap | null | undefined): AcademyBuilding[] =>
  Object.entries(buildingdata ?? {})
    .filter(([, building]) => Number(building?.t) === ACADEMY_TYPE)
    .map(([key, building]) => ({
      id: Number(building.id ?? key),
      building,
      level: levelOf(building),
    }))
    .filter((academy) => Number.isFinite(academy.id))
    .sort((a, b) => a.id - b.id);

/**
 * The monster an academy is training, or null when it is idle. An `upg` that
 * names a monster with no running training is stale and reads as idle, as the
 * original cleared it on a click (`BUILDING26.as:26-31`).
 */
export const academyTraining = (
  building: BuildingData,
  academy: JsonObject | null | undefined
): string | null => {
  const upg = building["upg"];
  if (typeof upg !== "string" || !upg) return null;
  return trainingEndsAt(academy, upg) !== null ? upg : null;
};

/**
 * Why an academy cannot take a training right now, or null. The original
 * offers no Open button on a building that is being built, upgraded or
 * fortified, or is damaged (`client/scripts/BUILDINGINFO.as:98-127`), so
 * none of those can start one; then `acad_err_busy` (`ACADEMY.as:62`).
 */
const academyRefusal = (save: AcademySave, academy: AcademyBuilding): Error | null => {
  const { id, building } = academy;
  if (academy.level < 1 || Number(building.cU) > 0 || Number(building.cF) > 0) {
    return yardRefusedErr("busy", "This Monster Academy is being built or upgraded.", { id });
  }
  if (isDamaged(building, save.buildinghealthdata)) {
    return yardRefusedErr("damaged", "Repair this Monster Academy first.", { id });
  }
  const training = academyTraining(building, save.academy);
  if (training) {
    return yardRefusedErr("academyBusy", "This Monster Academy is already training a monster.", {
      id,
      monster: training,
    });
  }
  return null;
};

/**
 * The catalogue entry for a monster a player may train, or `400 badRequest`:
 * not in the catalogue, blocked (C18), or not a surface `C` id (D19).
 */
export const trainableOrThrow = (monster: string): MonsterEntry => {
  const entry = /^C\d+$/.test(monster) ? monsterEntry(monster) : undefined;
  if (!entry || entry.blocked) {
    throw yardBadRequestErr("That monster cannot be trained.", { monster });
  }
  return entry;
};

/**
 * The monster's own checks, `ACADEMY.as:63-65` in order: `409 training
 * {monster, endsAt}` already training; `409 locked {monster}` not unlocked
 * (`lockerdata[id].t` is not 2); `409 maxLevel {monster, level}` at the top
 * of its ladder. Returns its level and the step it would pay for.
 */
const monsterGate = (save: AcademySave, monster: string): { level: number; step: PaidStep } => {
  const endsAt = trainingEndsAt(save.academy, monster);
  if (endsAt !== null) {
    throw yardRefusedErr("training", "That monster is already training.", { monster, endsAt });
  }
  if (Number((save.lockerdata?.[monster] as JsonObject | undefined)?.t) !== 2) {
    throw yardRefusedErr("locked", "Unlock that monster in the Monster Locker first.", { monster });
  }
  const level = trainingLevel(save.academy, monster);
  const step = trainingStep(monster, level);
  if (!step || level >= maxTrainingLevel(monster)) {
    throw yardRefusedErr("maxLevel", "That monster is fully trained.", { monster, level });
  }
  return { level, step };
};

/** `409 academyLevel {have, need}`: training level N to N+1 needs an academy at level N (`ACADEMY.as:66`). */
const academyLevelErr = (have: number, need: number) =>
  yardRefusedErr("academyLevel", `Needs Monster Academy level ${need}.`, { have, need });

/**
 * The checks `train` and `instant` share, in the original's order, and the
 * academy that will do it.
 *
 * With `academyId` the named building is checked first (`ACADEMY.as:62`):
 * `400 badRequest` not in the yard or not a Monster Academy; `409 busy {id}`
 * being built, upgraded or fortified; `409 damaged {id}`; `409 academyBusy
 * {id, monster}`. Without it the first idle academy high enough is taken:
 * `409 noAcademy` when the yard has no finished one, then the monster's
 * checks, then the first academy's refusal when none is idle.
 *
 * Then the monster (`training`, `locked`, `maxLevel`) and finally
 * `409 academyLevel {have, need}`. Putty is the wrapper's (train only).
 */
export const trainGate = (
  save: AcademySave,
  monster: string,
  academyId: number | undefined
): { academy: AcademyBuilding; level: number; step: PaidStep } => {
  trainableOrThrow(monster);
  const academies = academiesOf(save.buildingdata);

  if (academyId !== undefined) {
    const building = save.buildingdata?.[String(academyId)];
    if (!building) throw yardBadRequestErr("That building is not in your yard.", { id: academyId });
    const academy = academies.find((one) => one.id === academyId);
    if (!academy) {
      throw yardBadRequestErr("That building is not a Monster Academy.", { id: academyId });
    }
    const refusal = academyRefusal(save, academy);
    if (refusal) throw refusal;
    const { level, step } = monsterGate(save, monster);
    if (academy.level < level) throw academyLevelErr(academy.level, level);
    return { academy, level, step };
  }

  if (!academies.some((academy) => academy.level >= 1)) {
    throw yardRefusedErr("noAcademy", "Build a Monster Academy first.");
  }
  const { level, step } = monsterGate(save, monster);
  const idle = academies.filter((academy) => academyRefusal(save, academy) === null);
  if (idle.length === 0) {
    const first = academies.find((one) => one.level >= 1)!;
    throw academyRefusal(save, first)!;
  }
  const academy = idle.find((one) => one.level >= level);
  if (!academy) throw academyLevelErr(Math.max(...idle.map((one) => one.level)), level);
  return { academy, level, step };
};

/**
 * `buildingdata` with every academy's `upg` naming `monster` removed (the
 * original clears the first, `ACADEMY.as:139-145`; a save should never hold
 * two). Null when no academy names it.
 */
export const clearedUpg = (
  buildingdata: BuildingDataMap | null | undefined,
  monster: string
): BuildingDataMap | null => {
  let next: BuildingDataMap | null = null;
  for (const [key, building] of Object.entries(buildingdata ?? {})) {
    if (Number(building?.t) !== ACADEMY_TYPE || building["upg"] !== monster) continue;
    next ??= { ...buildingdata };
    const { upg: _upg, ...rest } = building;
    next[key] = rest as BuildingData;
  }
  return next;
};

/**
 * `academy` with `monster` one level up and its training fields gone
 * (`ACADEMY.FinishMonsterUpgrade`, `:148-174`), never past the top of its
 * ladder. The same change the catch-up makes at completion.
 */
export const trainedAcademy = (academy: JsonObject | null | undefined, monster: string): JsonObject => {
  const { time: _time, duration: _duration, ...entry } = entryOf(academy, monster);
  const top = maxTrainingLevel(monster) || Number.POSITIVE_INFINITY;
  const level = Math.min(trainingLevel(academy, monster) + 1, top);
  return { ...(academy ?? {}), [monster]: { ...entry, level } };
};

/** The slices finishing `monster`'s training writes: the level up, every `upg` naming it cleared. */
const trainedSlices = (save: AcademySave, monster: string) => {
  const buildingdata = clearedUpg(save.buildingdata, monster);
  return {
    academy: trainedAcademy(save.academy, monster),
    ...(buildingdata ? { buildingdata } : {}),
  };
};

/** The running training on `monster`, or `409 notTraining {monster}`. */
const runningOrThrow = (save: AcademySave, monster: string) => {
  trainableOrThrow(monster);
  const endsAt = trainingEndsAt(save.academy, monster);
  if (endsAt === null) {
    throw yardRefusedErr("notTraining", "That monster is not training.", { monster });
  }
  return { endsAt, level: trainingLevel(save.academy, monster) };
};

/** `report` of `POST /bm/yard/academy/train`. */
export interface AcademyTrainReport {
  monster: string;
  /** The academy doing it. */
  academy: number;
  /** The level the training reaches. */
  to: number;
  /** When it ends, unix seconds. */
  endsAt: number;
  /** Putty charged. */
  cost: { r3: number };
}

/** `report` of `POST /bm/yard/academy/cancel`. */
export interface AcademyCancelReport {
  monster: string;
  /** Putty actually returned, after the storage cap. */
  refund: { r3: number };
}

/** `report` of `POST /bm/yard/academy/finish` and `/instant`. */
export interface AcademyShinyReport {
  monster: string;
  /** The level it is now. */
  level: number;
  /** Shiny charged. */
  credits: number;
}

/**
 * Starts training `monster` one level up: the step's full putty price now,
 * `academy[monster].time = now + seconds`, `.duration = seconds`, and the
 * academy's `upg = monster` (`ACADEMY.as:68-74`).
 *
 * @param academyId - The academy to use; absent takes the first idle one high enough.
 */
export const planAcademyTrain = (
  save: AcademySave,
  monster: string,
  academyId: number | undefined,
  now: number
) => {
  const { academy, level, step } = trainGate(save, monster, academyId);
  const [putty, seconds] = step;
  const endsAt = now + seconds;
  const report: AcademyTrainReport = {
    monster,
    academy: academy.id,
    to: level + 1,
    endsAt,
    cost: { r3: putty },
  };

  return {
    report,
    slices: {
      academy: {
        ...(save.academy ?? {}),
        [monster]: { ...entryOf(save.academy, monster), level, time: endsAt, duration: seconds },
      },
      buildingdata: {
        ...(save.buildingdata ?? {}),
        [String(academy.id)]: { ...academy.building, upg: monster },
      },
    },
    debit: { r3: putty },
  };
};

/**
 * Cancels `monster`'s training: `time` and `duration` go, the academy is
 * freed, and the step's full putty price comes back, clamped to the storage
 * cap (`ACADEMY.CancelMonsterUpgrade`, `:133-146`). Progress is lost.
 */
export const planAcademyCancel = (save: AcademySave, monster: string) => {
  const { level } = runningOrThrow(save, monster);
  const refund = trainingStep(monster, level)?.[0] ?? 0;
  const { time: _time, duration: _duration, ...entry } = entryOf(save.academy, monster);
  const buildingdata = clearedUpg(save.buildingdata, monster);
  // What the wrapper's clamp will let through (`credit.ts`, T3), for the report.
  const report: AcademyCancelReport = {
    monster,
    refund: { r3: fitCredit(save, { r3: refund }).credited.r3 },
  };

  return {
    report,
    slices: {
      academy: { ...(save.academy ?? {}), [monster]: entry },
      ...(buildingdata ? { buildingdata } : {}),
    },
    credit: { r3: refund },
  };
};

/**
 * Finishes `monster`'s training now for `timeCost(time − now)` Shiny, free at
 * five minutes or less: the academy's Speed Up is the generic `SP4`
 * (`client/scripts/ACADEMYPOPUP.as:435-438`).
 */
export const planAcademyFinish = (save: AcademySave, monster: string, now: number) => {
  const { endsAt, level } = runningOrThrow(save, monster);
  const credits = timeCost(endsAt - now);
  const report: AcademyShinyReport = { monster, level: level + 1, credits };

  return { report, slices: trainedSlices(save, monster), shiny: credits };
};

/**
 * Trains `monster` one level at once for `timeCost(seconds) +
 * ceil(sqrt(putty / 2)^0.75)` Shiny and no putty (`ITR`,
 * `ACADEMYPOPUP.InstantMonsterUpgrade`, `:129-137`, `:365-424`). The original
 * offered it only where Start would pass bar the putty (`:173-221`), so the
 * `train` checks apply except putty; the academy is not taken.
 */
export const planAcademyInstant = (save: AcademySave, monster: string, academyId: number | undefined) => {
  const { level, step } = trainGate(save, monster, academyId);
  const credits = instantTrainPrice(step[1], step[0]);
  const report: AcademyShinyReport = { monster, level: level + 1, credits };

  return { report, slices: { academy: trainedAcademy(save.academy, monster) }, shiny: credits };
};
