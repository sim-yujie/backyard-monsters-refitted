import type { EntityManager } from "@mikro-orm/core";
import { achievementConfig } from "../../config/AchievementConfig.js";
import {
  AVAILABLE_ACHIEVEMENTS,
  type AchievementDef,
  type AchievementRule,
  type AchievementStat,
} from "../../game-data/achievements.js";
import { evaluateAchievements } from "./evaluate.js";
import { readView, unseenAchievements, type UnlockView, type ViewSave } from "./record.js";
import {
  needsBackfill,
  readAchievements,
  type Achievements,
  type AchievementsSave,
  type AchievementStats,
  type UnlockRecord,
} from "./state.js";

/**
 * What the achievements routes answer (`docs/design/achievements.md` §9.1,
 * §9.2, issue #204, WP4): the player's own list with progress and Shiny, and
 * the public list another player sees, earned or not and when, nothing more.
 *
 * Only the catalogue's available entries are listed or counted (§5.3). An
 * unlock still owed (`unpaid`, `config/AchievementConfig.ts`) is not earned
 * while rewards are off: nothing is shown before the player can be paid and
 * told. With rewards on, the next evaluation pays it.
 */

/** Names for the parts of an entry with several rules: entries 4 and 5, one per champion. */
const PART_LABELS: Partial<Record<AchievementStat, string>> = {
  upgrade_champ1: "Gorgo",
  upgrade_champ2: "Drull",
  upgrade_champ3: "Fomor",
};

/** One part of an entry with several rules. */
export interface ProgressPart {
  label: string;
  value: number;
  target: number;
}

/**
 * How far along an entry is: `value` of `target`, `value` capped at `target`
 * ("Town Hall 4 / 5"). An entry with several rules counts the parts met
 * (entry 5: 2 of 3 champions; entry 4, where one is enough, 0 or 1 of 1) and
 * lists them in `parts`.
 */
export interface AchievementProgress {
  value: number;
  target: number;
  parts?: ProgressPart[];
}

/** One entry of the player's own list. */
export interface AchievementEntryView {
  id: number;
  name: string;
  description: string;
  shiny: number;
  status: "locked" | "earned";
  /** Unix seconds it unlocked; earned only. */
  at?: number;
  progress: AchievementProgress;
}

/** `POST /bm/yard/achievements/state`'s report. */
export interface AchievementsState {
  /** Every available entry, in Flash's order. */
  achievements: AchievementEntryView[];
  earned: number;
  total: number;
  /** The Shiny the earned entries paid. */
  shinyEarned: number;
  /** Paid unlocks the client has not shown yet, oldest first (§9.3). */
  fresh: UnlockView[];
}

/** One entry of the public list: no progress, no Shiny (§9.2). */
export interface PublicAchievementView {
  id: number;
  name: string;
  description: string;
  status: "locked" | "earned";
  at?: number;
}

/** The public list, before the route adds the player's id and name. */
export interface PublicAchievements {
  earned: number;
  total: number;
  achievements: PublicAchievementView[];
}

/** Entry `id`'s unlock if it counts as earned: recorded, and paid unless rewards are on (§13 as built). */
const earnedUnlock = (record: Achievements, id: number, rewards: boolean): UnlockRecord | undefined => {
  const unlock = record.c[String(id)];
  return unlock && (rewards || !unlock.unpaid) ? unlock : undefined;
};

const capped = (stats: AchievementStats, rule: AchievementRule): number => Math.min(stats[rule.stat], rule.target);

/**
 * An entry's progress from the record's stats. An earned entry reads full,
 * whatever its stats say.
 */
export const progressOf = (entry: AchievementDef, stats: AchievementStats, earned: boolean): AchievementProgress => {
  if (entry.rules.length === 1) {
    const rule = entry.rules[0]!;
    return { value: earned ? rule.target : capped(stats, rule), target: rule.target };
  }
  const parts = entry.rules.map((rule) => ({
    label: PART_LABELS[rule.stat] ?? rule.stat,
    value: capped(stats, rule),
    target: rule.target,
  }));
  const target = entry.mode === "any" ? 1 : parts.length;
  const met = parts.filter((part) => part.value >= part.target).length;
  return { value: earned ? target : Math.min(met, target), target, parts };
};

/**
 * The player's own list (§9.1), from the record as it stands: call it after
 * the evaluation (`YardAction.reportAfterAchievements`).
 *
 * @param save - The main save, or an outpost's `poolView` (which reads the main row's record).
 * @param rewards - Whether rewards are on.
 */
export const achievementsState = (
  save: AchievementsSave,
  rewards: boolean = achievementConfig.rewards
): AchievementsState => {
  const record = readAchievements(save);
  let shinyEarned = 0;
  const achievements = AVAILABLE_ACHIEVEMENTS.map((entry): AchievementEntryView => {
    const unlock = earnedUnlock(record, entry.id, rewards);
    if (unlock) shinyEarned += unlock.shiny;
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      shiny: entry.shiny,
      status: unlock ? "earned" : "locked",
      ...(unlock && { at: unlock.at }),
      progress: progressOf(entry, record.s, Boolean(unlock)),
    };
  });
  return {
    achievements,
    earned: achievements.filter((entry) => entry.status === "earned").length,
    total: achievements.length,
    shinyEarned,
    fresh: unseenAchievements(save),
  };
};

/** The public list (§9.2) of a record. */
export const publicAchievements = (
  record: Achievements,
  rewards: boolean = achievementConfig.rewards
): PublicAchievements => {
  const achievements = AVAILABLE_ACHIEVEMENTS.map((entry): PublicAchievementView => {
    const unlock = earnedUnlock(record, entry.id, rewards);
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      status: unlock ? "earned" : "locked",
      ...(unlock && { at: unlock.at }),
    };
  });
  return {
    earned: achievements.filter((entry) => entry.status === "earned").length,
    total: achievements.length,
    achievements,
  };
};

/**
 * Another player's record, read-only (§8, §9.2). One already worked out is
 * taken as stored. One never worked out (`NULL`: a bot, a seeded player,
 * anyone who has not loaded since achievements came in) gets the backfill
 * worked out on the fly, its unlocks owed as `recordAchievements` would store
 * them while rewards are off. Nothing is written: no lock, no flush.
 *
 * @param em - Any entity manager; only reads.
 * @param main - The player's main save.
 * @param now - Unix seconds, the backfill's unlock time.
 * @param rewards - Whether rewards are on.
 */
export const readPublicRecord = async (
  em: EntityManager,
  main: ViewSave,
  now: number,
  rewards: boolean = achievementConfig.rewards
): Promise<Achievements> => {
  const record = readAchievements(main);
  if (!needsBackfill(record)) return record;
  const evaluation = evaluateAchievements(record, await readView(em, main, null, record), now);
  if (!rewards) {
    for (const unlock of evaluation.unlocked) evaluation.record.c[String(unlock.id)]!.unpaid = 1;
  }
  return evaluation.record;
};
