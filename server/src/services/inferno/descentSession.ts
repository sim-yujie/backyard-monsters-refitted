import { redis } from "../../server.js";
import { ATTACK_FINAL_LOCK_SECONDS } from "../base/attackCheckpoint.js";
import {
  ATTACK_SESSION_TTL,
  parseAttackSession,
  serialiseAttackSession,
  type AttackSession,
} from "../base/attackSession.js";

/**
 * The attack session of a Descent attack (`docs/design/inferno.md` §2.4,
 * WP 1.11). A Descent yard has no row: every player fights their own copy of
 * the 13 (`game-data/tribes/inferno/molochTribes.ts`), as with a Map Room 1
 * tribe (`maproom/v1/mr1TribeSession.ts`). So the session is keyed by the
 * attacker alone, one Descent attack at a time, and names the yard. It is
 * minted by `POST /bm/inferno/attack/start` and required by the save that
 * ends the attack (`descentLanding.ts`), with the same 420-second window.
 *
 * With it go what the Descent fights by: the yard's base id and the Flinger
 * payload the attack was started with (`descent.ts`).
 */
export interface DescentSession {
  /** The Descent yard attacked, `"201"`-`"213"`. */
  baseid: string;
  /** What one fling may carry (`descentFlingerCapacity`). */
  flingerCapacity: number;
  session: AttackSession;
}

/** The key a player's Descent attack is kept under. */
export const descentSessionKey = (userid: number) => `attack-session:descent:${userid}`;

/** The lock that lets exactly one save end that attack (issue #138's rule). */
export const descentFinalLockKey = (userid: number) => `attack-final:descent:${userid}`;

export const startDescentSession = async (userid: number, descent: DescentSession): Promise<void> => {
  await redis.setex(
    descentSessionKey(userid),
    ATTACK_SESSION_TTL,
    JSON.stringify({
      baseid: descent.baseid,
      flingerCapacity: descent.flingerCapacity,
      session: serialiseAttackSession(descent.session),
    })
  );
};

/** The stored session, or null when there is none or it does not read. */
export const parseDescentSession = (raw: string | null | undefined): DescentSession | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { baseid?: unknown; flingerCapacity?: unknown; session?: unknown };
    const session = parseAttackSession(typeof parsed.session === "string" ? parsed.session : null);
    const capacity = Number(parsed.flingerCapacity);
    if (!session || typeof parsed.baseid !== "string" || !Number.isSafeInteger(capacity) || capacity < 0) return null;
    return { baseid: parsed.baseid, flingerCapacity: capacity, session };
  } catch {
    return null;
  }
};

export const readDescentSession = async (userid: number): Promise<DescentSession | null> =>
  parseDescentSession(await redis.get(descentSessionKey(userid)));

export const endDescentSession = async (userid: number): Promise<void> => {
  await redis.del(descentSessionKey(userid));
};

/** @returns True when the caller now holds the lock. */
export const acquireDescentFinalLock = async (userid: number): Promise<boolean> =>
  (await redis.set(descentFinalLockKey(userid), "1", "EX", String(ATTACK_FINAL_LOCK_SECONDS), "NX")) === "OK";

export const releaseDescentFinalLock = async (userid: number): Promise<void> => {
  await redis.del(descentFinalLockKey(userid));
};
