import { redisBaiterTokens } from "../../services/goals/baiterTokenStore.js";
import { goalsActions } from "./goalsActions.js";
import type { YardRouteEntry } from "./index.js";
import { yardRoute } from "./yardRoute.js";

/**
 * The yard routes of the new-player tutorial's Goals package (a)
 * (`docs/design/tutorial.md` §6, §8.3, issue #227). Paths are under
 * `/bm/yard/`. Each runs under the save row lock, and each refuses on an
 * outpost (no `outposts` policy): Goals belong to the account's main yard.
 *
 * - `goals/state`: the baseline when pending, sticky `done`, every shown goal.
 * - `goals/claim { id }`: pays one goal, capped at storage.
 * - `goals/baiter-start` and `goals/baiter-run { token }`: the record of a
 *   finished Baiter practice run (goal N1, `services/goals/baiterRun.ts`).
 */

const actions = goalsActions(redisBaiterTokens);

export const goalsRoutes: YardRouteEntry[] = [
  { path: "goals/state", controller: yardRoute(actions.state) },
  { path: "goals/claim", controller: yardRoute(actions.claim) },
  { path: "goals/baiter-start", controller: yardRoute(actions.baiterStart) },
  { path: "goals/baiter-run", controller: yardRoute(actions.baiterRun) },
];
