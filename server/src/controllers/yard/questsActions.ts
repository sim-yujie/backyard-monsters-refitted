import type { EntityManager } from "@mikro-orm/core";
import z from "zod";

import type { Save } from "../../database/models/save.model.js";
import { planGrant, type GrantedReward } from "../../services/events/grant.js";
import { sqlHasFriend } from "../../services/quests/friends.js";
import {
  claimBonus,
  claimLogin,
  claimQuest,
  questPlayerOf,
  questsJson,
  swapDaily,
  updateQuests,
  type QuestRecord,
  type QuestRefusal,
} from "../../services/quests/state.js";
import { questsView, type QuestsView } from "../../services/quests/view.js";
import { nextUtcMidnight } from "../../services/quests/period.js";
import { creditDailyQuest } from "../../services/alliance/allianceProgress.js";
import { yardRefusedErr } from "../../services/yard/yardErrors.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The quest window's yard actions (beta 6, `services/quests/state.ts`). All
 * run on the main yard under its row lock (no `outposts` policy), so a claim
 * and its reward commit or roll back together, and pay through the wrapper's
 * outcome (`planGrant`: resources clamped to the storage cap, Shiny as
 * `grantShiny`, speed-ups into `storedata`). Rewards are never paid on their
 * own: each needs one of these Claim calls.
 *
 * - `quests/state {}`: the window's read. Checks whether the player has a
 *   friend to help (the weekly social quest's choice), picks today's and this
 *   week's quests when the day or week has turned, and answers the view.
 * - `quests/login/claim {}`: today's login card day. `409 claimedToday {nextAt}`.
 * - `quests/claim { period, slot }`: one finished quest. `409 noSuchQuest`,
 *   `409 notDone`, `409 claimed`.
 * - `quests/bonus/claim { period }`: the all-done bonus. `409 bonusNotReady`, `409 bonusClaimed`.
 * - `quests/swap { slot }`: the free daily swap. `409 noSwapsLeft`,
 *   `409 cannotSwap`, `409 nothingToSwapTo`.
 *
 * Every report is `{ quests: QuestsView, granted? }`, the view built after
 * the wrapper has counted the request's own progress
 * (`reportAfterAchievements`, which runs after the quests are recorded).
 */

export const QuestsStateSchema = z.object({}).passthrough();
export const QuestClaimSchema = z.object({
  period: z.enum(["daily", "weekly"]),
  slot: z.coerce.number().int().min(0).max(9),
});
export const QuestBonusSchema = z.object({ period: z.enum(["daily", "weekly"]) });
export const QuestSwapSchema = z.object({ slot: z.coerce.number().int().min(0).max(9) });

export interface QuestsReport {
  quests: QuestsView;
  /** What a claim paid (resources after the storage cap). */
  granted?: GrantedReward[];
  /** The login day claimed, 1-7. */
  day?: number;
}

/** Whether the player has a friend to help or gift; a stand-in for tests. */
export type HasFriend = (em: EntityManager, userid: number, now: number) => Promise<boolean>;

const MESSAGES: Record<QuestRefusal, string> = {
  claimedToday: "You have claimed today's login reward. Come back tomorrow!",
  noSuchQuest: "There is no such quest.",
  notDone: "That quest is not finished yet.",
  claimed: "You have claimed that reward already.",
  bonusNotReady: "Finish every quest first.",
  bonusClaimed: "You have claimed that bonus already.",
  noSwapsLeft: "You have used today's free swap.",
  cannotSwap: "Only an unfinished quest can be swapped.",
  nothingToSwapTo: "There is no other quest to swap to.",
};

const refuse = (reason: QuestRefusal, detail: object = {}): never => {
  throw yardRefusedErr(reason, MESSAGES[reason], detail);
};

/** The main save's record, rolled over to `now`. */
const current = (save: Save, now: number, hasFriend?: boolean): QuestRecord =>
  updateQuests(save, now, null, hasFriend).record;

const viewOf = (save: Save, now: number): QuestsView => questsView(current(save, now), now);

export const questsActions = (hasFriend: HasFriend = sqlHasFriend) => ({
  state: defineYardAction({
    schema: QuestsStateSchema,
    run: async ({ save, user, now, em }) => {
      const friend = await hasFriend(em, user.userid, now).catch(() => undefined);
      const record = current(save, now, friend);
      const report: QuestsReport = { quests: questsView(record, now) };
      return { report, slices: { dailyquests: questsJson(record) } };
    },
    reportAfterAchievements: (save: Save): QuestsReport => ({ quests: viewOf(save, Math.floor(Number(save.savetime))) }),
  }),

  loginClaim: defineYardAction({
    schema: QuestsStateSchema,
    run: ({ save, now }) => {
      const result = claimLogin(current(save, now), now);
      if (!result.ok) return refuse(result.reason, { nextAt: nextUtcMidnight(now) });
      const plan = planGrant(save, [{ kind: "shiny", amount: result.value.shiny }], now);
      const report: QuestsReport = { quests: questsView(result.record, now), granted: plan.granted, day: result.value.day };
      return {
        report,
        grantShiny: plan.grantShiny,
        slices: { ...plan.slices, dailyquests: questsJson(result.record) },
      };
    },
  }),

  claim: defineYardAction({
    schema: QuestClaimSchema,
    run: async ({ save, user, body, now, em }) => {
      const result = claimQuest(current(save, now), body.period, body.slot);
      if (!result.ok) return refuse(result.reason, { period: body.period, slot: body.slot });
      // A daily quest earns the player's alliance a point (design v5 §8).
      if (body.period === "daily") await creditDailyQuest(em, user.userid, now);
      const plan = planGrant(save, result.value.rewards, now);
      const report: QuestsReport = { quests: questsView(result.record, now), granted: plan.granted };
      return {
        report,
        credit: plan.credit,
        grantShiny: plan.grantShiny,
        slices: { ...plan.slices, dailyquests: questsJson(result.record) },
      };
    },
  }),

  bonusClaim: defineYardAction({
    schema: QuestBonusSchema,
    run: ({ save, body, now }) => {
      const result = claimBonus(current(save, now), body.period);
      if (!result.ok) return refuse(result.reason, { period: body.period });
      const plan = planGrant(save, [{ kind: "shiny", amount: result.value.shiny }], now);
      const report: QuestsReport = { quests: questsView(result.record, now), granted: plan.granted };
      return {
        report,
        grantShiny: plan.grantShiny,
        slices: { ...plan.slices, dailyquests: questsJson(result.record) },
      };
    },
  }),

  swap: defineYardAction({
    schema: QuestSwapSchema,
    run: ({ save, body, now }) => {
      const record = current(save, now);
      const result = swapDaily(record, questPlayerOf(save, record.hasFriend), body.slot);
      if (!result.ok) return refuse(result.reason, { slot: body.slot });
      const report: QuestsReport = { quests: questsView(result.record, now) };
      return { report, slices: { dailyquests: questsJson(result.record) } };
    },
  }),
});
