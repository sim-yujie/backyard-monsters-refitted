import { champ, creep, type WaveTable } from "../waveTypes.js";

/**
 * WMI1's 30 waves and 2 bonus waves, Flash's own (`client/scripts/SPECIALEVENT_WM1.as`
 * `WAVES`), generated from it: one line per spawn group, `at` seconds after the
 * wave starts (Flash's sub-wave delays added up), its bearing before the
 * wave's random quarter turn, its level, Monster Lab rank (Flash `powerup`)
 * and enrage seconds (`rage`). Owner, 27 Nov 2026: the same armies for every
 * player, no scaling; the numbers can be retuned here once, for everyone.
 */
export const WMI1_WAVES: WaveTable = [
  // Wave 1
  [
    creep(0, "C2", 5, 270, 1),
  ],
  // Wave 2
  [
    creep(0, "C2", 4, 270, 1),
    creep(1, "C3", 5, 270, 1),
  ],
  // Wave 3
  [
    creep(0, "C2", 5, 270, 1),
    creep(1, "C1", 5, 270, 1),
  ],
  // Wave 4
  [
    creep(0, "C1", 10, 270, 1),
    creep(1, "C3", 10, 270, 1),
  ],
  // Wave 5
  [
    creep(0, "C4", 10, 270, 1),
  ],
  // Wave 6
  [
    creep(0, "C2", 5, 270, 1),
    creep(2, "C4", 2, 270, 1),
  ],
  // Wave 7
  [
    creep(0, "C6", 10, 270, 1),
    creep(5, "C3", 50, 270, 1),
  ],
  // Wave 8
  [
    creep(0, "C1", 40, 270, 1),
    creep(2, "C4", 8, 270, 1),
  ],
  // Wave 9
  [
    creep(0, "C2", 10, 270, 1),
    creep(1, "C1", 10, 270, 1),
    creep(1, "C4", 10, 270, 1),
    creep(6, "C3", 10, 270, 1),
  ],
  // Wave 10
  [
    creep(0, "C6", 8, 270, 1),
    creep(2, "C4", 8, 270, 1),
  ],
  // Wave 11
  [
    creep(0, "C4", 10, 180, 1),
    creep(0, "IC1", 5, 180, 1),
    creep(0, "C7", 10, 0, 1),
    creep(0, "IC1", 5, 0, 1),
  ],
  // Wave 12
  [
    creep(0, "C6", 8, 0, 1),
    creep(0, "C6", 8, 180, 1),
    creep(15, "C7", 15, 270, 1),
    creep(15, "C7", 15, 90, 1),
  ],
  // Wave 13
  [
    creep(0, "C7", 8, 0, 1),
    creep(0, "C7", 8, 180, 1),
    creep(15, "C6", 15, 270, 1),
    creep(15, "C6", 15, 90, 1),
  ],
  // Wave 14
  [
    creep(0, "C6", 10, 0, 1),
    creep(0, "C6", 10, 180, 1),
    creep(15, "C7", 15, 270, 1),
    creep(15, "C7", 15, 90, 1),
    creep(30, "C8", 10, 270, 1),
  ],
  // Wave 15
  [
    creep(0, "C6", 20, 270, 1),
    creep(0, "C8", 15, 270, 1),
  ],
  // Wave 16
  [
    creep(0, "C7", 20, 270, 1),
    creep(0, "C8", 20, 270, 1),
  ],
  // Wave 17
  [
    creep(0, "C6", 12, 0, 1),
    creep(0, "C6", 12, 180, 1),
    creep(15, "C7", 18, 270, 1),
    creep(15, "C7", 18, 90, 1),
    creep(30, "C8", 15, 270, 1),
  ],
  // Wave 18
  [
    creep(0, "C7", 25, 270, 1),
    creep(0, "C7", 25, 90, 1),
    creep(15, "C8", 25, 270, 1),
  ],
  // Wave 19
  [
    creep(0, "C6", 10, 270, 1),
    creep(0, "C6", 10, 0, 1),
    creep(15, "C8", 10, 270, 1),
    creep(15, "C8", 10, 0, 1),
    creep(30, "C7", 15, 270, 1),
    creep(30, "C7", 15, 0, 1),
  ],
  // Wave 20
  [
    creep(0, "C5", 5, 270, 1),
    creep(0, "C5", 5, 90, 1),
    champ(15, 2, 1, 270, 12000, 0),
    creep(15, "C7", 20, 270, 1),
    creep(15, "C7", 20, 90, 1),
    creep(45, "C11", 5, 270, 1),
    creep(45, "C11", 5, 90, 1),
    creep(75, "C10", 5, 270, 1),
    creep(75, "C10", 5, 90, 1),
  ],
  // Wave 21
  [
    creep(0, "C13", 30, 90, 6, 1),
    creep(0, "IC1", 15, 90, 1),
  ],
  // Wave 22
  [
    creep(0, "C2", 20, 0, 3),
    champ(0, 1, 3, 0, 120000, 0),
    creep(15, "C9", 10, 0, 3, 1),
  ],
  // Wave 23
  [
    creep(0, "C6", 60, 270, 6),
    creep(0, "C15", 6, 270, 5),
  ],
  // Wave 24
  [
    creep(0, "C1", 40, 270, 6),
    creep(15, "C6", 30, 270, 6),
    creep(30, "C7", 20, 270, 6),
    creep(45, "C10", 10, 270, 6),
    creep(60, "C12", 5, 270, 6),
  ],
  // Wave 25
  [
    creep(0, "C5", 30, 270, 6, 3),
    creep(0, "C3", 30, 270, 6, 3),
    creep(0, "C13", 30, 270, 6, 3),
    creep(15, "C4", 30, 270, 6, 3),
    creep(15, "C7", 30, 270, 6, 3),
    creep(15, "C8", 30, 270, 6, 3),
    creep(15, "C9", 30, 270, 6, 3),
  ],
  // Wave 26
  [
    creep(0, "C5", 40, 270, 6, 3),
    creep(5, "IC1", 50, 270, 6, 3),
    champ(5, 2, 6, 270, 60000, 0),
  ],
  // Wave 27
  [
    creep(0, "C14", 30, 270, 6),
  ],
  // Wave 28
  [
    creep(0, "C11", 40, 270, 6, 3),
    creep(10, "C13", 40, 270, 6, 3),
    creep(40, "C11", 40, 270, 6, 3),
    creep(55, "C13", 40, 270, 6, 3),
  ],
  // Wave 29
  [
    creep(0, "C12", 5, 270, 6, 3),
    creep(15, "C12", 5, 0, 6, 3),
    creep(30, "C12", 5, 90, 6, 3),
    creep(45, "C12", 5, 180, 6, 3),
    creep(60, "C12", 5, 270, 6, 3),
    creep(75, "C12", 5, 0, 6, 3),
    creep(90, "C12", 5, 90, 6, 3),
    creep(105, "C12", 5, 180, 6, 3),
  ],
  // Wave 30
  [
    champ(0, 3, 6, 270, 40000, 0),
    creep(0, "C12", 15, 270, 6, 3),
    creep(0, "C13", 15, 180, 6, 3),
    creep(0, "C13", 15, 90, 6, 3),
    creep(0, "C15", 5, 270, 6),
    creep(30, "C12", 15, 0, 6, 3),
    creep(30, "C15", 5, 0, 6),
  ],
  // Bonus wave 1
  [
    creep(0, "IC1", 50, 270, 5, 3),
    creep(0, "IC1", 50, 90, 5, 3),
    creep(0, "IC1", 50, 0, 5, 3),
    creep(0, "IC1", 50, 180, 5, 3),
    champ(5, 1, 6, 270, 200000, 0),
    creep(5, "C10", 15, 270, 6),
    creep(5, "C12", 10, 270, 6, 3),
    creep(5, "C14", 10, 270, 6, 3),
    creep(5, "C15", 4, 270, 6),
    champ(5, 2, 6, 90, 60000, 0),
    creep(5, "C10", 15, 90, 6),
    creep(5, "C12", 10, 90, 6, 3),
    creep(5, "C14", 10, 90, 6, 3),
    creep(5, "C15", 6, 90, 6),
    champ(5, 3, 4, 0, 40000, 0),
    creep(5, "C12", 10, 0, 6, 3),
    creep(5, "C14", 10, 0, 6, 3),
    creep(5, "C15", 4, 0, 6),
    champ(65, 2, 6, 180, 60000, 0),
    champ(65, 2, 6, 0, 60000, 0),
  ],
  // Bonus wave 2
  [
    creep(0, "IC2", 40, 270, 6, 0, 30),
    creep(0, "IC2", 40, 90, 6, 0, 30),
    creep(0, "IC2", 40, 180, 6, 0, 30),
    creep(0, "IC2", 40, 0, 6, 0, 30),
    creep(60, "C13", 30, 270, 6, 3, 25),
    creep(60, "C13", 30, 180, 6, 3, 25),
    creep(60, "C13", 30, 0, 6, 3, 25),
    creep(60, "C13", 30, 90, 6, 3, 25),
    creep(120, "IC7", 10, 270, 6, 0, 30),
    creep(120, "IC7", 10, 180, 6, 0, 30),
    creep(120, "IC7", 10, 0, 6, 0, 30),
    creep(120, "IC7", 10, 90, 6, 0, 30),
    creep(120, "C14", 5, 270, 6, 3, 10),
    creep(120, "C14", 5, 180, 6, 3, 10),
    creep(120, "C14", 5, 90, 6, 3, 10),
    creep(120, "C14", 5, 0, 6, 3, 10),
  ],
];
