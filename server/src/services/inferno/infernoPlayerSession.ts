import { redis } from "../../server.js";
import { ATTACK_FINAL_LOCK_SECONDS } from "../base/attackCheckpoint.js";
import { ATTACK_SESSION_TTL, serialiseAttackSession } from "../base/attackSession.js";
import { parseDescentSession, type DescentSession } from "./descentSession.js";

/**
 * The attack session of an Inferno player attack (`docs/design/inferno.md`
 * §2.7, WP 3.2). The defender's Inferno yard is a real row, so the session is
 * keyed by its `basesaveid`, one attack at a time, as a surface attack's is
 * (`attackSessionStore.ts`); it lives under its own keys so the surface
 * finaliser never lands an Inferno attack with surface rules. It holds what a
 * tribe session holds: the base id, what one fling may carry (a Housing
 * Bunker's load, R11) and the attack session, with the Inferno yard's army as
 * `entryHoused` and the defender's purse as `defenderResources`. Minted by
 * `POST /bm/inferno/attack/start`, required by the save that ends the attack
 * (`infernoPlayerLanding.ts`), with the same 420-second window.
 */
export type InfernoPlayerSession = DescentSession;

export const infernoPlayerSessionKey = (basesaveid: number) => `attack-session:inferno-player:${basesaveid}`;

/** The lock that lets exactly one save end that attack (issue #138's rule). */
export const infernoPlayerFinalLockKey = (basesaveid: number) => `attack-final:inferno-player:${basesaveid}`;

export const startInfernoPlayerSession = async (basesaveid: number, attack: InfernoPlayerSession): Promise<void> => {
  await redis.setex(
    infernoPlayerSessionKey(basesaveid),
    ATTACK_SESSION_TTL,
    JSON.stringify({
      baseid: attack.baseid,
      flingerCapacity: attack.flingerCapacity,
      session: serialiseAttackSession(attack.session),
    })
  );
};

export const readInfernoPlayerSession = async (basesaveid: number): Promise<InfernoPlayerSession | null> =>
  parseDescentSession(await redis.get(infernoPlayerSessionKey(basesaveid)));

export const endInfernoPlayerSession = async (basesaveid: number): Promise<void> => {
  await redis.del(infernoPlayerSessionKey(basesaveid));
};

/** @returns True when the caller now holds the lock. */
export const acquireInfernoPlayerFinalLock = async (basesaveid: number): Promise<boolean> =>
  (await redis.set(infernoPlayerFinalLockKey(basesaveid), "1", "EX", String(ATTACK_FINAL_LOCK_SECONDS), "NX")) === "OK";

export const releaseInfernoPlayerFinalLock = async (basesaveid: number): Promise<void> => {
  await redis.del(infernoPlayerFinalLockKey(basesaveid));
};
