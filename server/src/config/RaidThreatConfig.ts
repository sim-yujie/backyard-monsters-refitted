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
 * The owner's table (Review Desk card b10-numbers, row threat = A, 27 Nov
 * 2026): odd steps add 10% monsters (x2.0 at 19), even steps add one thing
 * (2 timed drops at 2, 2 sides at 4, Vorgs at 6, 3 sides and Zafreetis at 8,
 * the champion at 10, 4 sides at 12, 4 drops at 14, 5 drops at 18), and the
 * champion's level climbs from 1 at 10 to 6 at 19. Change the rows here and
 * nothing else: the planner, the threat cap and the tests read this table.
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
 *   abilities as a player's champion's does; 0 at every step (the owner's
 *   table names no powers). It leaves the yard
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

/** One row per threat, 0 up; the last row is the cap (owner, 27 Nov 2026). */
export const RAID_THREAT_STEPS: readonly RaidThreatStep[] = [
  //    size sides drops gap vorg zaf champ pow retreat
  step(1.0, 1, 1, 0, 0, 0, 0, 0, 0), //  0: today's Flash raid, no time limit
  step(1.1, 1, 1, 0, 0, 0, 0, 0, 180), //  1: +10% monsters
  step(1.1, 1, 2, 10, 0, 0, 0, 0, 180), //  2: 2 timed drops
  step(1.2, 1, 2, 10, 0, 0, 0, 0, 180), //  3: +10%
  step(1.2, 2, 2, 10, 0, 0, 0, 0, 180), //  4: 2 sides
  step(1.3, 2, 2, 10, 0, 0, 0, 0, 180), //  5: +10%
  step(1.3, 2, 2, 10, 0.05, 0, 0, 0, 180), //  6: Vorgs (5%); the launch start cap
  step(1.4, 2, 2, 10, 0.05, 0, 0, 0, 180), //  7: +10%
  step(1.4, 3, 2, 12, 0.05, 0.02, 0, 0, 180), //  8: 3 sides + Zafreetis (2%)
  step(1.5, 3, 2, 12, 0.05, 0.02, 0, 0, 180), //  9: +10%
  step(1.5, 3, 2, 12, 0.05, 0.02, 1, 0, 180), // 10: one champion, level 1
  step(1.6, 3, 2, 12, 0.05, 0.02, 2, 0, 180), // 11: +10%, champion level 2
  step(1.6, 4, 2, 15, 0.05, 0.02, 2, 0, 180), // 12: 4 sides
  step(1.7, 4, 2, 15, 0.05, 0.02, 3, 0, 180), // 13: +10%, champion level 3
  step(1.7, 4, 4, 15, 0.05, 0.02, 3, 0, 180), // 14: 4 drops
  step(1.8, 4, 4, 15, 0.05, 0.02, 4, 0, 180), // 15: +10%, champion level 4
  step(1.8, 4, 4, 15, 0.05, 0.02, 4, 0, 180), // 16: (nothing new in the owner's table)
  step(1.9, 4, 4, 15, 0.05, 0.02, 5, 0, 180), // 17: +10%, champion level 5
  step(1.9, 4, 5, 15, 0.05, 0.02, 5, 0, 180), // 18: 5 drops
  step(2.0, 4, 5, 15, 0.05, 0.02, 6, 0, 180), // 19: +10% (x2.0), champion level 6
  step(2.0, 4, 5, 15, 0.05, 0.02, 6, 0, 180), // 20: the top
];

/** The highest threat; a good defence at the cap keeps it there. */
export const RAID_THREAT_MAX = RAID_THREAT_STEPS.length - 1;

/**
 * The highest threat a schedule from before beta 10 starts at, however many
 * good defences it keeps (owner, 27 Nov 2026): a veteran still earns the last
 * four steps to the first champion. Only the start is held here; a good
 * defence raises the threat past it as usual.
 */
export const RAID_THREAT_START_CAP = 6;

/**
 * Most monsters one raid may land, champion not counted. A bigger army is
 * scaled down to this, each type in proportion, so the fight stays inside the
 * server's replay deadline (`FINALISE_REPLAY_DEADLINE_MS`) on any yard.
 * Kept at 400 by the owner's table; the load measurement is in
 * `docs/design/wild-raids.md` §11.5.
 */
export const RAID_MAX_RAIDERS = 400;

/**
 * Seconds a wild champion stays on the yard before it leaves, if it has not
 * fallen. A lone champion the towers cannot reach (a Fomor sniping from out
 * of range, a Gorgo on a yard with weak towers) would otherwise keep the raid
 * going to its 10-minute cap, which the player must watch. Owner-approved
 * (27 Nov 2026), as is the 180 s retreat.
 */
export const RAID_CHAMPION_LEAVE_SECONDS = 120;
