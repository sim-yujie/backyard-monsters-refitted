import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { SetAvatarSchema } from "../../schemas/AuthSchemas.js";
import { unknownAvatarErr } from "../../errors/errors.js";
import { isAvatarPath } from "../../game-data/avatars.js";

/**
 * Sets a player's avatar from a `/player/avatar` body (issue #175).
 *
 * The avatar is one of the twelve critters in `game-data/avatars.ts`, stored in
 * `pic_square` as its path; anything else is refused before it is written, so
 * the column that chat, leaderboards and attack logs read never holds a
 * caller's own URL. Takes the entity manager so it can be tested without one.
 *
 * @param {Pick<EntityManager, "flush">} em - Flushes the change.
 * @param {User} user - The authenticated user.
 * @param {unknown} body - The request body.
 * @returns {Promise<string>} The stored path.
 * @throws {ClientSafeError} If the avatar is not on the allow-list.
 */
export const setAvatarFor = async (
  em: Pick<EntityManager, "flush">,
  user: User,
  body: unknown
): Promise<string> => {
  const parsed = SetAvatarSchema.safeParse(body);

  if (!parsed.success || !isAvatarPath(parsed.data.avatar)) throw unknownAvatarErr();

  user.pic_square = parsed.data.avatar;
  await em.flush();

  return parsed.data.avatar;
};
