import type Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Context } from "koa";

import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import {
  loadWaveRuns,
  saveWaveRuns,
  startWaveRun,
  stopWaveRun,
  waveEventsPanel,
} from "../../services/events/waves/waveRuns.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import type { adminOnly as AdminGuard } from "./routes.js";

/**
 * The dashboard's wave events box (`web/src/admin/waveEvents.ts`), in the
 * Events tab: Start and Stop per event, one wave event on at a time (owner,
 * 27 Nov 2026). The generic control every wave event uses (Wild Monster
 * Invasion 1 and 2 now; Blitzkrieg, Brukkarg War's waves and Christmas later).
 * - `GET /api/:apiVersion/admin/wave-events`: every event, its last run and the run on now.
 * - `POST /api/:apiVersion/admin/wave-events { action: "start", event, days? }`: starts
 *   `event` from now for its own days (`days`, 1-30, overrides); `409 alreadyRunning`
 *   while any wave event is on, `400 unknownEvent`.
 * - `POST ... { action: "stop" }`: ends the run on now; `409 notRunning` without one.
 * Owner-only (`adminOnly`). A change reaches this server at once and any other within a minute.
 */
export const mountAdminWaveEventRoutes = (
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

  router.get(`${admin}/wave-events`, apiVersion, adminOnly, async (ctx) => {
    await loadWaveRuns(em());
    answer(ctx, Status.OK, { error: 0, ...waveEventsPanel(getCurrentDateTime()) });
  });

  router.post(`${admin}/wave-events`, apiVersion, adminOnly, async (ctx) => {
    const body = (ctx.request.body ?? {}) as { action?: unknown; event?: unknown; days?: unknown };
    const now = getCurrentDateTime();
    const current = await loadWaveRuns(em());
    if (body.action === "start") {
      const days = body.days === undefined ? undefined : Number(body.days);
      if (days !== undefined && !(Number.isInteger(days) && days >= 1 && days <= 30)) {
        answer(ctx, Status.BAD_REQUEST, { error: "Days must be 1 to 30.", reason: "badChange" });
        return;
      }
      const next = startWaveRun(current, String(body.event ?? ""), now, days);
      if (next === "unknownEvent") {
        answer(ctx, Status.BAD_REQUEST, { error: "No such wave event.", reason: next });
        return;
      }
      if (next === "alreadyRunning") {
        answer(ctx, Status.CONFLICT, { error: "A wave event is already on. Stop it first.", reason: next, ...waveEventsPanel(now, current) });
        return;
      }
      await saveWaveRuns(em(), next, ctx.authUser.userid);
      logger.info(`Dashboard: wave event ${String(body.event)} started by ${ctx.authUser.userid}`);
      answer(ctx, Status.OK, { error: 0, ...waveEventsPanel(now) });
      return;
    }
    if (body.action === "stop") {
      const next = stopWaveRun(current, now);
      if (!next) {
        answer(ctx, Status.CONFLICT, { error: "No wave event is on.", reason: "notRunning", ...waveEventsPanel(now, current) });
        return;
      }
      await saveWaveRuns(em(), next, ctx.authUser.userid);
      logger.info(`Dashboard: wave event stopped by ${ctx.authUser.userid}`);
      answer(ctx, Status.OK, { error: 0, ...waveEventsPanel(now) });
      return;
    }
    answer(ctx, Status.BAD_REQUEST, { error: "Say start or stop.", reason: "badChange" });
  });
};
