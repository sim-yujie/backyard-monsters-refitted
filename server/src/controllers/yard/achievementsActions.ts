import z from "zod";
import type { Save } from "../../database/models/save.model.js";
import { updateAchievements } from "../../services/achievements/state.js";
import { achievementsState } from "../../services/achievements/view.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The player's own achievements actions (`docs/design/achievements.md` §9.1,
 * issue #204, WP4), bound to routes under `/bm/yard/` by `achievements.ts`
 * and kept apart from the binding so tests drive them through
 * `runYardAction`. Both are yard actions, so each runs under the main row's
 * lock with the catch-up and the evaluation (the backfill too, the first
 * time). Both work on an outpost: the record is the account's, on the main
 * row.
 */

/** `ids`: a JSON array of achievement numbers, as `repair`'s `ids` is read. */
export const AchievementsSeenSchema = z.object({
  ids: z
    .string()
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "ids must be a JSON array of achievement numbers" });
        return z.NEVER;
      }
    })
    .pipe(z.array(z.number().int().positive()).max(64)),
});

/**
 * The list is built after the wrapper's evaluation, so it holds what this
 * request unlocked or backfilled. `run` only builds a first copy.
 */
export const yardAchievementsStateAction = defineYardAction({
  schema: z.object({}),
  run: ({ save }) => ({ report: achievementsState(save) }),
  reportAfterAchievements: (save) => achievementsState(save),
  outposts: "allow",
});

/**
 * Marks the named unlocks `seen`. An id not earned, already seen, or still
 * owed (`unpaid`: never in an answer, so never shown) is ignored. The report
 * lists the ids it marked.
 */
export const yardAchievementsSeenAction = defineYardAction({
  schema: AchievementsSeenSchema,
  run: ({ save, body }) => {
    const marked: number[] = [];
    const achievements = updateAchievements(save, (record) => {
      for (const id of new Set(body.ids)) {
        const unlock = record.c[String(id)];
        if (!unlock || unlock.seen || unlock.unpaid) continue;
        unlock.seen = 1;
        marked.push(id);
      }
    });
    return {
      report: { seen: marked },
      ...(marked.length > 0 && { slices: { achievements: achievements as unknown as Save["achievements"] } }),
    };
  },
  outposts: "allow",
});
