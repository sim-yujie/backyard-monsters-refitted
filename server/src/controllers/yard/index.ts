import type { KoaController } from "../../utils/KoaController.js";
import {
  yardAcademyCancelAction,
  yardAcademyFinishAction,
  yardAcademyInstantAction,
  yardAcademyTrainAction,
} from "./academy.js";
import { yardBankAction } from "./bank.js";
import { yardBuildAction, yardCancelBuildAction, yardInstantBuildAction } from "./build.js";
import {
  yardHatcheryAddAction,
  yardHatcheryFinishAction,
  yardHatcheryRemoveAction,
} from "./hatchery.js";
import { yardInstantUpgradeAction } from "./instantUpgrade.js";
import { yardJuiceAction } from "./juice.js";
import {
  yardLockerCancelAction,
  yardLockerFinishAction,
  yardLockerInstantAction,
  yardLockerStartAction,
} from "./locker.js";
import { yardMushroomPickAction } from "./mushrooms.js";
import { yardRecycleAction } from "./recycle.js";
import { yardRepairAction, yardRepairInstantAction } from "./repair.js";
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
  { path: "hatchery/add", controller: yardRoute(yardHatcheryAddAction) },
  { path: "hatchery/remove", controller: yardRoute(yardHatcheryRemoveAction) },
  { path: "hatchery/finish", controller: yardRoute(yardHatcheryFinishAction) },
  { path: "bank", controller: yardRoute(yardBankAction) },
  { path: "mushroom/pick", controller: yardRoute(yardMushroomPickAction) },
  { path: "build", controller: yardRoute(yardBuildAction) },
  { path: "build/cancel", controller: yardRoute(yardCancelBuildAction) },
  { path: "build/instant", controller: yardRoute(yardInstantBuildAction) },
  { path: "academy/train", controller: yardRoute(yardAcademyTrainAction) },
  { path: "academy/cancel", controller: yardRoute(yardAcademyCancelAction) },
  { path: "academy/finish", controller: yardRoute(yardAcademyFinishAction) },
  { path: "academy/instant", controller: yardRoute(yardAcademyInstantAction) },
  { path: "repair", controller: yardRoute(yardRepairAction) },
  { path: "repair/instant", controller: yardRoute(yardRepairInstantAction) },
  { path: "recycle", controller: yardRoute(yardRecycleAction) },
  { path: "juice", controller: yardRoute(yardJuiceAction) },
];
