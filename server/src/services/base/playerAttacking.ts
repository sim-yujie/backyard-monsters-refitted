import { redis } from "../../server.js";
import { ATTACK_SESSION_WINDOW, attackerSessionKey } from "./attackSession.js";
import { readAttackSession } from "./attackSessionStore.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";

/**
 * Whether a player is in an attack of their own right now (issue #366): the
 * row their latest attack started on still holds a live session that names
 * them. A session ends when its attack is saved, so a finished attack reads
 * as none, as does one older than the attack window.
 *
 * Only attacks bound by a session count: a Map Room 1 tribe's is keyed by the
 * attacker already and never touches a Map Room 2 yard.
 *
 * @param userid - The player.
 */
export const isPlayerAttacking = async (userid: number): Promise<boolean> => {
  const row = Number(await redis.get(attackerSessionKey(userid)));
  if (!Number.isSafeInteger(row) || row <= 0) return false;

  const session = await readAttackSession(row);
  if (!session || session.attackerid !== userid) return false;

  return getCurrentDateTime() - session.startedat < ATTACK_SESSION_WINDOW;
};
