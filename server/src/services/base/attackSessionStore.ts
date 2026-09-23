import { redis } from "../../server.js";
import {
  ATTACK_SESSION_TTL,
  attackSessionKey,
  parseAttackSession,
  serialiseAttackSession,
  type AttackSession,
} from "./attackSession.js";

/**
 * Where an attack session is kept (issue #25, `attackSession.ts`).
 *
 * Redis, because that is already where this server keeps session state: the
 * login token store is Redis-backed (`middleware/auth.ts`), so a Redis that has
 * lost its keys has logged everybody out and cannot strand an attack that
 * outlived it. The key expires on its own, which is the whole of the cleanup.
 *
 * Split out from the rule so the rule stays importable — and testable — without
 * pulling in `server.ts` and with it the ORM and every connection it opens.
 */

/**
 * Records the attacker against the defender's row for the length of the attack.
 *
 * Called once the attack has been persisted, so `basesaveid` is populated.
 *
 * @param {number} basesaveid - The defender row being attacked.
 * @param {AttackSession} session - The attacker, the attack id and the start time.
 */
export const startAttackSession = async (
  basesaveid: number,
  session: AttackSession
): Promise<void> => {
  await redis.setex(
    attackSessionKey(basesaveid),
    ATTACK_SESSION_TTL,
    serialiseAttackSession(session)
  );
};

/**
 * Reads back the session for a defender row.
 *
 * @param {number} basesaveid - The defender row being saved.
 * @returns {Promise<AttackSession | null>} The session, or null if there is none.
 */
export const readAttackSession = async (basesaveid: number): Promise<AttackSession | null> =>
  parseAttackSession(await redis.get(attackSessionKey(basesaveid)));

/**
 * Drops the session when the attack is over, so the row is free immediately
 * rather than carrying a key that authorises nothing until it times out.
 *
 * @param {number} basesaveid - The defender row whose attack has ended.
 */
export const endAttackSession = async (basesaveid: number): Promise<void> => {
  await redis.del(attackSessionKey(basesaveid));
};
