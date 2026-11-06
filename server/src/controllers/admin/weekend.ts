import type Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Context } from "koa";

import { Status } from "../../enums/StatusCodes.js";
import {
  WEEKEND_EVENT_IDS,
  WEEKEND_EVENT_INFO,
  WEEKEND_LIMITS,
} from "../../game-data/events/weekendEvents.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import { weekendPlan, weekendState } from "../../services/events/weekendSchedule.js";
import {
  applyWeekendChange,
  envForced,
  loadWeekendSettings,
  parseWeekendChange,
  saveWeekendSettings,
  storedWeekendSettings,
  weekendSettings,
} from "../../services/events/weekendSettings.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import type { adminOnly as AdminGuard } from "./routes.js";

/**
 * The dashboard's weekend events panel (`web/src/admin/weekend.ts`):
 *
 * - `GET /api/:apiVersion/admin/weekend`: the stored settings, what runs now
 *   and next (as players see it), the next 8 weekends with what the rotation
 *   gives and what will run, and who changed the settings last.
 * - `POST /api/:apiVersion/admin/weekend { action, … }`: one change
 *   (`services/events/weekendSettings.ts` `parseWeekendChange`): the
 *   settings (on/off, percentages, rotation, first weekend, time zone,
 *   length, pop-up lead), one weekend swapped or skipped (or back to the
 *   rotation), an event run now for some hours, the forced run stopped, or
 *   everything back to the defaults. Answers as the GET does.
 *
 * Owner-only, like every dashboard route (`adminOnly`). Changes take effect
 * on this server at once and on any other within a minute.
 */

/** The panel's whole answer. */
export const weekendPanel = (now: number) => {
  const { settings, updatedAt, updatedBy } = storedWeekendSettings();
  return {
    now,
    settings,
    updatedAt,
    updatedBy,
    // What players get, `WEEKEND_FORCE` included.
    state: weekendState(weekendSettings(), now),
    plan: weekendPlan(settings, now),
    // A local `WEEKEND_FORCE` overrides what is stored here.
    envForced: envForced(process.env)?.id ?? null,
    events: WEEKEND_EVENT_IDS.map((id) => WEEKEND_EVENT_INFO[id]),
    limits: WEEKEND_LIMITS,
  };
};

export const mountAdminWeekendRoutes = (
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

  router.get(`${admin}/weekend`, apiVersion, adminOnly, async (ctx) => {
    await loadWeekendSettings(em());
    answer(ctx, weekendPanel(getCurrentDateTime()));
  });

  router.post(`${admin}/weekend`, apiVersion, adminOnly, async (ctx) => {
    const change = parseWeekendChange(ctx.request.body);
    if (!change.ok) {
      ctx.status = Status.BAD_REQUEST;
      ctx.set("Cache-Control", "no-store");
      ctx.body = { error: change.message, reason: "badChange" };
      return;
    }
    const now = getCurrentDateTime();
    // Start from what is stored now, not a minute-old copy.
    const current = await loadWeekendSettings(em());
    const next = applyWeekendChange(current, change.value, now);
    await saveWeekendSettings(em(), next, ctx.authUser.userid);
    logger.info(`Dashboard: weekend events ${change.value.action} by ${ctx.authUser.userid}: ${JSON.stringify(change.value)}`);
    answer(ctx, weekendPanel(now));
  });
};
