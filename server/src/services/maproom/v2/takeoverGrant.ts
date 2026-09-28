import { BaseType } from "../../../enums/Base.js";
import { TAKEOVER_DAMAGE } from "./takeoverRules.js";

/**
 * The owner's rule for taking another player's Map Room 2 outpost (issue #182,
 * outposts plan Q1):
 *
 * > After a player attacks an outpost and causes 90+% destroyed, it gives a
 * > single opportunity for the attacking player to take over the outpost. If
 * > the player chooses not to, the outpost then goes into damage protection.
 *
 * So the attack that leaves a player outpost at 90% or more does not start the
 * usual damage protection. It records a grant instead: that attacker, that
 * outpost, for {@link TAKEOVER_GRANT_SECONDS}. Only the grant's holder may take
 * the outpost over, once, while it runs. The takeover consumes it; a decline
 * (`POST /worldmapv2/declinetakeover`) or the clock running out ends it, and
 * the outpost then has the normal 8 hours of protection from that moment.
 *
 * Expiry needs no one to call the server. When the grant is made, the outpost's
 * `protected` is set to the grant's end plus 8 hours
 * ({@link grantProtectedUntil}). That one value does both jobs: while the grant
 * runs, the outpost reads as protected to everyone, so nobody else can attack
 * it or take it (the attack load and the takeover rules already refuse a
 * protected yard), and when the grant ends unused the protection carries on for
 * exactly the 8 hours the attack would have started had it ended then. A
 * decline brings the end forward to now plus 8 hours. The grant itself lives in
 * Redis with a TTL, keyed by the outpost; losing it only loses the attacker's
 * chance, never the defender's protection.
 *
 * Wild camps are not part of this: Flash's rules stand for them. A camp at 90%
 * or more is open to any player in range until it regenerates, 12 hours after
 * its last save (`takeoverRules.ts`, `wildMonsterExpiry.ts`).
 *
 * Pure, so the rule is testable without Redis; `takeoverGrantStore.ts` keeps
 * the grants.
 */

/**
 * How long the attacker has to decide: 10 minutes. The chance is offered on
 * the end-of-attack panel, so most answers come within seconds, but a player
 * may need to read the price, check their resources, or reopen the map after
 * closing the tab (the server also finishes an abandoned attack, and the grant
 * is made then too). Longer holds the defender's outpost in limbo: nobody else
 * can touch it, and its 8 hours of protection only start when the grant ends.
 */
export const TAKEOVER_GRANT_SECONDS = 10 * 60;

/** An outpost's damage protection at 25% or more (`damageProtection.ts`). */
export const OUTPOST_PROTECTION_SECONDS = 8 * 60 * 60;

/** One attacker's single chance at one outpost. */
export interface TakeoverGrant {
  /** The attacker who earned it. */
  attackerid: number;
  /** The outpost's save row. */
  basesaveid: number;
  /** The outpost's base id, for the client. */
  baseid: string;
  /** Server seconds when the chance ends. */
  expiresAt: number;
}

/**
 * Whether the attack that just ended earns its attacker a takeover grant:
 * a player outpost left at the takeover threshold. Main yards, camps and
 * Map Room 3 structures never do.
 *
 * @param {object} save - The defender as the attack left it.
 * @returns {boolean} True for a player outpost at 90% or more.
 */
export const earnsTakeoverGrant = (save: { type: string; damage: number }) =>
  save.type === BaseType.OUTPOST && save.damage >= TAKEOVER_DAMAGE;

/**
 * The grant an attack earns.
 *
 * @param {number} attackerid - The attacker.
 * @param {object} save - The outpost's `basesaveid` and `baseid`.
 * @param {number} now - Server seconds at the end of the attack.
 * @returns {TakeoverGrant} The grant.
 */
export const newTakeoverGrant = (
  attackerid: number,
  save: { basesaveid: number; baseid: string },
  now: number
): TakeoverGrant => ({
  attackerid,
  basesaveid: save.basesaveid,
  baseid: save.baseid,
  expiresAt: now + TAKEOVER_GRANT_SECONDS,
});

/**
 * The outpost's `protected` while a grant runs: the grant's end plus the
 * normal 8 hours, so an unused grant turns into protection by itself.
 *
 * @param {TakeoverGrant} grant - The grant.
 * @returns {number} Server seconds.
 */
export const grantProtectedUntil = (grant: TakeoverGrant) =>
  grant.expiresAt + OUTPOST_PROTECTION_SECONDS;

/**
 * Whether a grant is live and belongs to this taker.
 *
 * @param {TakeoverGrant | null} grant - The outpost's grant, if any.
 * @param {number} takerId - Who is asking.
 * @param {number} now - Server seconds.
 * @returns {boolean} True when the taker holds a grant that has not run out.
 */
export const holdsTakeoverGrant = (grant: TakeoverGrant | null, takerId: number, now: number) =>
  grant !== null && grant.attackerid === takerId && grant.expiresAt > now;
