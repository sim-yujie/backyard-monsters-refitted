import { redis } from "../../server.js";
import {
  ATTACK_CHECKPOINT_INDEX,
  ATTACK_CHECKPOINT_TTL,
  ATTACK_FINAL_LOCK_SECONDS,
  attackCheckpointKey,
  attackFinalLockKey,
  parseStoredCheckpoint,
  serialiseCheckpoint,
  type AttackCheckpoint,
} from "./attackCheckpoint.js";

/**
 * Where attack checkpoints are kept (issue #138, `attackCheckpoint.ts`).
 *
 * Redis, beside the attack session they extend (`attackSessionStore.ts`). One
 * key per defender row holds the latest checkpoint, and one set indexes the
 * rows that have one, so the sweep and an attacker's next load can find them
 * without scanning the keyspace. Concurrent attacks number in the handful, so
 * reading the whole index is cheaper than keeping a second one per attacker.
 */

/**
 * Stores a checkpoint, replacing the one before it.
 *
 * @param basesaveid - The defender row being attacked.
 * @param checkpoint - The checkpoint to keep.
 */
export const storeCheckpoint = async (
  basesaveid: number,
  checkpoint: AttackCheckpoint
): Promise<void> => {
  await redis.setex(
    attackCheckpointKey(basesaveid),
    ATTACK_CHECKPOINT_TTL,
    serialiseCheckpoint(checkpoint)
  );
  await redis.sadd(ATTACK_CHECKPOINT_INDEX, String(basesaveid));
};

/**
 * Reads a defender row's checkpoint.
 *
 * @param basesaveid - The defender row.
 * @returns The checkpoint, or null if it has none.
 */
export const readCheckpoint = async (basesaveid: number): Promise<AttackCheckpoint | null> =>
  parseStoredCheckpoint(await redis.get(attackCheckpointKey(basesaveid)));

/**
 * Forgets a defender row's checkpoint: its attack has been saved or finalised.
 *
 * @param basesaveid - The defender row.
 */
export const discardCheckpoint = async (basesaveid: number): Promise<void> => {
  await redis.del(attackCheckpointKey(basesaveid));
  await redis.srem(ATTACK_CHECKPOINT_INDEX, String(basesaveid));
};

/**
 * Every row that holds a checkpoint, with the checkpoint. An index entry whose
 * key has gone (expired, or lost) is dropped from the index on the way.
 */
export const listCheckpoints = async (): Promise<{ basesaveid: number; checkpoint: AttackCheckpoint }[]> => {
  const members = (await redis.smembers(ATTACK_CHECKPOINT_INDEX)) ?? [];
  const found: { basesaveid: number; checkpoint: AttackCheckpoint }[] = [];

  for (const member of members) {
    const basesaveid = Number(member);
    const checkpoint = Number.isSafeInteger(basesaveid) ? await readCheckpoint(basesaveid) : null;

    if (checkpoint) found.push({ basesaveid, checkpoint });
    else await redis.srem(ATTACK_CHECKPOINT_INDEX, member);
  }

  return found;
};

/**
 * Takes the lock that lets exactly one thing land an attack's result: the
 * attacker's final save, a duplicate of it sent as the page closed, or the
 * server finalising an abandoned attack. Whoever holds it re-reads the attack
 * session, which the winner ends, so the loser finds nothing left to do.
 *
 * @param basesaveid - The defender row.
 * @returns True when the lock is now held by the caller.
 */
export const acquireFinalLock = async (basesaveid: number): Promise<boolean> =>
  (await redis.set(
    attackFinalLockKey(basesaveid),
    "1",
    "EX",
    String(ATTACK_FINAL_LOCK_SECONDS),
    "NX"
  )) === "OK";

/** Releases the lock taken by {@link acquireFinalLock}. */
export const releaseFinalLock = async (basesaveid: number): Promise<void> => {
  await redis.del(attackFinalLockKey(basesaveid));
};
