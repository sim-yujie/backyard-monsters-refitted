import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { ATTACK_TIMEOUT } from "./isAttackActive.js";

/**
 * Binds an attack result to the player who started the attack (issue #25).
 *
 * `/base/save` used to let any authenticated caller write to a base whose row
 * carried a non-zero `attackid` (the permission check in `baseSave.ts`). The
 * `attackid` minted at attack start was never stored against an attacker and
 * never compared, so a second account could post `damage`, `destroyed`,
 * `protected` and a loot delta against a base somebody else was attacking, and
 * collect `attackloot` into its own pool (`docs/specs/combat.md` §1).
 *
 * The fix is a per-attack session, minted server-side at attack start and read
 * back on the save. Nothing new is asked of the client: the binding is the
 * authenticated caller's userid compared against the attacker recorded when the
 * attack began. The archived Flash client does already send its `attackid`
 * (`client/scripts/BASE.as:3264`), so that is checked too when present, but it
 * is a consistency check, not the gate — a value the client holds cannot
 * authorise anything.
 *
 * This module is pure: it decides, and it says how a session is written down.
 * `attackSessionStore.ts` is the half that talks to Redis.
 */

/**
 * How long a session authorises saves for.
 *
 * Deliberately the same 7 minutes as `isAttackActive`, so the two windows
 * cannot disagree: the moment the defender is free to be attacked by someone
 * else, the previous attacker can no longer write to the row.
 */
export const ATTACK_SESSION_WINDOW = ATTACK_TIMEOUT;

/**
 * How long the stored key is kept. A minute longer than the window, so an
 * attacker who is late gets the precise `expired` reason in the logs rather
 * than looking like someone who never started an attack at all.
 */
export const ATTACK_SESSION_TTL = ATTACK_SESSION_WINDOW + 60;

/** One attack, as recorded when the attacker entered the defender's yard. */
export interface AttackSession {
  /** `userid` of the account that started the attack. */
  attackerid: number;
  /** The `attackid` minted onto the defender's row at attack start. */
  attackid: number;
  /** Server seconds at attack start. */
  startedat: number;
}

/** Why a save was not accepted as this attack's result. */
export type AttackBindingReason =
  | "no-session"
  | "expired"
  | "wrong-attacker"
  | "stale-attack";

export type AttackBindingResult =
  | { ok: true }
  | { ok: false; reason: AttackBindingReason };

const OK: AttackBindingResult = { ok: true };

/** The key one defender row's current attack is stored under. */
export const attackSessionKey = (basesaveid: number) => `attack-session:${basesaveid}`;

/** A session as stored: three integers, so a stray key is readable by eye. */
export const serialiseAttackSession = (session: AttackSession): string =>
  `${session.attackerid}:${session.attackid}:${session.startedat}`;

/**
 * Reads a stored session back.
 *
 * Anything that is not three whole numbers is treated as no session at all
 * rather than thrown, so a key left behind by an older format refuses the save
 * instead of turning it into a 500.
 *
 * @param {string | null | undefined} raw - The stored value, if there was one.
 * @returns {AttackSession | null} The session, or null if nothing usable was stored.
 */
export const parseAttackSession = (raw: string | null | undefined): AttackSession | null => {
  if (!raw) return null;

  const parts = raw.split(":");
  if (parts.length !== 3) return null;

  const [attackerid, attackid, startedat] = parts.map((part) => Number(part));

  if (![attackerid, attackid, startedat].every(Number.isSafeInteger)) return null;

  return { attackerid: attackerid!, attackid: attackid!, startedat: startedat! };
};

interface BindingCheck {
  /** The session read back for the defender's row, or null if there is none. */
  session: AttackSession | null;
  /** `userid` of the account that sent the save. */
  callerid: number;
  /** The `attackid` currently on the defender's stored row. */
  storedAttackId: number;
  /** The `attackid` the client sent with the save, if it sent one. */
  submittedAttackId?: number;
  /** Server seconds now. */
  now: number;
}

/**
 * Decides whether a save may be applied as the result of the attack recorded
 * against the defender's row.
 *
 * The order is the order the reasons are worth knowing in: an absent session
 * first, then a session that has run out, then the wrong account, then an
 * account that is the right attacker but is writing against an attack the row
 * has since moved on from.
 *
 * @param {BindingCheck} check - The stored session and what the save presents.
 * @returns {AttackBindingResult} `{ ok: true }`, or the reason it was refused.
 */
export const checkAttackBinding = ({
  session,
  callerid,
  storedAttackId,
  submittedAttackId,
  now,
}: BindingCheck): AttackBindingResult => {
  if (!session) return { ok: false, reason: "no-session" };

  if (now - session.startedat >= ATTACK_SESSION_WINDOW)
    return { ok: false, reason: "expired" };

  if (session.attackerid !== callerid) return { ok: false, reason: "wrong-attacker" };

  // The row has moved on to a different attack since this session was minted.
  if (session.attackid !== storedAttackId) return { ok: false, reason: "stale-attack" };

  // The client's own copy, when it sends a real one. A zero or a missing field
  // is not treated as a mismatch: the check above is the authority, and a value
  // the client holds is not evidence of anything on its own.
  if (submittedAttackId && submittedAttackId !== session.attackid)
    return { ok: false, reason: "stale-attack" };

  return OK;
};

/**
 * A session for an attack starting now.
 *
 * @param {number} attackerid - The account starting the attack.
 * @param {number} attackid - The `attackid` minted onto the defender's row.
 */
export const newAttackSession = (attackerid: number, attackid: number): AttackSession => ({
  attackerid,
  attackid,
  startedat: getCurrentDateTime(),
});
