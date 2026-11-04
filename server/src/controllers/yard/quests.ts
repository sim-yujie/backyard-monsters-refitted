import type { YardRouteEntry } from "./index.js";
import { questsActions } from "./questsActions.js";
import { yardRoute } from "./yardRoute.js";

/**
 * The quest window's yard routes (`questsActions.ts`), under `/bm/yard/`:
 * the read, the login card, quest and bonus claims, and the daily swap.
 * Main yard only (no `outposts` policy).
 */

const actions = questsActions();

export const questsRoutes: YardRouteEntry[] = [
  { path: "quests/state", controller: yardRoute(actions.state) },
  { path: "quests/login/claim", controller: yardRoute(actions.loginClaim) },
  { path: "quests/claim", controller: yardRoute(actions.claim) },
  { path: "quests/bonus/claim", controller: yardRoute(actions.bonusClaim) },
  { path: "quests/swap", controller: yardRoute(actions.swap) },
];
