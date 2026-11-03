import type { Context } from "koa";

import { ATTACK_MODES } from "../../enums/Base.js";

/**
 * The routes that count as a real game action (#271), in one place.
 *
 * A player counts as online, and so cannot be attacked, only while they have
 * done one of these in the last ten minutes (`online.ts`). The owner's rule:
 * real server-side game actions count (collect, build, upgrade, hatch,
 * attack, planner apply and the like); being there does not. Since 3 Nov
 * every deliberate player action counts (owner: an active player must never
 * be disconnected): Layout saves, the Inferno's attacks and transfers, mail,
 * world chat (`chat/chatRooms.ts`), friends' help and gifts, alliance work
 * and Map Room bookmarks too. None of these count
 * ({@link NOT_REAL_ACTION_ROUTES}):
 *
 * - the `/presence` ping, and every load or poll a client sends while it sits
 *   still: `/base/load` outside an attack, the yard's `state`, Map Room 1's
 *   re-read, Map Room 2's cells and quotes, notifications, attack logs;
 * - an attack's `/base/checkpoint`, sent by itself every few seconds (the
 *   attack's start and its save count);
 * - reading (a mail thread, another yard), marking something seen, reports,
 *   tutorial tips, and the account's own settings and sign-in.
 *
 * A test holds every write route in `app.routes.ts` and the friends routes
 * to one list or the other, so a new feature's actions cannot be left out
 * by accident, as the Inferno's, the Layout saves and the friends' were
 * (3 Nov: players disconnected while playing).
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
  "hatchery/clear",
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
  "champion/cancel-egg",
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
  "move",
  "goals/claim",
  "goals/baiter-start",
  "goals/baiter-run",
  "guide/advance",
  "guide/finish",
  "guide/army",
  "guide/skip",
  "events/ladder/claim",
  "siege/lab/start",
  "siege/lab/cancel",
  "siege/lab/finish",
  "siege/lab/instant",
  "siege/factory/start",
  "siege/factory/cancel",
  "siege/factory/finish",
  "siege/factory/instant",
];

/**
 * The yard routes that are not: reads, a tip or an achievement pop-up
 * marked seen, and the daily login-calendar claim (a reward for turning up,
 * which is being there, not playing). A test holds every yard route to one
 * list or the other, so a new route needs a decision.
 */
export const NOT_REAL_ACTION_YARD_PATHS: readonly string[] = [
  "state",
  "goals/state",
  "tips/seen",
  "achievements/state",
  "achievements/seen",
  "events/calendar/claim",
];

/** The alliance routes that are real actions, `POST /alliance/<name>`. */
const ALLIANCE_ACTIONS: readonly string[] = [
  "createalliance",
  "editalliance",
  "leavealliance",
  "requestjoin",
  "inviteuser",
  "activatepowerup",
  "purchasepowerup",
  "changeinvitestatus",
  "kickmember",
  "promotemember",
  "changerelationship",
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
  // Moving the main yard.
  { method: "POST", path: "/base/migrate" },
  { method: "POST", path: "/base/migratetofriend" },
  { method: "POST", path: "/base/rejectmigratetofriend" },
  { method: "POST", path: "/worldmapv2/randommove" },
  // Map Room 2: taking over, auto-attacking, sending monsters.
  { method: "POST", path: "/worldmapv2/takeoverCell" },
  { method: "POST", path: "/worldmapv2/declinetakeover" },
  { method: "POST", path: "/worldmapv2/autoattack" },
  { method: "POST", path: "/worldmapv2/transferassets" },
  // The Yard Planner's writes to the yard, and its saved layouts and templates.
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/apply" },
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/walls/upgrade" },
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/traps/rearm" },
  { method: "PUT", path: "/api/:apiVersion/bm/yardplanner/layouts/:slot" },
  { method: "DELETE", path: "/api/:apiVersion/bm/yardplanner/layouts/:slot" },
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/savetemplate" },
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/deletetemplate" },
  // The Inferno: an attack's start (its save is /base/save) and sending monsters down.
  { method: "POST", path: "/api/:apiVersion/bm/inferno/attack/start" },
  { method: "POST", path: "/api/:apiVersion/bm/inferno/transfer" },
  // Mail and truces (owner, 3 Nov). World chat counts in `chat/chatRooms.ts`.
  { method: "POST", path: "/api/:apiVersion/player/sendmessage" },
  { method: "POST", path: "/api/:apiVersion/player/requesttruce" },
  // Friends: help in their yard, gifts, requests.
  { method: "POST", path: "/api/:apiVersion/bm/friends/help" },
  { method: "POST", path: "/api/:apiVersion/bm/friends/gift" },
  { method: "POST", path: "/api/:apiVersion/bm/friends/gifts/collect" },
  { method: "POST", path: "/api/:apiVersion/bm/friends/request" },
  { method: "POST", path: "/api/:apiVersion/bm/friends/request/answer" },
  // Map Room bookmarks.
  { method: "POST", path: "/api/:apiVersion/player/savebookmarks" },
  // Alliance work.
  ...ALLIANCE_ACTIONS.map((name): RealActionRoute => ({ method: "POST", path: `/alliance/${name}` })),
  // The "Stay protected?" prompt's tap (#275): the player said they are there.
  { method: "POST", path: "/api/:apiVersion/bm/presence/stay" },
  // A wild monster raid on the player's yard (#226): every answer to it, so watching one keeps them online.
  { method: "POST", path: "/api/:apiVersion/bm/raid/engage" },
  { method: "POST", path: "/api/:apiVersion/bm/raid/prepare" },
  { method: "POST", path: "/api/:apiVersion/bm/raid/start" },
  // The Trojan Horse's spring (#306 WP3, issue #326): a click, same as the raid routes above.
  { method: "POST", path: "/api/:apiVersion/bm/raid/trojan" },
  { method: "POST", path: "/api/:apiVersion/bm/raid/finish" },
  { method: "POST", path: "/api/:apiVersion/bm/raid/frequency" },
  // The in-game check (#273), answered right: the player is there after all.
  { method: "POST", path: "/api/:apiVersion/bm/presence/check/answer", when: isSolvedCheck },
  // Yard actions.
  ...REAL_ACTION_YARD_PATHS.map((path): RealActionRoute => ({ method: "POST", path: `${YARD_ROUTE_PREFIX}${path}` })),
];

/**
 * The write routes outside the yard that are not real actions, as
 * "METHOD pattern": sign-in and the account's own settings, reads and polls,
 * "seen" marks, reports, and DEV tools. A test holds every POST, PUT and
 * DELETE route in `app.routes.ts` and the friends routes to this list or
 * {@link REAL_ACTION_ROUTES}, so a new route needs a decision.
 */
export const NOT_REAL_ACTION_ROUTES: readonly string[] = [
  // Sign-in and the account's own settings.
  "POST /init",
  "POST /api/:apiVersion/player/getinfo",
  "POST /api/:apiVersion/player/logout",
  "POST /api/:apiVersion/player/register",
  "POST /api/:apiVersion/player/forgotPassword",
  "POST /api/:apiVersion/player/reset-password",
  "POST /api/:apiVersion/player/changeusername",
  "POST /api/:apiVersion/player/settings",
  "POST /api/:apiVersion/player/sound",
  "POST /api/:apiVersion/player/avatar",
  "POST /api/:apiVersion/player/block",
  "POST /api/:apiVersion/player/unblock",
  "POST /api/:apiVersion/bm/friends/remove",
  "POST /api/:apiVersion/bm/friends/request/cancel",
  "POST /alliance/deletemessages",
  // Reads, looks and polls a client sends while the player sits still.
  "POST /base/updatesaved",
  "POST /base/checkpoint",
  "POST /api/:apiVersion/bm/base/updatesaved",
  "POST /api/:apiVersion/bm/getnewmap",
  "POST /api/:apiVersion/bm/neighbours/get",
  "POST /api/:apiVersion/bm/inferno/load",
  "POST /api/:apiVersion/bm/inferno/view",
  "POST /api/:apiVersion/bm/presence",
  "POST /api/:apiVersion/bm/presence/check",
  "POST /api/:apiVersion/player/getmessagethread",
  "POST /alliance/searchalliances",
  "POST /worldmapv2/getarea",
  "POST /worldmapv2/sight",
  "POST /worldmapv2/takeoverquote",
  "POST /worldmapv2/autoattackplan",
  "POST /worldmapv2/setmapversion",
  // Marked seen.
  "POST /api/:apiVersion/bm/inferno/korath/seen",
  "POST /api/:apiVersion/bm/notifications/read",
  "POST /api/:apiVersion/bm/notifications/readall",
  // Reports.
  "POST /api/:apiVersion/bm/chat/report",
  "POST /api/:apiVersion/player/reportmessagethread",
  "POST /api/:apiVersion/bugreport",
  "POST /api/:apiVersion/bugreport/guest",
  "POST /api/:apiVersion/clienterrors",
  "POST /api/:apiVersion/clienterrors/guest",
  "POST /api/:apiVersion/player/recorddebugdata",
  // DEV only.
  "POST /api/:apiVersion/bm/presence/check/dev",
  "POST /api/:apiVersion/bm/raid/dev/due",
  "POST /api/:apiVersion/bm/raid/dev/trojan",
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
