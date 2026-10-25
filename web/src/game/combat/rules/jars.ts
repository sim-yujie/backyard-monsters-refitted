/**
 * The Candy Jars in the fight (Inferno WP 6.7, `docs/design/inferno.md` S6):
 * the figures and the arithmetic the engine's Jars read, each from Flash's
 * `com/monsters/siege/weapons/Jars.as` and the jar half of `BTOWER.as`.
 *
 * Dropped, a jar falls over every defending tower the drop's range touches,
 * standing or fallen (`Jars.getValidTargets`, `BASE.GetBuildingOverlap`). The
 * tower is untargetable from the drop (`BTOWER.ApplyJar`); once the jar has
 * landed, a second later (`JarLanded`), every shot the tower fires hits its
 * jar instead, for a multiple of the shot ({@link JAR_SHOT_MULTIPLIER}). A
 * broken jar plays its breaking strip, one cell a tick, and the tower can be
 * attacked again at the end of it (`TickJar`, `RemoveJar`). The Jars stay the
 * active weapon, with no timer, until every jar is broken (`Jars.update`).
 *
 * Positions here are screen points, the space Flash measured all of this in.
 */

import { JARS, siegeLevel, siegeValue } from "./siege.js";
import { TICKS_PER_SECOND, towerHealthScale } from "./stats.js";

/**
 * The building types a jar lands on: Flash keeps only the `BTOWER`s of what
 * the drop touches (`Jars.as:219-230`). `BUILDING20`, `21`, `23`, `25`, `115`,
 * `118`, the Quake Tower (129), the Inferno Cannon (130), the Magma Tower
 * (132), the Spurtz Cannons (136, and 137 through `SpurtzCannon`) and the
 * Stronghold (`GuardTower`, 138). Neither bunker is one: the Monster Bunker
 * (22) and the Housing Bunker (128) are `Bunker`s.
 */
export const JAR_TOWER_TYPES: readonly number[] = [
  20, 21, 23, 25, 115, 118, 129, 130, 132, 136, 137, 138,
];

/**
 * The fall, 1 s: `TweenLite.from(..., 1, ...)` with `RENDERER_ON`, which is
 * on (`BTOWER.as:263-269`, `BYMConfig.as:45-51`).
 */
export const JAR_FALL_TICKS = 1 * TICKS_PER_SECOND;

/**
 * `Jars.update` looks every second: `new Timer(1000, duration)` with a 0
 * duration, which repeats for good (`Jars.as:198`, `:203-207`).
 */
export const JAR_CHECK_TICKS = TICKS_PER_SECOND;

/**
 * `JAR_GRAPHIC_FRAMES`: the strip's last cell, where the jar is gone
 * (`Jars.as:26`, `BTOWER.as:300-308`).
 */
export const JAR_FRAMES = 23;

/**
 * What one shot does to the tower's own jar, as a multiple of the shot
 * (`int(damage * multiple * scale * overdrive)`): the Cannon's six
 * (`BUILDING20.as:33`), the Laser's 25 (`BUILDING23.as:53`), the Railgun's
 * and the Quake Tower's three (`BUILDING118.as:139`, `INFERNOQUAKETOWER.as:145`),
 * a Spurtz Cannon's quarter (`SpurtzCannon.shootJar`, `:193-201`), and one
 * for the Sniper, the Tesla's zap, the Aerial Defense and the Magma Tower
 * (`BUILDING21.as:48`, `BUILDING25.as:131`, `BUILDING115.as:132`,
 * `INFERNO_MAGMA_TOWER.as:69`). The Inferno Cannon and the Stronghold have
 * no jar branch: they fire on as ever and their jars never break.
 */
export const JAR_SHOT_MULTIPLIER: Readonly<Record<number, number>> = {
  20: 6,
  21: 1,
  23: 25,
  25: 1,
  115: 1,
  118: 3,
  129: 3,
  132: 1,
  136: 0.25,
  137: 0.25,
};

/** The Quake Tower, whose blow is not scaled by its health (`INFERNOQUAKETOWER.as:139`). */
export const JAR_QUAKE_TYPE = 129;

/** Jars dropped at a level, on the battle's clock. */
export interface JarsPlan {
  /** `range`: how far from the drop, on screen, it reaches. */
  readonly range: number;
  /** `durability`: each jar's health. */
  readonly durability: number;
  /** The tick the jars land. */
  readonly landsAt: number;
}

/** Jars dropped on tick `droppedAt` at `level`, or null for level 0 (not researched). */
export const jarsPlan = (level: number, droppedAt: number): JarsPlan | null => {
  const at = siegeLevel(level);
  const range = siegeValue(JARS.range, at);
  const durability = siegeValue(JARS.durability, at);
  if (range === null || durability === null) return null;
  return { range, durability, landsAt: droppedAt + JAR_FALL_TICKS };
};

/**
 * What a tower of `type` takes off its jar with a shot of `damage` (Tower
 * Overdrive in it) at health `hp` of `maxHp`, or null when its shots never
 * touch the jar ({@link JAR_SHOT_MULTIPLIER}).
 */
export const jarShot = (
  type: number,
  damage: number,
  hp: number,
  maxHp: number,
): number | null => {
  const multiple = JAR_SHOT_MULTIPLIER[type];
  if (multiple === undefined) return null;
  const scale = type === JAR_QUAKE_TYPE ? 1 : towerHealthScale(hp, maxHp);
  return Math.trunc(damage * multiple * scale);
};

/**
 * The strip's cell for a jar at `health` of `durability`, set as each shot is
 * fired, before it lands (`UpdateJar`, `BTOWER.as:284-298`): cracked twice
 * under 30%, once under 60%, whole above. It breaks from there.
 */
export const jarFrame = (health: number, durability: number): number => {
  const share = health / durability;
  if (share < 0.3) return 2;
  if (share < 0.6) return 1;
  return 0;
};
