import type { YardRouteEntry } from "./index.js";
import {
  yardGuideAdvanceAction,
  yardGuideArmyAction,
  yardGuideFinishAction,
  yardGuideSkipAction,
} from "./guideActions.js";
import { yardRoute } from "./yardRoute.js";

/**
 * The yard routes of the new-player tutorial's guided start package (b): `guide/advance`,
 * `guide/finish`, `guide/army`, `guide/skip` (`docs/design/tutorial.md` §2, §8.3). Issue #227.
 * The actions are `guideActions.ts`; the guide's paid build is `/bm/yard/build`
 * itself (`build.ts`). Paths are under `/bm/yard/`.
 */
export const guideRoutes: YardRouteEntry[] = [
  { path: "guide/advance", controller: yardRoute(yardGuideAdvanceAction) },
  { path: "guide/finish", controller: yardRoute(yardGuideFinishAction) },
  { path: "guide/army", controller: yardRoute(yardGuideArmyAction) },
  { path: "guide/skip", controller: yardRoute(yardGuideSkipAction) },
];
