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

/* ── Korath (G4) ──────────────────────────────────────────────────────────── */

/** `KORATH_POWER_FIREBALL` and `KORATH_POWER_STOMP` (`Korath.as:13-15`). */
export const KORATH_POWER_FIREBALL = 2;
export const KORATH_POWER_STOMP = 3;

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

/** The flame each hit leaves: a tenth of his damage (`Korath.as:162-165`). */
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

/** `ProximityLootBuff` is her third ability, live from power level 2 (`CHAMPIONCAGE.as:265`). */
export const hasLootAura = (id: string, power: number): boolean =>
  id === KRALLEN_ID && power >= KRALLEN_MAX_POWER_LEVEL;

/**
 * Krallen's `_buff` is her `buffs` rung alone (`Krallen.as:33`); her
 * `bonusBuffs` ladder is `[0]`, so `updateBuffs` adds nothing to it.
 */
export const krallenBuff = (level: number): number => championStat(KRALLEN_ID, "buffs", level);

/** The aura's radius: her `buffRadius` rung, on screen (`ProximityLootBuff.as:24`). */
export const krallenAuraRadius = (level: number): number =>
  championStat(KRALLEN_ID, "buffRadius", level);

/** What the aura adds to a looting property: `1 + _buff` (`ProximityLootBuff.as:47`). */
export const lootAuraBonus = (buff: number): number => 1 + buff;

/** The aura looks around every 50 of her frames (`ProximityLootBuff.as:42`). */
export const LOOT_AURA_FRAMES = 50;
