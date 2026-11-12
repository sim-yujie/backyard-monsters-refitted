import type Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Context, Middleware } from "koa";

import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import { actOnPhoto, listPhotoCases, parsePhotoAction } from "../../services/admin/photoReports.js";
import type { WordFilter } from "../../services/chat/badWords.js";
import { processPhoto } from "../../services/profile/photo.js";
import { checkBio, PROFILE_REFUSAL_WORDS, type ProfileRefusal } from "../../services/profile/profileRules.js";
import { readPhoto, readProfile, removeOwnPhoto, reportPhoto, saveBio, savePhoto } from "../../services/profile/profiles.js";
import { logger } from "../../utils/logger.js";

/**
 * Player profiles' routes (beta 7, `services/profile/`).
 *
 * The game's, signed in:
 *
 *   GET  /api/:apiVersion/bm/profile/:userid         a player's profile (their own adds the photo rules)
 *   POST /api/:apiVersion/bm/profile/bio             { bio }: the bio, word-filtered
 *   POST /api/:apiVersion/bm/profile/photo           { photo }: a JPEG data URL; stored re-encoded at 128x128
 *   POST /api/:apiVersion/bm/profile/photo/remove    takes the own photo down
 *   POST /api/:apiVersion/bm/profile/:userid/report  "Report inappropriate image"
 *   GET  /api/:apiVersion/profile/photos/:userid     the photo (an `<img>` sends no sign-in); `?v=` is the upload number
 *
 * The dashboard's, behind the owner-only check like every `/admin` route:
 *
 *   GET  /api/:apiVersion/admin/photoreports?status=open|closed&offset=
 *   POST /api/:apiVersion/admin/photoreports/:userid/act   { action: keep | remove | block | unblock }
 *
 * The middleware comes in as arguments so a test can mount these on a bare
 * router: this file does not boot the server. The photo upload carries a
 * picture, so it does not go through `logRequest`.
 */

export interface ProfileRouteDeps {
  readonly em: () => EntityManager;
  /** The game's sign-in check (`verifyUserAuth`) and account checks. */
  readonly signedIn: readonly Middleware[];
  readonly adminOnly: Middleware;
  readonly limiters: {
    readonly read: Middleware;
    readonly write: Middleware;
    readonly upload: Middleware;
    readonly report: Middleware;
    readonly image: Middleware;
  };
  readonly filter: () => WordFilter;
  readonly now?: () => Date;
}

const ok = (ctx: Context, body: Record<string, unknown>): void => {
  ctx.status = Status.OK;
  ctx.set("Cache-Control", "no-store");
  ctx.body = { error: 0, ...body };
};

const refuse = (ctx: Context, status: number, reason: ProfileRefusal, extra: Record<string, unknown> = {}): void => {
  ctx.status = status;
  ctx.set("Cache-Control", "no-store");
  ctx.body = { error: PROFILE_REFUSAL_WORDS[reason], reason, ...extra };
};

/** The user id in the path, or null after answering 404. */
const useridOf = (ctx: Context): number | null => {
  const id = Number(ctx.params.userid);
  if (!Number.isSafeInteger(id) || id < 1) {
    refuse(ctx, Status.NOT_FOUND, "notFound");
    return null;
  }
  return id;
};

const intOf = (raw: unknown): number | undefined => {
  const value = Number(raw);
  return raw !== undefined && raw !== "" && Number.isSafeInteger(value) ? value : undefined;
};

export const mountProfileRoutes = (router: Router, deps: ProfileRouteDeps): void => {
  const api = "/api/:apiVersion";
  const now = deps.now ?? (() => new Date());
  const { limiters } = deps;

  router.get(`${api}/bm/profile/:userid`, apiVersion, ...deps.signedIn, limiters.read, async (ctx) => {
    const userid = useridOf(ctx);
    if (userid === null) return;
    const profile = await readProfile(deps.em(), ctx.authUser.userid, userid, now());
    if (!profile) return refuse(ctx, Status.NOT_FOUND, "notFound");
    ok(ctx, { profile });
  });

  router.post(`${api}/bm/profile/bio`, apiVersion, ...deps.signedIn, limiters.write, async (ctx) => {
    const checked = checkBio((ctx.request.body as { bio?: unknown } | undefined)?.bio, deps.filter());
    if (!checked.ok) return refuse(ctx, Status.BAD_REQUEST, checked.reason);
    await saveBio(deps.em(), ctx.authUser.userid, checked.bio);
    ok(ctx, { bio: checked.bio });
  });

  router.post(`${api}/bm/profile/photo`, apiVersion, ...deps.signedIn, limiters.upload, async (ctx) => {
    const processed = processPhoto((ctx.request.body as { photo?: unknown } | undefined)?.photo);
    if (!processed.ok) {
      return refuse(ctx, Status.BAD_REQUEST, processed.reason);
    }
    const em = deps.em();
    const saved = await savePhoto(em, ctx.authUser.userid, processed.bytes, now());
    if (saved.outcome === "refused") {
      // 409, never 403: the game reads 401/403 as signed out.
      return refuse(ctx, Status.CONFLICT, saved.reason, {
        ...(saved.nextAt && { nextAt: saved.nextAt.toISOString() }),
      });
    }
    logger.info(`Profiles: ${ctx.authUser.userid} uploaded photo ${saved.version} (${processed.bytes.length} bytes)`);
    ok(ctx, { profile: await readProfile(em, ctx.authUser.userid, ctx.authUser.userid, now()) });
  });

  router.post(`${api}/bm/profile/photo/remove`, apiVersion, ...deps.signedIn, limiters.write, async (ctx) => {
    const em = deps.em();
    await removeOwnPhoto(em, ctx.authUser.userid);
    ok(ctx, { profile: await readProfile(em, ctx.authUser.userid, ctx.authUser.userid, now()) });
  });

  router.post(`${api}/bm/profile/:userid/report`, apiVersion, ...deps.signedIn, limiters.report, async (ctx) => {
    const userid = useridOf(ctx);
    if (userid === null) return;
    const done = await reportPhoto(deps.em(), ctx.authUser.userid, userid, now());
    if (done.outcome === "notFound") return refuse(ctx, Status.NOT_FOUND, "notFound");
    if (done.outcome === "self") return refuse(ctx, Status.BAD_REQUEST, "self");
    if (done.outcome === "noPhoto") return refuse(ctx, Status.CONFLICT, "noPhoto");
    ok(ctx, { reported: true, already: done.outcome === "already" });
  });

  router.get(`${api}/profile/photos/:userid`, apiVersion, limiters.image, async (ctx) => {
    const userid = useridOf(ctx);
    if (userid === null) return;
    const photo = await readPhoto(deps.em(), userid);
    if (!photo) return refuse(ctx, Status.NOT_FOUND, "noPhoto");
    ctx.status = Status.OK;
    ctx.type = "image/jpeg";
    // The address carries the upload number (`?v=`), so a new photo is a new
    // address. Private: a shared cache must not keep one the owner takes down.
    ctx.set("Cache-Control", "private, max-age=86400");
    ctx.set("X-Content-Type-Options", "nosniff");
    ctx.set("Content-Security-Policy", "default-src 'none'");
    ctx.body = photo;
  });

  const admin = `${api}/admin`;

  router.get(`${admin}/photoreports`, apiVersion, deps.adminOnly, async (ctx) => {
    ok(ctx, {
      ...(await listPhotoCases(deps.em(), {
        status: ctx.query.status === "closed" ? "closed" : "open",
        offset: intOf(ctx.query.offset),
        limit: intOf(ctx.query.limit),
      })),
    });
  });

  router.post(`${admin}/photoreports/:userid/act`, apiVersion, deps.adminOnly, async (ctx) => {
    const userid = useridOf(ctx);
    if (userid === null) return;
    const action = parsePhotoAction(ctx.request.body);
    if (!action.ok) {
      ctx.status = Status.BAD_REQUEST;
      ctx.body = { error: action.message, reason: "badRequest" };
      return;
    }
    const done = await actOnPhoto(deps.em(), userid, action.value, ctx.authUser.userid, now());
    if (done.outcome !== "done") return refuse(ctx, Status.NOT_FOUND, "notFound");
    logger.info(`Dashboard: ${ctx.authUser.userid} ${action.value} photo of ${userid}`);
    ok(ctx, { case: done.case });
  });
};
