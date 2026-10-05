import type { Context } from "koa";

import { ATTACK_MODES } from "../../enums/Base.js";

/**
 * The routes that count as a real game action (#271), in one place.
 *
 * A player counts as online, and so cannot be attacked, only while they have
 * done one of these in the last ten minutes (`online.ts`). The owner's rule:
 * real server-side game actions count (collect, build, upgrade, hatch,
 * attack, planner apply and the like); being there does not. So none of
 * these count:
 *
 * - the `/presence` ping, and every load or poll a client sends while it sits
 *   still: `/base/load` outside an attack, the yard's `state`, Map Room 1's
 *   re-read, Map Room 2's cells and quotes, notifications, attack logs;
 * - an attack's `/base/checkpoint`, sent by itself every few seconds (the
 *   attack's start and its save count);
 * - the account, mail, alliance, bookmark and tutorial-tip routes, which are
 *   not playing the game.
 *
 * Only a success counts: a 2xx answer whose body carries no error. The
 * middleware (`middleware/realAction.ts`) matches each request's method and
 * route pattern, as `app.routes.ts` writes it, against this list.
 */

export interface RealActionRoute {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  /** The pattern as `app.routes.ts` registers it. */
  readonly path: string;
  /**
   * Narrows a route that is only sometimes an action. The middleware asks once
   * the route has answered, so it may read the request or the answer.
   */
  readonly when?: (ctx: Context) => boolean;
}

/** The yard prefix, `POST /api/:apiVersion/bm/yard/<path>` (`controllers/yard/index.ts`). */
export const YARD_ROUTE_PREFIX = "/api/:apiVersion/bm/yard/";

/** Every yard route that is a real action. */
export const REAL_ACTION_YARD_PATHS: readonly string[] = [
  "upgrade",
  "upgrade/cancel",
  "speedup",
  "upgrade/instant",
  "shop/buy",
  "locker/start",
  "locker/cancel",
  "locker/finish",
  "locker/instant",
  "hatchery/add",
  "hatchery/remove",
  "hatchery/finish",
  // Collecting: the bank and the mushrooms.
  "bank",
  "mushroom/pick",
  "build",
  "build/cancel",
  "build/instant",
  "academy/train",
  "academy/cancel",
  "academy/finish",
  "academy/instant",
  "repair",
  "repair/instant",
  "recycle",
  "juice",
  "bunker/fill",
  "bunker/remove",
  "lab/start",
  "lab/cancel",
  "lab/finish",
  "lab/instant",
  "champion/raise",
  "champion/feed",
  "champion/evolve",
  "champion/heal",
  "champion/rename",
  "champion/stance",
  "champion/juice",
  "champion/freeze",
  "champion/thaw",
  "fortify",
  "fortify/cancel",
  "starterkit",
  "decor/place",
  "goals/claim",
  "goals/baiter-start",
  "goals/baiter-run",
  "guide/advance",
  "guide/finish",
  "guide/army",
  "guide/skip",
];

/**
 * The yard routes that are not: reads, and a tip or an achievement pop-up
 * marked seen. A test holds every yard route to one list or the other, so a
 * new route needs a decision.
 */
export const NOT_REAL_ACTION_YARD_PATHS: readonly string[] = [
  "state",
  "goals/state",
  "tips/seen",
  "achievements/state",
  "achievements/seen",
];

/** An in-game check's answer (#273) counts only when it was right. */
const isSolvedCheck = (ctx: Context): boolean => (ctx.body as { solved?: unknown } | undefined)?.solved === true;

/** An attack load: the attack's start. Any other load is not an action. */
const isAttackLoad = (ctx: Context): boolean => {
  const body = ctx.request.body as { type?: unknown } | undefined;
  return typeof body?.type === "string" && ATTACK_MODES.has(body.type);
};

export const REAL_ACTION_ROUTES: readonly RealActionRoute[] = [
  // Attacks: the start (an attack load) and the save that ends one. A Flash
  // yard save goes through /base/save as well, and is the Flash player's work.
  { method: "POST", path: "/base/load", when: isAttackLoad },
  { method: "POST", path: "/api/:apiVersion/bm/base/load", when: isAttackLoad },
  { method: "POST", path: "/base/save" },
  { method: "POST", path: "/api/:apiVersion/bm/base/save" },
  // Moving the main yard.
  { method: "POST", path: "/base/migrate" },
  { method: "POST", path: "/base/migratetofriend" },
  { method: "POST", path: "/base/rejectmigratetofriend" },
  { method: "GET", path: "/worldmapv3/relocate" },
  // Map Room 2: taking over, auto-attacking, sending monsters.
  { method: "POST", path: "/worldmapv2/takeoverCell" },
  { method: "POST", path: "/worldmapv2/declinetakeover" },
  { method: "POST", path: "/worldmapv2/autoattack" },
  { method: "POST", path: "/worldmapv2/transferassets" },
  // The Yard Planner's writes to the yard.
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/apply" },
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/walls/upgrade" },
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/traps/rearm" },
  // The "Stay protected?" prompt's tap (#275): the player said they are there.
  { method: "POST", path: "/api/:apiVersion/bm/presence/stay" },
  // A wild monster raid on the player's yard (#226): every answer to it, so watching one keeps them online.
  { method: "POST", path: "/api/:apiVersion/bm/raid/engage" },
  { method: "POST", path: "/api/:apiVersion/bm/raid/prepare" },
  { method: "POST", path: "/api/:apiVersion/bm/raid/start" },
  { method: "POST", path: "/api/:apiVersion/bm/raid/finish" },
  { method: "POST", path: "/api/:apiVersion/bm/raid/frequency" },
  // The in-game check (#273), answered right: the player is there after all.
  { method: "POST", path: "/api/:apiVersion/bm/presence/check/answer", when: isSolvedCheck },
  // Yard actions.
  ...REAL_ACTION_YARD_PATHS.map((path): RealActionRoute => ({ method: "POST", path: `${YARD_ROUTE_PREFIX}${path}` })),
];

const byRoute = new Map(REAL_ACTION_ROUTES.map((route) => [`${route.method} ${route.path}`, route]));

/** Whether a request to this route counts; asked once it has answered (see `when`). */
export const isRealActionRequest = (ctx: Context, matchedRoute: string | undefined): boolean => {
  if (matchedRoute === undefined) return false;
  const route = byRoute.get(`${ctx.method} ${matchedRoute}`);
  return route !== undefined && (route.when?.(ctx) ?? true);
};

/** Whether the answer is a success: 2xx, and no `error` other than 0 in the body. */
export const answeredOk = (ctx: Context): boolean => {
  if (ctx.status < 200 || ctx.status >= 300) return false;
  const body = ctx.body as { error?: unknown } | null | undefined;
  if (body === null || body === undefined || typeof body !== "object") return true;
  const error = body.error;
  return error === undefined || error === null || error === 0 || error === "0" || error === false;
};
