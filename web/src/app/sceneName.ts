/** Scene names, so nothing depends on a bare string in two places. */
export const SceneName = {
  BOOT: "boot",
  LOGIN: "login",
  /**
   * "The map", before anything knows which: loads the own yard and opens
   * Map Room 1, Map Room 2 or, with no Map Room, the yard (issue #162).
   */
  MAP: "map",
  /** The neighbours and wild monster tribes, below Map Room 2 (issue #132). */
  MAP_ROOM_1: "maproom1",
  MAP_ROOM_2: "maproom2",
  YARD: "yard",
  /** An attack on a foreign yard; opened through `game/attack/attackTarget`. */
  ATTACK: "attack",
  /**
   * A Wild Monster Baiter practice attack on the own yard (#126): the attack
   * scene with only the battle layer and the Baiter's package, opened through
   * `game/baiter/baiterSession`. Nothing on it talks to the server.
   */
  BAITER: "baiter",
  /**
   * A finished Baiter test played back (#22, WP5): the attack scene with only
   * the battle layer and the Baiter's package, opened through
   * `game/baiter/testHistory`. Nothing on it talks to the server.
   */
  BAITER_REPLAY: "baiter-replay",
  /**
   * An auto-attack's battle played back (issue #221): the attack scene with
   * only the battle layer and the watch package, opened through
   * `game/autoAttack/watchRun`. Nothing on it talks to the server.
   */
  WATCH: "watch",
  /**
   * A wild monster raid on the own main yard (#226): the attack scene with
   * only the battle layer and the raid package, opened through
   * `game/raid/raidSession`. It plays the fight the server already fought,
   * then lands it and opens the yard.
   */
  RAID: "raid",
  /** "You were away too long": the idle disconnect (#271, `game/presence/idleWatch.ts`). */
  AWAY: "away",
} as const;
export type SceneName = (typeof SceneName)[keyof typeof SceneName];
