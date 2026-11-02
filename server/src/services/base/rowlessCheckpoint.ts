import { attackNotBoundErr } from "../../errors/errors.js";
import { redis } from "../../server.js";
import { MR1_TRIBE_IDS } from "../../game-data/tribes/v1/index.js";
import {
  acquireDescentFinalLock,
  descentSessionKey,
  readDescentSession,
  releaseDescentFinalLock,
} from "../inferno/descentSession.js";
import { isDescentBaseid } from "../inferno/descent.js";
import {
  acquireInfernoTribeFinalLock,
  infernoTribeSessionKey,
  readInfernoTribeSession,
  releaseInfernoTribeFinalLock,
} from "../inferno/infernoTribeSession.js";
import { isInfernoTribeBaseid } from "../inferno/infernoTribes.js";
import {
  acquireMR1TribeFinalLock,
  mr1TribeSessionKey,
  readMR1TribeSession,
  releaseMR1TribeFinalLock,
} from "../maproom/v1/mr1TribeSession.js";
import {
  ATTACK_CHECKPOINT_TTL,
  parseStoredCheckpoint,
  serialiseCheckpoint,
  type AttackCheckpoint,
} from "./attackCheckpoint.js";
import type { AttackSession } from "./attackSession.js";

/**
 * Checkpoints of the attacks on yards that have no row (owner, 2 Nov 2026:
 * leaving a battle must never undo it): a Map Room 1 tribe, a Descent yard
 * and a Moloch tribe of the Inferno map. Every player fights their own copy
 * of those, so the attack is keyed by the attacker and the yard rather than
 * by a defender's `basesaveid` (`mr1TribeSession.ts`, `descentSession.ts`,
 * `infernoTribeSession.ts`), and so is its checkpoint. The checkpoint itself
 * is the Map Room 2 one (`attackCheckpoint.ts`): the fling log, the tick the
 * client reached and a copy of the session's facts, which outlive the session
 * itself. Beside it go the yard and, for the two Inferno kinds, the Flinger
 * payload the start served, which their replay cuts the log by.
 *
 * A checkpoint stored here means the attack has not landed: the save that
 * lands it (or the finaliser, `finaliseRowlessAttack.ts`) ends the session
 * and then drops the checkpoint, both under the kind's final lock; and a
 * checkpoint request that finds the session gone after storing drops what it
 * stored (`controllers/base/attackCheckpoint.ts`). Those two Redis steps come
 * after the database write, so a crash between them could leave a session or
 * a checkpoint of a landed attack; the landed mark (`landRowlessOnce`), set
 * before the write, is what makes that land nothing. So an attack lands once.
 */

export type RowlessKind = "mr1" | "descent" | "inferno-tribe";

/** One attack's place: the kind, the attacker and the yard. */
export interface RowlessRef {
  readonly kind: RowlessKind;
  readonly userid: number;
  readonly baseid: string;
}

/** A stored checkpoint of an attack on a yard with no row. */
export interface RowlessCheckpoint extends RowlessRef {
  /** What one fling may carry (Descent, Moloch tribe); 0 for a Map Room 1 tribe. */
  readonly flingerCapacity: number;
  readonly checkpoint: AttackCheckpoint;
}

/** The attack session of a yard with no row, as each kind's store keeps it. */
export interface RowlessSession {
  readonly flingerCapacity: number;
  readonly session: AttackSession;
}

/** Which kind of rowless yard a base id names, or null for any other base. */
export const rowlessKindOf = (baseid: unknown): RowlessKind | null => {
  const text = String(baseid ?? "");
  if (MR1_TRIBE_IDS.has(text)) return "mr1";
  if (isDescentBaseid(text)) return "descent";
  if (isInfernoTribeBaseid(text)) return "inferno-tribe";
  return null;
};

export const isInfernoKind = (kind: RowlessKind): boolean => kind !== "mr1";

export const rowlessCheckpointKey = ({ kind, userid, baseid }: RowlessRef) =>
  `attack-checkpoint:${kind}:${userid}:${baseid}`;

/** How many times landing that attack from its checkpoint has failed. */
export const rowlessCloseFailuresKey = ({ kind, userid, baseid }: RowlessRef) =>
  `attack-close-failures:${kind}:${userid}:${baseid}`;

/** Every rowless attack holding a checkpoint, as `kind:userid:baseid`, for the sweep and the loads. */
export const ROWLESS_CHECKPOINT_INDEX = "attack-checkpoints:rowless";

const memberOf = ({ kind, userid, baseid }: RowlessRef) => `${kind}:${userid}:${baseid}`;

const refOf = (member: string): RowlessRef | null => {
  const [kind, userid, baseid, ...rest] = member.split(":");
  if (rest.length > 0 || !baseid) return null;
  if (kind !== "mr1" && kind !== "descent" && kind !== "inferno-tribe") return null;
  const id = Number(userid);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { kind, userid: id, baseid };
};

export const storeRowlessCheckpoint = async (stored: RowlessCheckpoint): Promise<void> => {
  await redis.setex(
    rowlessCheckpointKey(stored),
    ATTACK_CHECKPOINT_TTL,
    JSON.stringify({ flingerCapacity: stored.flingerCapacity, checkpoint: serialiseCheckpoint(stored.checkpoint) })
  );
  await redis.sadd(ROWLESS_CHECKPOINT_INDEX, memberOf(stored));
};

export const readRowlessCheckpoint = async (ref: RowlessRef): Promise<RowlessCheckpoint | null> => {
  const raw = await redis.get(rowlessCheckpointKey(ref));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { flingerCapacity?: unknown; checkpoint?: unknown };
    const checkpoint = parseStoredCheckpoint(typeof parsed.checkpoint === "string" ? parsed.checkpoint : null);
    const capacity = Number(parsed.flingerCapacity);
    if (!checkpoint || !Number.isSafeInteger(capacity) || capacity < 0) return null;
    if (checkpoint.attackerid !== ref.userid) return null;
    return { kind: ref.kind, userid: ref.userid, baseid: ref.baseid, flingerCapacity: capacity, checkpoint };
  } catch {
    return null;
  }
};

/** Forgets the checkpoint: its attack has landed. The key goes first, so a failure after it leaves only an index entry the listing drops. */
export const discardRowlessCheckpoint = async (ref: RowlessRef): Promise<void> => {
  await redis.del(rowlessCheckpointKey(ref));
  await redis.del(rowlessCloseFailuresKey(ref));
  await redis.srem(ROWLESS_CHECKPOINT_INDEX, memberOf(ref));
};

/** Every stored rowless checkpoint; an index entry whose key has gone is dropped on the way. */
export const listRowlessCheckpoints = async (): Promise<RowlessCheckpoint[]> => {
  const members = (await redis.smembers(ROWLESS_CHECKPOINT_INDEX)) ?? [];
  const found: RowlessCheckpoint[] = [];
  for (const member of members) {
    const ref = refOf(member);
    const stored = ref ? await readRowlessCheckpoint(ref) : null;
    if (stored) found.push(stored);
    else await redis.srem(ROWLESS_CHECKPOINT_INDEX, member);
  }
  return found;
};

export const readRowlessCloseFailures = async (ref: RowlessRef): Promise<number> => {
  const count = Number(await redis.get(rowlessCloseFailuresKey(ref)));
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
};

export const countRowlessCloseFailure = async (ref: RowlessRef): Promise<void> => {
  const key = rowlessCloseFailuresKey(ref);
  await redis.setex(key, ATTACK_CHECKPOINT_TTL, String((await readRowlessCloseFailures(ref)) + 1));
};

/**
 * The open attack session on that yard, from the kind's own store: the
 * Descent and Moloch tribe sessions are one per attacker and name their yard,
 * so one on another yard is not this attack's.
 */
export const readRowlessSession = async ({ kind, userid, baseid }: RowlessRef): Promise<RowlessSession | null> => {
  if (kind === "mr1") {
    const session = await readMR1TribeSession(userid, baseid);
    return session ? { flingerCapacity: 0, session } : null;
  }
  const stored = kind === "descent" ? await readDescentSession(userid) : await readInfernoTribeSession(userid);
  return stored && stored.baseid === baseid ? stored : null;
};

const sessionKeyOf = ({ kind, userid, baseid }: RowlessRef): string =>
  kind === "mr1"
    ? mr1TribeSessionKey(userid, baseid)
    : kind === "descent"
      ? descentSessionKey(userid)
      : infernoTribeSessionKey(userid);

/**
 * Ends the attack `attackid` on that yard and drops its checkpoint, in that
 * order (see the file comment): landed, it can be neither saved nor landed
 * again. A session another attack holds by now is left alone. The caller
 * holds the kind's final lock.
 */
export const endRowlessAttack = async (ref: RowlessRef, attackid: number): Promise<void> => {
  const open = await readRowlessSession(ref);
  if (open && open.session.attackid === attackid) await redis.del(sessionKeyOf(ref));
  const stored = await readRowlessCheckpoint(ref);
  if (!stored || stored.checkpoint.attackid === attackid) await discardRowlessCheckpoint(ref);
};

/** One attack, told apart from any other on the same yard: attack ids are random, so its start goes with it. */
export interface RowlessAttackId {
  readonly attackid: number;
  readonly startedat: number;
}

/**
 * The mark that this attack has landed. Set before its landing writes
 * anything (`landRowlessOnce`), and kept past the checkpoint's own life, so
 * whatever outlives a landing cut short after its database write — a session
 * or checkpoint a crash left behind, a resent final save — finds it and lands
 * nothing more.
 */
export const rowlessLandedKey = ({ kind, userid, baseid }: RowlessRef, { attackid, startedat }: RowlessAttackId) =>
  `attack-landed:${kind}:${userid}:${baseid}:${attackid}:${startedat}`;

/** How long the landed mark is kept: a day past the checkpoint's 7 days. */
export const ROWLESS_LANDED_TTL = ATTACK_CHECKPOINT_TTL + 24 * 60 * 60;

/** Whether this attack has landed (or is landing right now, under the kind's final lock). */
export const rowlessLanded = async (ref: RowlessRef, attack: RowlessAttackId): Promise<boolean> =>
  (await redis.get(rowlessLandedKey(ref, attack))) !== null;

/**
 * Lands an attack at most once (the final save's path and the finaliser's).
 * The landed mark is set first, with NX: an attack already marked is not
 * written again, only its leftover session and checkpoint are cleared, and the
 * caller is refused as a save of an attack that is over. `write` is the
 * landing's database write; if it fails the mark goes again, so a resent
 * save or the finaliser can still land the attack. What follows the write
 * (counters, quests, ending the session, dropping the checkpoint) runs after
 * this returns: a failure or a crash there leaves the mark, so nothing is
 * landed twice. A crash between the mark and the write's commit lands
 * nothing, which is the side to err on. The caller holds the kind's final lock.
 */
export const landRowlessOnce = async <T>(
  ref: RowlessRef,
  attack: RowlessAttackId,
  write: () => Promise<T>
): Promise<T> => {
  const key = rowlessLandedKey(ref, attack);
  const marked = (await redis.set(key, "1", "EX", String(ROWLESS_LANDED_TTL), "NX")) === "OK";
  if (!marked) {
    await endRowlessAttack(ref, attack.attackid);
    throw attackNotBoundErr("landed");
  }
  try {
    return await write();
  } catch (err) {
    await redis.del(key);
    throw err;
  }
};

/** Takes the lock the kind's final save takes (issue #138's rule). */
export const acquireRowlessFinalLock = ({ kind, userid, baseid }: RowlessRef): Promise<boolean> =>
  kind === "mr1"
    ? acquireMR1TribeFinalLock(userid, baseid)
    : kind === "descent"
      ? acquireDescentFinalLock(userid)
      : acquireInfernoTribeFinalLock(userid);

export const releaseRowlessFinalLock = ({ kind, userid, baseid }: RowlessRef): Promise<void> =>
  kind === "mr1"
    ? releaseMR1TribeFinalLock(userid, baseid)
    : kind === "descent"
      ? releaseDescentFinalLock(userid)
      : releaseInfernoTribeFinalLock(userid);
