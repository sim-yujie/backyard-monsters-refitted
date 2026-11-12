import { Env } from "../enums/Env.js";
import { logger } from "../utils/logger.js";
import { isSwitchOn } from "./BotConfig.js";

/**
 * The quiet-login switch, for local test servers only (owner, 11 Nov 2026).
 *
 * A test account logged in to take pictures should land straight in its yard,
 * with none of the pop-ups that open by themselves on login: "What's new",
 * Moloch's emergence and its forced Inferno raid, the daily login card, the
 * country question, "Slow internet?", the owner's announcements, the weekend
 * pop-up, the support reminder, achievement cards waiting from before, Korath
 * unlocked, a team notice and Bob's one-time tips. The load tells the web
 * client (`quietlogin: 1`), which leaves them shut; the server itself leaves
 * the cave where it is and does not ask for the country.
 *
 * On only when BOTH hold:
 *
 * - `QUIET_LOGIN` is `1`, `on` or `true`: off unless someone sets it;
 * - the server is not the live one: `NODE_ENV` is not `production` and `ENV`
 *   is not `production`. Set there, it is refused (and said so once in the log).
 *
 * Read on each use, so tests can flip it.
 */
export const quietLoginOn = (env: Record<string, string | undefined> = process.env): boolean => {
  const raw = env.QUIET_LOGIN;
  if (!(isSwitchOn(raw) || raw?.trim() === "1")) return false;
  if (env.NODE_ENV === "production" || env.ENV === Env.PROD) {
    if (!warned) {
      warned = true;
      logger.warn("QUIET_LOGIN is set on a production server: refused, players see every pop-up as usual");
    }
    return false;
  }
  return true;
};

let warned = false;
