import type Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Context, Middleware } from "koa";

import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import {
  ANNOUNCEMENT_LIMITS,
  createAnnouncement,
  deleteAnnouncement,
  dismissForPlayer,
  getAnnouncementImage,
  getForAdmin,
  listForAdmin,
  listForPlayer,
  parseAnnouncement,
  updateAnnouncement,
} from "../../services/announcements/announcements.js";
import { logger } from "../../utils/logger.js";

/**
 * The in-game announcements' routes (`services/announcements/announcements.ts`).
 *
 * The game's, signed in:
 *
 *   GET  /api/:apiVersion/bm/announcements              the current ones, newest first, each with `dismissed`
 *   POST /api/:apiVersion/bm/announcements/:id/dismiss  "Got it"
 *   GET  /api/:apiVersion/announcements/images/:id      a published one's picture (an `<img>` sends no sign-in)
 *
 * The dashboard's, behind the owner-only check like every `/admin` route:
 *
 *   GET    /api/:apiVersion/admin/announcements             all of them, drafts too
 *   POST   /api/:apiVersion/admin/announcements             a new one
 *   PUT    /api/:apiVersion/admin/announcements/:id         a change
 *   DELETE /api/:apiVersion/admin/announcements/:id
 *   GET    /api/:apiVersion/admin/announcements/images/:id  any picture, drafts' too
 *
 * The middleware comes in as arguments so a test can mount these on a bare
 * router: this file does not boot the server. The writes carry pictures, so
 * none goes through `logRequest`.
 */

export interface AnnouncementRouteDeps {
  readonly em: () => EntityManager;
  /** The game's sign-in check (`verifyUserAuth`), then whatever else the game's routes need. */
  readonly signedIn: readonly Middleware[];
  /** The owner-only check (`services/admin/adminGuard.ts`). */
  readonly adminOnly: Middleware;
  /** In front of the pictures' public route. */
  readonly imageLimiter: Middleware;
  readonly now?: () => Date;
}

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

/** The id in the path, or null after answering 404. */
const idOf = (ctx: Context, what: string): number | null => {
  const id = Number(ctx.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    refuse(ctx, Status.NOT_FOUND, `There is no such ${what}.`, "notFound");
    return null;
  }
  return id;
};

const sendImage = (ctx: Context, image: { bytes: Buffer; type: string }, cache: string): void => {
  ctx.status = Status.OK;
  ctx.type = image.type;
  ctx.set("Cache-Control", cache);
  ctx.set("X-Content-Type-Options", "nosniff");
  ctx.body = image.bytes;
};

const BAD_IMAGE = "A picture is not right. Reload the page and try again.";

export const mountAnnouncementRoutes = (router: Router, deps: AnnouncementRouteDeps): void => {
  const api = "/api/:apiVersion";
  const now = deps.now ?? (() => new Date());
  const { adminOnly } = deps;

  router.get(`${api}/bm/announcements`, apiVersion, ...deps.signedIn, async (ctx) => {
    ok(ctx, { announcements: await listForPlayer(deps.em(), ctx.authUser.userid, now()) });
  });

  router.post(`${api}/bm/announcements/:id/dismiss`, apiVersion, ...deps.signedIn, async (ctx) => {
    const id = idOf(ctx, "announcement");
    if (id === null) return;
    const done = await dismissForPlayer(deps.em(), ctx.authUser.userid, id, now());
    if (done === "notFound") return refuse(ctx, Status.NOT_FOUND, "There is no such announcement.", "notFound");
    ok(ctx, { id });
  });

  router.get(`${api}/announcements/images/:id`, apiVersion, deps.imageLimiter, async (ctx) => {
    const id = idOf(ctx, "picture");
    if (id === null) return;
    const image = await getAnnouncementImage(deps.em(), id, true);
    if (!image) return refuse(ctx, Status.NOT_FOUND, "There is no such picture.", "notFound");
    // A picture never changes: an edit that swaps it makes a new id.
    sendImage(ctx, image, "public, max-age=86400, immutable");
  });

  const admin = `${api}/admin`;

  router.get(`${admin}/announcements`, apiVersion, adminOnly, async (ctx) => {
    ok(ctx, { announcements: await listForAdmin(deps.em(), now()), limits: ANNOUNCEMENT_LIMITS });
  });

  router.post(`${admin}/announcements`, apiVersion, adminOnly, async (ctx) => {
    const input = parseAnnouncement(ctx.request.body);
    if (!input.ok) return refuse(ctx, Status.BAD_REQUEST, input.message, "badAnnouncement");
    const em = deps.em();
    const id = await createAnnouncement(em, input.value, ctx.authUser.userid, now());
    if (id === "badImage") return refuse(ctx, Status.BAD_REQUEST, BAD_IMAGE, "badImage");
    logger.info(`Announcements: ${ctx.authUser.userid} wrote ${id} (${input.value.status})`);
    ok(ctx, { announcement: await getForAdmin(em, id, now()) });
  });

  router.put(`${admin}/announcements/:id`, apiVersion, adminOnly, async (ctx) => {
    const id = idOf(ctx, "announcement");
    if (id === null) return;
    const input = parseAnnouncement(ctx.request.body);
    if (!input.ok) return refuse(ctx, Status.BAD_REQUEST, input.message, "badAnnouncement");
    const em = deps.em();
    const done = await updateAnnouncement(em, id, input.value, ctx.authUser.userid, now());
    if (done === "notFound") return refuse(ctx, Status.NOT_FOUND, "There is no such announcement.", "notFound");
    if (done === "badImage") return refuse(ctx, Status.BAD_REQUEST, BAD_IMAGE, "badImage");
    logger.info(`Announcements: ${ctx.authUser.userid} changed ${id} (${input.value.status})`);
    ok(ctx, { announcement: await getForAdmin(em, id, now()) });
  });

  router.delete(`${admin}/announcements/:id`, apiVersion, adminOnly, async (ctx) => {
    const id = idOf(ctx, "announcement");
    if (id === null) return;
    if (!(await deleteAnnouncement(deps.em(), id))) {
      return refuse(ctx, Status.NOT_FOUND, "There is no such announcement.", "notFound");
    }
    logger.info(`Announcements: ${ctx.authUser.userid} deleted ${id}`);
    ok(ctx, { id });
  });

  router.get(`${admin}/announcements/images/:id`, apiVersion, adminOnly, async (ctx) => {
    const id = idOf(ctx, "picture");
    if (id === null) return;
    const image = await getAnnouncementImage(deps.em(), id, false);
    if (!image) return refuse(ctx, Status.NOT_FOUND, "There is no such picture.", "notFound");
    sendImage(ctx, image, "private, no-store");
  });
};
