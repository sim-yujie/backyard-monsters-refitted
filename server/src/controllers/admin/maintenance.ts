import type Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Context } from "koa";

import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import {
  COUNTDOWN_MINUTES,
  DEFAULT_COUNTDOWN_MINUTES,
  DEFAULT_MESSAGE,
  MESSAGE_MAX,
  applyMaintenanceChange,
  isCutOff,
  loadMaintenance,
  parseMaintenanceChange,
  saveMaintenance,
  storedMaintenance,
} from "../../services/admin/maintenance.js";
import { logger } from "../../utils/logger.js";
import type { adminOnly as AdminGuard } from "./routes.js";

/**
 * The dashboard's maintenance panel (`web/src/admin/maintenance.ts`):
 *
 * - `GET /api/:apiVersion/admin/maintenance`: on or off, the message, the
 *   back-at time, the cut-off and the time left, who changed it last.
 * - `POST /api/:apiVersion/admin/maintenance { action: "on", message?,
 *   backAt?, minutes? }` turns it on (new sign-ins refused at once, the
 *   countdown starts); on while already on changes the message and back-at
 *   time only. `{ action: "off" }` turns it off, cancelling a countdown.
 *   Answers as the GET does.
 *
 * Owner-only, like every dashboard route (`adminOnly`).
 */

export const maintenancePanel = (now: number) => {
  const { state, updatedAt, updatedBy } = storedMaintenance();
  return {
    now,
    on: state.on,
    message: state.message,
    backAt: state.backAt,
    startedAt: state.on ? state.startedAt : null,
    cutoffAt: state.on ? state.cutoffAt : null,
    remainingMs: state.on ? Math.max(0, state.cutoffAt - now) : 0,
    cutOff: isCutOff(state, now),
    updatedAt,
    updatedBy,
    limits: {
      minutes: COUNTDOWN_MINUTES,
      defaultMinutes: DEFAULT_COUNTDOWN_MINUTES,
      defaultMessage: DEFAULT_MESSAGE,
      messageMax: MESSAGE_MAX,
    },
  };
};

export const mountAdminMaintenanceRoutes = (
  router: Router,
  admin: string,
  adminOnly: typeof AdminGuard,
  em: () => EntityManager
): void => {
  const answer = (ctx: Context, body: Record<string, unknown>) => {
    ctx.status = Status.OK;
    ctx.set("Cache-Control", "no-store");
    ctx.body = { error: 0, ...body };
  };

  router.get(`${admin}/maintenance`, apiVersion, adminOnly, async (ctx) => {
    await loadMaintenance(em());
    answer(ctx, maintenancePanel(Date.now()));
  });

  router.post(`${admin}/maintenance`, apiVersion, adminOnly, async (ctx) => {
    const now = Date.now();
    const change = parseMaintenanceChange(ctx.request.body, now);
    if (!change.ok) {
      ctx.status = Status.BAD_REQUEST;
      ctx.set("Cache-Control", "no-store");
      ctx.body = { error: change.message, reason: "badChange" };
      return;
    }
    // Start from what is stored now, not a copy seconds old.
    const current = await loadMaintenance(em());
    const next = applyMaintenanceChange(current, change.value, now);
    await saveMaintenance(em(), next, ctx.authUser.userid);
    logger.info("Dashboard: maintenance {action} by {userid}: {change}", {
      action: change.value.action,
      userid: ctx.authUser.userid,
      change: JSON.stringify(change.value),
    });
    answer(ctx, maintenancePanel(now));
  });
};
