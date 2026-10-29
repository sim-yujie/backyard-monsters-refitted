import type { FriendRefusal } from "../../errors/errors.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { noAmounts, RESOURCE_KEYS } from "../base/economy/resourceBudget.js";
import { catchUpBuildings } from "../yard/catchUpBuildings.js";
import { catchUpRepairs } from "../yard/catchUpRepairs.js";
import { damageOf, healed } from "../yard/repair.js";
import type { ResourceAmounts } from "../yardplanner/costs.js";
import { blockedIdsOf } from "./friendRules.js";
import { helpersOf } from "./helpList.js";
import { isTrap } from "../../game-rules/combat/damagePercent.js";
import { FRIEND_GATES, HELP_RULES } from "./helpConfig.js";

/**
 * The help rules (`docs/design/friends.md` §4 and §7, issue #373), pure: who
 * may help whom, what one speed-up or repair does to a building, and the
 * helper's reward. The route (`controllers/friends/help.ts`) applies them to
 * the locked, caught-up saves; the help-mode load and the friends list ask
 * them which buildings could be helped. Nothing here reads the database or
 * the clock, and nothing trusts a number the client sent.
 */

/** The two kinds of help. */
export type HelpKind = "speedup" | "repair";

/** The countdowns a speed-up shortens, in the order Flash's `HelpB` tries them. */
const HELP_COUNTDOWNS = ["cB", "cU", "cF"] as const;
export type HelpCountdown = (typeof HELP_COUNTDOWNS)[number];

/** Which `tooNew` gate holds: the friendship's age, an account's age, or a level. */
export type GateRule = "friendship" | "account" | "level";

/** A refusal and, when known, the unix second it lifts and the gate that holds it. */
export interface HelpRefusal {
  reason: FriendRefusal;
  from?: number;
  rule?: GateRule;
}

/** A refusal's details beside its `reason`, as the routes send them: `from` and `rule` when known. */
export const refusalDetails = (refusal: HelpRefusal): { from?: number; rule?: GateRule } => ({
  ...(refusal.from !== undefined && { from: refusal.from }),
  ...(refusal.rule !== undefined && { rule: refusal.rule }),
});

/** What the gates read about one side of a help. */
export interface HelpSide {
  userid: number;
  banned: boolean;
  blocked_users: unknown;
  /** The main save's `createtime`, unix seconds: the account's age. */
  createtime: number;
  points: string | null;
  basevalue: string | null;
}

/** What the gates read: both sides and the friendship. */
export interface HelpFacts {
  helper: HelpSide;
  owner: HelpSide;
  /** Friends since, unix seconds; null when they are not friends. */
  friendsSince: number | null;
  /** Helps the helper has given today (UTC). */
  helpsToday: number;
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const levelOf = (side: HelpSide): number => calculateBaseLevel(side.points ?? "0", side.basevalue ?? "0");

/**
 * Why the helper may not help the owner at all today, or null when they may
 * (§4 "Who may help", §7 rules 1, 2 and 8). In this order: not friends; a
 * block either way or either account banned (the neutral `cannotSend`); the
 * age and level gates (`tooNew`, with `rule` naming the gate that holds and
 * `from` when time alone will lift it: the later of the friendship and
 * account ages, named after whichever lifts last); the daily cap.
 */
export const gateRefusal = (facts: HelpFacts, now: number): HelpRefusal | null => {
  const { helper, owner } = facts;
  if (facts.friendsSince === null) return { reason: "notFriends" };
  if (
    helper.banned ||
    owner.banned ||
    blockedIdsOf(helper.blocked_users).includes(owner.userid) ||
    blockedIdsOf(owner.blocked_users).includes(helper.userid)
  ) {
    return { reason: "cannotSend" };
  }

  const friendshipClears = facts.friendsSince + FRIEND_GATES.friendshipAgeHours * HOUR;
  const accountClears = Math.max(Number(helper.createtime), Number(owner.createtime)) + FRIEND_GATES.accountAgeDays * DAY;
  const levelsOk = levelOf(helper) >= FRIEND_GATES.minLevel && levelOf(owner) >= FRIEND_GATES.minLevel;
  if (!levelsOk) return { reason: "tooNew", rule: "level" };
  if (accountClears > now && accountClears >= friendshipClears) return { reason: "tooNew", from: accountClears, rule: "account" };
  if (friendshipClears > now) return { reason: "tooNew", from: friendshipClears, rule: "friendship" };

  if (facts.helpsToday >= HELP_RULES.dailyHelps) return { reason: "dailyCap" };
  return null;
};

/** Helps left today. */
export const helpsLeftOf = (helpsToday: number): number => Math.max(0, HELP_RULES.dailyHelps - helpsToday);

/** The countdown a speed-up would shorten, or null when none is running. */
export const helpCountdown = (building: BuildingData): HelpCountdown | null =>
  HELP_COUNTDOWNS.find((field) => Number(building[field]) > 0) ?? null;

/** What one speed-up does to a building. */
export interface SpeedupPlan {
  field: HelpCountdown;
  /** Seconds taken off: `floor(5%)` of the time left. */
  seconds: number;
  /** The building with the shorter countdown and the helper added to `hl`. */
  building: BuildingData;
}

/**
 * One speed-up by `helper` on a caught-up building (`BFOUNDATION.Help` and
 * `HelpB`, `client/scripts/BFOUNDATION.as:2337-2399`): `floor(5%)` of the time
 * left on the build, upgrade or fortify countdown, at most five helpers per
 * job, each once. A countdown too short for 5% to be a whole second has
 * nothing to help with.
 */
export const planSpeedup = (building: BuildingData, helper: number): SpeedupPlan | HelpRefusal => {
  const field = helpCountdown(building);
  if (!field) return { reason: "nothingToHelp" };
  const helpers = helpersOf(building);
  if (helpers.includes(helper)) return { reason: "alreadyHelped" };
  if (helpers.length >= HELP_RULES.helpersPerJob) return { reason: "helpersFull" };

  const left = Number(building[field]);
  const seconds = Math.floor(left * HELP_RULES.speedupShare);
  if (seconds < 1) return { reason: "nothingToHelp" };
  return { field, seconds, building: { ...building, [field]: left - seconds, hl: [...helpers, helper] } };
};

/** The slice of a save a repair reads. */
export interface HelpRepairSave {
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}

/** What one repair does to a yard. */
export interface RepairPlan {
  buildingdata: BuildingDataMap;
  buildinghealthdata: BuildingHealthData;
}

/**
 * One repair on a caught-up yard (Q4): the building back to full health at
 * once, `rE` cleared, as a one-building "Repair now" with no Shiny. A healthy
 * building has nothing to help with, so it is once per damage.
 */
export const planRepair = (save: HelpRepairSave, key: string): RepairPlan | HelpRefusal => {
  const building = save.buildingdata?.[key];
  const damage = building ? damageOf(save, key, building) : null;
  if (!building || !damage) return { reason: "nothingToHelp" };
  const buildinghealthdata = { ...(save.buildinghealthdata ?? {}) };
  delete buildinghealthdata[String(damage.id)];
  return { buildingdata: { ...save.buildingdata, [key]: healed(building) }, buildinghealthdata };
};

/** Whether a plan was refused. */
export const isRefusal = (plan: object): plan is HelpRefusal => "reason" in plan;

/**
 * The helper's reward for one help (Q3): 0.25% of the lower of the two
 * storage caps, rounded down, in each of the four resources. The route
 * credits it through the storage-cap clamp, so the helper never goes over
 * their own cap.
 */
export const rewardOf = (helperCap: number, ownerCap: number): ResourceAmounts => {
  const each = Math.max(0, Math.floor(Math.min(helperCap, ownerCap) * HELP_RULES.rewardShare));
  const reward = noAmounts();
  for (const key of RESOURCE_KEYS) reward[key] = each;
  return reward;
};

/** What each building could take, `true` or the reason it could not. */
export type BuildingHelp = Record<string, { speedup?: true | FriendRefusal; repair?: true | FriendRefusal }>;

/** The slice of the owner's save the preview reads. */
export interface HelpPreviewSave extends HelpRepairSave {
  savetime?: number;
}

/**
 * Which buildings in the owner's main yard the helper could speed up or
 * repair now, for the help-mode load and the friends list. The yard is caught
 * up on a copy (repairs, then building countdowns), so a job that ended since
 * the owner's last save is not offered. A building with nothing to help is
 * left out; `gate` (from {@link gateRefusal}) stands in for every answer when
 * the helper may not help at all.
 */
export const previewHelp = (save: HelpPreviewSave, helper: number, now: number, gate: HelpRefusal | null): BuildingHelp => {
  const copy = { type: save.type, buildingdata: save.buildingdata ?? {}, buildinghealthdata: save.buildinghealthdata ?? {} };
  const from = Math.min(Number(save.savetime ?? now) || now, now);
  catchUpRepairs(copy, from, now);
  catchUpBuildings(copy, from, now);

  const out: BuildingHelp = {};
  for (const [key, building] of Object.entries(copy.buildingdata ?? {})) {
    // Traps are never shown to a visitor (`viewMask.ts`): none is offered.
    if (!building || isTrap(Number(building.t))) continue;
    const entry: BuildingHelp[string] = {};
    if (helpCountdown(building)) {
      const plan = planSpeedup(building, helper);
      entry.speedup = gate ? gate.reason : isRefusal(plan) ? plan.reason : true;
    }
    if (damageOf(copy, key, building)) entry.repair = gate ? gate.reason : true;
    if (entry.speedup !== undefined || entry.repair !== undefined) out[String(building.id ?? key)] = entry;
  }
  return out;
};
