import type Router from "@koa/router";
import type { Context } from "koa";

import { isAdminUser } from "../../config/AdminConfig.js";
import { Env } from "../../enums/Env.js";
import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import { verifyUserAuth } from "../../middleware/auth.js";
import { postgres, redis } from "../../server.js";
import { makeAdminGuard } from "../../services/admin/adminGuard.js";
import {
  getBugReport,
  getBugReportImage,
  isBugReportFilter,
  listBugReports,
  parseTicketUpdate,
  updateBugReportTicket,
  type BugReportImageKind,
} from "../../services/admin/bugReportsAdmin.js";
import { errorTotals, listErrors } from "../../services/errors/errorStore.js";
import { daysBetween, readDailyStats, statsOverview, type StatsDeps } from "../../services/stats/dailyStats.js";
import { LOG_BASE, LOG_DIR, logger } from "../../utils/logger.js";

/**
 * The owner's dashboard API (`docs/design/admin-dashboard-api.md`); every
 * route is behind the owner-only check (`services/admin/adminGuard.ts`):
 * anyone not in `ADMIN_USER_IDS` gets a plain 404. `app.routes.ts` calls
 * this once. Nothing here goes through `logRequest`.
 */

const adminOnly = makeAdminGuard(verifyUserAuth, (userid) => isAdminUser(userid), (ctx) => {
  if (ctx.authUser) logger.warn(`Dashboard: refused user ${ctx.authUser.userid} on ${ctx.method} ${ctx.path}`);
});

const statsDeps = (): StatsDeps => ({
  em: postgres.em.fork(),
  redis,
  logDir: process.env.ENV === Env.LOCAL ? null : LOG_DIR,
  logBase: LOG_BASE,
});

const ok = (ctx: Context, body: Record<string, unknown>): void => {
  ctx.status = Status.OK;
  ctx.set("Cache-Control", "no-store");
  ctx.body = { error: 0, ...body };
};

const refuse = (ctx: Context, status: number, message: string, reason: string): void => {
  ctx.status = status;
  ctx.set("Cache-Control", "no-store");
  ctx.body = { error: message, reason };
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 400;

/** A whole number from the query string, or undefined. */
const intOf = (raw: unknown): number | undefined => {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isSafeInteger(value) ? value : undefined;
};

/** The report id in the path, or null after answering 404. */
const reportId = (ctx: Context): number | null => {
  const id = intOf(ctx.params.id);
  if (id === undefined || id < 1) {
    refuse(ctx, Status.NOT_FOUND, "There is no such bug report.", "notFound");
    return null;
  }
  return id;
};

export const mountAdminRoutes = (router: Router): void => {
  const admin = "/api/:apiVersion/admin";

  router.get(`${admin}/me`, apiVersion, adminOnly, (ctx) => {
    ok(ctx, { admin: true, userid: ctx.authUser.userid, username: ctx.authUser.username });
  });

  router.get(`${admin}/stats/overview`, apiVersion, adminOnly, async (ctx) => {
    const days = Math.min(MAX_DAYS, Math.max(1, intOf(ctx.query.days) ?? 30));
    ok(ctx, { ...(await statsOverview(statsDeps(), days)) });
  });

  router.get(`${admin}/stats/daily`, apiVersion, adminOnly, async (ctx) => {
    const now = Date.now();
    const to = typeof ctx.query.to === "string" && DAY.test(ctx.query.to) ? ctx.query.to : new Date(now - DAY_MS).toISOString().slice(0, 10);
    const from =
      typeof ctx.query.from === "string" && DAY.test(ctx.query.from)
        ? ctx.query.from
        : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
    if (from > to || daysBetween(from, to).length > MAX_DAYS) {
      refuse(ctx, Status.BAD_REQUEST, `Ask for at most ${MAX_DAYS} days, from before to.`, "badRange");
      return;
    }
    ok(ctx, { from, to, days: await readDailyStats(postgres.em.fork(), from, to) });
  });

  router.get(`${admin}/bugreports`, apiVersion, adminOnly, async (ctx) => {
    const filter = isBugReportFilter(ctx.query.filter) ? ctx.query.filter : "all";
    const page = await listBugReports(postgres.em.fork(), {
      before: intOf(ctx.query.before),
      limit: intOf(ctx.query.limit),
      filter,
    });
    ok(ctx, { ...page });
  });

  router.get(`${admin}/bugreports/:id`, apiVersion, adminOnly, async (ctx) => {
    const id = reportId(ctx);
    if (id === null) return;
    const report = await getBugReport(postgres.em.fork(), id);
    if (!report) return refuse(ctx, Status.NOT_FOUND, "There is no such bug report.", "notFound");
    ok(ctx, { report });
  });

  for (const kind of ["screenshot", "picture"] as const satisfies readonly BugReportImageKind[]) {
    router.get(`${admin}/bugreports/:id/${kind}`, apiVersion, adminOnly, async (ctx) => {
      const id = reportId(ctx);
      if (id === null) return;
      const image = await getBugReportImage(postgres.em.fork(), id, kind);
      if (!image) return refuse(ctx, Status.NOT_FOUND, `This report has no ${kind}.`, "notFound");
      ctx.status = Status.OK;
      ctx.type = image.type;
      ctx.set("Cache-Control", "private, no-store");
      ctx.set("X-Content-Type-Options", "nosniff");
      ctx.body = image.bytes;
    });
  }

  router.post(`${admin}/bugreports/:id/ticket`, apiVersion, adminOnly, async (ctx) => {
    const id = reportId(ctx);
    if (id === null) return;
    const update = parseTicketUpdate(ctx.request.body);
    if (!update.ok) return refuse(ctx, Status.BAD_REQUEST, update.message, "badTicket");
    const report = await updateBugReportTicket(postgres.em.fork(), id, update.value, ctx.authUser.userid);
    if (!report) return refuse(ctx, Status.NOT_FOUND, "There is no such bug report.", "notFound");
    ok(ctx, { report });
  });

  router.get(`${admin}/errors`, apiVersion, adminOnly, async (ctx) => {
    const source = ctx.query.source === "browser" || ctx.query.source === "server" ? ctx.query.source : undefined;
    const sort = ctx.query.sort === "count" ? "count" : "last";
    const sinceDays = intOf(ctx.query.sinceDays);
    const em = postgres.em.fork();
    ok(ctx, {
      groups: await listErrors(em, {
        source,
        sort,
        limit: intOf(ctx.query.limit),
        ...(sinceDays !== undefined && sinceDays > 0 && { since: new Date(Date.now() - sinceDays * DAY_MS) }),
      }),
      totals: await errorTotals(em),
    });
  });
};
