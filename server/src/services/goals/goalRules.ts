import { GOALS, type GoalCondition, type GoalDef } from "../../game-data/goals.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { Onboarding } from "../onboarding/state.js";
import { readLayouts } from "../yardplanner/layoutStorage.js";
import { levelOf } from "../yardplanner/costs.js";

/**
 * Whether each goal is met, shown and claimable (`docs/design/tutorial.md`
 * §6.2, issue #227): pure functions of the main save and its `onboarding`
 * record, so the badge (`summary.ts`), `goals/state` and `goals/claim` all
 * read a goal the same way.
 *
 * Everything is read from data only the server writes: buildings, the
 * Monster Locker, champions and layouts from the save's own columns (each
 * written by a yard or planner route), and the rest from `onboarding`'s
 * counters, which only server events move. `save.stats`, which `/base/save`
 * lets a client write, is never read.
 *
 * **Done is sticky.** A goal whose condition was once seen met keeps
 * `goals[id].done`, so recycling a building does not take a finished goal
 * back, as Flash's `_global` stats only ever went up.
 */

/** The parts of a main save the rules read. */
export interface GoalSave {
  buildingdata?: BuildingDataMap | null;
  lockerdata?: JsonObject | null;
  champion?: unknown;
  savetemplate?: unknown[] | null;
  mapversion?: number | null;
}

/** How far along a counting goal is: "3 / 5". */
export interface GoalProgress {
  have: number;
  need: number;
}

/** Where a goal stands for one player. */
export type GoalStatus =
  /** Not shown: its prereq is not claimed, or it is a Map Room 1 goal on Map Room 2. */
  | "hidden"
  /** Shown, not met yet. */
  | "open"
  /** Met (now or once) and not claimed. */
  | "ready"
  /** Paid, or marked claimed by the baseline. */
  | "claimed";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The highest finished level of any building of `type` (any type when undefined); 0 for none. */
const bestLevel = (buildingdata: BuildingDataMap | null | undefined, type?: number): number => {
  let best = 0;
  for (const building of Object.values(buildingdata ?? {})) {
    if (!building || (type !== undefined && Number(building.t) !== type)) continue;
    best = Math.max(best, levelOf(building));
  }
  return best;
};

/** The highest level of a champion of save type `type`; 0 when none was ever hatched. */
const championLevel = (champions: unknown, type: number): number => {
  if (!Array.isArray(champions)) return 0;
  let best = 0;
  for (const champion of champions) {
    if (!isRecord(champion) || Math.trunc(Number(champion.t)) !== type) continue;
    const level = Math.trunc(Number(champion.l));
    best = Math.max(best, Number.isFinite(level) && level > 0 ? level : 1);
  }
  return best;
};

/** A counting condition's figures, or undefined for a yes/no one. */
export const progressOf = (
  condition: GoalCondition,
  onboarding: Onboarding,
): GoalProgress | undefined => {
  switch (condition.kind) {
    case "counter":
      return { have: onboarding.counters[condition.counter], need: condition.target };
    default:
      return undefined;
  }
};

/** Whether the condition holds now, read from the save and the counters. */
export const conditionMet = (
  condition: GoalCondition,
  save: GoalSave,
  onboarding: Onboarding,
): boolean => {
  switch (condition.kind) {
    case "building":
      return bestLevel(save.buildingdata, condition.type) >= condition.level;
    case "anyBuilding":
      return bestLevel(save.buildingdata) >= condition.level;
    case "buildings":
      return condition.types.every((type) => bestLevel(save.buildingdata, type) >= condition.level);
    case "unlocked": {
      const entry = save.lockerdata?.[condition.monster];
      return isRecord(entry) && Number(entry.t) === 2;
    }
    case "champion":
      return championLevel(save.champion, condition.type) >= condition.level;
    case "counter":
      return onboarding.counters[condition.counter] >= condition.target;
    case "tribe":
      return onboarding.counters.tribes[condition.tribe] >= 1;
    case "raid":
      return onboarding.raidSeen !== undefined;
    case "layout":
      return readLayouts(save.savetemplate).length > 0;
  }
};

/** Whether the goal's reward has been paid, or marked claimed by the baseline. */
export const isClaimed = (onboarding: Onboarding, id: string): boolean =>
  onboarding.goals[id]?.claimed !== undefined;

/** Met now, or seen met once (sticky). */
export const goalMet = (goal: GoalDef, save: GoalSave, onboarding: Onboarding): boolean =>
  onboarding.goals[goal.id]?.done !== undefined || conditionMet(goal.condition, save, onboarding);

/** Map Room 1 goals hide on Map Room 2 and 3 (Q9). */
const onMapRoom1 = (save: GoalSave): boolean =>
  save.mapversion !== MapRoomVersion.V2 && save.mapversion !== MapRoomVersion.V3;

/** Shown to this player: prereq claimed, and not a Map Room 1 goal off Map Room 1. */
export const goalVisible = (goal: GoalDef, save: GoalSave, onboarding: Onboarding): boolean =>
  (!goal.mapRoom1Only || onMapRoom1(save)) &&
  (goal.prereq === undefined || isClaimed(onboarding, goal.prereq));

/**
 * One goal's status. A claimed goal stays "claimed" even if it would now be
 * hidden; everything else hidden is "hidden".
 */
export const goalStatus = (goal: GoalDef, save: GoalSave, onboarding: Onboarding): GoalStatus => {
  if (isClaimed(onboarding, goal.id)) return "claimed";
  if (!goalVisible(goal, save, onboarding)) return "hidden";
  return goalMet(goal, save, onboarding) ? "ready" : "open";
};

/**
 * Goals ready to claim, for the badge. Pure. A save whose baseline is still
 * pending counts 0: the baseline will mark everything it meets now as
 * claimed without a reward, so nothing is ready until something new is met.
 */
export const goalsReadyCount = (save: GoalSave, onboarding: Onboarding): number => {
  if (onboarding.goalsBaseline === "pending") return 0;
  return GOALS.filter((goal) => goalStatus(goal, save, onboarding) === "ready").length;
};

/**
 * The Goals baseline (decision Q1 of 2026-10-01): on a save from before
 * Goals, every goal it already meets is marked `claimed: "baseline"` (no
 * reward), and `goalsBaseline` becomes the time. Mutates `onboarding`.
 *
 * @returns Whether anything changed.
 */
export const applyBaseline = (save: GoalSave, onboarding: Onboarding, now: number): boolean => {
  if (onboarding.goalsBaseline !== "pending") return false;
  for (const goal of GOALS) {
    if (isClaimed(onboarding, goal.id) || !goalMet(goal, save, onboarding)) continue;
    const record = onboarding.goals[goal.id] ?? {};
    onboarding.goals[goal.id] = { ...record, done: record.done ?? now, claimed: "baseline" };
  }
  onboarding.goalsBaseline = now;
  return true;
};

/**
 * Writes `done` for every goal whose condition is met now and that has none
 * yet (sticky done, §6.2). Mutates `onboarding`.
 *
 * @returns Whether anything changed.
 */
export const markDone = (save: GoalSave, onboarding: Onboarding, now: number): boolean => {
  let changed = false;
  for (const goal of GOALS) {
    if (onboarding.goals[goal.id]?.done !== undefined) continue;
    if (!conditionMet(goal.condition, save, onboarding)) continue;
    onboarding.goals[goal.id] = { ...onboarding.goals[goal.id], done: now };
    changed = true;
  }
  return changed;
};
