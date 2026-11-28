import { creep, type WaveTable } from "../waveTypes.js";

/**
 * WMI2's 30 waves and 2 bonus waves, Flash's own (`client/scripts/SPECIALEVENT.as`
 * `WAVES`), generated from it: one line per spawn group, `at` seconds after the
 * wave starts (Flash's sub-wave delays added up), its bearing before the
 * wave's random quarter turn, its level, Monster Lab rank (Flash `powerup`)
 * and enrage seconds (`rage`). Owner, 27 Nov 2026: the same armies for every
 * player, no scaling; the numbers can be retuned here once, for everyone.
 */
export const WMI2_WAVES: WaveTable = [
  // Wave 1
  [
    creep(0, "IC1", 10, 270, 1),
  ],
  // Wave 2
  [
    creep(0, "IC2", 6, 270, 1),
    creep(1, "IC3", 6, 270, 1),
  ],
  // Wave 3
  [
    creep(0, "IC2", 8, 270, 1),
    creep(1, "IC1", 8, 270, 1),
  ],
  // Wave 4
  [
    creep(0, "IC2", 10, 270, 1),
    creep(10, "IC3", 10, 270, 1),
    creep(10, "IC1", 10, 270, 1),
  ],
  // Wave 5
  [
    creep(0, "IC1", 16, 270, 3),
    creep(6, "IC1", 16, 90, 3),
  ],
  // Wave 6
  [
    creep(0, "IC2", 12, 270, 1),
    creep(2, "IC1", 5, 270, 4),
  ],
  // Wave 7
  [
    creep(0, "IC2", 15, 270, 3),
    creep(5, "IC3", 40, 270, 1),
  ],
  // Wave 8
  [
    creep(0, "IC1", 40, 270, 1),
    creep(10, "IC5", 5, 270, 1),
  ],
  // Wave 9
  [
    creep(0, "IC2", 20, 270, 1),
    creep(1, "IC1", 15, 270, 1),
    creep(1, "IC7", 3, 270, 1),
    creep(16, "IC3", 10, 270, 1),
  ],
  // Wave 10
  [
    creep(0, "IC2", 20, 270, 3),
    creep(2, "IC7", 5, 270, 1),
    creep(2, "IC4", 5, 270, 1),
    creep(17, "IC3", 10, 270, 2),
    creep(17, "IC5", 5, 270, 1),
  ],
  // Wave 11
  [
    creep(0, "IC4", 10, 180, 1),
    creep(0, "IC4", 10, 0, 1),
    creep(15, "IC1", 25, 180, 1),
    creep(15, "IC1", 25, 0, 1),
  ],
  // Wave 12
  [
    creep(0, "IC4", 8, 0, 2),
    creep(0, "IC4", 8, 0, 2),
    creep(0, "IC2", 18, 0, 3),
    creep(0, "IC2", 18, 180, 3),
    creep(30, "IC6", 8, 270, 1),
    creep(30, "IC6", 8, 90, 1),
  ],
  // Wave 13
  [
    creep(0, "IC2", 15, 0, 4),
    creep(0, "IC2", 15, 180, 4),
    creep(5, "IC7", 3, 180, 1),
    creep(5, "IC7", 3, 0, 1),
    creep(20, "IC5", 4, 180, 1, 0, 15),
    creep(20, "IC5", 4, 0, 1, 0, 15),
    creep(65, "IC1", 10, 270, 1),
    creep(65, "IC1", 10, 90, 1),
    creep(65, "IC3", 10, 270, 2),
    creep(65, "IC3", 10, 90, 2),
  ],
  // Wave 14
  [
    creep(0, "IC7", 7, 0, 1),
    creep(0, "IC7", 7, 180, 1),
    creep(15, "IC6", 10, 270, 1),
    creep(15, "IC6", 10, 90, 1),
  ],
  // Wave 15
  [
    creep(0, "IC1", 10, 270, 4),
    creep(0, "IC1", 10, 180, 4),
    creep(0, "IC1", 10, 90, 4),
    creep(0, "IC1", 10, 0, 4),
    creep(15, "IC5", 9, 270, 1),
    creep(15, "IC5", 9, 180, 1),
    creep(15, "IC5", 9, 90, 1),
    creep(15, "IC5", 9, 0, 1),
    creep(25, "IC3", 10, 270, 4),
    creep(25, "IC3", 10, 90, 4),
  ],
  // Wave 16
  [
    creep(0, "IC1", 15, 270, 4, 0, 25),
    creep(0, "IC1", 15, 180, 4, 0, 25),
    creep(0, "IC1", 15, 90, 4, 0, 25),
    creep(0, "IC1", 15, 0, 4, 0, 25),
  ],
  // Wave 17
  [
    creep(0, "IC2", 12, 0, 1, 0, 30),
    creep(0, "IC2", 12, 180, 1, 0, 30),
    creep(15, "IC1", 30, 270, 5),
    creep(15, "IC1", 30, 90, 5),
    creep(30, "IC5", 15, 270, 1),
  ],
  // Wave 18
  [
    creep(0, "IC2", 10, 270, 2, 0, 30),
    creep(0, "IC2", 10, 90, 2, 0, 30),
    creep(15, "IC7", 5, 270, 4),
    creep(15, "IC7", 5, 90, 4),
    creep(15, "IC1", 10, 270, 4),
    creep(15, "IC1", 10, 180, 4),
    creep(15, "IC1", 10, 90, 4),
    creep(15, "IC1", 10, 0, 4),
    creep(30, "IC1", 10, 270, 4),
    creep(30, "IC1", 10, 180, 4),
    creep(30, "IC1", 10, 90, 4),
    creep(30, "IC1", 10, 0, 4),
  ],
  // Wave 19
  [
    creep(0, "IC1", 10, 270, 5),
    creep(0, "IC1", 10, 180, 5),
    creep(0, "IC1", 10, 90, 5),
    creep(0, "IC1", 10, 0, 5),
    creep(30, "IC1", 10, 270, 5),
    creep(30, "IC1", 10, 180, 5),
    creep(30, "IC1", 10, 90, 5),
    creep(30, "IC1", 10, 0, 5),
    creep(60, "IC1", 10, 270, 5),
    creep(60, "IC1", 10, 180, 5),
    creep(60, "IC1", 10, 90, 5),
    creep(60, "IC1", 10, 0, 5),
    creep(90, "IC1", 10, 270, 5),
    creep(90, "IC1", 10, 180, 5),
    creep(90, "IC1", 10, 90, 5),
    creep(90, "IC1", 10, 0, 5),
    creep(120, "IC1", 10, 270, 4),
    creep(120, "IC1", 10, 180, 4),
    creep(120, "IC1", 10, 90, 4),
    creep(120, "IC1", 10, 0, 4),
    creep(150, "IC1", 10, 270, 4),
    creep(150, "IC1", 10, 180, 4),
    creep(150, "IC1", 10, 90, 4),
    creep(150, "IC1", 10, 0, 4),
  ],
  // Wave 20
  [
    creep(0, "IC4", 10, 270, 4),
    creep(0, "IC4", 10, 180, 4),
    creep(0, "IC4", 10, 90, 4),
    creep(0, "IC4", 10, 0, 4),
    creep(15, "IC5", 10, 270, 4),
    creep(15, "IC5", 10, 180, 4),
    creep(15, "IC5", 10, 90, 4),
    creep(15, "IC5", 10, 0, 4),
    creep(30, "IC2", 10, 270, 4, 0, 30),
    creep(30, "IC2", 10, 180, 4, 0, 30),
    creep(30, "IC2", 10, 90, 4, 0, 30),
    creep(30, "IC2", 10, 0, 4, 0, 30),
    creep(35, "IC7", 5, 270, 1),
    creep(35, "IC7", 5, 90, 1),
    creep(65, "IC6", 5, 270, 1),
    creep(65, "IC6", 5, 90, 1),
    creep(95, "IC8", 5, 270, 1, 0, 30),
    creep(95, "IC8", 5, 90, 1, 0, 30),
  ],
  // Wave 21
  [
    creep(0, "IC6", 30, 270, 6, 0, 45),
    creep(30, "IC5", 60, 270, 6),
  ],
  // Wave 22
  [
    creep(0, "IC2", 30, 90, 6),
    creep(2, "IC2", 30, 0, 6),
    creep(4, "IC2", 30, 270, 6),
    creep(6, "IC2", 30, 180, 6),
    creep(16, "IC7", 15, 90, 3),
    creep(18, "IC7", 15, 0, 3),
    creep(20, "IC7", 15, 270, 3),
    creep(22, "IC7", 15, 180, 3),
    creep(67, "IC6", 25, 90, 6),
    creep(69, "IC6", 25, 0, 6),
    creep(71, "IC6", 25, 270, 6),
    creep(73, "IC6", 25, 180, 6),
  ],
  // Wave 23
  [
    creep(0, "IC8", 20, 0, 3),
    creep(15, "IC8", 20, 0, 3),
    creep(30, "IC8", 20, 0, 3),
    creep(45, "IC5", 30, 0, 3),
  ],
  // Wave 24
  [
    creep(0, "IC2", 25, 270, 6),
    creep(5, "IC2", 25, 90, 6),
    creep(10, "IC2", 25, 0, 6),
    creep(15, "IC2", 25, 180, 6),
    creep(30, "IC5", 20, 270, 6),
    creep(35, "IC7", 30, 270, 6, 0, 45),
    creep(50, "IC6", 30, 270, 6),
    creep(65, "IC6", 30, 270, 6),
  ],
  // Wave 25
  [
    creep(0, "IC2", 60, 270, 6, 0, 30),
    creep(20, "IC8", 30, 270, 3, 0, 25),
  ],
  // Wave 26
  [
    creep(0, "IC1", 40, 270, 6),
    creep(15, "IC1", 40, 270, 6),
    creep(30, "IC2", 30, 270, 6, 0, 25),
    creep(45, "IC7", 20, 270, 6),
    creep(60, "IC8", 10, 270, 6, 0, 45),
    creep(75, "IC8", 10, 270, 6, 0, 45),
  ],
  // Wave 27
  [
    creep(0, "IC4", 20, 270, 6, 3, 20),
    creep(15, "IC4", 20, 270, 6, 3, 20),
    creep(30, "IC4", 20, 270, 6, 3, 20),
    creep(45, "IC4", 20, 270, 6, 3, 20),
    creep(60, "IC8", 10, 270, 6, 3, 30),
    creep(60, "IC8", 10, 90, 6, 3, 30),
    creep(60, "IC8", 10, 0, 6, 3, 30),
  ],
  // Wave 28
  [
    creep(0, "IC7", 20, 270, 6, 3),
    creep(10, "IC7", 20, 270, 6, 3),
    creep(20, "IC7", 20, 270, 6, 3),
    creep(30, "IC7", 20, 270, 6, 3),
    creep(60, "IC8", 20, 270, 6, 3, 30),
    creep(70, "IC8", 20, 270, 6, 3, 30),
  ],
  // Wave 29
  [
    creep(0, "IC8", 5, 270, 6, 3, 30),
    creep(15, "IC8", 5, 0, 6, 3, 30),
    creep(30, "IC8", 5, 90, 6, 3, 30),
    creep(45, "IC8", 5, 180, 6, 3, 30),
    creep(60, "IC8", 5, 270, 6, 3, 30),
    creep(75, "IC8", 5, 0, 6, 3, 30),
    creep(90, "IC8", 5, 90, 6, 3, 30),
    creep(105, "IC8", 5, 180, 6, 3, 30),
    creep(120, "IC8", 5, 270, 6, 3, 30),
    creep(135, "IC8", 5, 0, 6, 3, 30),
    creep(150, "IC8", 5, 90, 6, 3, 30),
    creep(165, "IC8", 5, 180, 6, 3, 30),
    creep(180, "IC8", 5, 270, 6, 3, 30),
    creep(195, "IC8", 5, 0, 6, 3, 30),
    creep(210, "IC8", 5, 90, 6, 3, 30),
  ],
  // Wave 30
  [
    creep(0, "IC7", 10, 270, 6, 3, 45),
    creep(1, "IC7", 10, 270, 6, 3, 45),
    creep(2, "IC7", 10, 270, 6, 3, 45),
    creep(3, "IC7", 10, 270, 6, 3, 45),
    creep(33, "IC6", 5, 270, 6, 3, 30),
    creep(35, "IC6", 5, 0, 6, 3, 30),
    creep(37, "IC6", 5, 90, 6, 3, 30),
    creep(39, "IC6", 5, 180, 6, 3, 30),
    creep(41, "IC6", 5, 270, 6, 3, 30),
    creep(43, "IC6", 5, 0, 6, 3, 30),
    creep(45, "IC6", 5, 90, 6, 3, 30),
    creep(47, "IC6", 5, 180, 6, 3, 30),
    creep(49, "IC6", 5, 270, 6, 3, 30),
    creep(51, "IC6", 5, 0, 6, 3, 30),
    creep(53, "IC6", 5, 90, 6, 3, 30),
    creep(55, "IC6", 5, 180, 6, 3, 30),
    creep(57, "IC6", 5, 270, 6, 3, 30),
    creep(59, "IC6", 5, 0, 6, 3, 30),
    creep(61, "IC6", 5, 0, 6, 3, 30),
    creep(63, "IC6", 5, 90, 6, 3, 30),
    creep(123, "IC8", 32, 270, 6, 3, 30),
  ],
  // Bonus wave 1
  [
    creep(0, "IC2", 25, 270, 6, 3, 45),
    creep(1, "IC2", 25, 0, 6, 3, 45),
    creep(2, "IC2", 25, 90, 6, 3, 45),
    creep(3, "IC2", 25, 180, 6, 3, 45),
    creep(48, "IC5", 6, 270, 6, 0, 35),
    creep(49, "IC5", 6, 0, 6, 0, 35),
    creep(50, "IC5", 6, 90, 6, 0, 35),
    creep(51, "IC5", 6, 180, 6, 0, 35),
    creep(52, "IC7", 10, 270, 6, 3, 30),
    creep(53, "IC7", 10, 0, 6, 3, 30),
    creep(54, "IC7", 10, 90, 6, 3, 30),
    creep(55, "IC7", 10, 180, 6, 3, 30),
    creep(95, "IC3", 50, 270, 1, 0, 30),
    creep(97, "IC3", 50, 90, 1, 0, 30),
    creep(99, "IC3", 50, 180, 1, 0, 30),
    creep(101, "IC3", 50, 0, 1, 0, 30),
    creep(146, "IC8", 10, 270, 6, 3, 30),
    creep(147, "IC8", 10, 0, 6, 3, 30),
    creep(148, "IC8", 10, 90, 6, 3, 30),
    creep(149, "IC8", 10, 180, 6, 3, 30),
  ],
  // Bonus wave 2
  [
    creep(0, "IC4", 12, 270, 6, 3, 20),
    creep(5, "IC4", 12, 270, 6, 3, 20),
    creep(10, "IC4", 12, 270, 6, 3, 20),
    creep(15, "IC4", 12, 270, 6, 3, 20),
    creep(40, "IC1", 50, 270, 6, 3, 30),
    creep(45, "IC1", 50, 90, 6, 3, 30),
    creep(50, "IC1", 50, 0, 6, 3, 30),
    creep(55, "IC1", 50, 180, 6, 3, 30),
    creep(115, "IC5", 25, 180, 6, 0, 35),
    creep(115, "IC5", 25, 0, 6, 0, 35),
    creep(160, "IC7", 15, 270, 6, 3, 45),
    creep(161, "IC7", 15, 270, 6, 3, 45),
    creep(162, "IC7", 15, 270, 6, 3, 45),
    creep(163, "IC7", 15, 270, 6, 3, 45),
    creep(203, "IC6", 5, 270, 6, 3, 15),
    creep(208, "IC6", 5, 0, 6, 3, 15),
    creep(213, "IC6", 5, 90, 6, 3, 15),
    creep(218, "IC6", 5, 180, 6, 3, 15),
    creep(223, "IC6", 5, 270, 6, 3, 15),
    creep(228, "IC6", 5, 0, 6, 3, 15),
    creep(233, "IC6", 5, 90, 6, 3, 15),
    creep(238, "IC6", 5, 180, 6, 3, 15),
    creep(283, "IC8", 60, 270, 6, 3, 45),
  ],
];
