/**
 * Enum representing in-game rewards.
 * @enum {string}
 */
export enum Reward {
  VORG = "unblockVorg",
  SLIMEATTIKUS = "unblockSlimeattikus",
  REZGHUL = "unlockRezghul",
  KORATH = "KorathReward",
  /**
   * The Korath power a player has won (Monster Madness,
   * `services/events/korathPower.ts`). Not {@link KORATH}: old saves carry a
   * `KorathReward` of 3 that the Town Hall 7 gift used to write, which never
   * meant anything in this game.
   */
  KORATH_POWER = "korathPower",
  KRALLEN = "krallenReward",
  SPURTZ1 = "spurtzCannonReward",
  SPURTZ2 = "spurtzCannonReward2",
  DIAMOND_SPURTZ = "spurtzCannonReward3",
  GOLDEN_DAVE = "goldenDAVE",
  DAVE_STATUE = "daveStatue",
  IMPROVED_HCC="improvedHCC",
  EXTRA_TILES = "extraTiles",
  YARD_PLANNER_EXTRA_SLOTS = "yardPlannerExtraSlots",
}

/**
 * Enum representing Korath reward abilities.
 * @enum {number}
 */
export enum KorathReward {
  BURN = 1,
  BREATH_OF_FIRE = 2,
  FISTS_OF_DOOM = 3,
}
