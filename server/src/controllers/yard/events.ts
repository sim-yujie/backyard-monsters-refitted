import { sqlProgressStore } from "../../services/events/progressStore.js";
import { eventsActions } from "./eventsActions.js";
import type { YardRouteEntry } from "./index.js";
import { yardRoute } from "./yardRoute.js";

/**
 * The event claims' yard routes (`eventsActions.ts`), under `/bm/yard/`.
 * Main yard only (no `outposts` policy). The read-only list of events and
 * the player's progress is `GET /bm/events` (`controllers/events/eventsState.ts`).
 */

const actions = eventsActions(sqlProgressStore);

export const eventsRoutes: YardRouteEntry[] = [
  { path: "events/calendar/claim", controller: yardRoute(actions.calendarClaim) },
  { path: "events/ladder/claim", controller: yardRoute(actions.ladderClaim) },
];
