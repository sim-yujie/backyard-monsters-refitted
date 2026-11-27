/**
 * Wild champions: champions no player can own, which only the game's own
 * armies field (beta 10: Krampus, the Christmas frost tribe's champion, owner
 * 27 Nov 2026; ownable in a later update).
 *
 * They live apart from `combatStatsData.ts` (generated from the server's
 * `championStats.ts`, which is the list of ownable champions the attack
 * audit checks a flung champion against): `stats.ts` reads both tables, so
 * the engine fights a wild champion like any other, while the server never
 * accepts one in an attacker's fling (not in its `championStats`) and the
 * engine refuses one in a fling log too (`engine.ts`, `isWildChampion`).
 *
 * This file imports nothing, like `combatStatsData.ts`: the server loads the
 * rules under Bun with no build step.
 *
 * PROPOSED NUMBERS (owner to test and confirm, 27 Nov 2026), beside the
 * real champions at levels 1 and 6:
 * - Gorgo 40k-200k health, 1,000-3,000 damage, speed 1-2;
 * - Drull 12k-60k, 3,000-8,000, speed 2-3.6;
 * - Korath 28k-175k, 2,000-6,500, speed 1.4-2.5;
 * - Krampus 20k-110k, 1,200-4,000, speed 2-3: a fast raider, tougher than
 *   Drull and softer than Gorgo or Korath, hitting less hard than either,
 *   because its frost aura (`champions.ts`, `krampusAuraSlow`) is half its
 *   worth.
 */

/** `combatStatsData.ts`'s `ChampionCombatStat`, repeated so this file imports nothing. */
export interface WildChampionStat {
  readonly t: number;
  readonly name: string;
  readonly props: {
    readonly speed: readonly number[];
    readonly health: readonly number[];
    readonly damage: readonly number[];
    readonly range: readonly number[];
    readonly buffs: readonly number[];
    readonly buffRadius: readonly number[];
    readonly bucket: readonly number[];
    readonly targetGroup: readonly number[];
    readonly movement: readonly string[];
    readonly attack: readonly string[];
    readonly bonusSpeed: readonly number[];
    readonly bonusHealth: readonly number[];
    readonly bonusDamage: readonly number[];
    readonly bonusRange: readonly number[];
    readonly bonusBuffs: readonly number[];
  };
}

/** Every wild champion, keyed like `CHAMPION_PROPS` (`G<t>`). */
export const WILD_CHAMPION_PROPS: Readonly<Record<string, WildChampionStat>> = {
  // G6 Krampus (frost tribe, beta 10)
  G6: {
    t: 6,
    name: "Krampus",
    props: {
      speed: [2, 2.2, 2.4, 2.6, 2.8, 3],
      health: [20000, 36000, 52000, 70000, 90000, 110000],
      damage: [1200, 1600, 2000, 2600, 3200, 4000],
      range: [35, 45, 55, 60, 65, 70],
      // The frost aura's slow, as a share (0.15 = 15% slower), and its radius in the
      // engine's range space (Fomor's enrage reaches 250 in it), per level.
      buffs: [0.15, 0.2, 0.25, 0.3, 0.35, 0.4],
      buffRadius: [200, 220, 240, 260, 280, 300],
      bucket: [200],
      targetGroup: [0],
      movement: ["ground"],
      attack: ["melee"],
      // No food bonus: a wild champion is never fed.
      bonusSpeed: [0, 0, 0],
      bonusHealth: [0, 0, 0],
      bonusDamage: [0, 0, 0],
      bonusRange: [0, 0, 0],
      bonusBuffs: [0, 0, 0],
    },
  },
};
