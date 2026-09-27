import type { KoaController } from "../../utils/KoaController.js";
import { yardStateAction } from "./state.js";
import { yardRoute } from "./yardRoute.js";
import { yardCancelUpgradeAction, yardUpgradeAction } from "./upgrade.js";

/**
 * Every yard action route, mounted by `app.routes.ts` as
 * `POST /api/:apiVersion/bm/yard/<path>` behind `apiVersion`, `verifyUserAuth`
 * and `logRequest` (`docs/design/yard-buildings.md` §2.1).
 *
 * Append-only: each work package adds its own lines at the end, so parallel
 * branches merge without touching each other's entries.
 */
export interface YardRouteEntry {
  /** Path under `/bm/yard/`, e.g. `state` or `upgrade/cancel`. */
  path: string;
  controller: KoaController;
}

export const yardRoutes: YardRouteEntry[] = [
  { path: "state", controller: yardRoute(yardStateAction) },
  { path: "upgrade", controller: yardRoute(yardUpgradeAction) },
  { path: "upgrade/cancel", controller: yardRoute(yardCancelUpgradeAction) },
];
