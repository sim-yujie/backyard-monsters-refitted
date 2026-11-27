/**
 * THE RAID THREAT TABLE (beta 10, owner 27 Nov 2026,
 * `docs/design/wild-raids.md` "Beta 10 threat").
 *
 * Every wild tribe raid is planned at the player's threat level. Each raid
 * defended at 90%+ health raises the next raid's threat by one step, a lost
 * raid steps back one, a cancelled raid leaves it as it was
 * (`services/raids/raidThreat.ts`). The row for a threat says how that raid
 * grows over today's Flash raid (threat 0, which is exactly the raid before
 * beta 10).
 *
 * PLACEHOLDER NUMBERS. The owner approves the final table on the Review Desk;
 * the numbers helper proposes it. Change the rows here and nothing else: the
 * planner, the threat cap and the tests read this table.
 *
 * Columns:
 * - `size`: the army's size times this, on top of the more / same / less
 *   choice (x1.3 / x1 / x0.5). The tribe's own make-up is kept.
 * - `sides`: how many directions the raid lands from, 1 to 4. The first is
 *   the least-defended way in (Flash's rule); the others are the next
 *   least-defended ways at least 90 degrees from those already taken.
 * - `drops`: how many groups the army lands in on every side, one after
 *   another; 1 lands it all at once.
 * - `dropGapSeconds`: seconds between one group and the next on a side. The
 *   sides take turns inside the gap, so groups land round the yard in turn.
 * - `vorgShare` / `zafreetiShare`: extra Vorgs (C16) and Zafreetis (C15),
 *   both flying healers, as a share of the tribe's army; at least one of each
 *   when the share is above 0.
 * - `championLevel`: one random champion (Gorgo, Drull, Fomor or Korath) at
 *   this level (1 to 6) lands with the last group on the first side; 0 for
 *   none. `championPower` is its power level (0 to 3), which unlocks its
 *   abilities as a player's champion's does. It leaves the yard
 *   {@link RAID_CHAMPION_LEAVE_SECONDS} after it lands if it is still standing.
 * - `retreatSeconds`: every raider still on the yard leaves this long after
 *   the last group lands; 0 never (the raid before beta 10). Measured: Vorgs
 *   and Zafreetis can heal a raider fighting a defender for the whole
 *   10-minute cap, which the player must watch.
 * - `strength`: the raiders' health and damage multiplier. 1 everywhere: the
 *   monsters fight at plain stats (the defender's own Academy levels, D9).
 *   Kept as a column in case the owner wants the steps to toughen them too.
 */
export interface RaidThreatStep {
  readonly size: number;
  readonly sides: 1 | 2 | 3 | 4;
  readonly drops: number;
  readonly dropGapSeconds: number;
  readonly vorgShare: number;
  readonly zafreetiShare: number;
  readonly championLevel: number;
  readonly championPower: number;
  readonly retreatSeconds: number;
  readonly strength: number;
}

const step = (
  size: number,
  sides: RaidThreatStep["sides"],
  drops: number,
  dropGapSeconds: number,
  vorgShare: number,
  zafreetiShare: number,
  championLevel: number,
  championPower: number,
  retreatSeconds: number,
): RaidThreatStep => ({
  size,
  sides,
  drops,
  dropGapSeconds,
  vorgShare,
  zafreetiShare,
  championLevel,
  championPower,
  retreatSeconds,
  strength: 1,
});

/** One row per threat, 0 up; the last row is the cap. PLACEHOLDERS (see above). */
export const RAID_THREAT_STEPS: readonly RaidThreatStep[] = [
  //    size sides drops gap vorg zaf champ pow retreat
  step(1.0, 1, 1, 0, 0, 0, 0, 0, 0), //  0: today's Flash raid, no time limit
  step(1.1, 1, 1, 0, 0, 0, 0, 0, 180), //  1
  step(1.2, 1, 2, 10, 0, 0, 0, 0, 180), //  2: lands in two groups
  step(1.3, 2, 2, 10, 0, 0, 0, 0, 180), //  3: two sides
  step(1.4, 2, 2, 10, 0.05, 0, 0, 0, 180), //  4: Vorgs
  step(1.5, 2, 3, 10, 0.05, 0.05, 0, 0, 180), //  5: Zafreetis
  step(1.6, 3, 3, 12, 0.05, 0.05, 0, 0, 180), //  6: three sides
  step(1.7, 3, 3, 12, 0.08, 0.08, 0, 0, 180), //  7
  step(1.8, 3, 3, 12, 0.08, 0.08, 1, 0, 180), //  8: a champion
  step(1.9, 3, 4, 12, 0.1, 0.1, 2, 0, 180), //  9
  step(2.0, 4, 4, 15, 0.1, 0.1, 2, 1, 180), // 10: four sides
  step(2.1, 4, 4, 15, 0.1, 0.1, 3, 1, 180), // 11
  step(2.2, 4, 4, 15, 0.12, 0.12, 3, 1, 180), // 12
  step(2.3, 4, 4, 15, 0.12, 0.12, 4, 2, 180), // 13
  step(2.4, 4, 5, 15, 0.12, 0.12, 4, 2, 180), // 14
  step(2.5, 4, 5, 15, 0.15, 0.15, 5, 2, 180), // 15
  step(2.6, 4, 5, 15, 0.15, 0.15, 5, 3, 180), // 16
  step(2.7, 4, 5, 15, 0.15, 0.15, 6, 3, 180), // 17
  step(2.8, 4, 5, 15, 0.15, 0.15, 6, 3, 180), // 18
  step(2.9, 4, 5, 15, 0.15, 0.15, 6, 3, 180), // 19
  step(3.0, 4, 5, 15, 0.15, 0.15, 6, 3, 180), // 20: the cap
];

/** The highest threat; a good defence at the cap keeps it there. */
export const RAID_THREAT_MAX = RAID_THREAT_STEPS.length - 1;

/**
 * Most monsters one raid may land, champion not counted. A bigger army is
 * scaled down to this, each type in proportion, so the fight stays inside the
 * server's replay deadline (`FINALISE_REPLAY_DEADLINE_MS`) on any yard.
 * PLACEHOLDER: set from the load measurement in the beta 10 report.
 */
export const RAID_MAX_RAIDERS = 400;

/**
 * Seconds a wild champion stays on the yard before it leaves, if it has not
 * fallen. A lone champion the towers cannot reach (a Fomor sniping from out
 * of range, a Gorgo on a yard with weak towers) would otherwise keep the raid
 * going to its 10-minute cap, which the player must watch. PLACEHOLDER.
 */
export const RAID_CHAMPION_LEAVE_SECONDS = 120;
