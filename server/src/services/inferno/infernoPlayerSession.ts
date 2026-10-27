import { redis } from "../../server.js";
import {
  ATTACK_CHECKPOINT_TTL,
  ATTACK_FINAL_LOCK_SECONDS,
  parseStoredCheckpoint,
  serialiseCheckpoint,
  type AttackCheckpoint,
} from "../base/attackCheckpoint.js";
import { serialiseAttackSession } from "../base/attackSession.js";
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
 *
 * An attack once started is used (owner, 27 Oct): one its attacker leaves
 * without the final save is closed by the server from its last checkpoint
 * (`infernoPlayerFinalise.ts`). So the session is kept until the attack is
 * landed or closed, not just for its window (the window is the session's own
 * `startedat`, `checkAttackBinding`), and every open one is listed in
 * {@link INFERNO_PLAYER_ATTACKS} for the finaliser. The checkpoint, the
 * battle as the client last reported it, lives beside it under its own key,
 * so the surface finaliser never sees it.
 */
export type InfernoPlayerSession = DescentSession;

export const infernoPlayerSessionKey = (basesaveid: number) => `attack-session:inferno-player:${basesaveid}`;

/** The last checkpoint of the attack on that yard (`/base/checkpoint`). */
export const infernoPlayerCheckpointKey = (basesaveid: number) => `attack-checkpoint:inferno-player:${basesaveid}`;

/** Every Inferno yard with an open player attack, for the finaliser. */
export const INFERNO_PLAYER_ATTACKS = "attack-sessions:inferno-player";

/** The lock that lets exactly one save end that attack (issue #138's rule). */
export const infernoPlayerFinalLockKey = (basesaveid: number) => `attack-final:inferno-player:${basesaveid}`;

export const startInfernoPlayerSession = async (basesaveid: number, attack: InfernoPlayerSession): Promise<void> => {
  // A checkpoint left by an earlier attack on this yard is not this one's.
  await redis.del(infernoPlayerCheckpointKey(basesaveid));
  await redis.setex(
    infernoPlayerSessionKey(basesaveid),
    ATTACK_CHECKPOINT_TTL,
    JSON.stringify({
      baseid: attack.baseid,
      flingerCapacity: attack.flingerCapacity,
      session: serialiseAttackSession(attack.session),
    })
  );
  await redis.sadd(INFERNO_PLAYER_ATTACKS, String(basesaveid));
};

export const readInfernoPlayerSession = async (basesaveid: number): Promise<InfernoPlayerSession | null> =>
  parseDescentSession(await redis.get(infernoPlayerSessionKey(basesaveid)));

/** Ends the attack on that yard: landed or closed, it can be neither saved nor closed again. */
export const endInfernoPlayerSession = async (basesaveid: number): Promise<void> => {
  await redis.del(infernoPlayerSessionKey(basesaveid));
  await redis.del(infernoPlayerCheckpointKey(basesaveid));
  await redis.srem(INFERNO_PLAYER_ATTACKS, String(basesaveid));
};

export const storeInfernoPlayerCheckpoint = async (basesaveid: number, checkpoint: AttackCheckpoint): Promise<void> => {
  await redis.setex(infernoPlayerCheckpointKey(basesaveid), ATTACK_CHECKPOINT_TTL, serialiseCheckpoint(checkpoint));
};

export const readInfernoPlayerCheckpoint = async (basesaveid: number): Promise<AttackCheckpoint | null> =>
  parseStoredCheckpoint(await redis.get(infernoPlayerCheckpointKey(basesaveid)));

/**
 * Every open Inferno player attack, by the defender's yard. An index entry
 * whose session has gone is dropped on the way.
 */
export const listInfernoPlayerAttacks = async (): Promise<{ basesaveid: number; attack: InfernoPlayerSession }[]> => {
  const found: { basesaveid: number; attack: InfernoPlayerSession }[] = [];
  for (const member of (await redis.smembers(INFERNO_PLAYER_ATTACKS)) ?? []) {
    const basesaveid = Number(member);
    const attack = Number.isSafeInteger(basesaveid) ? await readInfernoPlayerSession(basesaveid) : null;
    if (attack) found.push({ basesaveid, attack });
    else await redis.srem(INFERNO_PLAYER_ATTACKS, member);
  }
  return found;
};

/** @returns True when the caller now holds the lock. */
export const acquireInfernoPlayerFinalLock = async (basesaveid: number): Promise<boolean> =>
  (await redis.set(infernoPlayerFinalLockKey(basesaveid), "1", "EX", String(ATTACK_FINAL_LOCK_SECONDS), "NX")) === "OK";

export const releaseInfernoPlayerFinalLock = async (basesaveid: number): Promise<void> => {
  await redis.del(infernoPlayerFinalLockKey(basesaveid));
};
