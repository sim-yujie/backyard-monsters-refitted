import { GOALS, goalById, type GoalDef, type GoalReward } from "../../game-data/goals.js";
import { hatchCost, housingSpace, monsterEntry } from "../../game-data/monsterCatalogue.js";
import type { Save } from "../../database/models/save.model.js";
import { updateOnboarding, type Onboarding } from "../onboarding/state.js";
import { fitCredit } from "../yard/credit.js";
import { academyLevels, freeHousing, isMapRoom3Monsters } from "../yard/hatchery.js";
import { levelOf, readHoused } from "../yard/production.js";
import { yardBadRequestErr, yardRefusedErr } from "../yard/yardErrors.js";
import type { ResourceAmounts } from "../yardplanner/costs.js";
import {
  applyBaseline,
  goalMet,
  goalStatus,
  isClaimed,
  goalVisible,
  markDone,
  progressOf,
  type GoalProgress,
} from "./goalRules.js";

/**
 * The Goals routes' decisions (`docs/design/tutorial.md` §6.3, §8.3, issue
 * #227): `goals/state` and `goals/claim`. Pure plans the yard action wrapper
 * applies under the save row lock, so a claim's reward, its monsters and its
 * `claimed` mark land in one transaction, and a second claim of the same goal
 * finds it claimed (anti-cheat rules 2 and 7, §8.4).
 *
 * Both start the same way: the Goals baseline when the save still has one
 * pending (decision Q1: goals already met are marked claimed, no reward), and
 * sticky `done` for every goal met now.
 *
 * **Rewards are capped** at the storage cap (decision Q2): the claim pays
 * through the wrapper's ordinary `credit`, which clamps (`credit.ts`). What
 * did not fit is lost and the report says so. **Monster rewards wait for
 * room** (Q10): the claim is refused unless Housing takes all of them.
 * **Points** as Flash's `QUESTS.CollectB` gave them: `ceil(value / 50)`,
 * `value` the listed reward plus each monster's hatch cost
 * (`client/scripts/QUESTS.as:1784-1816`).
 */

/** One monster reward as the panel shows it. */
export interface GoalMonsters {
  id: string;
  name: string;
  count: number;
}

/** One goal as `goals/state` sends it. Hidden goals are not sent. */
export interface GoalView {
  id: string;
  order: number;
  name: string;
  description: string;
  reward: GoalReward;
  monsters?: GoalMonsters;
  status: "open" | "ready" | "claimed";
  /** Marked claimed by the baseline, without a reward. */
  baseline?: true;
  progress?: GoalProgress;
  /** For a ready goal with monsters: whether Housing has room for all of them now. */
  room?: boolean;
}

/** `report` of `goals/state`. */
export interface GoalsStateReport {
  goals: GoalView[];
}

/** `report` of `goals/claim`. */
export interface GoalClaimReport {
  id: string;
  /** What landed in storage, after the cap. */
  credited: ResourceAmounts;
  /** What the cap turned away. */
  overflow: ResourceAmounts;
  /** Monsters housed. */
  monsters?: { id: string; count: number };
  /** Empire points awarded. */
  points: number;
}

/** Brings the record up to date: the baseline if pending, then sticky `done`. */
const refreshed = (save: Save, now: number): { onboarding: Onboarding; changed: boolean } => {
  let changed = false;
  const onboarding = updateOnboarding(save, (record) => {
    changed = applyBaseline(save, record, now);
    changed = markDone(save, record, now) || changed;
  });
  return { onboarding, changed };
};

/** Housing space the goal's monsters take, at the player's academy levels; 0 without monsters. */
const spaceNeeded = (goal: GoalDef, levels: Readonly<Record<string, number>>): number => {
  if (!goal.monsters) return 0;
  const space = housingSpace(goal.monsters.id, levelOf(levels, goal.monsters.id)) ?? 0;
  return space * goal.monsters.count;
};

/** Whether Housing takes all of the goal's monsters now. */
const hasRoom = (save: Save, goal: GoalDef, now: number): boolean => {
  if (!goal.monsters) return true;
  const levels = academyLevels(save.academy);
  return freeHousing(save, readHoused(save.monsters), levels, now) >= spaceNeeded(goal, levels);
};

const monstersView = (goal: GoalDef): GoalMonsters | undefined =>
  goal.monsters && {
    ...goal.monsters,
    name: monsterEntry(goal.monsters.id)?.name ?? goal.monsters.id,
  };

/** Every shown goal, in order. */
export const goalViews = (save: Save, onboarding: Onboarding, now: number): GoalView[] => {
  const views: GoalView[] = [];
  for (const goal of GOALS) {
    const status = goalStatus(goal, save, onboarding);
    if (status === "hidden") continue;
    const monsters = monstersView(goal);
    const progress = progressOf(goal.condition, onboarding);
    views.push({
      id: goal.id,
      order: goal.order,
      name: goal.name,
      description: goal.description,
      reward: goal.reward,
      ...(monsters && { monsters }),
      status,
      ...(onboarding.goals[goal.id]?.claimed === "baseline" && { baseline: true as const }),
      ...(progress && status === "open" && { progress }),
      ...(monsters && status === "ready" && { room: hasRoom(save, goal, now) }),
    });
  }
  return views;
};

/**
 * `goals/state`: applies the baseline if pending, marks newly met goals done,
 * and returns every shown goal. Writes the record only when it changed.
 */
export const planGoalsState = (save: Save, now: number) => {
  const { onboarding, changed } = refreshed(save, now);
  const report: GoalsStateReport = { goals: goalViews(save, onboarding, now) };
  return { report, ...(changed && { slices: { onboarding } }) };
};

/**
 * `goals/claim`: pays one goal.
 *
 * Refusals: `400 unknownGoal`; `409 goalHidden` (prereq not claimed, or a Map
 * Room 1 goal on Map Room 2); `409 alreadyClaimed` (the baseline's included);
 * `409 notMet`; `409 mapRoom3` for monsters on a Map Room 3 yard;
 * `409 housing { monster, count, need, free }` when Housing cannot take
 * every monster.
 */
export const planGoalClaim = (save: Save, id: string, now: number) => {
  const goal = goalById(id);
  if (!goal) throw yardBadRequestErr("There is no such goal.", { id }, "unknownGoal");

  const { onboarding } = refreshed(save, now);
  if (isClaimed(onboarding, goal.id)) {
    throw yardRefusedErr("alreadyClaimed", "That goal's reward has already been collected.", { id });
  }
  if (!goalVisible(goal, save, onboarding)) {
    throw yardRefusedErr("goalHidden", "That goal is not open to you yet.", { id });
  }
  if (!goalMet(goal, save, onboarding)) {
    throw yardRefusedErr("notMet", "That goal is not finished yet.", { id });
  }

  const levels = academyLevels(save.academy);
  let monsters: Save["monsters"] | undefined;
  let value = goal.reward.r1 + goal.reward.r2 + goal.reward.r3 + goal.reward.r4;
  if (goal.monsters) {
    if (isMapRoom3Monsters(save.monsters)) {
      throw yardRefusedErr("mapRoom3", "Monster rewards on a Map Room 3 yard are not supported yet.");
    }
    const housed = readHoused(save.monsters);
    const need = spaceNeeded(goal, levels);
    const free = freeHousing(save, housed, levels, now);
    if (free < need) {
      throw yardRefusedErr("housing", "Make room in Housing for this goal's monsters first.", {
        monster: goal.monsters.id,
        count: goal.monsters.count,
        need,
        free: Math.max(0, free),
      });
    }
    const { id: monster, count } = goal.monsters;
    housed[monster] = (housed[monster] ?? 0) + count;
    monsters = { ...(save.monsters ?? {}), housed };
    value += (hatchCost(monster, levelOf(levels, monster)) ?? 0) * count;
  }

  onboarding.goals[goal.id] = { ...onboarding.goals[goal.id], claimed: now };
  const credit: ResourceAmounts = { ...goal.reward };
  const fit = fitCredit(save, credit);
  const points = Math.ceil(value / 50);
  const report: GoalClaimReport = {
    id: goal.id,
    credited: fit.credited,
    overflow: fit.overflow,
    ...(goal.monsters && { monsters: { id: goal.monsters.id, count: goal.monsters.count } }),
    points,
  };
  return {
    report,
    slices: { onboarding, ...(monsters && { monsters }) },
    credit,
    points,
  };
};
