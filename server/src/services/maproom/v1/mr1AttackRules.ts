import { AttackPermission } from "../../../enums/MapRoom.js";
import type { NeighbourData } from "../../../types/NeighbourData.js";

/**
 * Who a Map Room 1 player may attack (owner, 11 Nov 2026: "mr 1 -> neighbor +
 * level gap"), ported from upstream bym-refitted (9b7d9a252, 9a88febce):
 *
 * 1. **Neighbours only.** The target's owner must be on the attacker's Map
 *    Room 1 list (`Maproom.neighbors`). An attack puts the attacker on the
 *    defender's list (`registerAttacker`), so whoever attacked you can be hit
 *    back.
 * 2. **Level gap.** A main yard more than {@link MR1_ATTACK_LEVEL_GAP} levels
 *    below the attacker's is off limits, unless both have reached
 *    {@link MR1_ATTACK_LEVEL_EXEMPT_FROM}.
 * 3. **Vengeance.** Attacking someone more than the gap ABOVE you is allowed
 *    and hands them one vengeance on you: they may then hit you back across
 *    the gap once per such attack. What a pair did while close in level never
 *    counts. Vengeance lapses {@link MR1_REVENGE_WINDOW_DAYS} days after the
 *    last attack from you (upstream keeps a pair on each other's maps that
 *    long, `REVENGE_WINDOW_DAYS`).
 *
 * Pure: the rows are read in `mr1AttackCheck.ts`, the counters moved in
 * `registerAttacker.ts`, and the map's codes set in `updateNeighbourData.ts`.
 * Map Room 2/3, the Inferno, tribes, outposts and friend visits are untouched.
 */

/** How many levels below their own a Map Room 1 player can still attack (upstream `ATTACK_LEVEL_GAP`). */
export const MR1_ATTACK_LEVEL_GAP = 7;

/** Two players who have both reached this level can always attack each other (upstream `ATTACK_LEVEL_EXEMPT_FROM`). */
export const MR1_ATTACK_LEVEL_EXEMPT_FROM = 40;

/** How long vengeance lasts after the attack that earned it (upstream `REVENGE_WINDOW_DAYS`). */
export const MR1_REVENGE_WINDOW_DAYS = 14;

const REVENGE_WINDOW_SECONDS = MR1_REVENGE_WINDOW_DAYS * 24 * 60 * 60;

type RevengeEntry = Pick<NeighbourData, "vengeance" | "lastattackfrom">;

/**
 * Vengeance a player still has on a neighbour: the attacks that neighbour
 * made on them from more than the gap below, not yet paid back, while the
 * last attack from them is under {@link MR1_REVENGE_WINDOW_DAYS} days old.
 *
 * @param entry - The neighbour's entry on the player's own list.
 * @param now - Unix seconds.
 */
export const vengeanceOwed = (entry: RevengeEntry | null | undefined, now: number): number => {
  const count = Math.max(0, Math.floor(Number(entry?.vengeance ?? 0)));
  if (!count) return 0;
  const at = Number(entry?.lastattackfrom ?? 0);
  return at > 0 && now - at < REVENGE_WINDOW_SECONDS ? count : 0;
};

/** Whether the neighbour attacked the player within the revenge window, so a re-search keeps them. */
export const attackedRecently = (entry: Pick<NeighbourData, "lastattackfrom">, now: number): boolean => {
  const at = Number(entry.lastattackfrom ?? 0);
  return at > 0 && now - at < REVENGE_WINDOW_SECONDS;
};

export interface Mr1Levels {
  readonly attackerLevel: number;
  readonly defenderLevel: number;
  /** Vengeance the attacker has on the defender ({@link vengeanceOwed}). */
  readonly vengeance: number;
}

/**
 * What the two levels allow, in the map's codes (upstream `levelPermission`):
 * too far below is LEVEL_RESTRICTION (3), or VENGEANCE_MODE (4) with
 * vengeance left; far above is HIGHER_LEVEL (2), which is allowed and earns
 * the defender a vengeance; anything else ATTACKABLE (1).
 */
export const mr1LevelPermission = ({ attackerLevel, defenderLevel, vengeance }: Mr1Levels): AttackPermission => {
  const bothExempt = attackerLevel >= MR1_ATTACK_LEVEL_EXEMPT_FROM && defenderLevel >= MR1_ATTACK_LEVEL_EXEMPT_FROM;
  if (bothExempt) return AttackPermission.ATTACKABLE;

  if (attackerLevel - defenderLevel > MR1_ATTACK_LEVEL_GAP) {
    return vengeance > 0 ? AttackPermission.VENGEANCE_MODE : AttackPermission.LEVEL_RESTRICTION;
  }

  if (defenderLevel - attackerLevel > MR1_ATTACK_LEVEL_GAP) return AttackPermission.HIGHER_LEVEL;

  return AttackPermission.ATTACKABLE;
};

/**
 * A fresh search's list keeping, besides the found ones, every old neighbour
 * who attacked the player within the revenge window: an attack keeps the
 * attacker on the defender's map that long, whatever their levels (upstream
 * `getRecentOpponentIds`), so a re-search never takes the hit back away.
 *
 * @param previous - The list being replaced.
 * @param carried - The found list, counters already carried (`carryAttackCounters`).
 * @param now - Unix seconds.
 */
export const keepRecentAttackers = (
  previous: readonly NeighbourData[],
  carried: NeighbourData[],
  now: number
): NeighbourData[] => {
  const found = new Set(carried.map((entry) => entry.userid));
  const kept = previous.filter((old) => !found.has(old.userid) && attackedRecently(old, now));
  return kept.length ? [...carried, ...kept] : carried;
};
