import type { Context } from "koa";

import { ATTACK_MODES } from "../../enums/Base.js";
import { MessageType } from "../../enums/MessageType.js";

/**
 * The routes that count as a real game action (#271), in one place.
 *
 * A player counts as online, and so cannot be attacked, only while they have
 * done one of these in the last ten minutes (`online.ts`). The owner's rule:
 * real server-side game actions count (collect, build, upgrade, hatch,
 * attack, planner apply and the like); being there does not. Since 3 Nov
 * every action that changes the game counts (owner: an active player must
 * never be disconnected): the Inferno's attacks and transfers, truce
 * requests, and friends' help and gifts too. None of these count
 * ({@link NOT_REAL_ACTION_ROUTES}):
 *
 * - the `/presence` ping, and every load or poll a client sends while it sits
 *   still: `/base/load` outside an attack, the yard's `state`, Map Room 1's
 *   re-read, Map Room 2's cells and quotes, notifications, attack logs;
 * - an attack's `/base/checkpoint`, sent by itself every few seconds (the
 *   attack's start and its save count);
 * - reading (a mail thread, another yard), marking something seen, reports,
 *   tutorial tips, and the account's own settings and sign-in;
 * - writes that change no game state and so could be repeated for nothing
 *   (security review, 3 Nov): saved layouts and templates, Map Room
 *   bookmarks, alliance work, friend requests, mail (owner, 3 Nov: "mail
 *   like chat") and world chat (not an HTTP route at all). They keep the player connected, as they are input, but
 *   do not renew the protection.
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
  "build/walls",
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
  "decor/buy",
  "move",
  "goals/claim",
  "goals/baiter-start",
  "goals/baiter-run",
  "guide/advance",
  "guide/finish",
  "guide/army",
  "guide/skip",
  "events/ladder/claim",
  "quests/claim",
  "quests/bonus/claim",
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
  // The quest window's read, its login card (as the event calendar) and the daily swap.
  "quests/state",
  "quests/login/claim",
  "quests/swap",
];

/** An in-game check's answer (#273) counts only when it was right. */
const isSolvedCheck = (ctx: Context): boolean => (ctx.body as { solved?: unknown } | undefined)?.solved === true;

/**
 * A mail that proposes a truce in a thread. Other mail is like world chat
 * (owner, 3 Nov: "mail like chat"): input, not a game action.
 */
const isTruceMail = (ctx: Context): boolean =>
  (ctx.request.body as { type?: unknown } | undefined)?.type === MessageType.TRUCE_REQUEST;

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
  // The Yard Planner's writes to the yard.
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/apply" },
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/walls/upgrade" },
  { method: "POST", path: "/api/:apiVersion/bm/yardplanner/traps/rearm" },
  // The Inferno: an attack's start (its save is /base/save) and sending monsters down.
  { method: "POST", path: "/api/:apiVersion/bm/inferno/attack/start" },
  { method: "POST", path: "/api/:apiVersion/bm/inferno/transfer" },
  // Truce requests (owner, 3 Nov): rate-limited, and bot-watched as any action.
  // Plain mail is not one (owner: "mail like chat").
  { method: "POST", path: "/api/:apiVersion/player/requesttruce" },
  { method: "POST", path: "/api/:apiVersion/player/sendmessage", when: isTruceMail },
  // Friends: help in their yard, and gifts.
  { method: "POST", path: "/api/:apiVersion/bm/friends/help" },
  { method: "POST", path: "/api/:apiVersion/bm/friends/gift" },
  { method: "POST", path: "/api/:apiVersion/bm/friends/gifts/collect" },
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
  // The Look and sound choices, sent by the game itself at load (owner's dashboard, 4 Nov 2026).
  "POST /api/:apiVersion/player/look",
  "POST /api/:apiVersion/player/avatar",
  "POST /api/:apiVersion/player/block",
  "POST /api/:apiVersion/player/unblock",
  "POST /api/:apiVersion/player/unmute",
  // Writes that change no game state, so a script could repeat them for
  // nothing (security review, 3 Nov): they keep the player connected, as
  // input does, but do not renew the protection.
  "PUT /api/:apiVersion/bm/yardplanner/layouts/:slot",
  "DELETE /api/:apiVersion/bm/yardplanner/layouts/:slot",
  "POST /api/:apiVersion/bm/yardplanner/savetemplate",
  "POST /api/:apiVersion/bm/yardplanner/deletetemplate",
  "POST /api/:apiVersion/player/savebookmarks",
  // A game-team warning or chat pause marked seen (moderation, 3 Nov).
  "POST /api/:apiVersion/bm/moderation/notice/:id/seen",
  "POST /api/:apiVersion/bm/friends/request",
  "POST /api/:apiVersion/bm/friends/request/answer",
  "POST /api/:apiVersion/bm/friends/request/cancel",
  "POST /api/:apiVersion/bm/friends/remove",
  // Pinning a friend to the top of the list (beta 7) only sorts it.
  "POST /api/:apiVersion/bm/friends/pin",
  "POST /alliance/createalliance",
  "POST /alliance/editalliance",
  "POST /alliance/leavealliance",
  "POST /alliance/requestjoin",
  "POST /alliance/inviteuser",
  "POST /alliance/activatepowerup",
  "POST /alliance/purchasepowerup",
  "POST /alliance/changeinvitestatus",
  "POST /alliance/kickmember",
  "POST /alliance/promotemember",
  "POST /alliance/changerelationship",
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
  // A moderator looking up a player to mail (beta 7).
  "POST /api/:apiVersion/player/mail/findplayer",
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
  "POST /api/:apiVersion/clienttiming",
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
