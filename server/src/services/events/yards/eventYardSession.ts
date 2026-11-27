import { redis } from "../../../server.js";
import { ATTACK_FINAL_LOCK_SECONDS } from "../../base/attackCheckpoint.js";
import {
  ATTACK_SESSION_TTL,
  parseAttackSession,
  serialiseAttackSession,
  type AttackSession,
} from "../../base/attackSession.js";

/**
 * The attack session of a Brukkarg event yard attack (beta 10), kept as a
 * Map Room 1 tribe's is (`mr1TribeSession.ts`): every player fights their
 * own copy of the yard, which has no row, so the session is keyed by the
 * attacker and the yard. Minted by the attack load (`eventYardAttack.ts`),
 * required by the save that lands it (`eventYardLanding.ts`), with the same
 * 420-second window. The event run it belongs to is the one that covered
 * its `startedat` (`yardRunIdAt`).
 */

export const eventYardSessionKey = (userid: number, baseid: string) => `attack-session:event:${userid}:${baseid}`;

/** The lock that lets exactly one save end that attack (issue #138's rule). */
export const eventYardFinalLockKey = (userid: number, baseid: string) => `attack-final:event:${userid}:${baseid}`;

export const startEventYardSession = async (userid: number, baseid: string, session: AttackSession): Promise<void> => {
  await redis.setex(eventYardSessionKey(userid, baseid), ATTACK_SESSION_TTL, serialiseAttackSession(session));
};

export const readEventYardSession = async (userid: number, baseid: string): Promise<AttackSession | null> =>
  parseAttackSession(await redis.get(eventYardSessionKey(userid, baseid)));

/** @returns True when the caller now holds the lock. */
export const acquireEventYardFinalLock = async (userid: number, baseid: string): Promise<boolean> =>
  (await redis.set(eventYardFinalLockKey(userid, baseid), "1", "EX", String(ATTACK_FINAL_LOCK_SECONDS), "NX")) === "OK";

export const releaseEventYardFinalLock = async (userid: number, baseid: string): Promise<void> => {
  await redis.del(eventYardFinalLockKey(userid, baseid));
};
