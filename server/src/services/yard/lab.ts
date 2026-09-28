import { labAbility, labStep, type LabAbility, type PaidStep } from "../../game-data/monsterCatalogue.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { StorageCapSave } from "../base/economy/resourceBudget.js";
import { levelOf } from "../yardplanner/costs.js";
import { trainingLevel } from "./academy.js";
import { isDamaged } from "./buildingJobs.js";
import { fitCredit } from "./credit.js";
import { instantResearchPrice, timeCost } from "./shiny.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The Monster Lab's research: `POST /bm/yard/lab/start`, `/cancel`, `/finish`,
 * `/instant` (`docs/design/yard-buildings.md` §6 "Lab tab";
 * `docs/specs/monsters-and-hatchery.md` §4.2).
 *
 * The rules are `MONSTERLAB.CanPowerup` (`client/scripts/MONSTERLAB.as:269-313`)
 * with the prices from the lab table (`LAB_ABILITIES`, `MONSTERLAB.as:77-188`):
 * the monster is unlocked, not at rank 3, the next rank is at most the lab's
 * level, the monster's academy level is at least the rank + 1, then putty (the
 * wrapper's `409 shortfall`). So **rank N needs lab level N and monster level
 * N+1**. The Lab takes the research only when the original offered its Open
 * button (built, not upgrading or fortifying, not damaged;
 * `client/scripts/BUILDINGINFO.as:98-127`) and is not already researching:
 * one lab, one research at a time (`MONSTERLAB.as:315-325`).
 *
 * Storage is the original's (§6 "Storage"): the running research is on the
 * Lab's own building entry, `upg` (monster id), `upt` (absolute unix end) and
 * `upl` (the rank being bought) (`MONSTERLAB.as:432-460`); a finished rank is
 * `academy[id].powerup` (`:336`). Completion on the clock is the catch-up's
 * (`catchUpTraining.ts`, `catchUpResearch`).
 *
 * Everything here is pure: it reads the caught-up save the yard action wrapper
 * hands it and returns what should change, or throws the refusal. The wrapper
 * charges the putty and the Shiny, clamps the refund and writes.
 */

/** Monster Lab type id (`client/scripts/MONSTERLAB.as:34`). */
export const LAB_TYPE = 116;

/** The top rank of every ability: three cost entries (`MONSTERLAB.as:77-188`), and `powerup == 3` is "Fully Powered Up" (`:276-281`). */
export const MAX_RANK = 3;

/** The slice of a save the lab routes read. */
export interface LabSave extends StorageCapSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
  lockerdata?: JsonObject | null;
  academy?: JsonObject | null;
}

/** One `academy` entry as an object, `{}` when absent or unreadable. */
const entryOf = (academy: JsonObject | null | undefined, monster: string): JsonObject => {
  const entry = academy?.[monster];
  return entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as JsonObject) : {};
};

/** A monster's lab rank, 0..3; 0 when absent or unreadable. */
export const powerupRank = (academy: JsonObject | null | undefined, monster: string): number => {
  const rank = Math.floor(Number(entryOf(academy, monster).powerup));
  return Number.isFinite(rank) && rank > 0 ? Math.min(rank, MAX_RANK) : 0;
};

/** A research the Lab is running. */
export interface LabResearch {
  /** The monster, e.g. `C3`. */
  monster: string;
  /** The rank it reaches. */
  rank: number;
  /** When it ends, unix seconds. */
  endsAt: number;
}

/**
 * The research a Lab building holds, or null. It needs all three fields: an
 * `upg` with no finish time is stale (the original dropped it on a click,
 * `MONSTERLAB.Click`, `:191-196`), and an `upg` naming a monster with no
 * ability or a rank outside 1..3 is unreadable.
 */
export const labResearch = (building: BuildingData | null | undefined): LabResearch | null => {
  const monster = building?.["upg"];
  const endsAt = Number(building?.["upt"]);
  const rank = Number(building?.["upl"]);
  if (typeof monster !== "string" || !labAbility(monster)) return null;
  if (!Number.isFinite(endsAt) || endsAt <= 0) return null;
  if (!Number.isInteger(rank) || rank < 1 || rank > MAX_RANK) return null;
  return { monster, rank, endsAt };
};

/** The Lab building with its research fields removed. */
export const withoutResearch = (building: BuildingData): BuildingData => {
  const { upg: _upg, upt: _upt, upl: _upl, ...rest } = building;
  return rest as BuildingData;
};

/** Whether a building entry carries any research field. */
export const hasResearchFields = (building: BuildingData): boolean =>
  building["upg"] !== undefined || building["upt"] !== undefined || building["upl"] !== undefined;

/**
 * `academy` with `monster` at `rank` (`MONSTERLAB.FinishMonsterPowerup`, `:336`),
 * never lowered: a rank the monster already has stays.
 */
export const researchedAcademy = (
  academy: JsonObject | null | undefined,
  monster: string,
  rank: number
): JsonObject => {
  const entry = entryOf(academy, monster);
  const powerup = Math.min(Math.max(powerupRank(academy, monster), rank), MAX_RANK);
  return { ...(academy ?? {}), [monster]: { ...entry, powerup } };
};

/** One Monster Lab in the yard. */
export interface LabBuilding {
  id: number;
  building: BuildingData;
  /** Its level; 0 while it is still being built. */
  level: number;
}

/**
 * The yard's Monster Lab: the one researching when there is one, else the
 * first by building id. The original allows one lab (MH §4.2 "How many"); a
 * save holding two is read as the first.
 */
export const labOf = (buildingdata: BuildingDataMap | null | undefined): LabBuilding | null => {
  const labs = Object.entries(buildingdata ?? {})
    .filter(([, building]) => Number(building?.t) === LAB_TYPE)
    .map(([key, building]) => ({ id: Number(building.id ?? key), building, level: levelOf(building) }))
    .filter((lab) => Number.isFinite(lab.id))
    .sort((a, b) => a.id - b.id);
  return labs.find((lab) => labResearch(lab.building) !== null) ?? labs[0] ?? null;
};

/**
 * The lab ability of a monster a player may research, or `400 badRequest`:
 * not one of the ten with an ability (the nine others and every Inferno
 * monster have none, MH §4.2).
 */
export const researchableOrThrow = (monster: string): LabAbility => {
  const ability = /^C\d+$/.test(monster) ? labAbility(monster) : undefined;
  if (!ability) throw yardBadRequestErr("That monster has no Lab ability.", { monster });
  return ability;
};

/** The finished Lab, or `409 noLab`. */
const builtLabOrThrow = (save: LabSave): LabBuilding => {
  const lab = labOf(save.buildingdata);
  if (!lab) throw yardRefusedErr("noLab", "Build a Monster Lab first.");
  return lab;
};

/**
 * The checks `start` and `instant` share, in the original's order, and the
 * lab and step they would use.
 *
 * `400 badRequest` no ability; `409 noLab`; the Lab's own state — `409 busy
 * {id}` being built, upgraded or fortified, `409 damaged {id}`, `409 labBusy
 * {id, monster}` already researching (the popup then offers only Speed Up and
 * Cancel, `MONSTERLABPOPUP.as:262-279`); then `CanPowerup` (`:269-313`) —
 * `409 locked {monster}` not unlocked, `409 maxRank {monster, rank}`,
 * `409 labLevel {have, need}`, `409 monsterLevel {monster, have, need}`.
 * Putty is the wrapper's (start only).
 */
export const researchGate = (
  save: LabSave,
  monster: string
): { lab: LabBuilding; rank: number; step: PaidStep } => {
  researchableOrThrow(monster);
  const lab = builtLabOrThrow(save);
  const { id, building } = lab;

  if (lab.level < 1 || Number(building.cU) > 0 || Number(building.cF) > 0) {
    throw yardRefusedErr("busy", "The Monster Lab is being built or upgraded.", { id });
  }
  if (isDamaged(building, save.buildinghealthdata)) {
    throw yardRefusedErr("damaged", "Repair the Monster Lab first.", { id });
  }
  const running = labResearch(building);
  if (running) {
    throw yardRefusedErr("labBusy", "The Monster Lab is already researching.", {
      id,
      monster: running.monster,
    });
  }

  if (Number((save.lockerdata?.[monster] as JsonObject | undefined)?.t) !== 2) {
    throw yardRefusedErr("locked", "Unlock that monster in the Monster Locker first.", { monster });
  }
  const current = powerupRank(save.academy, monster);
  if (current >= MAX_RANK) {
    throw yardRefusedErr("maxRank", "That ability is fully researched.", { monster, rank: current });
  }
  const rank = current + 1;
  if (rank > lab.level) {
    throw yardRefusedErr("labLevel", `Needs Monster Lab level ${rank}.`, { have: lab.level, need: rank });
  }
  const level = trainingLevel(save.academy, monster);
  if (level < rank + 1) {
    throw yardRefusedErr("monsterLevel", `Needs that monster at level ${rank + 1}.`, {
      monster,
      have: level,
      need: rank + 1,
    });
  }
  return { lab, rank, step: labStep(monster, rank)! };
};

/** The running research, or `409 noLab` / `409 notResearching`. */
const runningOrThrow = (save: LabSave): { lab: LabBuilding; research: LabResearch } => {
  const lab = builtLabOrThrow(save);
  const research = labResearch(lab.building);
  if (!research) throw yardRefusedErr("notResearching", "The Monster Lab is not researching.");
  return { lab, research };
};

/** `buildingdata` with the Lab's research fields removed. */
const clearedLab = (save: LabSave, lab: LabBuilding): BuildingDataMap => ({
  ...(save.buildingdata ?? {}),
  [String(lab.id)]: withoutResearch(lab.building),
});

/** `report` of `POST /bm/yard/lab/start`. */
export interface LabStartReport {
  monster: string;
  /** The rank the research reaches. */
  rank: number;
  /** The Lab doing it. */
  lab: number;
  /** When it ends, unix seconds. */
  endsAt: number;
  /** Putty charged. */
  cost: { r3: number };
}

/** `report` of `POST /bm/yard/lab/cancel`. */
export interface LabCancelReport {
  monster: string;
  /** The rank that was being researched. */
  rank: number;
  /** Putty actually returned, after the storage cap. */
  refund: { r3: number };
}

/** `report` of `POST /bm/yard/lab/finish` and `/instant`. */
export interface LabShinyReport {
  monster: string;
  /** The rank it has now. */
  rank: number;
  /** Shiny charged. */
  credits: number;
}

/**
 * Starts researching `monster`'s next rank: the rank's full putty price now,
 * and the Lab's `upg = monster`, `upt = now + seconds`, `upl = rank`
 * (`MONSTERLAB.StartMonsterPowerup`, `:315-325`).
 */
export const planLabStart = (save: LabSave, monster: string, now: number) => {
  const { lab, rank, step } = researchGate(save, monster);
  const [putty, seconds] = step;
  const endsAt = now + seconds;
  const report: LabStartReport = { monster, rank, lab: lab.id, endsAt, cost: { r3: putty } };

  return {
    report,
    slices: {
      buildingdata: {
        ...(save.buildingdata ?? {}),
        [String(lab.id)]: { ...lab.building, upg: monster, upt: endsAt, upl: rank },
      },
    },
    debit: { r3: putty },
  };
};

/**
 * Cancels the running research: the Lab's fields go and the rank's full putty
 * price comes back, clamped to the storage cap (`MONSTERLAB.CancelMonsterPowerupB`,
 * `:379-388`). Progress is lost.
 */
export const planLabCancel = (save: LabSave) => {
  const { lab, research } = runningOrThrow(save);
  const refund = labStep(research.monster, research.rank)?.[0] ?? 0;
  // What the wrapper's clamp will let through (`credit.ts`, T3), for the report.
  const report: LabCancelReport = {
    monster: research.monster,
    rank: research.rank,
    refund: { r3: fitCredit(save, { r3: refund }).credited.r3 },
  };

  return { report, slices: { buildingdata: clearedLab(save, lab) }, credit: { r3: refund } };
};

/**
 * Finishes the running research now for `timeCost(upt − now)` Shiny, free at
 * five minutes or less: the Lab's Speed Up is the generic `SP4` priced from
 * the lab's finish time (`MONSTERLABPOPUP.as:429-432`, `STORE.as:377-378`).
 */
export const planLabFinish = (save: LabSave, now: number) => {
  const { lab, research } = runningOrThrow(save);
  const credits = timeCost(research.endsAt - now);
  const report: LabShinyReport = { monster: research.monster, rank: research.rank, credits };

  return {
    report,
    slices: {
      academy: researchedAcademy(save.academy, research.monster, research.rank),
      buildingdata: clearedLab(save, lab),
    },
    shiny: credits,
  };
};

/**
 * Researches `monster`'s next rank at once for `timeCost(seconds, false) +
 * ceil(sqrt(putty / 2)^0.75)` Shiny and no putty (`IPU`,
 * `MONSTERLAB.InstantMonsterPowerup`, `:390-431`). The original offered it
 * only where Start would pass bar the putty and the Lab was idle
 * (`MONSTERLABPOPUP.as:262-323`), so `start`'s checks apply except putty; the
 * Lab is not taken.
 */
export const planLabInstant = (save: LabSave, monster: string) => {
  const { rank, step } = researchGate(save, monster);
  const credits = instantResearchPrice(step[1], step[0]);
  const report: LabShinyReport = { monster, rank, credits };

  return { report, slices: { academy: researchedAcademy(save.academy, monster, rank) }, shiny: credits };
};
