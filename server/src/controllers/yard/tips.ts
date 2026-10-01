import { yardTipsSeenAction } from "../../services/onboarding/tips.js";
import type { YardRouteEntry } from "./index.js";
import { yardRoute } from "./yardRoute.js";

/**
 * The yard routes of the new-player tutorial's screen tips package (c): `tips/seen` (`docs/design/tutorial.md`
 * §7, §8.3). Issue #227.
 *
 * The foundation (WP0) gave each tutorial package its own route file, spread
 * into `yardRoutes` by `index.ts`, so the three packages never edit the same
 * file. Paths are under `/bm/yard/`. The action is in
 * `services/onboarding/tips.ts`.
 */
export const tipsRoutes: YardRouteEntry[] = [
  { path: "tips/seen", controller: yardRoute(yardTipsSeenAction) },
];
