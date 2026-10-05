import type { YardRouteEntry } from "./index.js";
import { yardAchievementsSeenAction, yardAchievementsStateAction } from "./achievementsActions.js";
import { yardRoute } from "./yardRoute.js";

/**
 * The player's own achievements routes (`docs/design/achievements.md` §9.1,
 * issue #204, WP4). Paths are under `/bm/yard/`; the actions are in
 * `achievementsActions.ts`.
 *
 * - `achievements/state`: every available entry with its progress, the
 *   counts, the Shiny earned, and the unlocks not yet shown.
 * - `achievements/seen { ids }`: the client showed those unlocks' pop-ups.
 */
export const achievementsRoutes: YardRouteEntry[] = [
  { path: "achievements/state", controller: yardRoute(yardAchievementsStateAction) },
  { path: "achievements/seen", controller: yardRoute(yardAchievementsSeenAction) },
];
