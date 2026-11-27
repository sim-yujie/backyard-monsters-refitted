import { RAID_THREAT_MAX, RAID_THREAT_START_CAP, RAID_THREAT_STEPS, type RaidThreatStep } from "../../config/RaidThreatConfig.js";

/**
 * A player's raid threat (beta 10, owner 27 Nov 2026,
 * `docs/design/wild-raids.md` "Beta 10 threat"): how strong their next wild
 * tribe raid is, a row of `config/RaidThreatConfig.ts`.
 *
 * - A wild raid defended at 90%+ health raises it by one, up to the cap.
 * - A wild raid lost steps it back one, down to 0.
 * - A cancelled raid (quit = cancel, D5) never lands, so it never moves.
 * - The Trojan Horse and Moloch's emergence raids land through their own
 *   records and never move it.
 *
 * It lives in `aiattacks.threat`. A schedule from before beta 10 has none;
 * its threat starts at the number of 90%+ wild defences among the raids it
 * keeps in `recent` (the newest 10), at most 6, read once by `readSchedule` and written
 * back with the schedule's next write (no schema migration, design §8.1).
 */

/** `recent` tribes that are not wild tribe raids (`TROJAN_TRIBE`, `MOLOCH_TRIBE`); they never count. */
export const THREAT_FREE_TRIBES: ReadonlySet<string> = new Set(["wild", "moloch"]);

/** A threat held to 0..{@link RAID_THREAT_MAX}, whole. */
export const clampThreat = (threat: number): number =>
  Number.isFinite(threat) ? Math.max(0, Math.min(RAID_THREAT_MAX, Math.floor(threat))) : 0;

/** The table's row for a threat (held to the table). */
export const raidThreatStep = (threat: number): RaidThreatStep =>
  RAID_THREAT_STEPS[clampThreat(threat)] as RaidThreatStep;

/** Whether a raid of this tribe moves the threat. */
export const threatCounts = (tribe: string): boolean => !THREAT_FREE_TRIBES.has(tribe);

/** A kept raid, as much of it as the start threat reads. */
export interface ThreatRecord {
  readonly tribe: string;
  readonly shiny: number;
  readonly defended?: boolean;
}

/**
 * The threat a schedule from before beta 10 starts at: its 90%+ wild
 * defences among `recent` (`defended`, or for an older record `shiny > 0`),
 * at most {@link RAID_THREAT_START_CAP}.
 */
export const startThreat = (recent: readonly ThreatRecord[]): number =>
  Math.min(
    RAID_THREAT_START_CAP,
    clampThreat(recent.filter((record) => threatCounts(record.tribe) && (record.defended ?? record.shiny > 0)).length),
  );

/** The threat after a wild raid landed: one up for a good defence, one down for a poor one. */
export const threatAfter = (threat: number, defended: boolean): number =>
  clampThreat(clampThreat(threat) + (defended ? 1 : -1));
