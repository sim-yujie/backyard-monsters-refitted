import {
  BUILDING_HP,
  CHAMPION_PROPS,
  FLYER_MODE,
  GRID_COST,
  GRID_COST_FORMULA,
  MONSTER_PROPS,
  MR2_CAPACITY,
  OUTPOST_BUILDING_HP,
  OUTPOST_CAPACITY,
  OUTPOST_TOWER_STATS,
  PROPS_SIZE,
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
import type { CombatTargetKind } from "./types.js";

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
 * The longest a wild monster raid runs, in seconds (issue #226).
 *
 * A raid has no countdown: Flash ends it when no raider is left
 * (`client/scripts/WMATTACK.as:331-347`). This is only a safety cap, so a
 * raider stuck somewhere cannot keep the battle open for ever.
 */
export const RAID_MAX_SECONDS = 600;

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

/**
 * A champion's `movement` or `attack` string at one level.
 *
 * These are ladders like every other champion prop: Fomor's `movement` is
 * `["ground", "ground", "fly"]` (`client/scripts/CHAMPIONCAGE.as:160`), so it
 * walks at levels 1 and 2 and flies from 3. `ChampionBase` reads it through
 * `GetGuardianProperty`, which clamps a level past the end to the last entry
 * (`CHAMPIONCAGE.as:401-416`, `champions/ChampionBase.as:153`).
 */
export const championMode = (
  id: string,
  key: "movement" | "attack",
  level: number,
): string | undefined =>
  atLevel<string | undefined>(CHAMPION_PROPS[id]?.props[key], level, undefined);

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

/** The `bonus*` ladder each base stat takes its power-level bonus from. */
const CHAMPION_BONUS_KEY = {
  speed: "bonusSpeed",
  health: "bonusHealth",
  damage: "bonusDamage",
  range: "bonusRange",
} as const;

/**
 * A champion stat at its level plus its power level's bonus, which the
 * `bonus*` ladders add to the level figure, one entry per power level 1 to 3
 * (issue #195). Power level 0 adds nothing.
 */
export const championStatWithPower = (
  id: string,
  key: keyof typeof CHAMPION_BONUS_KEY,
  level: number,
  powerLevel: number,
): number => {
  const base = championStat(id, key, level);
  const power = Math.min(Math.max(Math.floor(powerLevel), 0), CHAMPION_MAX_POWER_LEVEL);
  if (power === 0) return base;
  const bonus = CHAMPION_PROPS[id]?.props[CHAMPION_BONUS_KEY[key]]?.[power - 1];
  return base + (typeof bonus === "number" ? bonus : 0);
};

/* ── Buildings ────────────────────────────────────────────────────────────── */

/**
 * Whether a yard of `kind` reads the outpost props table.
 *
 * `GLOBAL.SetBuildingProps` swaps in `OUTPOST_YARD_PROPS._outpostProps` when
 * the yard type is `EnumYardType.OUTPOST` (`client/scripts/GLOBAL.as:716-723`),
 * which is what an attack on a player's Map Room 2 outpost loads as
 * (`MR2/PopupAttackA.as:125-127`). A wild monster camp loads as a main yard
 * (`:122-123`), so it keeps the main table.
 */
const readsOutpostProps = (kind: CombatTargetKind): boolean => kind === "outpost";

/**
 * A building's health at one level, 0 for a type with no ladder.
 *
 * Three of the 140 props entries have no `hp`; none of them is targetable. On
 * an outpost the outpost table's ladder wins where it has one: the core's
 * 200,000 and the six-level towers (`OUTPOST_BUILDING_HP`).
 */
export const maxHp = (type: number, level: number, kind: CombatTargetKind = "main"): number =>
  atLevel(hpLadder(type, kind), level, 0);

/** The whole health ladder of a type in a yard of `kind`, or an empty array. */
export const hpLadder = (type: number, kind: CombatTargetKind = "main"): readonly number[] =>
  (readsOutpostProps(kind) ? OUTPOST_BUILDING_HP[type] : undefined) ?? BUILDING_HP[type] ?? [];

/**
 * One tower's stats at one level, undefined for a type with no stats block.
 *
 * On an outpost the outpost table's block wins where it has one
 * (`OUTPOST_TOWER_STATS`).
 */
export const towerStats = (
  type: number,
  level: number,
  kind: CombatTargetKind = "main",
): TowerLevelStats | undefined => {
  const levels =
    (readsOutpostProps(kind) ? OUTPOST_TOWER_STATS[type] : undefined) ?? TOWER_STATS[type];
  if (!levels || levels.length === 0) return undefined;
  const clamped = Math.max(1, Math.min(Math.floor(level), levels.length));
  return levels[clamped - 1];
};

/**
 * `GLOBAL._averageAltitude`, the cell height at which the terrain changes
 * nothing (`client/scripts/GLOBAL.as:398`, `:805`).
 */
export const AVERAGE_ALTITUDE = 125;

/**
 * The lowest cell height the terrain applies from: below it the tower keeps
 * its table range (`client/scripts/BTOWER.as:81`).
 */
export const ALTITUDE_FLOOR = 100;

/**
 * The range a tower fires at, in yard units: its `stats` range, scaled by the
 * cell's height on a player's Map Room 2 outpost.
 *
 * `BTOWER.Props` takes `int(range)` and hands it to `AdjustTowerRange`, which
 * returns `int(cellHeight * range / 125)` when the yard is an outpost and the
 * height is at least 100 (`client/scripts/BTOWER.as:80-85`, `:94-99`). So a
 * tower on a cell of height 250 reaches twice as far, and one below 100 is
 * unchanged. `Props` also takes that branch in a wild monster attack, but
 * `AdjustTowerRange` tests the yard type, and a camp loads as a main yard
 * (`MR2/PopupAttackA.as:122-123`), so a camp's towers keep their table range.
 * `height` is the map cell's `i`, an `int` (`MR2/MapRoomCell.as:244-246`,
 * `:322`).
 *
 * Undefined for a type with no range. A bunker reads its dispatch range from
 * the props table directly (`client/scripts/BUILDING22.as:90`, `:124`) and
 * does not come through here.
 */
export const towerRange = (
  type: number,
  level: number,
  kind: CombatTargetKind = "main",
  height = 0,
): number | undefined => {
  const range = towerStats(type, level, kind)?.range;
  if (range === undefined) return undefined;
  const cell = Math.trunc(height);
  if (!readsOutpostProps(kind) || !(cell >= ALTITUDE_FLOOR)) return range;
  return Math.trunc((cell * Math.trunc(range)) / AVERAGE_ALTITUDE);
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
 * 0 for any other type on a main yard, because no other `capacity` in the
 * props table is a combat number there (`web/tools/gen-building-costs.mjs:158-167`).
 * On an outpost the outpost table's ladders are read, the harvesters' included,
 * since an attack gives each harvester a buffer out of it
 * ({@link outpostHarvesterStock}).
 */
export const capacity = (type: number, level: number, kind: CombatTargetKind = "main"): number =>
  atLevel(
    (readsOutpostProps(kind) ? OUTPOST_CAPACITY[type] : undefined) ?? MR2_CAPACITY[type],
    level,
    0,
  );

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
 * The Railgun (issue #261), whose shot is a beam rather than a bullet.
 *
 * `BUILDING118.Fire` (`client/scripts/BUILDING118.as:120-202`) fires from its
 * drawn anchor {@link RAILGUN_MUZZLE_DROP} px down the screen (`_top`, `:39`,
 * `:146`) towards its target, and lays {@link RAILGUN_SEGMENTS} segments of
 * {@link RAILGUN_SEGMENT} screen px along that bearing (`:157`, `:171-185`): a
 * line 1,600 px long that runs on past the target (`:189`). Every creep among
 * those within {@link RAILGUN_REACH} of the muzzle whose screen point lies
 * within {@link RAILGUN_BEAM_RADIUS} px of the line takes the shot's damage,
 * scaled by the Railgun's health like every tower's ({@link towerHealthScale})
 * but not truncated (`:187-198`, {@link beamHits}). It shoots with the trap's flags, the ground
 * and the invisible (`:44`): no flyer is ever on its line.
 *
 * The beam is measured on screen, as Flash measured it, and the reach in yard
 * units, as `getCreepsInRange` measures every range (`Targeting.as:203-236`).
 * A screen pixel is 0.71 yard units straight across the screen and 1.41
 * straight down it (`screenDistanceSquared`), so the 1,600 px line reaches
 * 1,131 yard units when it points across the screen and 2,263 when it points
 * down it, where the 1,600 yard reach cuts it short; the 20 px half-width is
 * 28 yard units either side of a line across the screen and 14 of one down it.
 */
export const RAILGUN_TYPE = 118;
export const RAILGUN_MUZZLE_DROP = 15;
export const RAILGUN_SEGMENT = 32;
export const RAILGUN_SEGMENTS = 50;
export const RAILGUN_BEAM_RADIUS = 20;
export const RAILGUN_REACH = 1600;

/**
 * What a tower's shot is worth at its own health (issue #264): `0.5 + 0.5 /
 * maxHealth * health`, full at full health and half when all but wrecked.
 * Every tower's `Fire` reads it: the Cannon (`BUILDING20.as:27`), Sniper
 * (`BUILDING21.as:42`), Laser (`BUILDING23.as:47`), Tesla (`BUILDING25.as:125`),
 * Aerial Defense (`BUILDING115.as:126`) and Railgun (`BUILDING118.as:133`).
 */
export const towerHealthScale = (hp: number, maxHp: number): number =>
  maxHp > 0 ? 0.5 + (0.5 / maxHp) * hp : 0.5;

/**
 * A tower's shot at its health, `int(damage * scale)`: the whole number its
 * projectile, bolt or beam carries (`BUILDING20.as:43`, `BUILDING21.as:55`,
 * `BUILDING23.as:65`, `BUILDING25.as:144`, `BUILDING115.as:139`). The
 * Railgun's beam alone is not truncated (`BUILDING118.as:194-195`).
 */
export const towerShotDamage = (damage: number, hp: number, maxHp: number): number =>
  Math.trunc(damage * towerHealthScale(hp, maxHp));

/**
 * `lineIntersectCircle` (`BUILDING118.as:204-222`): whether the segment from
 * `(ax, ay)` to `(bx, by)` passes through the circle of `radius` round
 * `(cx, cy)`. A line that only touches the circle misses, and so does one that
 * crosses it only beyond either end of the segment.
 */
export const beamHits = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  radius: number,
): boolean => {
  const a = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  const b = 2 * ((bx - ax) * (ax - cx) + (by - ay) * (ay - cy));
  const c = cx * cx + cy * cy + ax * ax + ay * ay - 2 * (cx * ax + cy * ay) - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return false;
  const root = Math.sqrt(discriminant);
  const far = (-b + root) / (2 * a);
  const near = (-b - root) / (2 * a);
  return !((far < 0 || far > 1) && (near < 0 || near > 1));
};

/**
 * The Aerial Defense Tower (issue #265), which fires in salvoes.
 *
 * `BUILDING115.TickAttack` (`client/scripts/BUILDING115.as:40-114`) counts its
 * fire tick down while it reloads (`_fireStage` 1). When it runs out it
 * re-arms it by `rate * 2` and opens a salvo (stage 2) of
 * {@link aerialSalvo} shots, one every {@link AERIAL_SHOT_TICKS} of its frames
 * (`_frameNumber % 4`), the n-th at the n-th of up to that many targets in turn
 * (`_shotsFired % _targetCreeps.length`, `FindTargets(salvo, priority)`). Each
 * is the shell every tower fires, `int(damage * scale)` with the full splash
 * (`:126-139`). A target found dead costs that frame its shot and the tower
 * looks again (`:84-93`); while it has nothing in range it looks every tick
 * and sets the fire tick to 30 (`:65-69`), which is then the reload. Once the
 * salvo is spent it reloads again (`:71-72`).
 */
export const AERIAL_DEFENSE_TYPE = 115;
export const AERIAL_SHOT_TICKS = 4;

/** Shots in a salvo by level, `_targetArray` (`BUILDING115.as:27`). */
export const AERIAL_SALVO: readonly number[] = [4, 4, 6, 8, 10, 12, 14, 16];

/** The salvo of an Aerial Defense Tower of `level`; the table's last past its end. */
export const aerialSalvo = (level: number): number =>
  AERIAL_SALVO[Math.min(Math.max(Math.trunc(level), 1), AERIAL_SALVO.length) - 1] ?? 0;

/**
 * The Tesla Tower (issue #266), which charges and then zaps.
 *
 * Its `rate` is not a re-arm time but the zaps in a charge (`BUILDING25.as:157`,
 * "shots fired per charge" in its upgrade text, `:68-73`). `BTOWER.TickAttack`
 * still runs its fire tick (`rate * 2`), and every `Fire` there only names the
 * target and, if the coil is idle, starts a charge (`:84-96`). The rest is
 * `TickFast` (`:98-203`), an `ENTER_FRAME` handler, so it counts frames of the
 * 40 fps stage, {@link TESLA_TICKS_PER_FRAME} loops each: {@link TESLA_CHARGE_END}
 * frames of charge (`_animTick` 0 to 32); then a zap every
 * {@link TESLA_ZAP_FRAMES} frames, `int(damage * scale)` straight into the
 * named target wherever it now is, `rate` of them (`:123-160`), its strip
 * looping cells 32-40 meanwhile; then the wind-down, a cell every second frame
 * up to {@link TESLA_WIND_END} (`:190-198`), before it can charge again. A
 * zap whose target is dead or gone looks for one new target and winds down
 * if there is none (`:174-186`); the zaps that follow still go at the old
 * target until the next `Fire` names the new one, and a dead target takes
 * nothing.
 */
export const TESLA_TYPE = 25;
export const TESLA_TICKS_PER_FRAME = 2;
export const TESLA_CHARGE_END = 32;
export const TESLA_LOOP_END = 41;
export const TESLA_WIND_END = 55;
export const TESLA_ZAP_FRAMES = 4;

/**
 * The Laser Tower (issue #267), whose shot is a beam that sweeps and pulses.
 *
 * `BUILDING23.Fire` (`client/scripts/BUILDING23.as:44-67`) hands
 * `EFFECTS.Laser` the point {@link LASER_DROP} px below its anchor, the
 * target's drawn point, and `int(damage * scale)`; `LASER.Fire`
 * (`com/monsters/effects/LASER.as:53-69`) aims short of the target by
 * `150 / sqrt(distance)` degrees and `LASER.Tick` (`:71-172`) turns it on by
 * `2 / sqrt(distance)` a loop for {@link LASER_TICKS} loops and more, so the
 * end of the beam sweeps across the target and on past it. It never hits the
 * target as such. Every {@link LASER_PULSE_TICKS} loops (`_frameNumber % 8`)
 * it pulses ({@link laserPulse}) everything on the ground or invisible within
 * the tower's `splash` of the beam's end (`Splash`, `:174-193`), with no
 * floor; thirteen pulses a beam. The beam outlives its tower.
 *
 * Distances are on screen, as Flash drew them; the splash is measured in
 * yard units round the end's `PATHING.FromISO`, as `getCreepsInRange` does.
 * The beam's length wobbles by `sin((duration / 4 + getTimer() / 1000) / 20)`
 * of a twentieth (`:104-105`); the engine reads `getTimer()` as 0, the only
 * value two runtimes agree on (fidelity note 16). The angle's sine and cosine
 * are {@link seriesSin} and {@link seriesCos}, because §3.4 rule 3 keeps
 * `Math.sin` out of the engine.
 */
export const LASER_TYPE = 23;
export const LASER_DROP = 35;
export const LASER_TICKS = 100;
export const LASER_PULSE_TICKS = 8;
/** The `height` `Fire` passes: where the beam is drawn from, 60 px above its origin. */
export const LASER_HEIGHT = 60;

/**
 * `sin` by its Taylor series to the `x^25` term: only `+`, `*` and `/`, which
 * IEEE 754 rounds alike everywhere (§3.4 rule 3). Within a few ulp of
 * `Math.sin` for `|x| < 3`, which is all the laser asks.
 */
export const seriesSin = (x: number): number => {
  const squared = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 12; n += 1) {
    term *= -squared / (2 * n * (2 * n + 1));
    sum += term;
  }
  return sum;
};

/** `cos` by its Taylor series to the `x^26` term, as {@link seriesSin}. */
export const seriesCos = (x: number): number => {
  const squared = x * x;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 13; n += 1) {
    term *= -squared / ((2 * n - 1) * 2 * n);
    sum += term;
  }
  return sum;
};

/** A laser beam's geometry, fixed when it is fired; screen px and radians. */
export interface LaserSweep {
  /** The beam's origin on screen, below the tower's anchor. */
  readonly ax: number;
  readonly ay: number;
  /** The unit vector from the origin to the target, on screen. */
  readonly ux: number;
  readonly uy: number;
  /** `_distance`, whole screen px from the origin to the target. */
  readonly distance: number;
  /** Where the sweep starts, off the target's bearing, and how far it turns a loop. */
  readonly start: number;
  readonly turn: number;
}

const RADIANS = Math.PI / 180;

/**
 * `LASER.Fire` (`LASER.as:53-69`) from its whole-px origin `(ax, ay)` to its
 * whole-px target `(bx, by)`. A target on the origin itself gives Flash a
 * beam of NaNs; {@link laserEnd} gives it none.
 */
export const laserSweep = (ax: number, ay: number, bx: number, by: number): LaserSweep => {
  const dx = Math.trunc(ax - bx);
  const dy = Math.trunc(ay - by);
  const length = Math.sqrt(dx * dx + dy * dy);
  const distance = Math.trunc(length);
  const root = Math.sqrt(distance);
  return {
    ax,
    ay,
    // `atan2(dy, dx) + 180`, the bearing from the origin to the target; `atan2(0, 0)` is 0.
    ux: length > 0 ? -dx / length : -1,
    uy: length > 0 ? -dy / length : 0,
    distance,
    start: root > 0 ? (-150 / root) * RADIANS : 0,
    turn: root > 0 ? (2 / root) * RADIANS : 0,
  };
};

/**
 * The end of the beam on screen `duration` loops after it was fired, 1 to
 * {@link LASER_TICKS} + 1 (`LASER.as:101-106`), or null for a beam of no length.
 */
export const laserEnd = (sweep: LaserSweep, duration: number): { x: number; y: number } | null => {
  if (sweep.distance <= 0) return null;
  const angle = sweep.start + sweep.turn * duration;
  const cos = seriesCos(angle);
  const sin = seriesSin(angle);
  const reach = sweep.distance + seriesSin(duration / 80) * (sweep.distance / 20);
  return {
    x: sweep.ax + (sweep.ux * cos - sweep.uy * sin) * reach,
    y: sweep.ay + (sweep.ux * sin + sweep.uy * cos) * reach,
  };
};

/** A pulse `distance` from the beam's end: `damage * 0.5 / splash * (splash - distance)`. */
export const laserPulse = (damage: number, splash: number, distance: number): number =>
  splash > 0 ? ((damage * 0.5) / splash) * (splash - distance) : 0;

/**
 * The Spurtz Cannon and the Black Spurtz Cannon (issue #313), which spray
 * shells that may hatch Spurtz.
 *
 * `BTOWER.TickAttack` re-arms the cannon by `rate * 2` and calls `Fire` on
 * each target it holds; `SpurtzCannon.Fire` (`client/scripts/SpurtzCannon.as:
 * 83-91`) takes the nearest {@link SPURTZ_MAX_TARGETS} again and aims at the
 * last of them, so a burst opens on that one. Every tick (`:109-118`) the
 * barrel turns a degree towards the aim, the long way round if that is the way
 * the difference points (`:154-165`); once the barrel is within
 * {@link SPURTZ_SWITCH_ANGLE} degrees the aim moves to the next target in the
 * list (`:120-139`). While the fire tick is a multiple of
 * {@link SPURTZ_SHOT_TICKS} it fires, up to `shots` a burst, the first only
 * once the barrel is within {@link SPURTZ_START_ANGLE} degrees (`:146-148`).
 *
 * A shell flies down the barrel as far as the target is, scattered by up to a
 * fifth of that distance across and down (`:173-191`, `:220-222`), at half its
 * `speed` a loop, and lands at the first loop its remaining distance is
 * within `speed` (`FIREBALL.as:113-141`). There it hurts the ground attackers
 * within {@link spurtzBlastRadius} with `DealLinearAEDamage` (`:237-244`), and
 * half the time (`Math.random() > 0.5`) a Spurtz hatches where it landed
 * (`:226-235`). The cannon's `splash` stat is never read: the shell has no
 * creep to splash round (`FIREBALLS.as:102-107`).
 *
 * A hatched Spurtz, {@link SPURTZ_ID}, is a disposable defender
 * (`:246-253`) at the defender's level for it (`CREATURES.as:45-66`). It goes
 * for the nearest ground attacker within {@link SPURTZ_LOOK}
 * (`CreepBase.as:660-694`) and is culled by its cannon's `TickFast`, every
 * second loop, once past {@link SPURTZ_CULL_FRAMES} frames: at once with
 * nothing to fight, else one time in ten (`:98-107`).
 */
export const SPURTZ_CANNON_TYPES: ReadonlySet<number> = new Set([136, 137]);
export const isSpurtzCannon = (type: number): boolean => SPURTZ_CANNON_TYPES.has(type);
/** `_maxTargets` (`SpurtzCannon.as:53`). */
export const SPURTZ_MAX_TARGETS = 10;
/** The fire tick a shot needs to be a multiple of (`:147`). */
export const SPURTZ_SHOT_TICKS = 5;
/** Degrees off the aim the barrel may be and still open a burst (`:39`). */
export const SPURTZ_START_ANGLE = 20;
/** Degrees off the aim at which the aim moves on to the next target (`:37`). */
export const SPURTZ_SWITCH_ANGLE = 2;
/** `-_top`: the muzzle and the aiming point sit this far above the anchor (`:50`). */
export const SPURTZ_MUZZLE_RISE = 32;
/** The shell's scatter, either way, as a share of the distance it is fired (`:177`). */
export const SPURTZ_SCATTER = 0.2;
/** The shell's sprite, 34 by 27 (`SPRITES.as:90`): its width plus height at full scale. */
export const SPURTZ_SHELL_SPAN = 61;
/** The shell's random scale, `random * 0.6 + 0.4` (`:207-211`). */
export const SPURTZ_SCALE_MIN = 0.4;
export const SPURTZ_SCALE_SPREAD = 0.6;
/** `Math.random() > 0.5`: a landing hatches a Spurtz (`:35`, `:232`). */
export const SPURTZ_HATCH_CHANCE = 0.5;
export const SPURTZ_ID = "IC1";
/** How far a hatched Spurtz looks for an attacker (`CreepBase.as:663`). */
export const SPURTZ_LOOK = 200;
/** Frames a hatched Spurtz looks again after, while it is not swinging (`CreepBase.as:1066`). */
export const SPURTZ_RELOOK_FRAMES = 150;
/** Frames before the cull can take a hatched Spurtz (`SpurtzCannon.as:102`). */
export const SPURTZ_CULL_FRAMES = 100;
/** `Math.random() > 0.9`: the cull takes a Spurtz that still has a foe. */
export const SPURTZ_CULL_ROLL = 0.9;
/** The cull runs in `TickFast`, once a 40 fps frame: every second loop. */
export const SPURTZ_CULL_TICKS = 2;

/** The blast round a landing shell: the most recent shell's `width + height`, a `uint`. */
export const spurtzBlastRadius = (scale: number): number => Math.trunc(SPURTZ_SHELL_SPAN * scale);

/**
 * `atan` by range reduction and its series: only `+`, `*`, `/` and `sqrt`,
 * which IEEE 754 rounds alike everywhere (§3.4 rule 3). Halving the angle
 * twice brings any argument within `tan(pi / 8)`, where twenty terms are
 * far below a double's last bit.
 */
export const seriesAtan = (z: number): number => {
  if (z !== z) return z;
  let x = z;
  for (let halving = 0; halving < 2; halving += 1) x /= 1 + Math.sqrt(1 + x * x);
  const squared = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 20; n += 1) {
    term *= -squared;
    sum += term / (2 * n + 1);
  }
  return sum * 4;
};

/** `Math.atan2(y, x)` in degrees, on {@link seriesAtan}; `atan2(0, 0)` is 0. */
export const seriesAtan2Degrees = (y: number, x: number): number => {
  let radians: number;
  if (x > 0) radians = seriesAtan(y / x);
  else if (x < 0) radians = seriesAtan(y / x) + (y >= 0 ? Math.PI : -Math.PI);
  else radians = y > 0 ? Math.PI / 2 : y < 0 ? -Math.PI / 2 : 0;
  return radians * (180 / Math.PI);
};

/**
 * `rotateBarrelTowardsTarget` (`SpurtzCannon.as:154-165`): a degree towards
 * `aim`, down when they are equal, with Flash's own folding past 180 either way.
 */
export const turnSpurtzBarrel = (barrel: number, aim: number): number => {
  let next = barrel + (aim - barrel > 0 ? 1 : -1);
  if (next > 180) next = -(180 - next);
  else if (next < -180) next = 180 - (180 - next);
  return next;
};

/** The Heavy Trap, the one trap that is choosy about what sets it off. */
export const HEAVY_TRAP_TYPE = 117;

/**
 * What a Heavy Trap's blast deals to a flyer `distance` away: half the ground
 * falloff. Its `Explode` runs a second pass over the flyers inside `size` at
 * `damage * 0.5 / size * (size - distance * 0.5)` (`client/scripts/BHEAVYTRAP.as:68-82`).
 * No other trap touches a flyer.
 */
export const heavyTrapFlyerDamageAt = (distance: number): number =>
  trapDamageAt(HEAVY_TRAP_TYPE, distance) * 0.5;

/**
 * Whether a creep with this `monsterId` sets off a trap of `type`.
 *
 * A Booby Trap goes off under anything on the ground. A Heavy Trap's
 * `FindTargets` skips every `C` creature but 10 to 12 (Crabatron, Project X,
 * D.A.V.E.) and every `I` creature but 7 and 8 (Sabnox, King Wormzer), so only
 * those and the champions, whose `G` ids neither test touches, trip it
 * (`client/scripts/BHEAVYTRAP.as:28-31`). The number is read after the first
 * `C`, which is why `IC7` counts as 7. Once tripped, the blast still hurts
 * every creep inside it, small ones included (`:51-61`).
 */
export const tripsTrap = (type: number, monsterId: string): boolean => {
  if (type !== HEAVY_TRAP_TYPE) return true;
  const prefix = monsterId.charAt(0);
  // AS3's `int()` reads a string with no number in it as 0.
  const number = Number.parseInt(monsterId.substring(monsterId.indexOf("C") + 1), 10) || 0;
  if (prefix === "C") return number >= 10 && number <= 12;
  if (prefix === "I") return number >= 7 && number <= 8;
  return true;
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
 * wild monster camp, nine tenths anywhere else, and a fifth of that again in a
 * wild monster attack, Map Room 1's tribes included
 * (`client/scripts/BSTORAGE.as:77-85`). Every one of them shrinks the gain,
 * which is what makes the loot bound of §2.4 an upper bound.
 *
 * Flash's test for the half reads `GLOBAL._currentCell.baseType ==
 * EnumYardType.OUTPOST`, but `baseType` is the Map Room 2 cell's `_base`
 * (`MapRoomCell.as:220-222`), whose 1 is a wild monster camp (`MapRoomCell.as:
 * 529`, `PopupAttackA.as:123-124`); a player's outpost is 3. `OUTPOST` is also
 * 1, so the half and the lower fall caps below land on the camps, never on a
 * player's outpost. The caps' own names, `_LOOT_MAX_WM_*`, say the same.
 */
export const STORAGE_SCALAR_WILD_CAMP = 0.5;
export const STORAGE_SCALAR_MAIN = 0.9;
export const WILD_MONSTER_LOOT_DIVISOR = 5;

/** `GLOBAL.mode == "wmattack"`: a Map Room 2 camp or a Map Room 1 tribe. */
export const isWildMonsterAttack = (kind: CombatTargetKind): boolean =>
  kind === "wild" || kind === "tribe";

/** The scalar `BSTORAGE.Loot` puts on a storage hit's draw on a yard of `kind`. */
export const storageScalar = (kind: CombatTargetKind): number =>
  kind === "wild" ? STORAGE_SCALAR_WILD_CAMP : STORAGE_SCALAR_MAIN;

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

/** The share `ATTACK.Loot` adds to a gain at `playerLevel`: 0 from level 20 up. */
export const lowLevelLootIncrement = (playerLevel: number): number =>
  playerLevel >= LOW_LEVEL_LOOT_CEILING
    ? 0
    : Math.max(0, (LOW_LEVEL_LOOT_CEILING - playerLevel) * LOW_LEVEL_LOOT_PER_LEVEL);

/** The multiplier `ATTACK.Loot` applies to a gain at `playerLevel`. */
export const lowLevelLootBonus = (playerLevel: number): number =>
  1 + lowLevelLootIncrement(playerLevel);

/**
 * One gain after the low-level bonus, as `ATTACK.Loot` banks it.
 *
 * `param2 += param2 * bonus` on an `int` (`client/scripts/ATTACK.as:678-680`)
 * truncates each gain on its own, so the bonus is applied per call, not to
 * the battle's total.
 */
export const withLowLevelBonus = (amount: number, playerLevel: number): number => {
  const whole = Math.trunc(amount);
  return Math.trunc(whole + whole * lowLevelLootIncrement(playerLevel));
};

/**
 * Every creep's looting property before anything is added to it.
 *
 * `MonsterBase` builds it as `CModifiableProperty(MAX_VALUE, 0, 0.5)`
 * (`MonsterBase.as:260`), and `lootingMultiplier` reads its value
 * (`MonsterBase.as:353-356`), so an ordinary creep draws half a unit of
 * resource for each point of damage it deals (`BFOUNDATION.as:528-534`).
 */
export const LOOT_PROPERTY_BASE = 0.5;

/**
 * What a resource specialist and a champion add to their looting property.
 *
 * A `targetGroup` 3 creep and every champion add an
 * `AdditionPropertyModifier(1.5)` on construction (`CreepBase.as:224-226`,
 * `ChampionBase.as:221`), and a `CModifiableProperty` adds its modifiers to
 * its base, so they loot at 2.
 */
export const LOOT_PROPERTY_BONUS = 1.5;

/**
 * A creep's `lootingMultiplier`, which scales the damage it deals to a
 * harvester or a storage building into the resource it draws.
 *
 * Krallen loots at the champion's 2 like every other champion: her
 * `_lootMults` (`x2` against a harvester, `x3` against storage,
 * `champions/Krallen.as:31-32`) is set and never read. Her one looting effect
 * is the attacker's storage cap, which her `buffs` ladder raises while she is
 * on the field (`client/scripts/ATTACK.as:696-702`).
 */
export const lootingMultiplier = (targetGroup: number, champion: boolean): number =>
  champion || targetGroup === TARGET_GROUP.RESOURCES
    ? LOOT_PROPERTY_BASE + LOOT_PROPERTY_BONUS
    : LOOT_PROPERTY_BASE;

/** The types a point of damage draws resources out of (`docs/specs/combat.md:1410-1416`). */
export const HARVESTER_TYPES: readonly number[] = [1, 2, 3, 4];
export const STORAGE_TYPES: readonly number[] = [6, 14, 112];

/** Whether damage to this type takes resources with it. */
export const isLootable = (type: number): boolean =>
  HARVESTER_TYPES.includes(type) || STORAGE_TYPES.includes(type);

/**
 * The share of its capacity an outpost harvester holds when an attack loads:
 * half above half health, a quarter at half health or below.
 */
export const OUTPOST_HARVESTER_SHARE = 0.5;
export const OUTPOST_HARVESTER_SHARE_DAMAGED = 0.25;

/**
 * What an outpost harvester holds for an attacker to take.
 *
 * An outpost harvester banks nothing of its own (`BRESOURCE.Export` writes no
 * `st` on an outpost, `client/scripts/BRESOURCE.as:483-485`), so `Setup` gives
 * it a buffer instead, whatever `st` says: `0.5 * capacity[level - 1]` when
 * its health is above half, `0.25 *` it at half or below, and nothing once it
 * is destroyed, stored in an `int` (`:506-518`). Looting it also takes the
 * amount out of the owner's pool (`:93-126`), which the engine does.
 */
export const outpostHarvesterStock = (
  type: number,
  level: number,
  hp: number,
  ceiling: number,
): number => {
  if (!HARVESTER_TYPES.includes(type) || !(ceiling > 0)) return 0;
  const health = hp / ceiling;
  if (!(health > 0)) return 0;
  const share = health <= 0.5 ? OUTPOST_HARVESTER_SHARE_DAMAGED : OUTPOST_HARVESTER_SHARE;
  return Math.trunc(share * capacity(type, level, "outpost"));
};

/**
 * What a storage building gives up when a creep brings it down.
 *
 * `BSTORAGE.Destroyed` (`client/scripts/BSTORAGE.as:91-155`) takes a share of
 * the yard's whole pool, each resource in turn, on top of what the hits drew
 * on the way down: a tenth for the Town Hall, a twentieth for an outpost's
 * core, a twenty-fifth for a silo. Each share has a ceiling, lower for a silo
 * or a Town Hall on a Map Room 2 wild monster camp (see
 * {@link STORAGE_SCALAR_WILD_CAMP} for why the camp and not a player's
 * outpost), and goo is halved outside Map Room 3. None of the per-hit scalars
 * apply: no half or nine tenths, no fifth for a wild monster attack, no
 * creep's looting multiplier. Only the low-level bonus does, because the
 * share goes through `ATTACK.Loot`.
 */
export const STORAGE_FALL_SHARE_TOWN_HALL = 0.1;
export const STORAGE_FALL_SHARE_OUTPOST = 0.05;
export const STORAGE_FALL_SHARE_SILO = 0.04;
export const STORAGE_FALL_MAX_TOWN_HALL = 10_000_000;
export const STORAGE_FALL_MAX_OUTPOST = 10_000_000;
export const STORAGE_FALL_MAX_SILO = 4_000_000;
/** The Town Hall's ceiling on a Map Room 2 wild monster camp (`_LOOT_MAX_WM_TH`). */
export const STORAGE_FALL_MAX_TOWN_HALL_ON_WILD_CAMP = 2_000_000;
/** A silo's ceiling on a Map Room 2 wild monster camp (`_LOOT_MAX_WM_SILO`). */
export const STORAGE_FALL_MAX_SILO_ON_WILD_CAMP = 500_000;
/** `_LOOT_GOO_LIMITER`: goo's share is halved, rounded up. */
export const STORAGE_FALL_GOO_LIMITER = 0.5;

/**
 * The amount of `resource` (1 to 4) a fallen storage building of `type` takes
 * out of a pool holding `held` of it, before the low-level bonus.
 */
export const storageFallLoot = (
  type: number,
  resource: number,
  held: number,
  onWildCamp: boolean,
): number => {
  const share =
    type === 14
      ? STORAGE_FALL_SHARE_TOWN_HALL
      : type === 112
        ? STORAGE_FALL_SHARE_OUTPOST
        : STORAGE_FALL_SHARE_SILO;
  let amount = Math.trunc(Math.max(0, held) * share);
  if (type === 6) {
    amount = Math.min(amount, STORAGE_FALL_MAX_SILO);
    if (onWildCamp) amount = Math.min(amount, STORAGE_FALL_MAX_SILO_ON_WILD_CAMP);
  }
  if (type === 14) {
    amount = Math.min(amount, STORAGE_FALL_MAX_TOWN_HALL);
    if (onWildCamp) amount = Math.min(amount, STORAGE_FALL_MAX_TOWN_HALL_ON_WILD_CAMP);
  }
  if (type === 112) amount = Math.min(amount, STORAGE_FALL_MAX_OUTPOST);
  if (resource === 4) amount = Math.ceil(amount * STORAGE_FALL_GOO_LIMITER);
  return amount;
};

/* ── Bombs ────────────────────────────────────────────────────────────────── */

/** One entry of `ResourceBombs._bombs`. */
export interface BombStats {
  readonly id: string;
  /** 1 twigs, 2 pebbles, 3 putty. There is no goo bomb. */
  readonly resource: number;
  /** Flat damage at the centre; 0 for a putty bomb, which enrages instead. */
  readonly damage: number;
  /**
   * Putty only: the share of each hit an enraged creep shrugs off. Flash names
   * it `damageMult` but it is the `Enrage` armour (`ResourceBomb.as:170-185`).
   */
  readonly damageMult?: number;
  /** Putty only: the move-speed and swing-rate multiplier (`speed`). */
  readonly speed?: number;
  /** Putty only: how long the boost lasts, in seconds (`speedlength`). */
  readonly speedlength?: number;
  /**
   * `_size` of the blast, in isometric pixels. Despite the name it is a full
   * width, not a radius: see {@link bombBlast}.
   */
  readonly radius: number;
  /**
   * How many pieces rain down. Each one deals `damage / particles` to every
   * building the blast reaches (`ResourceBomb.as`, `dpp`).
   */
  readonly particles: number;
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
  { id: "tw0", resource: 1, damage: 2200, radius: 200, particles: 200,
    cost: 10_000, catapultLevel: 1 },
  // :64
  { id: "tw1", resource: 1, damage: 7000, radius: 200, particles: 200,
    cost: 100_000, catapultLevel: 1 },
  // :79
  { id: "tw2", resource: 1, damage: 50_000, radius: 200, particles: 200,
    cost: 5_000_000, catapultLevel: 1 },
  // :94
  { id: "pb0", resource: 2, damage: 2400, radius: 200, particles: 200,
    cost: 10_000, catapultLevel: 2 },
  // :109
  { id: "pb1", resource: 2, damage: 9000, radius: 300, particles: 200,
    cost: 100_000, catapultLevel: 2 },
  // :124
  { id: "pb2", resource: 2, damage: 30_000, radius: 350, particles: 200,
    cost: 2_000_000, catapultLevel: 2 },
  // :139
  { id: "pb3", resource: 2, damage: 75_000, radius: 400, particles: 200,
    cost: 10_000_000, catapultLevel: 2 },
  // Putty bombs deal no damage: they enrage the attacker's own creeps for
  // `speedlength` seconds (`speed`, `damageMult` armour), so none of them
  // reaches the damage bound of §2.3.
  // :154
  { id: "pu0", resource: 3, damage: 0, radius: 150, particles: 25,
    cost: 10_000, catapultLevel: 3, damageMult: 0.2,
    speed: 1.2, speedlength: 10 },
  // :172
  { id: "pu1", resource: 3, damage: 0, radius: 150, particles: 37,
    cost: 100_000, catapultLevel: 3, damageMult: 0.4,
    speed: 1.4, speedlength: 15 },
  // :190
  { id: "pu2", resource: 3, damage: 0, radius: 300, particles: 43,
    cost: 5_000_000, catapultLevel: 3, damageMult: 0.7,
    speed: 1.8, speedlength: 30 },
  // :208
  { id: "pu3", resource: 3, damage: 0, radius: 500, particles: 50,
    cost: 10_000_000, catapultLevel: 3, damageMult: 0.9,
    speed: 2.0, speedlength: 40 },
];

/** The bombs a catapult at `catapultLevel` can fire. */
export const bombsFor = (catapultLevel: number): readonly BombStats[] =>
  BOMBS.filter((bomb) => bomb.catapultLevel <= catapultLevel);

/**
 * The bombs' face damage at `catapultLevel`: one bomb per resource, each at
 * its largest tier. At catapult 2 that is 50,000 of twigs plus 75,000 of
 * pebbles; putty adds nothing, having no damage at all.
 *
 * This is what the bombs deal to **one** ordinary building (a Storage Silo
 * takes it times its level). A blast hits every building it reaches, so the
 * damage budget does not use this figure: it weighs the defender's yard
 * instead (`potential.ts` `bombsPotential`, issue #84).
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

/* ── The blast ────────────────────────────────────────────────────────────── */

/**
 * `BASE._angle`: how much the client squashes every ellipse it stands in for
 * something on the ground (`client/scripts/BASE.as:331`).
 */
export const ELLIPSE_SQUASH = 0.8;

/** An ellipse by its two semi-axes, in isometric pixels. */
export interface Ellipse {
  /** Half the width. */
  readonly rx: number;
  /** Half the height. */
  readonly ry: number;
}

/**
 * The ellipse `BASE.EllipseEdgeDistanceSqrd(angle, width, width * _angle)`
 * describes (`BASE.as:5008-5019`). Both of its size parameters are declared
 * `int`, so the width and the squashed height each truncate before halving.
 */
export const squashedEllipse = (width: number): Ellipse => ({
  rx: Math.trunc(width) / 2,
  ry: Math.trunc(width * ELLIPSE_SQUASH) / 2,
});

/**
 * The area a damage bomb hits, centred where it lands.
 *
 * `ResourceBomb` hands `EllipseEdgeDistanceSqrd` the bomb's `radius` as the
 * ellipse's full width (`com/monsters/effects/ResourceBomb.as`, the
 * constructor), so the blast reaches `radius / 2` either side and
 * `radius * 0.4` above and below: the "radius" is a diameter. This is the one
 * figure the engine's hit test and the attack screen's drop ring both read, so
 * the ring the player aims with is the blast they get.
 */
export const bombBlast = (bomb: BombStats): Ellipse => squashedEllipse(bomb.radius);

/**
 * How far a putty bomb reaches, in yard units: a circle of half its `radius`
 * around the drop, measured on the ground (`ResourceBomb.as`, the creep loop's
 * `size * 0.5` against `PATHING.FromISO` positions).
 */
export const puttyReach = (bomb: BombStats): number => bomb.radius / 2;

/** The props `size` of a type; 0 when its entry has none (`_size` is an `int`). */
export const propsSizeOf = (type: number): number => PROPS_SIZE[type] ?? 0;

/**
 * The squared distance from an ellipse's centre to its edge along `(dx, dy)`.
 *
 * `EllipseEdgeDistanceSqrd` gets there with `atan2`, `tan` and `pow`; this is
 * the same quantity in plain arithmetic, `d² a² b² / (dx² b² + dy² a²)`, because
 * the transcendental functions are not guaranteed to round alike in V8 and in
 * Bun and the result decides which buildings a bomb hits. At the centre the
 * client's `atan2(0, 0)` is 0, which reads the horizontal semi-axis.
 */
export const ellipseEdgeSquared = (ellipse: Ellipse, dx: number, dy: number): number => {
  const a2 = ellipse.rx * ellipse.rx;
  const b2 = ellipse.ry * ellipse.ry;
  if (a2 <= 0 || b2 <= 0) return 0;
  const along = dx * dx + dy * dy;
  if (along === 0) return a2;
  return (along * a2 * b2) / (dx * dx * b2 + dy * dy * a2);
};

/**
 * Whether a damage bomb reaches a building, `(dx, dy)` apart in isometric
 * pixels from the blast's centre to the building's (`_mc.y + _middle`).
 *
 * The client stands in an ellipse `size * 0.5` wide for the building and tests
 * the squared distance against the sum of the two squared edge distances,
 * which is what `d⁴ < (e₁ + e₂)²` comes to (`ResourceBomb.as`). A building is
 * therefore hit a little outside the blast ellipse, by less than its own
 * half-size.
 */
export const bombReaches = (
  bomb: BombStats,
  dx: number,
  dy: number,
  buildingSize: number,
): boolean => {
  const apart = dx * dx + dy * dy;
  const reach =
    ellipseEdgeSquared(bombBlast(bomb), dx, dy) +
    ellipseEdgeSquared(squashedEllipse(buildingSize * 0.5), dx, dy);
  return apart < reach;
};

/**
 * What one particle of a damage bomb takes off one building, before
 * fortification (`ResourceBomb.Damage`).
 *
 * Every particle hits every building the blast reached for the same share,
 * `int(damage / particles)`: the client meant to scale it by distance, but the
 * `dist` it scales by is a field nothing ever assigns, so the factor is always
 * 1 and there is no falloff. A Storage Silo takes the share times its level,
 * a wall 6% of it and a tower 90%, each truncated to an integer the way the
 * client's `int` local truncates. A jarred tower other than a bunker and the
 * Champion Cage take nothing.
 */
export const bombParticleDamage = (
  bomb: BombStats,
  target: {
    readonly type: number;
    readonly level: number;
    readonly kind: string;
    readonly jarred?: boolean;
  },
): number => {
  const share = Math.trunc(bomb.damage / bomb.particles);
  let dealt = target.type === 6 ? share * target.level : share;
  if (target.kind === "wall") dealt = Math.trunc(dealt * 0.06);
  if (target.kind === "tower") {
    dealt = Math.trunc(dealt * 0.9);
    if (target.type !== 22 && target.type !== 128 && target.jarred) dealt = 0;
  }
  if (target.type === 114) dealt = 0;
  return dealt;
};
