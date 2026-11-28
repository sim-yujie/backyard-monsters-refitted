import { champ, creep, type WaveTable } from "../waveTypes.js";

/**
 * Brukkarg War's 25 defence waves, Flash's own (`client/scripts/com/monsters/
 * replayableEvents/attackDefend/brukkargWar/BrukkargWarEvent.as` `WAVES`),
 * generated from it: one line per `WaveObj`, `at` seconds after the wave
 * starts (Flash's numbers between them are waits in seconds, added up), its
 * bearing (`WaveObj.DIR`) before the wave's random quarter turn, its level
 * and Monster Lab rank (`powerLevel`). A `G<n>` WaveObj is champion `n`
 * (Flash `WMATTACK.SpawnCreep` -> `CREEPS.SpawnGuardian`, one per count),
 * at full health (Flash passed `int.MAX_VALUE`) and no food bonus
 * (`ChampionBase` health, foodBonus). Not carried: Flash's champion power
 * level 3 (the engine's champion groups have no power level yet), and Flash
 * spawned these creeps without their level (`CREEPS.Spawn`); the table's
 * level 6 is kept as the wave engine reads it.
 *
 * Every 5 waves beaten opens the next Brukkarg yard
 * (`BRUKWAR_WAVES_PER_YARD`, `game-data/events/yardEvents.ts`).
 */

/** Flash's `int.MAX_VALUE`: the champion comes out at full health (capped). */
const FULL = 2_147_483_647;

export const BRUKWAR_WAVES: WaveTable = [
  // Wave 1
  [
    creep(0, "C2", 50, 270, 6, 3),
    creep(0, "C6", 50, 270, 6, 3),
  ],
  // Wave 2
  [
    creep(0, "IC1", 20, 270, 6, 3),
    creep(3, "C5", 10, 270, 6, 3),
    creep(3, "C5", 10, 90, 6, 3),
  ],
  // Wave 3
  [
    creep(0, "C10", 30, 270, 6, 3),
    creep(0, "C17", 30, 270, 6, 3),
  ],
  // Wave 4
  [
    creep(0, "C6", 40, 270, 6, 3),
    creep(0, "C2", 40, 270, 6, 3),
    creep(0, "C9", 40, 270, 6, 3),
    creep(0, "C3", 40, 270, 6, 3),
  ],
  // Wave 5
  [
    champ(0, 1, 6, 270, FULL, 0),
    creep(0, "C16", 10, 270, 6, 3),
  ],
  // Wave 6
  [
    creep(0, "C8", 40, 270, 6, 3),
    creep(0, "C16", 10, 270, 6, 3),
    creep(2, "C8", 40, 270, 6, 3),
    creep(2, "C16", 10, 270, 6, 3),
    creep(6, "IC6", 30, 270, 6, 3),
    creep(6, "C16", 10, 270, 6, 3),
  ],
  // Wave 7
  [
    creep(0, "C11", 70, 270, 6, 3),
  ],
  // Wave 8
  [
    creep(0, "C7", 30, 270, 6, 3),
    creep(0, "C10", 30, 270, 6, 3),
    creep(0, "IC4", 20, 270, 6, 3),
  ],
  // Wave 9
  [
    creep(0, "C12", 5, 270, 6, 3),
    creep(0, "C6", 10, 270, 6, 3),
  ],
  // Wave 10
  [
    creep(0, "C5", 8, 270, 6, 3),
    creep(0, "C5", 8, 90, 6, 3),
    creep(0, "C5", 8, 0, 6, 3),
    creep(0, "C5", 8, 180, 6, 3),
    champ(5, 5, 6, 270, FULL, 0),
    champ(5, 5, 6, 270, FULL, 0),
    champ(5, 5, 6, 270, FULL, 0),
    champ(5, 5, 6, 90, FULL, 0),
    champ(5, 5, 6, 90, FULL, 0),
    champ(5, 5, 6, 90, FULL, 0),
    creep(5, "C5", 5, 0, 6, 3),
    creep(5, "C5", 5, 180, 6, 3),
  ],
  // Wave 11
  [
    creep(0, "C17", 25, 270, 6, 3),
    creep(0, "IC1", 25, 270, 6, 3),
    creep(0, "C1", 25, 270, 6, 3),
    creep(30, "C17", 25, 270, 6, 3),
    creep(30, "IC1", 25, 270, 6, 3),
    creep(30, "C1", 25, 270, 6, 3),
  ],
  // Wave 12
  [
    creep(0, "IC4", 20, 270, 6, 3),
    creep(0, "C13", 30, 270, 6, 3),
  ],
  // Wave 13
  [
    creep(0, "C6", 50, 270, 6, 3),
    creep(2, "C3", 50, 270, 6, 3),
    creep(2, "IC7", 50, 270, 6, 3),
    creep(2, "C16", 20, 270, 6, 3),
  ],
  // Wave 14
  [
    creep(0, "C5", 6, 270, 6, 3),
    creep(1, "C9", 50, 270, 6, 3),
    creep(1, "C15", 1, 270, 6, 3),
    creep(2, "C5", 6, 270, 6, 3),
    creep(3, "C3", 50, 270, 6, 3),
    creep(3, "C15", 1, 270, 6, 3),
    creep(4, "C5", 6, 270, 6, 3),
    creep(5, "C12", 20, 270, 6, 3),
    creep(5, "C15", 1, 270, 6, 3),
  ],
  // Wave 15
  [
    creep(0, "C5", 6, 270, 6, 3),
    creep(1, "C5", 6, 90, 6, 3),
    creep(2, "C5", 6, 0, 6, 3),
    creep(3, "C5", 6, 180, 6, 3),
    champ(4, 2, 6, 270, FULL, 0),
    creep(4, "C15", 5, 270, 6, 3),
    creep(4, "IC2", 40, 270, 6, 3),
  ],
  // Wave 16
  [
    creep(0, "C11", 20, 270, 6, 3),
    creep(0, "C12", 1, 270, 6, 3),
    creep(0, "C16", 5, 270, 6, 3),
    creep(0, "C17", 10, 270, 6, 3),
    creep(0, "C11", 20, 90, 6, 3),
    creep(0, "C12", 1, 90, 6, 3),
    creep(0, "C16", 5, 90, 6, 3),
    creep(0, "C17", 10, 90, 6, 3),
    creep(0, "C11", 20, 0, 6, 3),
    creep(0, "C12", 1, 0, 6, 3),
    creep(0, "C16", 5, 0, 6, 3),
    creep(0, "C17", 10, 0, 6, 3),
    creep(0, "C11", 20, 180, 6, 3),
    creep(0, "C12", 1, 180, 6, 3),
    creep(0, "C16", 5, 180, 6, 3),
    creep(0, "C17", 10, 180, 6, 3),
  ],
  // Wave 17
  [
    creep(0, "C17", 10, 270, 6, 3),
    creep(0, "C17", 10, 90, 6, 3),
    creep(0, "C17", 10, 180, 6, 3),
    creep(0, "C17", 10, 0, 6, 3),
    creep(0, "C1", 20, 270, 6, 3),
    creep(0, "C1", 20, 90, 6, 3),
    creep(0, "C1", 20, 0, 6, 3),
    creep(0, "C1", 20, 180, 6, 3),
    creep(0, "IC1", 20, 270, 6, 3),
    creep(0, "IC1", 20, 90, 6, 3),
    creep(0, "IC1", 20, 0, 6, 3),
    creep(0, "IC1", 20, 180, 6, 3),
    creep(0, "C12", 6, 270, 6, 3),
    creep(0, "C12", 6, 90, 6, 3),
    creep(0, "C12", 6, 0, 6, 3),
    creep(0, "C12", 6, 180, 6, 3),
  ],
  // Wave 18
  [
    creep(0, "C5", 20, 270, 6, 3),
    creep(0, "C7", 50, 270, 6, 3),
    creep(0, "C8", 50, 270, 6, 3),
    creep(0, "C10", 60, 270, 6, 3),
    creep(0, "C15", 5, 270, 6, 3),
  ],
  // Wave 19
  [
    creep(0, "IC4", 40, 270, 6, 3),
    creep(0, "C14", 50, 270, 6, 3),
    creep(5, "C16", 5, 270, 6, 3),
  ],
  // Wave 20
  [
    champ(0, 3, 6, 270, FULL, 0),
    creep(0, "C10", 60, 270, 6, 3),
    creep(0, "C6", 60, 270, 6, 3),
    creep(0, "C5", 11, 270, 6, 3),
  ],
  // Wave 21
  [
    creep(0, "C12", 16, 270, 6, 3),
    creep(0, "C12", 16, 90, 6, 3),
    creep(0, "C12", 16, 0, 6, 3),
    creep(0, "C12", 16, 180, 6, 3),
    creep(0, "C15", 2, 270, 6, 3),
    creep(0, "C15", 2, 90, 6, 3),
    creep(0, "C15", 2, 180, 6, 3),
    creep(0, "C15", 2, 0, 6, 3),
  ],
  // Wave 22
  [
    creep(0, "C14", 10, 270, 6, 3),
    creep(2, "IC5", 10, 270, 6, 3),
    creep(2, "C14", 10, 270, 6, 3),
    creep(4, "C14", 10, 270, 6, 3),
    creep(6, "IC5", 10, 270, 6, 3),
    creep(8, "C14", 15, 270, 6, 3),
    creep(10, "IC5", 15, 270, 6, 3),
    creep(12, "C14", 20, 270, 6, 3),
    creep(14, "IC5", 20, 270, 6, 3),
  ],
  // Wave 23
  [
    creep(0, "IC4", 15, 270, 6, 3),
    creep(0, "C13", 15, 270, 6, 3),
    creep(0, "IC8", 15, 270, 6, 3),
    creep(30, "IC4", 15, 270, 6, 3),
    creep(30, "C13", 15, 270, 6, 3),
    creep(30, "IC8", 15, 270, 6, 3),
  ],
  // Wave 24
  [
    creep(0, "C12", 25, 270, 6, 3),
    creep(0, "C12", 25, 90, 6, 3),
    creep(0, "C15", 2, 270, 6, 3),
    creep(0, "C15", 2, 90, 6, 3),
    creep(10, "C12", 15, 270, 6, 3),
    creep(10, "C12", 15, 90, 6, 3),
    creep(10, "C15", 2, 270, 6, 3),
    creep(10, "C15", 2, 90, 6, 3),
  ],
  // Wave 25
  [
    creep(0, "C5", 10, 270, 6, 3),
    creep(3, "C12", 15, 270, 6, 3),
    creep(3, "C14", 20, 270, 6, 3),
    creep(3, "C15", 5, 270, 6, 3),
    champ(8, 4, 6, 270, FULL, 0),
    creep(8, "C15", 5, 270, 6, 3),
    creep(8, "C14", 20, 270, 6, 3),
    creep(8, "C12", 15, 270, 6, 3),
    champ(38, 4, 6, 270, FULL, 0),
    creep(38, "C15", 5, 270, 6, 3),
    creep(38, "C14", 20, 270, 6, 3),
    creep(38, "C12", 15, 270, 6, 3),
    creep(48, "C12", 20, 270, 6, 3),
    creep(48, "C15", 3, 270, 6, 3),
  ],
];
