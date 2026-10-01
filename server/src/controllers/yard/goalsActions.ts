import z from "zod";
import { planBaiterRun, planBaiterStart, type BaiterTokenStore } from "../../services/goals/baiterRun.js";
import { planGoalClaim, planGoalsState } from "../../services/goals/claim.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Goals package's yard actions (issue #227), bound to routes by
 * `goals.ts`. Kept apart from the binding so tests drive them through
 * `runYardAction` with an in-memory token store, without Redis.
 */

export const GoalClaimSchema = z.object({ id: z.string().min(1).max(16) });
export const BaiterRunSchema = z.object({ token: z.string().min(1).max(64) });

/** The four actions, with the Baiter token store as a parameter so tests need no Redis. */
export const goalsActions = (tokens: BaiterTokenStore) => ({
  state: defineYardAction({
    schema: z.object({}),
    run: ({ save, now }) => planGoalsState(save, now),
  }),
  claim: defineYardAction({
    schema: GoalClaimSchema,
    run: ({ save, body, now }) => planGoalClaim(save, body.id, now),
  }),
  baiterStart: defineYardAction({
    schema: z.object({}),
    run: ({ save, user, now }) => planBaiterStart(save, user.userid, now, tokens),
  }),
  baiterRun: defineYardAction({
    schema: BaiterRunSchema,
    run: ({ save, user, body, now }) => planBaiterRun(save, user.userid, body.token, now, tokens),
  }),
});
