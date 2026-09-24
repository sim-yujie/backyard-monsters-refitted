import {
  BUILDING_HP,
  CHAMPION_PROPS,
  FLYER_MODE,
  GRID_COST,
  GRID_COST_FORMULA,
  MONSTER_PROPS,
  MR2_CAPACITY,
  TOWER_STATS,
  TRAP_STATS,
} from "./combatStatsData.js";
import type {
  ChampionCombatProps,
  GridCostRect,
  MonsterCombatProps,
  TowerLevelStats,
  TrapStats,
} from "./combatStatsData.js";

/**
 * Reading the combat stats table, and the constants that live in code.
 *
 * Two kinds of number decide a battle. The first are ladders in the Flash
 * client's props file, which `combatStatsData.ts` carries; this file is how
 * they are read, including the clamp the client applies to a level past the end
 * of an array. The second are written into the client's classes rather than its
 * tables — a tower's re-arm, a trap's blast falloff, the fortification formula,
 * the bomb tiers — and those are transcribed here, each with the line it came
 * from, because there is no table to generate them out of.
 *
 * ## Ticks
 *
 * Every duration is in **fast ticks, 80 per second**. That is the unit the
 * client's combat constants are already written in: `GLOBAL` banks `2 / 25`
 * loops per millisecond, which is 80 a second (`client/scripts/GLOBAL.as:1234`),
 * and `rate * 2`, `attackDelay` and the 150-tick retarget are all counted in
 * them. Converting to seconds would be a chance to be wrong in forty places for
 * nothing (`docs/design/server-combat.md` §3.4, §6 item 9).
 *
 * ## What is not here
 *
 * Nothing in this file decides anything. The bound model (`potential.ts`), the
 * damage percentage (`damagePercent.ts`) and the engine (`engine.ts`) are the
 * consumers; this is the dictionary they read. It imports only
 * `combatStatsData.ts`, because the shared module may import nothing outside
 * itself (`docs/design/server-combat.md` §3.2) — the server runs these bytes
 * under Bun with no build step and the web client bundles the same ones.
 */

/* ── The clock ────────────────────────────────────────────────────────────── */

/**
 * Fast ticks per second.
 *
 * `GLOBAL` banks `2 / 25` loops for every millisecond elapsed
 * (`client/scripts/GLOBAL.as:1234`), so a second is 80 loops. The engine runs a
 * fixed timestep at this rate and drops the client's accumulator, its 800-loop
 * cap and its catch-up mode (`docs/specs/combat.md:1443-1447`).
 */
export const TICKS_PER_SECOND = 80;

/** Seconds to fast ticks, floored — every stored duration is an integer tick. */
export const ticks = (seconds: number): number => Math.floor(seconds * TICKS_PER_SECOND);

/**
 * How long an attack runs before it ends itself, in seconds.
 *
 * `ATTACK._countdown` starts at `60 * 5`, or `60 * 7` when the attacker's
 * alliance holds Declare War (`client/scripts/GLOBAL.as:839-842`).
 */
export const ATTACK_COUNTDOWN_SECONDS = 300;
export const DECLARE_WAR_COUNTDOWN_SECONDS = 420;

/**
 * The grace after the countdown reaches zero, in seconds.
 *
 * The client retreats everything at `_countdown == -120`
 * (`client/scripts/ATTACK.as:237-240`), so an attack cannot outlive the longer
 * countdown plus this.
 */
export const RETREAT_GRACE_SECONDS = 120;

/** The longest an honest attack can last: Declare War plus the retreat grace. */
export const ATTACK_MAX_SECONDS = DECLARE_WAR_COUNTDOWN_SECONDS + RETREAT_GRACE_SECONDS;

/**
 * The damage percentage that counts as a win.
 *
 * `BYMConfig.k_sVICTORY_THRESHOLD`
 * (`client/scripts/com/monsters/configs/BYMConfig.as:30`), which is what
 * `destroyed` is derived from on a wild monster or outpost target
 * (`client/scripts/BASE.as:3297-3308`).
 */
export const VICTORY_THRESHOLD = 90;

/* ── Reading a ladder ─────────────────────────────────────────────────────── */

/**
 * `values[level - 1]`, with the client's clamp for a level past the end.
 *
 * `CREATURES.GetProperty` shortens the level to the array's length before
 * indexing, so a level 6 Pokey and a level 9 Pokey both read the last entry
 * (`client/scripts/CREATURES.as:75-77`, `:81`). A missing or empty array reads
 * as 0, which is the same fallthrough the client's `if (!stat) return 0` makes
 * (`:49-51`).
 */
const atLevel = <T>(values: readonly T[] | undefined, level: number, fallback: T): T => {
  if (!values || values.length === 0) return fallback;
  const clamped = Math.max(1, Math.min(Math.floor(level), values.length));
  return values[clamped - 1] ?? fallback;
};

/* ── Monsters ─────────────────────────────────────────────────────────────── */

/** The keys of {@link MonsterCombatProps} that hold a number ladder. */
export type MonsterStatKey = keyof MonsterCombatProps;

/**
 * One monster stat at one level, 0 when the monster does not carry it.
 *
 * Levels come from the attacker's academy, 1 to 6
 * (`docs/specs/monsters-and-hatchery.md:1263-1275`); an absent academy entry
 * means level 1 (`client/scripts/CREATURES.as:45-47`).
 */
export const monsterStat = (id: string, key: MonsterStatKey, level: number): number =>
  atLevel(MONSTER_PROPS[id]?.props[key], level, 0);

/** `ground`, `fly`, `fly_low`, `burrow`, … or undefined when the table has none. */
export const monsterMovement = (id: string): string | undefined => MONSTER_PROPS[id]?.movement;

/** The pathing mode, when the monster declares one. */
export const monsterPathing = (id: string): string | undefined => MONSTER_PROPS[id]?.pathing;

/** Whether the table holds this monster at all. */
export const isKnownMonster = (id: string): boolean => MONSTER_PROPS[id] !== undefined;

/** Every monster id the table holds, in table order. */
export const monsterIds = (): readonly string[] => Object.keys(MONSTER_PROPS);

/**
 * Fast ticks between swings when a monster carries no `attackDelay`.
 *
 * `CreepBase` reads the property and substitutes 60 when it comes back falsy
 * (`client/scripts/com/monsters/monsters/creeps/CreepBase.as:108-111`).
 */
export const ATTACK_DELAY_DEFAULT = 60;

/** A monster's swing interval in fast ticks, with the default applied. */
export const monsterAttackDelay = (id: string, level: number): number =>
  monsterStat(id, "attackDelay", level) || ATTACK_DELAY_DEFAULT;

/**
 * The range a monster with no `range` ladder attacks from.
 *
 * `CreepBase` substitutes 1 for a falsy range, which is melee
 * (`CreepBase.as:112-114`).
 */
export const MELEE_RANGE = 1;

/** A monster's attack range in yard units, with the melee default applied. */
export const monsterRange = (id: string, level: number): number =>
  monsterStat(id, "range", level) || MELEE_RANGE;

/**
 * The two halvings between a monster's `speed` prop and what it moves per tick.
 *
 * `CreepBase` divides the prop by 2 when it builds the creep
 * (`CreepBase.as:84`) and `move()` halves it again every tick
 * (`:1456`), so a Pokey's `speed: 1.2` is 0.3 yard units per fast tick. The
 * tutorial doubling at `:85-87` is not modelled: an attack is never in it.
 */
export const SPEED_DIVISOR = 2;
export const MOVE_SPEED_FACTOR = 0.5;

/** Yard units a monster covers per fast tick while walking, before behaviour. */
export const monsterTickSpeed = (id: string, level: number): number =>
  (monsterStat(id, "speed", level) / SPEED_DIVISOR) * MOVE_SPEED_FACTOR;

/**
 * What each behaviour does to that speed, applied in this order.
 *
 * `CreepBase.move()` (`:1456-1470`), and `ChampionBase.move()` applies the same
 * three factors to its own behaviour names
 * (`com/monsters/monsters/champions/ChampionBase.as:1374-1390`). Attacking
 * stops a creep outright, which is why it is 0 rather than a factor.
 */
export const BEHAVIOUR_SPEED: Readonly<Record<string, number>> = {
  pen: 0.5,
  juice: 1.5,
  housing: 1.5,
  bunker: 1.5,
  cage: 1.5,
  freeze: 1.5,
  defend: 1.5,
};

/**
 * Fast ticks between a creep looking for a new target.
 *
 * `CreepBase.TickFast` re-targets every 150 frames when it is neither looking
 * nor attacking (`CreepBase.as:874-876`). The client's catch-up branch, which
 * stretches this to 300, is not modelled (`docs/specs/combat.md:1443-1447`).
 */
export const RETARGET_TICKS = 150;

/**
 * The target groups a monster's `targetGroup` names.
 *
 * Group 2 falls through to "all" when no wall is left and rewrites itself to 1;
 * group 4 does not (`com/monsters/monsters/MonsterBase.as:1072-1077`).
 * `targeting.ts` owns the rules; these are the names.
 */
export const TARGET_GROUP = {
  ALL: 1,
  WALLS: 2,
  RESOURCES: 3,
  TOWERS: 4,
  MONSTERS: 5,
  CHAMPIONS: 6,
} as const;

/**
 * What a specialist does to its own class, and what a hunter does to a creep.
 *
 * A `targetGroup` 2 creep hitting a building whose class is `wall`, and a
 * `targetGroup` 4 creep hitting one whose class is `tower`, deal double; a
 * creep in the hunt behaviour hitting another creep deals triple
 * (`CreepBase.as:884-894`). The hunt multiplier never touches a building, so it
 * does not reach the damage bound of `docs/design/server-combat.md` §2.3.
 */
export const SPECIALIST_DAMAGE_MULTIPLIER = 2;
export const HUNT_DAMAGE_MULTIPLIER = 3;

/**
 * The multiplier a monster's swing carries against one building class.
 *
 * `kind` is the props `type` string the cost table already carries — `wall`,
 * `tower`, `resource` and the rest.
 */
export const specialistMultiplier = (targetGroup: number, kind: string): number => {
  if (targetGroup === TARGET_GROUP.WALLS && kind === "wall") return SPECIALIST_DAMAGE_MULTIPLIER;
  if (targetGroup === TARGET_GROUP.TOWERS && kind === "tower") return SPECIALIST_DAMAGE_MULTIPLIER;
  return 1;
};

/* ── Champions ────────────────────────────────────────────────────────────── */

/** The keys of {@link ChampionCombatProps} that hold a ladder. */
export type ChampionStatKey = keyof ChampionCombatProps;

/** One champion number stat at one level, 0 when the champion has none. */
export const championStat = (id: string, key: ChampionStatKey, level: number): number => {
  const values = CHAMPION_PROPS[id]?.props[key];
  if (!values) return 0;
  const value = atLevel(values as readonly (number | string)[], level, 0);
  return typeof value === "number" ? value : 0;
};

/** A champion's `movement` or `attack` string at one level. */
export const championMode = (id: string, key: "movement" | "attack"): string | undefined => {
  const values = CHAMPION_PROPS[id]?.props[key];
  return values?.[0];
};

/**
 * The champion id an `attackerchampion` entry's `t` names, or undefined.
 *
 * A submitted champion is matched to the stored one by `t`
 * (`docs/design/server-combat.md` §2.5), and the stat table is keyed by id.
 */
export const championByType = (t: number): string | undefined =>
  Object.keys(CHAMPION_PROPS).find((id) => CHAMPION_PROPS[id]?.t === t);

/** Every champion id the table holds, in table order. */
export const championIds = (): readonly string[] => Object.keys(CHAMPION_PROPS);

/**
 * Champion swing intervals in fast ticks, which live in code, not the table.
 *
 * `ChampionBase` sets 56 for every champion
 * (`com/monsters/monsters/champions/ChampionBase.as:164`); `Fomor` overrides it
 * to 8 (`champions/Fomor.as:12`) and `Korath` switches on level, 72 at 1 and 2
 * and 80 from 3 up (`champions/Korath.as:25-46`).
 */
export const CHAMPION_ATTACK_DELAY_DEFAULT = 56;

/** Per-champion overrides, indexed by level minus one where the ladder varies. */
export const CHAMPION_ATTACK_DELAY: Readonly<Record<string, readonly number[]>> = {
  // Fomor is G3, `champions/Fomor.as:12`
  G3: [8],
  // Korath is G4, `champions/Korath.as:25-46`
  G4: [72, 72, 80, 80, 80, 80],
};

/** A champion's swing interval in fast ticks at one level. */
export const championAttackDelay = (id: string, level: number): number =>
  atLevel(CHAMPION_ATTACK_DELAY[id], level, CHAMPION_ATTACK_DELAY_DEFAULT);

/**
 * The power level a champion's `bonus*` ladders are indexed by, 0 to 3.
 *
 * `Krallen` clamps its own to `MAX_POWERLEVEL` before the super call
 * (`champions/Krallen.as:25`), and every bonus array in the stat table is three
 * entries long, so a power level of 0 adds nothing.
 */
export const CHAMPION_MAX_POWER_LEVEL = 3;

/* ── Buildings ────────────────────────────────────────────────────────────── */

/**
 * A building's health at one level, 0 for a type with no ladder.
 *
 * Three of the 140 props entries have no `hp`; none of them is targetable.
 */
export const maxHp = (type: number, level: number): number =>
  atLevel(BUILDING_HP[type], level, 0);

/** The whole health ladder of a type, or an empty array. */
export const hpLadder = (type: number): readonly number[] => BUILDING_HP[type] ?? [];

/** One tower's stats at one level, undefined for a type with no stats block. */
export const towerStats = (type: number, level: number): TowerLevelStats | undefined => {
  const levels = TOWER_STATS[type];
  if (!levels || levels.length === 0) return undefined;
  const clamped = Math.max(1, Math.min(Math.floor(level), levels.length));
  return levels[clamped - 1];
};

/** Whether a type carries a stats block at all. */
export const isTower = (type: number): boolean => TOWER_STATS[type] !== undefined;

/**
 * A tower waits `rate * 2` fast ticks between shots.
 *
 * `BTOWER.TickFast` adds `_rate * 2` to its fire tick after firing
 * (`client/scripts/BTOWER.as:179`), where `_rate` is the level's `rate` from
 * the props table (`:105`). So the Cannon Tower's `rate: 40` is one shot a
 * second.
 */
export const TOWER_REARM_MULTIPLIER = 2;

/**
 * The fast ticks a tower waits after losing or acquiring a target.
 *
 * `BTOWER` sets `_fireTick = 30` on each of its three re-acquire paths
 * (`BTOWER.as:184`, `:189`, `:220`).
 */
export const TOWER_ACQUIRE_TICKS = 30;

/** A tower's interval between shots in fast ticks, 0 when it does not shoot. */
export const towerRearmTicks = (type: number, level: number): number => {
  const rate = towerStats(type, level)?.rate;
  return rate === undefined ? 0 : rate * TOWER_REARM_MULTIPLIER;
};

/** 0 ground only, 1 both, 2 air only. A type with no entry is ground only. */
export const flyerMode = (type: number): 0 | 1 | 2 => FLYER_MODE[type] ?? 0;

/** Whether a tower may fire at a flying creep (`BTOWER.as:165`). */
export const hitsFlyers = (type: number): boolean => flyerMode(type) !== 0;

/** Whether a tower may fire at a ground creep: mode 2 is air only. */
export const hitsGround = (type: number): boolean => flyerMode(type) !== 2;

/**
 * The pathing rectangles a placed building stamps, with the wall formula applied.
 *
 * Every rectangle is a constant except the wall's inner one, which
 * `BFOUNDATION.SetProps` prices at `100 + level * 25`
 * (`client/scripts/BFOUNDATION.as:3151`). A type with no row stamps nothing,
 * which is what a trap does.
 */
export const gridCost = (type: number, level = 1): readonly GridCostRect[] => {
  const rects = GRID_COST[type];
  if (!rects) return [];
  const formula = GRID_COST_FORMULA[type];
  if (!formula) return rects;
  return rects.map((rect, index) =>
    index === formula.rect
      ? ([rect[0], rect[1], rect[2], rect[3], formula.base + level * formula.perLevel] as const)
      : rect,
  );
};

/**
 * A Map Room 2 capacity at one level: Flinger payload, Housing room, Bunker room.
 *
 * 0 for any other type, because no other `capacity` in the props table is a
 * combat number (`web/tools/gen-building-costs.mjs:158-167`).
 */
export const capacity = (type: number, level: number): number =>
  atLevel(MR2_CAPACITY[type], level, 0);

/** The Flinger, whose payload caps one fling. */
export const FLINGER_TYPE = 5;

/**
 * The Flinger level a Map Room 2 attacker fires at.
 *
 * `GLOBAL` pins it to 4 outside Map Room 3 (`client/scripts/GLOBAL.as:863`),
 * so one Map Room 2 fling carries 2,250 bucket units whatever the attacker
 * built (`:713`).
 */
export const MR2_FLINGER_LEVEL = 4;

/** A trap's one-shot numbers, or undefined for a type that is not a trap. */
export const trapStats = (type: number): TrapStats | undefined => TRAP_STATS[type];

/**
 * The radius a trap watches, and how often it looks, in fast ticks.
 *
 * `BTRAP` sets `_range = 20` in its constructor (`client/scripts/BTRAP.as:25`)
 * and re-scans every 20 ticks while it has no target (`:50-53`). The blast
 * itself uses the wider `size`, not this.
 */
export const TRAP_TRIGGER_RANGE = 20;
export const TRAP_RETARGET_TICKS = 20;

/**
 * What a trap deals to a creep `distance` away, with its linear falloff.
 *
 * `damage / size * (size - distance * 0.5)` over every creep inside `size`
 * (`client/scripts/BTRAP.as:98`, `:106`). The halved distance means the edge of
 * the blast still deals half damage rather than none, and a creep outside it
 * takes nothing.
 */
export const trapDamageAt = (type: number, distance: number): number => {
  const trap = TRAP_STATS[type];
  if (!trap || distance > trap.size) return 0;
  return (trap.damage / trap.size) * (trap.size - distance * 0.5);
};

/**
 * The highest fortification a building can hold.
 *
 * `BYMConfig.k_sMAX_FORTIFICATION_LEVEL`
 * (`com/monsters/configs/BYMConfig.as:32`).
 */
export const MAX_FORTIFICATION_LEVEL = 4;

/**
 * What a building actually takes from a swing of `damage`.
 *
 * Fortification cuts it by `10 + level * 10` percent and armour by its own
 * fraction (`client/scripts/BFOUNDATION.as:508-512`). Both only ever lower the
 * figure, which is why neither appears in the damage bound of
 * `docs/design/server-combat.md` §2.3.
 */
export const fortifiedDamage = (damage: number, fortification = 0, armor = 0): number => {
  let dealt = Math.abs(damage);
  if (fortification > 0) {
    dealt *= 100 - (fortification * 10 + 10);
    dealt /= 100;
  }
  return dealt * (armor ? 1 - armor : 1);
};

/* ── Loot ─────────────────────────────────────────────────────────────────── */

/**
 * What a storage building hands over per point of damage.
 *
 * `BSTORAGE.Loot` scales the draw by where the yard is: half on a Map Room 2
 * outpost, nine tenths on a main yard, and a fifth of that again on a wild
 * monster camp (`client/scripts/BSTORAGE.as:77-85`). Every one of them shrinks
 * the gain, which is what makes the loot bound of §2.4 an upper bound.
 */
export const STORAGE_SCALAR_OUTPOST = 0.5;
export const STORAGE_SCALAR_MAIN = 0.9;
export const WILD_MONSTER_LOOT_DIVISOR = 5;

/**
 * The bonus a low-level attacker's loot carries.
 *
 * `ATTACK.Loot` adds `(20 - playerLevel) * 3%` below level 20
 * (`client/scripts/ATTACK.as:678-680`), so the most anyone gets is `+57%` at
 * level 1. That is where `LOOT_GAIN_RATIO = 1.6` comes from
 * (`docs/design/server-combat.md` §2.4, §6 item 3).
 */
export const LOW_LEVEL_LOOT_CEILING = 20;
export const LOW_LEVEL_LOOT_PER_LEVEL = 0.03;

/** The multiplier `ATTACK.Loot` applies to a gain at `playerLevel`. */
export const lowLevelLootBonus = (playerLevel: number): number =>
  playerLevel >= LOW_LEVEL_LOOT_CEILING
    ? 1
    : 1 + Math.max(0, (LOW_LEVEL_LOOT_CEILING - playerLevel) * LOW_LEVEL_LOOT_PER_LEVEL);

/**
 * What a resource specialist and a champion add to their looting property.
 *
 * A `targetGroup` 3 creep and every champion add 1.5 to the loot property on
 * construction (`CreepBase.as:224-226`, `ChampionBase.as:221`), over a base of
 * 1. How `CModifiableProperty` composes the two was not traced
 * (`docs/specs/combat.md:1370-1372`), so the bound takes the larger reading.
 */
export const LOOT_PROPERTY_BONUS = 1.5;

/**
 * Krallen's looting multipliers, the largest in the client.
 *
 * `x2` against a harvester and `x3` against a storage building
 * (`champions/Krallen.as:31-32`). She also raises the attacker's own storage
 * cap by her `buffs` ladder while she is on the field
 * (`client/scripts/ATTACK.as:696-702`).
 */
export const KRALLEN_RESOURCE_LOOT_MULTIPLIER = 2;
export const KRALLEN_STORAGE_LOOT_MULTIPLIER = 3;

/** The types a point of damage draws resources out of (`docs/specs/combat.md:1410-1416`). */
export const HARVESTER_TYPES: readonly number[] = [1, 2, 3, 4];
export const STORAGE_TYPES: readonly number[] = [6, 14, 112];

/** Whether damage to this type takes resources with it. */
export const isLootable = (type: number): boolean =>
  HARVESTER_TYPES.includes(type) || STORAGE_TYPES.includes(type);

/* ── Bombs ────────────────────────────────────────────────────────────────── */

/** One entry of `ResourceBombs._bombs`. */
export interface BombStats {
  readonly id: string;
  /** 1 twigs, 2 pebbles, 3 putty. There is no goo bomb. */
  readonly resource: number;
  /** Flat damage at the centre; 0 for a putty bomb, which slows instead. */
  readonly damage: number;
  /** The fraction a putty bomb takes off a creep's speed. */
  readonly damageMult?: number;
  readonly radius: number;
  /** What firing it costs the attacker, out of the same resource. */
  readonly cost: number;
  /** The catapult level that unlocks this tier. */
  readonly catapultLevel: number;
}

/**
 * The bomb table, transcribed from `ResourceBombs.Data()`.
 *
 * `com/monsters/effects/ResourceBombs.as:48-226`, one row per `_bombs` entry
 * with the line each starts on. It is a code literal rather than a props entry,
 * so there is nothing for the generator to read; `stats.test.ts` asserts the
 * figures the bound depends on.
 *
 * Firing one marks every bomb of that resource used, so an attack fires at most
 * one per resource (`ResourceBombs.as:310-314`), and the client refuses one the
 * attacker cannot pay for (`:301-305`).
 */
export const BOMBS: readonly BombStats[] = [
  // :49
  { id: "tw0", resource: 1, damage: 2200, radius: 200, cost: 10_000, catapultLevel: 1 },
  // :64
  { id: "tw1", resource: 1, damage: 7000, radius: 200, cost: 100_000, catapultLevel: 1 },
  // :79
  { id: "tw2", resource: 1, damage: 50_000, radius: 200, cost: 5_000_000, catapultLevel: 1 },
  // :94
  { id: "pb0", resource: 2, damage: 2400, radius: 200, cost: 10_000, catapultLevel: 2 },
  // :109
  { id: "pb1", resource: 2, damage: 9000, radius: 300, cost: 100_000, catapultLevel: 2 },
  // :124
  { id: "pb2", resource: 2, damage: 30_000, radius: 350, cost: 2_000_000, catapultLevel: 2 },
  // :139
  { id: "pb3", resource: 2, damage: 75_000, radius: 400, cost: 10_000_000, catapultLevel: 2 },
  // Putty bombs deal no damage: `damageMult` is what they take off a creep's
  // speed, so none of them reaches the damage bound of §2.3.
  // :154
  { id: "pu0", resource: 3, damage: 0, radius: 150, cost: 10_000, catapultLevel: 3,
    damageMult: 0.2 },
  // :172
  { id: "pu1", resource: 3, damage: 0, radius: 150, cost: 100_000, catapultLevel: 3,
    damageMult: 0.4 },
  // :190
  { id: "pu2", resource: 3, damage: 0, radius: 300, cost: 5_000_000, catapultLevel: 3,
    damageMult: 0.7 },
  // :208
  { id: "pu3", resource: 3, damage: 0, radius: 500, cost: 10_000_000, catapultLevel: 3,
    damageMult: 0.9 },
];

/** The bombs a catapult at `catapultLevel` can fire. */
export const bombsFor = (catapultLevel: number): readonly BombStats[] =>
  BOMBS.filter((bomb) => bomb.catapultLevel <= catapultLevel);

/**
 * The most damage bombs can add to one attack at `catapultLevel`.
 *
 * One bomb per resource, each taken at its largest tier
 * (`docs/design/server-combat.md` §2.3). At catapult 2 that is 50,000 of twigs
 * plus 75,000 of pebbles; putty adds nothing, having no damage at all.
 */
export const maxBombDamage = (catapultLevel: number): number => {
  const best = new Map<number, number>();
  for (const bomb of bombsFor(catapultLevel)) {
    best.set(bomb.resource, Math.max(best.get(bomb.resource) ?? 0, bomb.damage));
  }
  return [...best.values()].reduce((total, one) => total + one, 0);
};

/**
 * The most one resource can be spent on bombs in one attack.
 *
 * The largest tier of that resource the catapult unlocks, and 0 for a resource
 * it has no bomb for — which is every catapult level for goo.
 */
export const maxBombSpend = (resource: number, catapultLevel: number): number =>
  bombsFor(catapultLevel)
    .filter((bomb) => bomb.resource === resource)
    .reduce((most, bomb) => Math.max(most, bomb.cost), 0);
