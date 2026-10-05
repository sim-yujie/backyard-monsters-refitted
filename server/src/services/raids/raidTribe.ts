import { Tribe, Tribes } from "../../enums/Tribes.js";
import type { Rng } from "../../game-rules/combat/rng.js";

/**
 * Which tribe raids (#226 WP1, `docs/design/wild-raids.md` §5.1).
 *
 * Flash sent the player's weakest Map Room 1 camp, and a random one of the
 * four when no camp was loaded (`WMATTACK.as:465-506`). The owner chose random
 * for everyone (Q3): one of the four, rolled from the raid's own seed, whatever
 * map room the player is on.
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

/** One draw off the raid's stream: a tribe, each of the four equally likely. */
export const pickRaidTribe = (rng: Rng): Tribe => RAID_TRIBES[rng.int(RAID_TRIBES.length)] ?? Tribe.LEGIONNAIRE;
