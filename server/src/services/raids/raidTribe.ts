import { MR1_TRIBES, Tribe, Tribes } from "../../enums/Tribes.js";
import type { Rng } from "../../game-rules/combat/rng.js";
import type { TribeData } from "../../types/TribeData.js";
import { currentMR1Tribes, mr1TribeRespawned, mr1TribeStatuses } from "../maproom/v1/mr1TribeRules.js";

/**
 * Which tribe raids (#226 WP1, `docs/design/wild-raids.md` §5.1).
 *
 * As Flash's `WMATTACK.Trigger` (`WMATTACK.as:458-510`, owner 2026-10-23,
 * replacing the random pick of Q3): the player's weakest Map Room 1 camp
 * still standing whose level is at least the player's level less 10 (camps
 * sorted by level, `WMBASE.as:82-96`); with no camps at all, one of the four
 * at random; with camps but none that fits, Legionnaire. A player on Map
 * Room 2 has left their Map Room 1 camps behind, so has none.
 *
 * Each tribe plans its raid its own way (`TRIBES.as:43-99`):
 *
 * - Legionnaire (`PROCESS3`) heads for the nearest tower with tanks and damage
 *   dealers;
 * - Kozu (`PROCESS4`) swarms the nearest harvester, silo or Town Hall;
 * - Abunakki (`PROCESS5`) sends kamikaze, with tanks and looters when the way
 *   in takes fire;
 * - Dreadnaut (`PROCESS7`) sends looters, with tanks when the way in takes
 *   fire.
 */

/** The four, in the order a roll indexes them. */
export const RAID_TRIBES: readonly Tribe[] = Tribes;

/** How far below the player's level a camp may be and still send the raid (`WMATTACK.as:467`). */
export const RAID_CAMP_LEVEL_SPAN = 10;

/** One of the player's Map Room 1 camps, as the tribe choice reads it. */
export interface RaidCamp {
  readonly tribe: Tribe;
  readonly level: number;
  readonly destroyed: boolean;
}

/** One draw off the raid's stream: a tribe, each of the four equally likely. */
export const pickRaidTribe = (rng: Rng): Tribe => RAID_TRIBES[rng.int(RAID_TRIBES.length)] ?? Tribe.LEGIONNAIRE;

/**
 * The raiding tribe. The roll is drawn whether or not it is used, so the
 * rest of the raid's stream (the routes' scatter) is the same either way.
 *
 * @param rng - The raid's stream.
 * @param playerLevel - The player's level.
 * @param camps - The player's Map Room 1 camps; null or empty for none.
 */
export const chooseRaidTribe = (rng: Rng, playerLevel: number, camps: readonly RaidCamp[] | null): Tribe => {
  const roll = pickRaidTribe(rng);
  if (!camps || camps.length === 0) return roll;
  const weakest = [...camps]
    .sort((one, other) => one.level - other.level)
    .find((camp) => !camp.destroyed && camp.level >= playerLevel - RAID_CAMP_LEVEL_SPAN);
  return weakest?.tribe ?? Tribe.LEGIONNAIRE;
};

/**
 * A Map Room 1 player's four camps as the Map Room 1 screen shows them
 * (`mapRoom1View.ts`): one per tribe at their Town Hall's tier, each level
 * set by the player's (`mr1TribeStatuses`), wrecked until its ten minutes
 * are up (`tribedata`, `mr1TribeRespawned`).
 *
 * @param townHallLevel - The player's Town Hall level.
 * @param playerLevel - The player's level.
 * @param tribedata - Their Map Room 1 rows (`Maproom.tribedata`).
 * @param now - Unix seconds.
 */
export const mr1RaidCamps = (
  townHallLevel: number,
  playerLevel: number,
  tribedata: readonly TribeData[],
  now: number
): RaidCamp[] => {
  const statuses = mr1TribeStatuses(townHallLevel, MR1_TRIBES, playerLevel, []);
  return currentMR1Tribes(townHallLevel, MR1_TRIBES).map((slot, index) => {
    const record = tribedata.find((tribe) => tribe.baseid === String(slot.template.baseid));
    return {
      tribe: RAID_TRIBES[index] ?? Tribe.LEGIONNAIRE,
      level: statuses[index]?.[1] ?? playerLevel,
      destroyed: Boolean(record?.destroyed) && !mr1TribeRespawned(record!, now),
    };
  });
};
