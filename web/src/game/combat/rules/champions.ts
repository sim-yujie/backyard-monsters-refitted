import { CHAMPION_MAX_POWER_LEVEL, championStat } from "./stats.js";
import { CHAMPION_PROPS } from "./combatStatsData.js";

/**
 * The champions' own abilities, as the Flash champions use them (issue #222).
 *
 * Every number here is read off `client/scripts/com/monsters/monsters/champions/`
 * and the components those classes add; the engine (`engine.ts`) applies them.
 * Timings are the original client's, where every component ticked every frame.
 * The refitted client batches component ticks three frames at a time
 * (`MonsterBase.as:199`, `:516-535`), which changes no figure here except that
 * it makes `ProximityLootBuff`'s `% 50` test miss most of its frames; the
 * engine keeps the per-frame cadence the abilities were written for.
 *
 * ## Gates
 *
 * Abilities are gated on the power level, `pl`, as Flash gates them, and on the
 * evolution level. Flash adds the `bonus*` ladders by the food bonus, `fb`; the
 * engine indexes them by `pl` (issue #202), and the two buffs below follow it.
 */

export const GORGO_ID = "G1";
export const DRULL_ID = "G2";
export const FOMOR_ID = "G3";
export const KORATH_ID = "G4";
export const KRALLEN_ID = "G5";

/** Krallen clamps her power level to 2 before anything reads it (`Krallen.as:15`, `:25`). */
export const KRALLEN_MAX_POWER_LEVEL = 2;

/** A champion's power level as its own class reads it: whole, 0 to 3, Krallen's at most 2. */
export const championPower = (id: string, powerLevel: number | undefined): number => {
  const whole = Math.min(Math.max(Math.floor(powerLevel ?? 0), 0), CHAMPION_MAX_POWER_LEVEL);
  return id === KRALLEN_ID ? Math.min(whole, KRALLEN_MAX_POWER_LEVEL) : whole;
};

/* ── Frames ───────────────────────────────────────────────────────────────── */

/**
 * A champion's `_frameNumber` starts at a random whole number below 7
 * (`ChampionBase.as:228`, `Krallen.as:47`), and a flying champion's is drawn
 * again below 1,000 (`ChampionBase.as:237`). The engine draws both from the
 * battle's stream when the champion takes the field.
 */
export const START_FRAME_SPREAD = 7;
export const FLYING_START_FRAME_SPREAD = 1000;

/** A champion looks for a new building every 100 of its frames (`ChampionBase.as:804`). */
export const CHAMPION_RETARGET_FRAMES = 100;

/* ── Melee reach to buildings ─────────────────────────────────────────────── */

/**
 * How near a melee champion in {@link MELEE_REACH_CHAMPIONS} must stand to
 * hit a building: yard units from the nearest point of its footprint, one
 * grid cell. A melee monster's route ends in the cell beside the footprint
 * and it stops within 10 screen px of that cell's middle, 0 to 25 units off
 * the tiles; this lets the champion strike no farther out than that.
 */
export const MELEE_BUILDING_REACH = 10;

/**
 * The melee champions, which hit a building from beside it rather than from
 * their stat `range` (patch 7.10, owner 19 Nov 2026, after player arC's
 * report that Gorgo hit his Town Hall from about four tiles off): Gorgo,
 * Drull, Korath and Krallen. Their range stays theirs against monsters
 * (`fight`, the cage) and for Korath's quake. Fomor, ranged, keeps his.
 */
export const MELEE_REACH_CHAMPIONS: readonly string[] = [GORGO_ID, DRULL_ID, KORATH_ID, KRALLEN_ID];

/**
 * The share of its stat range from which a ranged monster or Fomor reaches a
 * building, in yard units from the nearest tile: 1/√2 (owner's pick C,
 * 24 Nov 2026, after D.A.V.E. was seen firing from much farther than in Flash).
 *
 * Flash measured `range` in screen pixels (`CreepBase.as:735-741`). Since
 * patch 7.9 reach is yard units from the nearest tile (`reachSquared`), and a
 * yard circle shows on screen as a 2:1 ellipse, √2 times as wide as the range
 * in pixels. Scaled by 1/√2, a ranged monster beside a building fires from
 * Flash's `range` pixels off the tiles again; head on it fires from half of
 * that. Its range against monsters (`fight`) is screen pixels and unchanged.
 */
export const RANGED_BUILDING_REACH_SCALE = Math.SQRT1_2;

/**
 * A champion's or monster's reach to a building, given its stat range: one
 * cell for a melee champion (patch 7.10), else its range scaled by
 * {@link RANGED_BUILDING_REACH_SCALE}. Every building reach in the engine
 * (`canShootBuilding` and Fomor's support reach) goes through here.
 */
export const buildingReachOf = (id: string, champion: boolean, range: number): number =>
  champion && MELEE_REACH_CHAMPIONS.includes(id)
    ? MELEE_BUILDING_REACH
    : range * RANGED_BUILDING_REACH_SCALE;

/* ── Korath (G4) ──────────────────────────────────────────────────────────── */

/**
 * Korath's powers (`Korath.as:11-15`): 1 Burn, 2 Breath of Fire, 3 Fists of
 * Doom, as Monster Madness awards them. Flash named power 1 `NORMAL` and left
 * the flame on every Korath; here the flame is the Burn power's (owner,
 * 11 Nov 2026: "No one has korath with burns yet so remove it"), so a Korath
 * at power 0 hits without one.
 */
export const KORATH_POWER_BURN = 1;
export const KORATH_POWER_FIREBALL = 2;
export const KORATH_POWER_STOMP = 3;

/** Whether Korath's hits and fireballs leave his flame: from the Burn power, power level 1. */
export const hasFlame = (id: string, power: number): boolean =>
  id === KORATH_ID && power >= KORATH_POWER_BURN;

/**
 * Korath shoots a fireball at a flyer from power level 2 at level 4 and up
 * (`Korath.as:72`, `:99`, `:118`, `:131`); without it he cannot hit one.
 */
export const hasFireball = (id: string, level: number, power: number): boolean =>
  id === KORATH_ID && power >= KORATH_POWER_FIREBALL && level > 3;

/** The quake, from power level 3 at level 5 and up (`Korath.as:184`). */
export const hasQuake = (id: string, level: number, power: number): boolean =>
  id === KORATH_ID && power >= KORATH_POWER_STOMP && level > 4;

/** The fireball deals a quarter of his damage, as an `int` (`Korath.as:114`). */
export const KORATH_FIREBALL_DIVISOR = 4;

/**
 * A defending Korath fires at a flyer from twice his range
 * (`ChampionBase.as:876`); attacking, his reach is his range (`Korath.as:136`).
 */
export const KORATH_DEFEND_FLYER_REACH = 2;

/**
 * The flame each hit leaves, once he has Burn ({@link hasFlame}): a tenth of
 * his damage (`Korath.as:162-165`).
 */
export const FLAME_SHARE = 0.1;

/**
 * The flame burns every 40 ticks (`CStatusEffect._MAX_TICKS`,
 * `CStatusEffect.as:15`, `:96-108`), for as long as its target lives: the
 * effect's `_curLife` is reset by a second flame and read by nothing, so it
 * never runs out. A second flame on a burning creep renews the first and adds
 * nothing (`MonsterBase.addStatusEffect`, `:408-416`).
 */
export const FLAME_INTERVAL = 40;

/** The quake starts after three swings (`Korath.as:184`). */
export const QUAKE_SWINGS = 3;

/**
 * The quake's frames (`Korath.as:172-181`): it lands when
 * `_frameNumber / 8 % 10 + 20 == 26`, frame 48 after it starts, and is over at
 * `== 29`, frame 72. Korath does nothing else in between.
 */
export const QUAKE_STRIKE_FRAME = 48;
export const QUAKE_END_FRAME = 72;

/** `_frameNumber / 8 % 10` repeats every 80 frames, so the tests are on the frame mod 80. */
export const QUAKE_FRAME_CYCLE = 80;

/** Its reach, and the inner circle that takes full damage, in ranges (`Korath.as:200-202`). */
export const QUAKE_RADIUS_RANGES = 2.5;
export const QUAKE_INNER_RANGES = 1.5;

/**
 * What `Targeting.DealLinearAEDamage` deals at `distance` (`Targeting.as:340-389`):
 * everything inside `inner`, then a straight fall to the edge, never below a
 * fifth. Each figure lands in an `int`, so each truncates. Undefined past the
 * edge.
 */
export const linearAreaDamage = (
  damage: number,
  radius: number,
  inner: number,
  distance: number,
): number | undefined => {
  const near = inner > radius ? radius - 1 : inner;
  const away = Math.trunc(distance);
  if (radius < away) return undefined;
  let dealt = away < near ? Math.trunc(damage) : Math.trunc((damage / radius) * (radius - away));
  if (dealt < damage / 5) dealt = Math.trunc(damage / 5);
  return dealt;
};

/**
 * Building types `getBuildingsInRange` skips: the ones whose props are
 * `isUntargetable` (`BFOUNDATION.as:695-697`, `GameObject.as:98-100`). Every
 * other building the quake reaches takes it, walls, traps and scenery too.
 */
export const UNTARGETABLE_TYPES: readonly number[] = [27, 127, 139];

/* ── Fomor (G3) ───────────────────────────────────────────────────────────── */

/**
 * Fomor's `_buff`: its `buffs` rung plus the power level's `bonusBuffs`
 * (`ChampionBase.as:154-159`), which its enrage aura is built from.
 */
export const fomorBuff = (level: number, power: number): number => {
  const base = championStat(FOMOR_ID, "buffs", level);
  if (power <= 0) return base;
  const bonus = CHAMPION_PROPS[FOMOR_ID]?.props.bonusBuffs?.[power - 1];
  return base + (typeof bonus === "number" ? bonus : 0);
};

/** `AOEEnrage(250, 1 + _buff * 2, _buff)` (`Fomor.as:18`). */
export const ENRAGE_RADIUS = 250;

/** How often the aura looks around, in ticks (`AOEEnrage.RANGE_CHECK_INTERVAL`). */
export const ENRAGE_INTERVAL = 30;

/** An enraged ally's speed and swing rate multiplier (`Enrage.as:21-25`). */
export const enrageMultiplier = (buff: number): number => 1 + buff * 2;

/**
 * An enraged ally's armour: `ArmorPropertyModifier(_buff)` over a base of 0
 * (`GameObject.as:55`), which `MonsterBase.modifyHealth` takes off every hit
 * as `1 - armor` (`MonsterBase.as:378-379`). A value outside (0, 1] is read
 * as 1 (`ArmorPropertyModifier.as:6-10`).
 */
export const enrageArmour = (buff: number): number => (buff > 1 || buff <= 0 ? 1 : buff);

/** How far Fomor looks for a wounded ally to follow (`Fomor.as:64`). */
export const FOMOR_BUFF_SEARCH = 1500;

/** Fomor looks again every 100 frames, and every 120 while idle (`Fomor.as:119`, `:217`). */
export const FOMOR_LOOK_FRAMES = 100;
export const FOMOR_IDLE_FRAMES = 120;

/** It lets a healed ally go on a frame divisible by 20 (`Fomor.as:204`). */
export const FOMOR_HEALED_FRAMES = 20;

/** It stops shooting when its ally drifts past 1.25 of its range (`Fomor.as:220`). */
export const FOMOR_DRIFT = 1.25;

/* ── Krallen (G5) ─────────────────────────────────────────────────────────── */

/**
 * Her loot aura needs the Krallen Hunt's 3x goal (owner, 13 Nov 2026): a
 * Krallen of any level, 1 to 5, whose player looted three times their hunt
 * goal carries it until the end of the next hunt
 * (`server/src/game-data/events/events.ts`, `KRALLEN_AURA_GOAL_TIMES`); every
 * other Krallen carries none. Flash gave `ProximityLootBuff`, her third
 * ability, to the Krallen whose player reached the second loot mark, 3x the
 * first (power level 2, `CHAMPIONCAGE.as:265`, `KOTHHandler.as:76-84`), at any
 * level. From 23 Oct to 13 Nov 2026 every Krallen of level 3 and up had it
 * without the 3x; from 13 to 15 Nov it needed level 3 too; levels 1-2 added
 * 15 Nov 2026 (owner: a level 1 Krallen won with the 3x must use it).
 */
export const KRALLEN_AURA_LEVEL = 1;

/**
 * Whether a champion carries the loot aura: an attacking Krallen from
 * {@link KRALLEN_AURA_LEVEL} whose aura was earned and running when the attack
 * began (`earned`, the log's `aura`, which the server stamps). A Krallen
 * defending from her cage never lifts the loot of the monsters attacking her
 * yard.
 */
export const hasLootAura = (
  id: string,
  level: number,
  friendly: boolean,
  earned: boolean,
): boolean =>
  id === KRALLEN_ID && !friendly && earned && Math.floor(level) >= KRALLEN_AURA_LEVEL;

/** The aura's radius: her `buffRadius` rung, on screen (`ProximityLootBuff.as:24`). */
export const krallenAuraRadius = (level: number): number =>
  championStat(KRALLEN_ID, "buffRadius", level);

/**
 * AURA STRENGTH, the one place to change it. What the aura adds to a looting
 * property at her levels 1 to 5, added as `LootingMultiplier` adds
 * (`LootingMultiplier.as:46-53`). An ordinary monster loots 0.5, a resource
 * hunter or champion 2.
 * - Level 5: Flash's own `1 + _buff` at her top `buffs` rung, 0.3
 *   (`ProximityLootBuff.as:51`): 1.3, so 0.5 becomes 1.8 (3.6 times) and a
 *   looter's 2 becomes 3.3 (1.65 times).
 * - Level 4: 0.9 (2.8 times, 1.45 times). Level 3: 0.5 (twice, 1.25 times).
 *   Owner, 2026-10-23; kept 13 Nov 2026.
 * - Level 2: 0.35 (1.7 times, 1.175). Level 1: 0.2 (1.4 times, 1.1 times).
 *   Owner, 15 Nov 2026.
 */
export const LOOT_AURA_BONUS: readonly number[] = [0.2, 0.35, 0.5, 0.9, 1.3];

/** What the aura adds to a looting property at her `level`, 0 below {@link KRALLEN_AURA_LEVEL}. */
export const lootAuraBonus = (level: number): number => {
  const rung = Math.floor(level) - KRALLEN_AURA_LEVEL;
  if (!(rung >= 0)) return 0;
  return LOOT_AURA_BONUS[Math.min(rung, LOOT_AURA_BONUS.length - 1)] ?? 0;
};

/** The aura looks around every 50 of her frames (`ProximityLootBuff.as:42`). */
export const LOOT_AURA_FRAMES = 50;

/* ── Krampus's frost aura (beta 10, frost tribe) ─────────────────────────── */

/** Krampus, the frost tribe's champion: wild (`wildChampions.ts`), an enemy this Christmas. */
export const KRAMPUS_ID = "G6";

/**
 * The frost aura looks around every 30 ticks, as Fomor's enrage does
 * (`ENRAGE_INTERVAL`): everything of the other side inside its radius is
 * chilled, and everything it chilled that is no longer inside is let go.
 */
export const KRAMPUS_AURA_INTERVAL = 30;

/**
 * Owner, 27 Nov 2026: "frost aura slows nearby towers AND monsters". The slow
 * at Krampus's level, as a share: a chilled monster moves and swings that
 * much slower, a chilled tower acts on that share fewer ticks (it reloads,
 * winds up and fires slower). Its `buffs` ladder (`wildChampions.ts`):
 * PROPOSED 15% at level 1 up to 40% at level 6.
 */
export const krampusAuraSlow = (level: number): number => championStat(KRAMPUS_ID, "buffs", level);

/** The aura's radius, in the engine's range space (`buffRadius`): PROPOSED 200 to 300. */
export const krampusAuraRadius = (level: number): number =>
  championStat(KRAMPUS_ID, "buffRadius", level);

/** The slow in whole percent, 0-90, for the towers' tick count (integers: same everywhere). */
export const krampusSlowPercent = (level: number): number =>
  Math.max(0, Math.min(90, Math.round(krampusAuraSlow(level) * 100)));
