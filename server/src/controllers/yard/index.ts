import type { KoaController } from "../../utils/KoaController.js";
import { yardInstantUpgradeAction } from "./instantUpgrade.js";
import {
  yardLockerCancelAction,
  yardLockerFinishAction,
  yardLockerInstantAction,
  yardLockerStartAction,
} from "./locker.js";
import { yardShopBuyAction } from "./shopBuy.js";
import { yardSpeedupAction } from "./speedup.js";
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
  { path: "speedup", controller: yardRoute(yardSpeedupAction) },
  { path: "upgrade/instant", controller: yardRoute(yardInstantUpgradeAction) },
  { path: "shop/buy", controller: yardRoute(yardShopBuyAction) },
  { path: "locker/start", controller: yardRoute(yardLockerStartAction) },
  { path: "locker/cancel", controller: yardRoute(yardLockerCancelAction) },
  { path: "locker/finish", controller: yardRoute(yardLockerFinishAction) },
  { path: "locker/instant", controller: yardRoute(yardLockerInstantAction) },
];
