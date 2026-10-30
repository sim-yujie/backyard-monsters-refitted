import { infernoConfig } from "../../config/InfernoConfig.js";
import { GOALS, goalById, type GoalCondition, type GoalDef } from "../../game-data/goals.js";
import { INFERNO_GOALS, infernoGoalById } from "../../game-data/infernoGoals.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { GoalRecord, Onboarding } from "../onboarding/state.js";
import { readLayouts } from "../yardplanner/layoutStorage.js";
import { levelOf } from "../yardplanner/costs.js";
import { siegeStock } from "../yard/siege.js";

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
 *
 * **Two books** ({@link GoalBook}): the surface's Goals, and the Inferno's
 * quests (`docs/design/inferno.md` WP 4.1), read against the Inferno yard as
 * its yard actions see it (`infernoView`): its own buildings and Strongbox,
 * with the records and counters on the main save's `onboarding`.
 */

/** The parts of a main save (or of the Inferno yard's view) the rules read. */
export interface GoalSave {
  /** `inferno` on the Inferno yard, whose book is the Inferno quests. */
  type?: string | null;
  buildingdata?: BuildingDataMap | null;
  lockerdata?: JsonObject | null;
  champion?: unknown;
  savetemplate?: unknown[] | null;
  mapversion?: number | null;
  /** The siege weapons, `{ [id]: { level, quantity } }`, written only by the siege routes. */
  siege?: JsonObject | null;
}

/** How far along a counting goal is: "3 / 5". */
export interface GoalProgress {
  have: number;
  need: number;
}

/** Where a goal stands for one player. */
export type GoalStatus =
  /** Not shown: its prereq is not claimed, a Map Room 1 goal on Map Room 2, or an Inferno goal with the Inferno off. */
  | "hidden"
  /** Shown, not met yet. */
  | "open"
  /** Met (now or once) and not claimed. */
  | "ready"
  /** Paid, or marked claimed by the baseline. */
  | "claimed";

/** One list of goals and where its records live in `onboarding`. */
export interface GoalBook {
  readonly goals: readonly GoalDef[];
  readonly byId: (id: string) => GoalDef | undefined;
  /** `onboarding.goals` or `onboarding.infernoGoals`: the record itself, to read or write. */
  readonly records: (onboarding: Onboarding) => Record<string, GoalRecord>;
  /**
   * The surface's Goals: prereqs, Map Room 1 goals and the Inferno switch hide
   * goals, and the Goals baseline applies. The Inferno's quests are never
   * hidden: Flash's Quests window listed every quest not claimed
   * (`QUESTSPOPUP.as:174-183`), and there was no baseline.
   */
  readonly surface: boolean;
}

/** The surface's Goals (issue #227). */
export const SURFACE_GOALS: GoalBook = {
  goals: GOALS,
  byId: goalById,
  records: (onboarding) => onboarding.goals,
  surface: true,
};

/** The Inferno's 38 quests (WP 4.1). */
export const INFERNO_QUESTS: GoalBook = {
  goals: INFERNO_GOALS,
  byId: infernoGoalById,
  records: (onboarding) => onboarding.infernoGoals,
  surface: false,
};

/** The Inferno quests on the Inferno yard, the Goals on the main yard and an outpost. */
export const goalBookOf = (save: GoalSave): GoalBook =>
  save.type === BaseType.INFERNO ? INFERNO_QUESTS : SURFACE_GOALS;

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
    // An egg (status 3) has not hatched yet (`services/yard/champion.ts`).
    if (Number(champion.status) === 3) continue;
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
    case "siegeLevel":
      return siegeStock(save.siege, condition.weapon).level >= condition.level;
  }
};

/** Whether the goal's reward has been paid, or marked claimed by the baseline. */
export const isClaimed = (onboarding: Onboarding, id: string, book: GoalBook = SURFACE_GOALS): boolean =>
  book.records(onboarding)[id]?.claimed !== undefined;

/** Met now, or seen met once (sticky). */
export const goalMet = (
  goal: GoalDef,
  save: GoalSave,
  onboarding: Onboarding,
  book: GoalBook = SURFACE_GOALS,
): boolean =>
  book.records(onboarding)[goal.id]?.done !== undefined || conditionMet(goal.condition, save, onboarding);

/** Map Room 1 goals hide on Map Room 2 and 3 (Q9). */
const onMapRoom1 = (save: GoalSave): boolean =>
  save.mapversion !== MapRoomVersion.V2 && save.mapversion !== MapRoomVersion.V3;

/**
 * Shown to this player: prereq claimed, not a Map Room 1 goal off Map Room 1,
 * and not an Inferno goal (SW4-SW12) while the new Inferno is off. An
 * Inferno quest is always shown.
 */
export const goalVisible = (
  goal: GoalDef,
  save: GoalSave,
  onboarding: Onboarding,
  book: GoalBook = SURFACE_GOALS,
): boolean =>
  !book.surface ||
  ((!goal.inferno || infernoConfig.enabled) &&
    (!goal.mapRoom1Only || onMapRoom1(save)) &&
    (goal.prereq === undefined || isClaimed(onboarding, goal.prereq, book)));

/**
 * One goal's status. A claimed goal stays "claimed" even if it would now be
 * hidden; everything else hidden is "hidden".
 */
export const goalStatus = (
  goal: GoalDef,
  save: GoalSave,
  onboarding: Onboarding,
  book: GoalBook = SURFACE_GOALS,
): GoalStatus => {
  if (isClaimed(onboarding, goal.id, book)) return "claimed";
  if (!goalVisible(goal, save, onboarding, book)) return "hidden";
  return goalMet(goal, save, onboarding, book) ? "ready" : "open";
};

/**
 * Goals ready to claim, for the badge. Pure. A save whose baseline is still
 * pending counts 0: the baseline will mark everything it meets now as
 * claimed without a reward, so nothing is ready until something new is met.
 * On the Inferno yard it counts the Inferno quests, which have no baseline.
 */
export const goalsReadyCount = (
  save: GoalSave,
  onboarding: Onboarding,
  book: GoalBook = goalBookOf(save),
): number => {
  if (book.surface && onboarding.goalsBaseline === "pending") return 0;
  return book.goals.filter((goal) => goalStatus(goal, save, onboarding, book) === "ready").length;
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
export const markDone = (
  save: GoalSave,
  onboarding: Onboarding,
  now: number,
  book: GoalBook = SURFACE_GOALS,
): boolean => {
  const records = book.records(onboarding);
  let changed = false;
  for (const goal of book.goals) {
    if (records[goal.id]?.done !== undefined) continue;
    if (!conditionMet(goal.condition, save, onboarding)) continue;
    records[goal.id] = { ...records[goal.id], done: now };
    changed = true;
  }
  return changed;
};
