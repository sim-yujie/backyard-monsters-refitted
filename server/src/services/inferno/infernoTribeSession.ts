import { redis } from "../../server.js";
import { ATTACK_FINAL_LOCK_SECONDS } from "../base/attackCheckpoint.js";
import { ATTACK_SESSION_TTL, serialiseAttackSession } from "../base/attackSession.js";
import { parseDescentSession, type DescentSession } from "./descentSession.js";

/**
 * The attack session of a Moloch tribe attack (`docs/design/inferno.md` §2.7,
 * WP 2.8). A tribe yard has no row: every player fights their own copy, as
 * with the Descent (`descentSession.ts`), so the session is keyed by the
 * attacker alone, one tribe attack at a time, and names the tribe. It holds
 * the same as a Descent session: the base id, what one fling may carry
 * (`infernoTribeFlingCapacity`) and the attack session, with the Inferno
 * yard's army as `entryHoused`. Minted by `POST /bm/inferno/attack/start`,
 * required by the save that ends the attack (`infernoTribeLanding.ts`), with
 * the same 420-second window.
 */
export type InfernoTribeSession = DescentSession;

export const infernoTribeSessionKey = (userid: number) => `attack-session:inferno-tribe:${userid}`;

/** The lock that lets exactly one save end that attack (issue #138's rule). */
export const infernoTribeFinalLockKey = (userid: number) => `attack-final:inferno-tribe:${userid}`;

export const startInfernoTribeSession = async (userid: number, tribe: InfernoTribeSession): Promise<void> => {
  await redis.setex(
    infernoTribeSessionKey(userid),
    ATTACK_SESSION_TTL,
    JSON.stringify({
      baseid: tribe.baseid,
      flingerCapacity: tribe.flingerCapacity,
      session: serialiseAttackSession(tribe.session),
    })
  );
};

export const readInfernoTribeSession = async (userid: number): Promise<InfernoTribeSession | null> =>
  parseDescentSession(await redis.get(infernoTribeSessionKey(userid)));

export const endInfernoTribeSession = async (userid: number): Promise<void> => {
  await redis.del(infernoTribeSessionKey(userid));
};

/** @returns True when the caller now holds the lock. */
export const acquireInfernoTribeFinalLock = async (userid: number): Promise<boolean> =>
  (await redis.set(infernoTribeFinalLockKey(userid), "1", "EX", String(ATTACK_FINAL_LOCK_SECONDS), "NX")) === "OK";

export const releaseInfernoTribeFinalLock = async (userid: number): Promise<void> => {
  await redis.del(infernoTribeFinalLockKey(userid));
};
