import {
  ATTACK_COUNTDOWN_SECONDS,
  DECLARE_WAR_COUNTDOWN_SECONDS,
  RETREAT_GRACE_SECONDS,
} from "../../game-rules/combat/index.js";

/**
 * How long an attack counts as live, in server seconds from its start: the
 * defender's yard is locked for this long, and the attacker may save the
 * result (and checkpoint it) for this long. One window for both, so the
 * moment the defender is free to be attacked by someone else is the moment
 * the previous attacker can no longer write to the row.
 *
 * It is the attack's own length — its countdown, then the retreat grace the
 * engine allows after it (`engine.ts`, `ATTACK.as:237-240`) — plus a spare
 * minute for loading and the save's round trip. A flat 7 minutes used to
 * serve every attack, which an ordinary attack's 300 s and 120 s already
 * filled with nothing to spare, and a Declare War attack's 420 s and 120 s
 * overran (owner, 4 Nov 2026).
 */

/** Spare time on top of the battle's own length: loading, and the save on its way. */
export const ATTACK_WINDOW_SPARE_SECONDS = 60;

/**
 * The window for an attack: 480 s, or 600 s when the attacker's alliance had
 * Declare War running when it started.
 *
 * @param declareWar - Whether Declare War ran for the attacker at the start.
 */
export const attackWindowSeconds = (declareWar = false): number =>
  (declareWar ? DECLARE_WAR_COUNTDOWN_SECONDS : ATTACK_COUNTDOWN_SECONDS) +
  RETREAT_GRACE_SECONDS +
  ATTACK_WINDOW_SPARE_SECONDS;

/** The longest window any attack has: what a store keeping attacks must outlast. */
export const LONGEST_ATTACK_WINDOW_SECONDS = attackWindowSeconds(true);

/** An attack as the defender's row records it (`AttackDetails`). */
export interface RecordedAttackStart {
  starttime: number;
  /** Set when Declare War ran for the attacker; absent otherwise. */
  declarewar?: boolean;
}

/**
 * When the attack recorded on a defender's row stops being live: its lock
 * ends, and so does its attacker's right to save.
 *
 * @param attack - The row's entry for the attack.
 */
export const attackEndsAt = (attack: RecordedAttackStart): number =>
  Number(attack.starttime) + attackWindowSeconds(attack.declarewar === true);
