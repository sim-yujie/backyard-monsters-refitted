import { Tribe } from "../../enums/Tribes.js";
import { monsterStat } from "../../game-rules/combat/stats.js";
import { buildingClass } from "../../game-rules/combat/yard.js";
import type { Roster } from "../../game-rules/combat/types.js";

/**
 * How big a wild monster raid is and what it is made of (#226 WP1,
 * `docs/design/wild-raids.md` §5.3 and §5.4).
 *
 * Each tribe's `ProcessC` (`client/scripts/com/monsters/ai/PROCESS3.as`,
 * `PROCESS4.as`, `PROCESS5.as`, `PROCESS7.as`) counts the yard, picks its
 * monsters by the player's level, and says how far out each type starts. The
 * arithmetic is copied as Flash wrote it, `int` truncations, `Math.ceil`s and
 * all. Intelligence is always 1, so Flash's `x (0.5 + 0.5 x intelligence)` is
 * left out. Raiders fight with plain stats (owner, Q8), so there is no
 * strength figure here.
 */

/** Flash's monster tables (`WMATTACK.as:44-54`). */
export const RAID_TANKS = ["C2", "C6", "C10", "C12"] as const;
export const RAID_DAMAGE_DEALERS = ["C1", "C4", "C7", "C8", "C11", "C11"] as const;
export const RAID_LOOTERS = ["C3", "C9", "C14"] as const;
export const RAID_FODDER = ["C1", "C1", "C1", "C3", "C8", "C9"] as const;
export const RAID_KAMIKAZE = "C5";

/** `GLOBAL._mapWidth` (`GLOBAL.as:802`): the radius raids come in from, in yard units. */
export const RAID_MAP_WIDTH = 800;

/** `_mapWidth * 0.25`: how far out the first type starts (`PROCESS3.as:138`). */
export const RAID_WALK = RAID_MAP_WIDTH * 0.25;

/** A target closer to the way in than this pushes the army further out (`PROCESS3.as:139-143`). */
export const RAID_NEAR_TARGET = 100;

/** Extra distance for later types, so they arrive behind the first (`PROCESS3.as:154`, `PROCESS5.as:166-187`). */
export const DAMAGE_DEALER_LEAD = 25;
export const KAMIKAZE_LEAD = 40;
export const LOOTER_LEAD = 80;

/** Per tribe: what a building counts for, and what a trap or a wall counts for. */
export const RAID_WEIGHTS: Readonly<Record<Tribe, { readonly building: number; readonly trapOrWall: number }>> = {
  [Tribe.LEGIONNAIRE]: { building: 1, trapOrWall: 0.13 },
  [Tribe.KOZU]: { building: 1.4, trapOrWall: 0.2 },
  [Tribe.ABUNAKKI]: { building: 0.3, trapOrWall: 0.01 },
  [Tribe.DREADNAUT]: { building: 1, trapOrWall: 0.15 },
};

/**
 * The army's size, `N`: every harvester, tower, "special" building, trap and
 * wall, each with its tribe's weight times the amplifier, summed one by one in
 * id order (as Flash's loop adds them, so the float rounds the same way) and
 * truncated.
 *
 * Flash walks every building it has, standing or not (`PROCESS3.as:116-125`);
 * a raid never comes while anything is damaged (Q5), so that never differs.
 * The test is by props class; Flash's `is BTOWER` / `is BTRAP` / `is BWALL` /
 * `is BRESOURCE` name the same buildings (`PROCESS7.as` tests the classes).
 */
export const raidArmySize = (tribe: Tribe, types: readonly number[], amplifier: number): number => {
  const weight = RAID_WEIGHTS[tribe];
  let total = 0;
  for (const type of types) {
    const kind = buildingClass(type);
    if (kind === "trap" || kind === "wall") total += weight.trapOrWall * amplifier;
    else if (kind === "special" || kind === "tower" || kind === "resource") total += weight.building * amplifier;
  }
  return Math.trunc(total);
};

/** The monster tier, `level / 40` held to 0..1 (`PROCESS3.as:128-133`). */
export const raidTier = (level: number): number => Math.min(1, Math.max(0, level / 40));

/** `_tanks[int(3f)]`: C2, then C6 from level 14, C10 from 27 and C12 at 40. */
export const raidTank = (tier: number): string => RAID_TANKS[Math.trunc((RAID_TANKS.length - 1) * tier)] ?? "C2";

/** `_dps[int(5f)]`: a step every 8 levels. */
export const raidDamageDealer = (tier: number): string =>
  RAID_DAMAGE_DEALERS[Math.trunc((RAID_DAMAGE_DEALERS.length - 1) * tier)] ?? "C1";

/** `_looters[int(1 x f)]`, Abunakki's: C3, then C9 at level 40 (`PROCESS5.as:150`). */
export const abunakkiLooter = (tier: number): string => RAID_LOOTERS[Math.trunc((RAID_LOOTERS.length - 2) * tier)] ?? "C3";

/** `_looters[int(1 x f) + 1]`, Dreadnaut's: C9, then C14 at level 40 (`PROCESS7.as:139`). */
export const dreadnautLooter = (tier: number): string =>
  RAID_LOOTERS[Math.trunc((RAID_LOOTERS.length - 2) * tier) + 1] ?? "C9";

/** The level-0 walking speed Flash reads, `props.speed[0]`. */
const speedOf = (monster: string): number => monsterStat(monster, "speed", 1);

/**
 * How far out the first type starts: `_mapWidth / 4`, plus however much the
 * target is closer than 100 to the way in (`PROCESS3.as:138-143`).
 *
 * Flash measures from the way in, in yard units, to the target's screen
 * position, mixing the two spaces; that is copied, and it almost never
 * matters, since the way in is 800 out.
 */
export const raidWalk = (distanceToTarget: number): number =>
  RAID_WALK + (distanceToTarget < RAID_NEAR_TARGET ? RAID_NEAR_TARGET - distanceToTarget : 0);

/** What each tribe's `ProcessC` reads beyond the yard's building list. */
export interface RaidArmyFacts {
  /** Every building's type, in id order. */
  readonly types: readonly number[];
  /** The player's level. */
  readonly level: number;
  /** The more / same / less multiplier (`RAID_PREFERENCES`). */
  readonly amplifier: number;
  /** The chosen way in's tower fire (`raidDirection.ts`); above 0 brings tanks for Abunakki and Dreadnaut. */
  readonly damageTaken: number;
  /** What the chosen way in's target is worth (`raidDirection.ts`), Dreadnaut's looter share. */
  readonly resourcesGained: number;
  /** {@link raidWalk} for the chosen way in. */
  readonly walk: number;
}

/** The planned army: how many of each, and how far out each type starts (Flash's `attack` and `distances`). */
export interface RaidArmy {
  readonly monsters: Roster;
  /** Yard units out past the way in; each type lands in a disc this wide (`WMATTACK.as:710-718`). */
  readonly distances: Readonly<Record<string, number>>;
}

/** Collects counts the way Flash's `_loc2_` does: added up, zero counts dropped. */
const army = (counts: ReadonlyArray<readonly [string, number]>, distances: Record<string, number>): RaidArmy => {
  const monsters: Record<string, number> = {};
  for (const [monster, count] of counts) monsters[monster] = (monsters[monster] ?? 0) + count;
  for (const monster of Object.keys(monsters)) if (monsters[monster] === 0) delete monsters[monster];
  return { monsters, distances };
};

/** Legionnaire, `PROCESS3.ProcessC` (`:101-174`): a third tanks, a sixth damage dealers. */
const legionnaire = (size: number, tier: number, walk: number): RaidArmy => {
  let tanks = size / 3;
  const dealers = tanks / 2;
  const tank = raidTank(tier);
  const dealer = raidDamageDealer(tier);
  const distances: Record<string, number> = {};
  let time = 0;
  if (tanks >= 1) {
    time = walk / speedOf(tank);
    distances[tank] = time * speedOf(tank);
  }
  if (dealers >= 1) {
    if (time === 0) time = walk / speedOf(dealer);
    distances[dealer] = DAMAGE_DEALER_LEAD + time * speedOf(dealer);
  }
  if (tank === "C12") tanks = Math.ceil(tanks / 2);
  return army(
    [
      [tank, Math.trunc(tanks)],
      [dealer, Math.trunc(dealers)],
    ],
    distances,
  );
};

/**
 * Kozu, `PROCESS4.ProcessC` (`:101-155`): `int(0.33N)` each of three
 * neighbouring fodder slots, `int(5f)` and the slots either side (held at the
 * ends). The low slot's speed times the walk sets every type's distance.
 */
const kozu = (size: number, tier: number, walk: number): RaidArmy => {
  const last = RAID_FODDER.length - 1;
  const middle = Math.trunc(last * tier);
  const low = middle === 0 ? middle : middle - 1;
  const high = middle === last ? middle : middle + 1;
  const slots = [RAID_FODDER[low], RAID_FODDER[middle], RAID_FODDER[high]] as const;
  const time = walk / speedOf(slots[0]);
  const distances: Record<string, number> = {};
  for (const monster of slots) distances[monster] = time * speedOf(monster);
  const each = Math.trunc(0.33 * size);
  return army(
    slots.map((monster) => [monster, each] as const),
    distances,
  );
};

/**
 * Abunakki, `PROCESS5.ProcessC` (`:101-196`). With fire on the way in: a fifth
 * looters, the rest split tanks to kamikaze 1 : 1/0.3; with none, all
 * kamikaze (at least 1). Every count rounds up, and kamikaze over 5 become
 * looters.
 */
const abunakki = (size: number, tier: number, walk: number, damageTaken: number): RaidArmy => {
  let looters: number;
  let tanks: number;
  let kamikaze: number;
  if (damageTaken > 0) {
    looters = 0.2 * size;
    tanks = (size - looters) / 1.3;
    kamikaze = tanks / 0.3;
  } else {
    looters = 0;
    tanks = 0;
    kamikaze = size < 1 ? size + 1 : size;
  }
  looters = Math.ceil(looters);
  tanks = Math.ceil(tanks);
  kamikaze = Math.ceil(kamikaze);
  if (kamikaze > 5) {
    looters += kamikaze - 5;
    kamikaze = 5;
  }
  const looter = abunakkiLooter(tier);
  const tank = raidTank(tier);
  const distances: Record<string, number> = {};
  let time = 0;
  if (tanks >= 1) {
    time = walk / speedOf(tank);
    distances[tank] = time * speedOf(tank);
  }
  if (kamikaze >= 1) {
    if (time === 0) time = walk / speedOf(RAID_KAMIKAZE);
    distances[RAID_KAMIKAZE] = KAMIKAZE_LEAD + time * speedOf(RAID_KAMIKAZE);
  }
  if (looters >= 1) {
    if (time === 0) time = walk / speedOf(looter);
    distances[looter] = LOOTER_LEAD + time * speedOf(looter);
  }
  if (tank === "C12") tanks = Math.ceil(tanks / 2);
  return army(
    [
      [looter, Math.trunc(looters)],
      [tank, Math.trunc(tanks)],
      [RAID_KAMIKAZE, Math.trunc(kamikaze)],
    ],
    distances,
  );
};

/**
 * Dreadnaut, `PROCESS7.ProcessC` (`:101-170`). With fire on the way in, the
 * looters' share is loot / (fire + loot), at least a half, and the rest tanks;
 * with none, all looters. C12 tanks are halved and C14 looters divided by 2.5,
 * both rounded up.
 */
const dreadnaut = (size: number, tier: number, walk: number, damageTaken: number, resourcesGained: number): RaidArmy => {
  let looters: number;
  let tanks: number;
  if (damageTaken > 0) {
    const share = Math.max(0.5, resourcesGained / (damageTaken + resourcesGained));
    looters = share * size;
    tanks = size - looters;
  } else {
    looters = size;
    tanks = 0;
  }
  const looter = dreadnautLooter(tier);
  const tank = raidTank(tier);
  const distances: Record<string, number> = {};
  let time = 0;
  if (tanks >= 1) {
    time = walk / speedOf(tank);
    distances[tank] = time * speedOf(tank);
  }
  if (looters >= 1) {
    if (time === 0) time = walk / speedOf(looter);
    distances[looter] = time * speedOf(looter);
  }
  if (tank === "C12") tanks = Math.ceil(tanks / 2);
  if (looter === "C14") looters = Math.ceil(looters / 2.5);
  return army(
    [
      [looter, Math.trunc(looters)],
      [tank, Math.trunc(tanks)],
    ],
    distances,
  );
};

/** The raid's army for a tribe, sized from the yard and the player's level. */
export const raidArmy = (tribe: Tribe, facts: RaidArmyFacts): RaidArmy => {
  const size = raidArmySize(tribe, facts.types, facts.amplifier);
  const tier = raidTier(facts.level);
  switch (tribe) {
    case Tribe.LEGIONNAIRE:
      return legionnaire(size, tier, facts.walk);
    case Tribe.KOZU:
      return kozu(size, tier, facts.walk);
    case Tribe.ABUNAKKI:
      return abunakki(size, tier, facts.walk, facts.damageTaken);
    case Tribe.DREADNAUT:
      return dreadnaut(size, tier, facts.walk, facts.damageTaken, facts.resourcesGained);
  }
};
