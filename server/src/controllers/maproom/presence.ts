import type { KoaController } from "../../utils/KoaController.js";
import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { postgres, redis } from "../../server.js";
import { presenceAnswer } from "../../services/user/presenceAnswer.js";
import { raidOnPing, type RaidView } from "../../services/raids/raidFlow.js";
import { parseRaidScreen, recordRaidScreen } from "../../services/raids/raidStore.js";
import { logger } from "../../utils/logger.js";

/**
 * How long one ping keeps the player online, in seconds: the life every other
 * writer of the key gives it (`baseLoad.ts`, `baseSave.ts`, `updateSaved.ts`).
 */
export const PRESENCE_TTL_SECONDS = 120;

/**
 * `POST /api/:apiVersion/bm/presence` — the web client's "I am still here"
 * (bot neighbours WP9, #242; `docs/design/bot-neighbours.md` §8).
 *
 * "Online" is the Redis key `last-seen:main:<userid>`: an attack load refuses
 * a main yard whose key is under 60 seconds old (`baseModeAttack.ts`), and the
 * neighbour lists read it as `saved`. Flash refreshed it with its 30-second
 * `updatesaved` poll; the web client never polls, so a web player sitting in
 * their yard read as offline a minute after the yard loaded and could be
 * attacked while they watched. The client now pings this every 30 seconds
 * while its tab is visible and the player is on any screen of the game: a
 * revenge lands only while the player is away.
 *
 * It refreshes the key and reads two more: no save is written, and one is
 * read only while an attack session runs on the main yard. It is not a real
 * game action (#271): a ping says a game is open, not that anyone is playing
 * it, and a player online by pings alone reads as offline ten minutes after
 * their last real action (`services/user/online.ts`).
 *
 * The answer (#275, `PresenceAnswer`) carries the server's clock, the last
 * real action, for the client's "Stay protected?" prompt, and an attack on
 * the main yard, for the banner that locks the yard while it runs.
 *
 * Wild monster raids (#226 WP3, `docs/design/wild-raids.md` §7.3): the body
 * says what the player is looking at, `{ where: "yard" | "other", planner }`
 * (the web yard sends `where: "yard"` and whether its Planner is open). It is
 * kept for as long as the ping counts, and a ping that says "yard, Planner
 * closed" may open a raid that is due (`raidOnPing`). The open raid comes back
 * as `raid`. A ping with no body (older clients, Flash) never gets one. A
 * raid that fails to open is logged and never fails the ping.
 */
export const presence: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const now = getCurrentDateTime();
  await redis.setex(`last-seen:main:${user.userid}`, PRESENCE_TTL_SECONDS, now.toString());

  const screen = parseRaidScreen(ctx.request.body);
  if (screen) await recordRaidScreen(user.userid, screen);
  let raid: RaidView | undefined;
  try {
    raid = await raidOnPing(postgres.em, user, screen, now);
  } catch (err) {
    logger.error("Could not check for a wild monster raid for userid {userid}: {error}", {
      event: "wild-raid-ping-failed",
      userid: user.userid,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  ctx.status = Status.OK;
  ctx.body = { error: 0, ...(await presenceAnswer(user, now)), ...(raid && { raid }) };
};

/**
 * `POST /api/:apiVersion/bm/presence/stay` — the "Stay protected?" prompt's
 * tap (#275): a real game action (`realActions.ts`), so the middleware moves
 * `last-action` to now once this answers, and the player is online again for
 * ten minutes. It refreshes the presence mark too, as a ping does, and
 * answers like one, with `lastAction` already now.
 */
export const stayProtected: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const now = getCurrentDateTime();
  await redis.setex(`last-seen:main:${user.userid}`, PRESENCE_TTL_SECONDS, now.toString());

  ctx.status = Status.OK;
  ctx.body = { error: 0, ...(await presenceAnswer(user, now, now)) };
};
