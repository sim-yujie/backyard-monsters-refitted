import { Env } from "../enums/Env.js";
import { isSwitchOn } from "./BotConfig.js";

/**
 * The tribe yard editor's switch (local servers only).
 *
 * The editor lets the owner design the Map Room 2 wild monster camps' yards in
 * the game and writes them into the server's own source files
 * (`game-data/tribes/v2/levels/<tribe>.ts`), so it must never run on the live
 * server. It is on only when ALL of these hold:
 *
 * - `TRIBE_EDITOR` is `on` (or `true`): off unless someone sets it;
 * - `ENV` is `local` (the live server runs with `ENV=production`, and
 *   `StartupSafety.ts` refuses a production `NODE_ENV` without it);
 * - `NODE_ENV` is not `production` (PM2's `ecosystem.config.mjs` sets it on
 *   the live server).
 *
 * When it is off, `app.routes.ts` does not register the editor's routes at
 * all, so they answer 404 like any unknown path, and every handler checks the
 * switch again before doing anything.
 */
export const tribeEditorEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  isSwitchOn(env.TRIBE_EDITOR) && env.ENV === Env.LOCAL && env.NODE_ENV !== "production";
