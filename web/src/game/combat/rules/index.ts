/**
 * The shared combat rules module: one source, two runtimes.
 *
 * Everything under this directory is executed by both trees. The source of
 * truth is here, in `web/`, where issue #22's Wild Monster Baiter iterates on
 * it and the stricter compiler runs; `web/tools/sync-combat-rules.mjs` copies
 * every non-test file into `server/src/game-rules/combat/` byte for byte and
 * writes a SHA-256 manifest into both directories, and a drift test on each
 * side fails if a copy stops matching (`docs/design/server-combat.md` §3.2).
 *
 * The web client imports `@/game/combat/rules`; the server imports
 * `../../../game-rules/combat/index.js`. Both get the same bytes, which is what
 * makes the Baiter's simulation and the server's audit agree.
 *
 * ## The rules the module lives by
 *
 * `boundary.test.ts` reads every file here and refuses:
 *
 * - an import that is not relative and inside this directory — no `@/`, no
 *   `pixi.js`, no `node:`, nothing from Bun or Koa;
 * - `window`, `document`, `performance`, `Date.now` or `Math.random`, because
 *   the engine is deterministic and takes its clock and its randomness as
 *   inputs (`docs/design/server-combat.md` §3.4);
 * - a line over 100 columns.
 *
 * Relative imports carry the `.js` suffix, which the server's `NodeNext`
 * resolution requires and the web's `bundler` resolution accepts for a `.ts`
 * file, so the copy needs no rewriting.
 */

export * from "./combatStatsData.js";
export * from "./stats.js";
