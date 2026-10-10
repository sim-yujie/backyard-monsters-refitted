import type { MonsterRanks } from "./types.js";

/**
 * The Monster Lab's special moves (issue #352, `docs/design/special-moves.md`).
 *
 * Every move is switched on by a Lab rank of 1 or more and scaled by the rank,
 * 1 to 3 (`MonsterBase.powerUpLevel`, `MONSTERLAB.as:77-188`). Rank 0 is the
 * plain monster. The numbers follow the Lab screen's own text (owner decision,
 * 2026-10-10), which is where Flash's code and screen disagree.
 *
 * Only numbers live here, so the engine, the Lab screen and the tests read the
 * same figure. All of it is whole-number arithmetic.
 */

/** The highest Lab rank a monster reaches (`MONSTERLAB.as`, three ranks each). */
export const MAX_RANK = 3;

/** A monster's rank in `ranks`: whole, 0 to {@link MAX_RANK}; absent or unreadable is 0. */
export const rankOf = (ranks: MonsterRanks | undefined, id: string): number => {
  const rank = ranks?.[id];
  if (typeof rank !== "number" || !Number.isFinite(rank) || rank < 1) return 0;
  return Math.min(Math.floor(rank), MAX_RANK);
};

/** C4 Fink: "Extra Target(s)" (`Fink.as:6-10`). */
export const FINK_ID = "C4";
/** Fink's splash reaches this far and is full damage inside it (`Fink.as:10`). */
export const FINK_RADIUS = 60;
/** Fink's splash hits this many targets besides the one it struck: its rank. */
export const finkExtraTargets = (rank: number): number => rank;

/** C13 Wormzer: "Splash Damage" (`Wormzer.as:5-15`). */
export const WORMZER_ID = "C13";
/** Wormzer's splash reaches this far, with a straight fall to a fifth at the edge. */
export const WORMZER_RADIUS = 100;
/** The swing's damage times this is the splash's full damage: x1, x2, x3. */
export const wormzerMultiplier = (rank: number): number => rank;

/** C11 Project X: "Acid Damage" (`ProjectX.as:6-15`). */
export const PROJECT_X_ID = "C11";
/** Project X's death blast reaches this far, falling away to a fifth at the edge. */
export const PROJECT_X_RADIUS = 60;
/** Its damage times this is the blast's full damage: x1, x2, x3 (the Lab screen's). */
export const projectXMultiplier = (rank: number): number => rank;

/** C5 Eye-ra: "Airburst Bonus" (`CreepBase.airburst`, `Eyera.as`). */
export const EYE_RA_ID = "C5";
/** The airburst's damage as a percentage of the swing: 120, 130, 140 (Lab screen +20/30/40%). */
export const airburstPercent = (rank: number): number => 100 + 10 * (rank + 1);
/** Flash's building blast radius is 60 times the multiplier, and it keeps the whole pixels. */
export const AIRBURST_BUILDING_RADIUS = 60;
/** Flash's blast radius on creeps is 90 times the same multiplier. */
export const AIRBURST_CREEP_RADIUS = 90;
/** A blast radius scaled by the airburst multiplier, truncated as `int()` does. */
export const airburstRadius = (base: number, rank: number): number =>
  Math.trunc((base * airburstPercent(rank)) / 100);

/** C12 D.A.V.E.: "Rocket Range" (`DAVERockets.as:6-17`). */
export const DAVE_ID = "C12";
/** D.A.V.E.'s range at a rank: 140, 180, 220. It has no range, and so no rockets, at rank 0. */
export const daveRange = (rank: number): number => 100 + 40 * rank;

/** C3 Bolt: "Blink Range" (`Bolt.as:5-7`, `Blink.as`). */
export const BOLT_ID = "C3";
/** Bolt's blink reaches this far, on screen, per rank: 150, 300, 450 (`Blink.as:21`). */
export const blinkRange = (rank: number): number => 150 * rank;
/** It only blinks with fewer than this many waypoints of route left: 5, 10, 15 (`Blink.as:17`). */
export const blinkRouteLimit = (rank: number): number => 5 * rank;
/** The blink is this many hops, each a tenth of the way (`Blink.as:12`, `:42`). */
export const BLINK_HOPS = 10;

/** C7 Bandito: "Whirlwind" (`Bandito.as`, `BanditoAOEDamageSpin.as`). */
export const BANDITO_ID = "C7";
/** The spin splashes this far round the Bandito, full damage inside it (`Bandito.as:15`). */
export const BANDITO_RADIUS = 60;
/** Its attack speed as a percentage: 100, 150, 200 (the Lab screen's 1 / 1.5 / 2 x). */
export const banditoSpeedPercent = (rank: number): number => 50 + 50 * rank;

/** C8 Fang: "Venom Damage" (`Fang.as:5-7`, `PoisonOnAttack.as`, `DOTEffect.as`). */
export const FANG_ID = "C8";
/** Each stack of venom hurts for the Fang's damage times this: 0.1, 0.2, 0.3 (the Lab screen's). */
export const venomShare = (rank: number): number => rank / 10;
/** The venom bites every half second: Flash's 40 loops at 80 loops a second (owner decision 2026-10-10). */
export const VENOM_INTERVAL_SECONDS = 0.5;

/** C9 Brain: "Cloak Delay" (`Brain.as:5-7`, `Invisibility.as`). */
export const BRAIN_ID = "C9";
/** Seconds a Brain stays unseen once it has arrived: 0, 4, 8 (the Lab screen's). */
export const cloakDelaySeconds = (rank: number): number => 4 * (rank - 1);

/** C14 Teratorn: "Fireball Bounces" (`Teratorn.as:5-8`, `GlavesOnAttack.as`, `FIREBALL.as`). */
export const TERATORN_ID = "C14";
/** A fireball jumps on to a building within this many screen px of the last (`FIREBALL.as:279`). */
export const BOUNCE_RADIUS = 100;
/** How many times the fireball jumps on: its rank. */
export const bounceCount = (rank: number): number => rank;
