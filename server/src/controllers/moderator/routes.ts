import type Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Context, Middleware, Next } from "koa";

import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import type { ModerationEffects } from "../../services/admin/moderation.js";
import {
  actAsModerator,
  countOpenReports,
  listModReports,
  modLineAround,
  modPlayer,
  modRoleOf,
  parseModAction,
  type ModFilter,
} from "../../services/moderator/modReports.js";
import { logger } from "../../utils/logger.js";

/**
 * The game's Reports window for moderators (owner, 12 Nov 2026;
 * `services/moderator/modReports.ts`):
 *
 * - `GET  /api/:v/mod/status`: `{ moderator: 0|1, open }` for any signed-in
 *   player; the game shows the Reports button only on `moderator: 1`, with
 *   `open` (players with something open) as its number. Nobody else gets a count.
 * - `GET  /api/:v/mod/reports?filter=all|reports|filter|closed&offset=`: the list.
 * - `GET  /api/:v/mod/reports/players/:id`: one player's open lines, log and decisions.
 * - `GET  /api/:v/mod/reports/lines/:id/around`: the chat around one open word-filter line.
 * - `POST /api/:v/mod/reports/players/:id/act`: Close, Warn or Mute (1h, 1d, 3d, 7d).
 *
 * Everything but `status` is for moderators and admins only: anyone else
 * gets 403 `notModerator`, whatever their game claims. Moderators, game team
 * accounts and the moderator themselves are never shown and never acted on
 * (403 `self`, `gameTeam`, `moderator`).
 */

export interface ModReportsRouteDeps {
  readonly em: () => EntityManager;
  /** The game's sign-in check (`verifyUserAuth`) and any limiter. */
  readonly signedIn: readonly Middleware[];
  /** What a warning or mute does outside the database (the dashboard's own). */
  readonly effects: ModerationEffects;
  readonly now?: () => Date;
}

export const MOD_REFUSAL_WORDS = {
  notModerator: "Only moderators can open Reports.",
  notShown: "There is nothing open for this player.",
  notOpen: "This line is closed, so its chat is no longer shown.",
  self: "You can't decide on reports against yourself. An admin will.",
  gameTeam: "That is a game team account. An admin decides on it.",
  moderator: "That player is a moderator. An admin decides on reports against moderators.",
  changed: "Something new came in for this player. Look again before deciding.",
  nothingOpen: "Someone already closed this. Nothing is open for this player now.",
  noPlayer: "This player's account is gone.",
  longerMute: "This player's chat is already muted for longer. Warn or Close instead.",
} as const;

export type ModRefusal = keyof typeof MOD_REFUSAL_WORDS;

const ok = (ctx: Context, body: Record<string, unknown>): void => {
  ctx.status = Status.OK;
  ctx.set("Cache-Control", "no-store");
  ctx.body = { error: 0, ...body };
};

const refuse = (ctx: Context, status: number, reason: ModRefusal | "badRequest", message?: string): void => {
  ctx.status = status;
  ctx.set("Cache-Control", "no-store");
  const words = message ?? MOD_REFUSAL_WORDS[reason as ModRefusal];
  ctx.body = { error: words, message: words, reason };
};

const intOf = (raw: unknown): number | undefined => {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isSafeInteger(value) ? value : undefined;
};

const FILTERS: readonly ModFilter[] = ["all", "reports", "filter", "closed"];

export const mountModReportsRoutes = (router: Router, deps: ModReportsRouteDeps): void => {
  const base = "/api/:apiVersion/mod";
  const now = () => deps.now?.() ?? new Date();

  /** Moderators and admins only, checked against the list on every call. */
  const modOnly = async (ctx: Context, next: Next): Promise<void> => {
    const role = await modRoleOf(deps.em(), ctx.authUser.userid);
    if (!role) {
      logger.warn(`Moderator: refused user ${ctx.authUser.userid} on ${ctx.method} ${ctx.path}`);
      return refuse(ctx, Status.FORBIDDEN, "notModerator");
    }
    await next();
  };

  router.get(`${base}/status`, apiVersion, ...deps.signedIn, async (ctx) => {
    const em = deps.em();
    const role = await modRoleOf(em, ctx.authUser.userid);
    if (!role) return ok(ctx, { moderator: 0 });
    ok(ctx, { moderator: 1, open: await countOpenReports(em, now()) });
  });

  router.get(`${base}/reports`, apiVersion, ...deps.signedIn, modOnly, async (ctx) => {
    const wanted = String(ctx.query.filter ?? "all") as ModFilter;
    const filter = FILTERS.includes(wanted) ? wanted : "all";
    const offset = intOf(ctx.query.offset);
    ok(ctx, { ...(await listModReports(deps.em(), { filter, offset: offset !== undefined && offset > 0 ? offset : 0 }, now())) });
  });

  router.get(`${base}/reports/players/:id`, apiVersion, ...deps.signedIn, modOnly, async (ctx) => {
    const id = intOf(ctx.params.id);
    const player = id !== undefined && id > 0 ? await modPlayer(deps.em(), ctx.authUser.userid, id, now()) : null;
    if (!player) return refuse(ctx, Status.NOT_FOUND, "notShown");
    ok(ctx, { player });
  });

  router.get(`${base}/reports/lines/:id/around`, apiVersion, ...deps.signedIn, modOnly, async (ctx) => {
    const id = intOf(ctx.params.id);
    const around = id !== undefined && id > 0 ? await modLineAround(deps.em(), ctx.authUser.userid, id) : { outcome: "notOpen" as const };
    if (around.outcome !== "done") return refuse(ctx, Status.CONFLICT, "notOpen");
    ok(ctx, { lines: around.lines });
  });

  router.post(`${base}/reports/players/:id/act`, apiVersion, ...deps.signedIn, modOnly, async (ctx) => {
    const id = intOf(ctx.params.id);
    if (id === undefined || id < 1) return refuse(ctx, Status.NOT_FOUND, "notShown");
    const parsed = parseModAction(ctx.request.body);
    if (!parsed.ok) return refuse(ctx, Status.BAD_REQUEST, "badRequest", parsed.message);
    const done = await actAsModerator(deps.em(), ctx.authUser.userid, id, parsed.value.action, parsed.value.seen, deps.effects, now());
    if (done.outcome === "done") return ok(ctx, { closed: done.closed, player: done.player });
    const status =
      done.outcome === "self" || done.outcome === "gameTeam" || done.outcome === "moderator"
        ? Status.FORBIDDEN
        : done.outcome === "noPlayer"
          ? Status.NOT_FOUND
          : Status.CONFLICT;
    refuse(ctx, status, done.outcome);
  });
};
