import { YardBuildWallsSchema } from "../../schemas/YardSchemas.js";
import { builtEvents } from "../../services/achievements/record.js";
import { planBuildWalls } from "../../services/yard/buildWalls.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/build/walls` — a drawn line or L of wall Blocks built in one
 * request (walls Option B, owner 8 Nov 2026): every cell checked again by the
 * single build's gates, blocked cells skipped, the rest built in order while
 * the hall's limit and the resources last, one charge, one write. The rules
 * are `services/yard/buildWalls.ts`.
 *
 * Each Block built counts as one built for the achievements (issue #204), as
 * the single build's does. Rate-limited per user (`wallLineLimiter`,
 * `middleware/rateLimiters.ts`).
 */
export const yardBuildWallsAction = defineYardAction({
  schema: YardBuildWallsSchema,
  run: ({ save, body }) => {
    const plan = planBuildWalls(save, {
      type: body.type,
      cells: body.cells.map(([x, y]) => ({ x, y })),
    });
    return {
      ...plan,
      achievementEvents: builtEvents(plan.report.built.map(() => ({ kind: "build", t: body.type }))),
    };
  },
  outposts: "allow",
  inferno: "allow",
});
