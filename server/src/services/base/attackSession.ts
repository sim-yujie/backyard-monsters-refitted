import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import {
  parseDefenderForces,
  type DefenderForces,
  type ResourceAmounts,
} from "../../game-rules/combat/index.js";
import type { EntryHoused } from "../yard/attackRoster.js";
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
  /**
   * What each of the attacker's own yards housed at attack entry, after the
   * server caught their production up (`docs/design/yard-buildings.md` §4.6).
   * Caps what the attack save can take from each yard
   * (`services/yard/attackRoster.ts`). Absent on a session minted before it
   * existed, and for a Map Room 3 attack.
   */
  entryHoused?: EntryHoused;
  /**
   * The defender's resource pool as the attack load served it: the row's own,
   * or its owner's main pool for an outpost. The attack save replays the
   * battle over this pool to cap the loot (`combat/attackLoot.ts`), since an
   * outpost's pool is its owner's and can change while the attack runs.
   * Absent on a session minted before it existed.
   */
  defenderResources?: ResourceAmounts;
  /**
   * The attacker's own pool at attack start, after the load caught their
   * yard up. The bombs the attack fires are priced against it, and one it
   * could not afford does not fight in the server's replay (issue #23, C3):
   * the client decided against the pool it was shown, not against whatever
   * the pool holds by the time the save arrives. Absent on a session minted
   * before it existed.
   */
  attackerResources?: ResourceAmounts;
  /**
   * The attacker's player level at attack start, from their stored save
   * (`calculateBaseLevel`), which the attack load also hands the client for
   * the engine's low-level loot bonus (`ATTACK.as:678-680`, issue #167). The
   * loot replay runs at this level, so an honest client and the replay agree.
   * Absent on a session minted before it existed, whose client ran at no bonus.
   */
  attackerlevel?: number;
  /**
   * The defence the attack load served (issue #195): each bunker's garrison,
   * the defender's academy levels, the champion in its cage. The attack save
   * and the finaliser replay the battle against this, so they fight exactly
   * what the client fought even if the defender's row moves meanwhile. Absent
   * on a session minted before it existed; the replay then reads the row.
   */
  defenderForces?: DefenderForces;
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

/**
 * A session as stored: three integers, so a stray key is readable by eye, or
 * JSON once it carries `entryHoused` or `defenderResources`.
 */
export const serialiseAttackSession = (session: AttackSession): string =>
  session.entryHoused ||
  session.defenderResources ||
  session.attackerResources ||
  session.defenderForces ||
  session.attackerlevel !== undefined
    ? JSON.stringify(session)
    : `${session.attackerid}:${session.attackid}:${session.startedat}`;

/** The `entryHoused` of a JSON session: base id → monster id → whole count ≥ 0. */
const entryHousedOf = (raw: unknown): EntryHoused | undefined => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: EntryHoused = {};
  for (const [baseid, housed] of Object.entries(raw as Record<string, unknown>)) {
    if (!housed || typeof housed !== "object" || Array.isArray(housed)) continue;
    const counts: Record<string, number> = {};
    for (const [id, count] of Object.entries(housed as Record<string, unknown>)) {
      if (Number.isSafeInteger(count) && (count as number) >= 0) counts[id] = count as number;
    }
    out[baseid] = counts;
  }
  return out;
};

/** The `defenderResources` of a JSON session: `r1`..`r4`, each finite and at least 0. */
const defenderResourcesOf = (raw: unknown): ResourceAmounts | undefined => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const pool = raw as Record<string, unknown>;
  const amounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const key of ["r1", "r2", "r3", "r4"] as const) {
    const value = pool[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
    amounts[key] = value;
  }
  return amounts;
};

/** What an attack load records of the battle beside its binding: see {@link AttackSession}. */
export type AttackSessionFacts = Pick<
  AttackSession,
  "entryHoused" | "defenderResources" | "attackerResources" | "attackerlevel" | "defenderForces"
>;

/**
 * The facts of a JSON record, each kept only when it reads cleanly: the
 * session's own, or the copy a checkpoint carries (`attackCheckpoint.ts`).
 *
 * @param {Record<string, unknown>} parsed - The record, JSON-parsed.
 * @returns {AttackSessionFacts} The facts found.
 */
export const sessionFactsOf = (parsed: Record<string, unknown>): AttackSessionFacts => {
  const entryHoused = entryHousedOf(parsed.entryHoused);
  const defenderResources = defenderResourcesOf(parsed.defenderResources);
  const attackerResources = defenderResourcesOf(parsed.attackerResources);
  const defenderForces = parseDefenderForces(parsed.defenderForces);
  const { attackerlevel } = parsed;
  return {
    ...(entryHoused && { entryHoused }),
    ...(defenderForces && { defenderForces }),
    ...(defenderResources && { defenderResources }),
    ...(attackerResources && { attackerResources }),
    ...(Number.isSafeInteger(attackerlevel) &&
      (attackerlevel as number) >= 1 && { attackerlevel: attackerlevel as number }),
  };
};

/**
 * Reads a stored session back.
 *
 * Anything that is not three whole numbers (colon-separated, or in JSON with
 * `entryHoused`) is treated as no session at all
 * rather than thrown, so a key left behind by an older format refuses the save
 * instead of turning it into a 500.
 *
 * @param {string | null | undefined} raw - The stored value, if there was one.
 * @returns {AttackSession | null} The session, or null if nothing usable was stored.
 */
export const parseAttackSession = (raw: string | null | undefined): AttackSession | null => {
  if (!raw) return null;

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const { attackerid, attackid, startedat } = parsed;
      if (![attackerid, attackid, startedat].every(Number.isSafeInteger)) return null;
      return {
        attackerid: attackerid as number,
        attackid: attackid as number,
        startedat: startedat as number,
        ...sessionFactsOf(parsed),
      };
    } catch {
      return null;
    }
  }

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
 * @param {EntryHoused} [entryHoused] - The attacker's yards' `housed` at entry.
 * @param {ResourceAmounts} [defenderResources] - The defender's pool as the attack load serves it.
 * @param {number} [attackerlevel] - The attacker's player level, which the attack load serves too.
 * @param {ResourceAmounts} [attackerResources] - The attacker's own pool at attack start.
 * @param {DefenderForces} [defenderForces] - The defence the attack load serves (issue #195).
 */
export const newAttackSession = (
  attackerid: number,
  attackid: number,
  entryHoused?: EntryHoused,
  defenderResources?: ResourceAmounts,
  attackerlevel?: number,
  attackerResources?: ResourceAmounts,
  defenderForces?: DefenderForces
): AttackSession => ({
  attackerid,
  attackid,
  startedat: getCurrentDateTime(),
  ...(entryHoused && { entryHoused }),
  ...(defenderForces && { defenderForces }),
  ...(defenderResources && { defenderResources }),
  ...(attackerResources && { attackerResources }),
  ...(attackerlevel !== undefined && { attackerlevel }),
});
