import type { YardRouteEntry } from "./index.js";

/**
 * The yard routes of the new-player tutorial's screen tips package (c): `tips/seen` (`docs/design/tutorial.md`
 * §7, §8.3). Issue #227.
 *
 * Empty until that package lands. The foundation (WP0) gave each tutorial
 * package its own route file, spread into `yardRoutes` by `index.ts`, so the
 * three packages never edit the same file. Paths are under `/bm/yard/`.
 */
export const tipsRoutes: YardRouteEntry[] = [];
