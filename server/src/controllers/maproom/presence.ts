import type { KoaController } from "../../utils/KoaController.js";
import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { redis } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";

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
 * It only refreshes the key: no save is read or written, so it costs one
 * Redis write. It is not a real game action (#271): a ping says a game is
 * open, not that anyone is playing it, and a player online by pings alone
 * reads as offline ten minutes after their last real action
 * (`services/user/online.ts`).
 */
export const presence: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await redis.setex(`last-seen:main:${user.userid}`, PRESENCE_TTL_SECONDS, getCurrentDateTime().toString());

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
