import type Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Context } from "koa";

import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import {
  allConstellations,
  loadStarFigures,
  parseFigureChange,
  saveStarFigure,
} from "../../services/alliance/starFigures.js";
import { logger } from "../../utils/logger.js";
import type { adminOnly as AdminGuard } from "./routes.js";

/**
 * The in-game star editor (web `ui/alliance/StarEditor.ts`), owner-only like
 * every dashboard route:
 *
 * - `GET /api/:apiVersion/admin/star-figures`: every constellation (id, name,
 *   type, kind) and the figures saved so far.
 * - `POST /api/:apiVersion/admin/star-figures { id, figure }` saves one
 *   figure; `{ id, reset: true }` drops it so the built-in one shows again.
 *   Answers as the GET does.
 *
 * Saved figures reach every player through `myalliance` (`star_figures`).
 */
export const mountAdminStarFigureRoutes = (
  router: Router,
  admin: string,
  adminOnly: typeof AdminGuard,
  em: () => EntityManager
): void => {
  const answer = async (ctx: Context) => {
    ctx.status = Status.OK;
    ctx.set("Cache-Control", "no-store");
    ctx.body = { error: 0, constellations: allConstellations(), figures: await loadStarFigures(em()) };
  };

  router.get(`${admin}/star-figures`, apiVersion, adminOnly, answer);

  router.post(`${admin}/star-figures`, apiVersion, adminOnly, async (ctx) => {
    const parsed = parseFigureChange(ctx.request.body);
    if (!parsed.ok) {
      ctx.status = Status.BAD_REQUEST;
      ctx.set("Cache-Control", "no-store");
      ctx.body = { error: parsed.reason, reason: "badFigure" };
      return;
    }
    await saveStarFigure(em(), parsed.change, ctx.authUser.userid);
    logger.info(
      `Star editor: ${parsed.change.id} ${"reset" in parsed.change ? "reset" : "saved"} by ${ctx.authUser.userid}`
    );
    await answer(ctx);
  });
};
