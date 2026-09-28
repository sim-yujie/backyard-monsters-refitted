import { redis } from "../../../server.js";
import {
  ATTACK_SESSION_TTL,
  parseAttackSession,
  serialiseAttackSession,
  type AttackSession,
} from "../../base/attackSession.js";
import { ATTACK_FINAL_LOCK_SECONDS } from "../../base/attackCheckpoint.js";

/**
 * The attack session of a Map Room 1 tribe attack (issue #161).
 *
 * A Map Room 2 attack is bound to the defender's row (`attackSessionStore.ts`,
 * keyed by `basesaveid`). A Map Room 1 tribe has no row: every player has their
 * own copy of the four tribes, kept in their `Maproom` record. So the session
 * is keyed by the attacker and the tribe base instead, and holds the same
 * thing, minted by the attack load and required by the save
 * (`checkAttackBinding`, the same 420-second window).
 */

/** The key a player's attack on one tribe base is kept under. */
export const mr1TribeSessionKey = (userid: number, baseid: string) =>
  `attack-session:mr1:${userid}:${baseid}`;

/** The lock that lets exactly one save end that attack (issue #138's rule). */
export const mr1TribeFinalLockKey = (userid: number, baseid: string) =>
  `attack-final:mr1:${userid}:${baseid}`;

export const startMR1TribeSession = async (
  userid: number,
  baseid: string,
  session: AttackSession
): Promise<void> => {
  await redis.setex(mr1TribeSessionKey(userid, baseid), ATTACK_SESSION_TTL, serialiseAttackSession(session));
};

export const readMR1TribeSession = async (userid: number, baseid: string): Promise<AttackSession | null> =>
  parseAttackSession(await redis.get(mr1TribeSessionKey(userid, baseid)));

export const endMR1TribeSession = async (userid: number, baseid: string): Promise<void> => {
  await redis.del(mr1TribeSessionKey(userid, baseid));
};

/** @returns True when the caller now holds the lock. */
export const acquireMR1TribeFinalLock = async (userid: number, baseid: string): Promise<boolean> =>
  (await redis.set(
    mr1TribeFinalLockKey(userid, baseid),
    "1",
    "EX",
    String(ATTACK_FINAL_LOCK_SECONDS),
    "NX"
  )) === "OK";

export const releaseMR1TribeFinalLock = async (userid: number, baseid: string): Promise<void> => {
  await redis.del(mr1TribeFinalLockKey(userid, baseid));
};
