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
 * - Krampus 17k-62k, 800-1,700, speed 1.3-2.4: softer and weaker-hitting
 *   than any of them, because its frost aura (`champions.ts`: towers near it
 *   see less far, defenders near it are slower) and its blows' frost are
 *   half its worth.
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
      // Between Fomor and Korath (owner, 27 Nov 2026: "closer to Fomor and
      // Korath, more hybrid-ish"). Retuned 28 Nov 2026 with the aura's sight
      // cut (`champions.ts`, `krampusSightCut`): towers near him see less far,
      // so he takes far fewer shots than his health suggests. Alone on the
      // sandbox test yard he wrecks about 11/17/23% at levels 1/3/6 (Fomor
      // 6/9/12%, Korath 17/24/29%; `art-samples/frost-tribe/abilities/specs/
      // krampus-tune.mjs`). Korath's melee reach.
      speed: [1.3, 1.5, 1.9, 2, 2.2, 2.4],
      health: [17000, 30000, 42000, 50000, 56000, 62000],
      damage: [800, 950, 1150, 1400, 1600, 1700],
      range: [35, 45, 55, 60, 65, 65],
      // The frost aura's slow on defending monsters, as a share (0.15 = 15% slower),
      // and its radius in the engine's range space (Fomor's enrage reaches 250 in it), per level.
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
