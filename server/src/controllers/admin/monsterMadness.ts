import type Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Context } from "koa";

import { Status } from "../../enums/StatusCodes.js";
import { MONSTER_MADNESS_DAYS, MONSTER_MADNESS_GOALS } from "../../game-data/events/monsterMadness.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import {
  loadMonsterMadnessRuns,
  monsterMadnessMeta,
  monsterMadnessRuns,
  runningRun,
  saveMonsterMadnessRuns,
  startRun,
  stopRun,
} from "../../services/events/monsterMadnessRuns.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import type { adminOnly as AdminGuard } from "./routes.js";

/**
 * The dashboard's Monster Madness box (`web/src/admin/monsterMadness.ts`), in
 * the Events tab. The event is on no calendar (owner, 11 Nov 2026): it runs
 * only when started here.
 *
 * - `GET /api/:apiVersion/admin/monster-madness`: the run on now (or null),
 *   the last run, the length and goals, and who changed it last.
 * - `POST /api/:apiVersion/admin/monster-madness { action: "start" | "stop" }`:
 *   `start` runs it from now for {@link MONSTER_MADNESS_DAYS} days
 *   (`409 alreadyRunning` while one is on); `stop` ends the run on now
 *   (`409 notRunning` without one). Answers as the GET does.
 *
 * Owner-only, like every dashboard route (`adminOnly`). A change reaches this
 * server at once and any other within a minute.
 */

export const monsterMadnessPanel = (now: number) => {
  const runs = monsterMadnessRuns();
  return {
    now,
    running: runningRun(now, runs),
    last: runs.at(-1) ?? null,
    days: MONSTER_MADNESS_DAYS,
    goals: MONSTER_MADNESS_GOALS,
    ...monsterMadnessMeta(),
  };
};

export const mountAdminMonsterMadnessRoutes = (
  router: Router,
  admin: string,
  adminOnly: typeof AdminGuard,
  em: () => EntityManager
): void => {
  const answer = (ctx: Context, status: number, body: Record<string, unknown>) => {
    ctx.status = status;
    ctx.set("Cache-Control", "no-store");
    ctx.body = body;
  };

  router.get(`${admin}/monster-madness`, apiVersion, adminOnly, async (ctx) => {
    await loadMonsterMadnessRuns(em());
    answer(ctx, Status.OK, { error: 0, ...monsterMadnessPanel(getCurrentDateTime()) });
  });

  router.post(`${admin}/monster-madness`, apiVersion, adminOnly, async (ctx) => {
    const action = (ctx.request.body as { action?: unknown } | undefined)?.action;
    if (action !== "start" && action !== "stop") {
      answer(ctx, Status.BAD_REQUEST, { error: "Say start or stop.", reason: "badChange" });
      return;
    }
    const now = getCurrentDateTime();
    // Start from what is stored now, not a minute-old copy.
    const current = await loadMonsterMadnessRuns(em());
    const next = action === "start" ? startRun(current, now) : stopRun(current, now);
    if (!next) {
      const reason = action === "start" ? "alreadyRunning" : "notRunning";
      const words = action === "start" ? "Monster Madness is already on." : "Monster Madness is not on.";
      answer(ctx, Status.CONFLICT, { error: words, reason, ...monsterMadnessPanel(now) });
      return;
    }
    await saveMonsterMadnessRuns(em(), next, ctx.authUser.userid);
    logger.info(`Dashboard: Monster Madness ${action} by ${ctx.authUser.userid}`);
    answer(ctx, Status.OK, { error: 0, ...monsterMadnessPanel(now) });
  });
};
