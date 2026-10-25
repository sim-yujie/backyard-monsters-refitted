/**
 * The siege weapons' numbers (Inferno WP 6.2, `docs/design/inferno.md` §2.9,
 * S6): Marilyn Monstroe the Decoy, the Loot-O-Tron 5000 Vacuum and the Candy
 * Jars, ten levels each, figure for figure from Flash's
 * `client/scripts/com/monsters/siege/weapons/{Decoy,Vacuum,Jars}.as`.
 *
 * Shared by both sides like the rest of this module: the Siege Lab and Factory
 * (WP 6.3) charge and time from it, their screens (WP 6.4) show it, and the
 * engine (WP 6.5-6.7) fights with it. `siege.test.ts` reads the Flash files
 * and holds every figure here to them.
 *
 * A level is 1 to {@link SIEGE_MAX_LEVEL}. Flash read entry `level - 1` with
 * the level held to 0..10 (`SiegeWeaponProperty.getValueForLevel`), so level
 * 0, a weapon not yet researched, has no value at all; here that is `null`.
 *
 * Both costs are in Inferno resources: the Lab and the Factory charge and fund
 * with Flash's Inferno flag set (`SiegeLab.as:74-77`, `SiegeFactory.as:117-120`,
 * `BASE.Charge`'s fourth argument), and check room against the Inferno storage
 * (`SiegeWeapon.hasCapacityToUpgrade`). The research costs are Flash's
 * unrounded figures; `BASE.Charge` floors what it takes ({@link chargedCost}).
 */

/** One of the three, as Flash spells their ids (`Decoy.ID`, `Vacuum.ID`, `Jars.ID`). */
export type SiegeId = "decoy" | "vacuum" | "jars";

/** The levels a weapon has (`SiegeWeapon.MAX_LEVEL`). */
export const SIEGE_MAX_LEVEL = 10;

/**
 * Where a weapon may be dropped (`DROPZONE.as:14-18`): open ground, open
 * ground clear of buildings, or onto the defending towers.
 */
export type SiegeDrop = "ground" | "ground-special" | "buildings";

/** The Decoy's clearance from buildings, `DROPZONE.SIEGEWEAPON_GROUND_SPECIAL_RADIUS`. */
export const SIEGE_GROUND_SPECIAL_RADIUS = 30;

/** What researching a level, or making one weapon, costs: Inferno resources and seconds. */
export interface SiegeCost {
  readonly r1: number;
  readonly r2: number;
  readonly r3: number;
  readonly r4: number;
  readonly time: number;
}

/** A figure the Lab screen lists, in its order (`SiegeWeaponProperty.order`). */
export type SiegeStat = "damage" | "range" | "duration" | "durability" | "lootBonus";

export interface SiegeWeaponData {
  readonly id: SiegeId;
  /** Its name in Flash's `english.json` (`#w_<id>#`). */
  readonly name: string;
  readonly drop: SiegeDrop;
  /** The figures the Lab screen shows, first to last (`label_<id>_stat1..3`). */
  readonly stats: readonly SiegeStat[];
  /** By level, 1 first. Empty where Flash gave the weapon none. */
  readonly damage: readonly number[];
  readonly range: readonly number[];
  /** Seconds it works once dropped; 0 for one that never runs out. */
  readonly duration: readonly number[];
  /** The damage it takes before it breaks. */
  readonly durability: readonly number[];
  /** The Vacuum's take: "Steals resources at the rate of #v1# per second". */
  readonly lootBonus: readonly number[];
  /** Research to each level in the Siege Lab: entry 0 opens level 1. */
  readonly upgradeCosts: readonly SiegeCost[];
  /** Making one weapon at each level in the Siege Factory. */
  readonly buildCosts: readonly SiegeCost[];
}

/** `Decoy.as:50-180`: draws defenders in, bunkered ones too, then blows up. */
export const DECOY: SiegeWeaponData = {
  id: "decoy",
  name: "Marilyn Monstroe",
  drop: "ground-special",
  stats: ["damage", "range", "duration"],
  damage: [1000, 1500, 2500, 3500, 4500, 6500, 9000, 12500, 17000, 23500],
  range: [250, 270, 290, 310, 320, 350, 380, 410, 440, 480],
  duration: [10, 11, 12, 12, 14, 15, 17, 18, 19, 21],
  durability: [],
  lootBonus: [],
  upgradeCosts: [
      { r1: 37599.9587467407, r2: 43866.6185378641, r3: 43866.6185378641, r4: 0, time: 14400 },
      { r1: 72169.829039505, r2: 84198.1338794225, r3: 84198.1338794225, r4: 0, time: 18900 },
      { r1: 138513.14459241, r2: 161598.668691145, r3: 161598.668691145, r4: 0, time: 25200 },
      { r1: 265769.311821143, r2: 310064.197124667, r3: 310064.197124667, r4: 0, time: 36000 },
      { r1: 509415.86296686, r2: 594318.50679467, r3: 594318.50679467, r4: 0, time: 55800 },
      { r1: 972778.278801511, r2: 1134907.9919351, r3: 1134907.9919351, r4: 0, time: 86400 },
      { r1: 1833130.23035504, r2: 2138651.93541421, r3: 2138651.93541421, r4: 0, time: 216000 },
      { r1: 3309676.9374281, r2: 3861289.76033278, r3: 3861289.76033278, r4: 0, time: 302400 },
      { r1: 5369777.93088871, r2: 6264740.91937016, r3: 6264740.91937016, r4: 0, time: 345600 },
      { r1: 7386672.13671496, r2: 8617784.15950078, r3: 8617784.15950078, r4: 0, time: 388800 },
  ],
  buildCosts: [
      { r1: 14324, r2: 28648, r3: 28648, r4: 0, time: 3000 },
      { r1: 27493, r2: 54987, r3: 54987, r4: 0, time: 4500 },
      { r1: 52767, r2: 105534, r3: 105534, r4: 0, time: 7200 },
      { r1: 101245, r2: 202491, r3: 202491, r4: 0, time: 9900 },
      { r1: 194063, r2: 388126, r3: 388126, r4: 0, time: 15300 },
      { r1: 370582, r2: 741164, r3: 741164, r4: 0, time: 22500 },
      { r1: 698335, r2: 1396671, r3: 1396671, r4: 0, time: 34200 },
      { r1: 1260829, r2: 2521659, r3: 2521659, r4: 0, time: 51300 },
      { r1: 2045630, r2: 4091259, r3: 4091259, r4: 0, time: 76500 },
      { r1: 2813970, r2: 5627941, r3: 5627941, r4: 0, time: 86400 },
  ],
};

/** `Vacuum.as:19-150`: latches onto the Town Hall and sucks its resources out. */
export const VACUUM: SiegeWeaponData = {
  id: "vacuum",
  name: "Loot-O-Tron 5000",
  drop: "ground",
  stats: ["lootBonus", "durability", "duration"],
  damage: [],
  range: [],
  duration: [30, 35, 40, 45, 50, 60, 65, 70, 80, 85],
  durability: [6000, 7200, 7800, 9400, 10300, 11200, 14600, 20500, 29000, 44200],
  lootBonus: [25000, 38153, 58225, 88856, 135604, 206945, 292002, 380324, 495361, 593977],
  upgradeCosts: [
      { r1: 36525.6742111195, r2: 35451.3896754984, r3: 35451.3896754984, r4: 0, time: 7200 },
      { r1: 72856.8101856925, r2: 70713.9628272898, r3: 70713.9628272898, r4: 0, time: 11700 },
      { r1: 145311.983388114, r2: 141038.101523758, r3: 141038.101523758, r4: 0, time: 18900 },
      { r1: 289715.138033823, r2: 281194.10456224, r3: 281194.10456224, r4: 0, time: 28800 },
      { r1: 576767.5769981, r2: 559803.82473345, r3: 559803.82473345, r4: 0, time: 49500 },
      { r1: 1141625.06806759, r2: 1108047.86018325, r3: 1108047.86018325, r4: 0, time: 86400 },
      { r1: 2211351.3581495, r2: 2146311.61232158, r3: 2146311.61232158, r4: 0, time: 259200 },
      { r1: 3995477.90599582, r2: 3877963.84993712, r3: 3877963.84993712, r4: 0, time: 388800 },
      { r1: 6194145.1020071, r2: 6011964.36371277, r3: 6011964.36371277, r4: 0, time: 475200 },
      { r1: 7981712.40588686, r2: 7746956.15865489, r3: 7746956.15865489, r4: 0, time: 475200 },
  ],
  buildCosts: [
      { r1: 28648, r2: 14324, r3: 28648, r4: 0, time: 14400 },
      { r1: 57143, r2: 28571, r3: 57143, r4: 0, time: 19800 },
      { r1: 113970, r2: 56985, r3: 113970, r4: 0, time: 27900 },
      { r1: 227228, r2: 113614, r3: 227228, r4: 0, time: 39600 },
      { r1: 452367, r2: 226183, r3: 452367, r4: 0, time: 54900 },
      { r1: 895392, r2: 447696, r3: 895392, r4: 0, time: 77400 },
      { r1: 1734393, r2: 867197, r3: 1734393, r4: 0, time: 86400 },
      { r1: 3133708, r2: 1566854, r3: 3133708, r4: 0, time: 129600 },
      { r1: 4858153, r2: 2429077, r3: 4858153, r4: 0, time: 172800 },
      { r1: 6260167, r2: 3130083, r3: 6260167, r4: 0, time: 259200 },
  ],
};

/** `Jars.as:32-162`: glass jars over every tower in range, useless till shot out. */
export const JARS: SiegeWeaponData = {
  id: "jars",
  name: "Candy Jars",
  drop: "buildings",
  stats: ["range", "durability"],
  damage: [],
  range: [200, 210, 235, 335, 360, 370, 380, 390, 400, 410],
  duration: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  durability: [2000, 3000, 4500, 7000, 11000, 13500, 16500, 20500, 25500, 31500],
  lootBonus: [],
  upgradeCosts: [
      { r1: 54788.2570728397, r2: 73051.0094304529, r3: 54788.2570728397, r4: 0, time: 8100 },
      { r1: 94981.5611740237, r2: 126642.081565365, r3: 94981.5611740237, r4: 0, time: 13500 },
      { r1: 164651.086038632, r2: 219534.781384843, r3: 164651.086038632, r4: 0, time: 19800 },
      { r1: 285371.258002827, r2: 380495.010670437, r3: 285371.258002827, r4: 0, time: 30600 },
      { r1: 494329.891507663, r2: 659106.522010217, r3: 494329.891507663, r4: 0, time: 51300 },
      { r1: 854888.169815886, r2: 1139850.89308785, r3: 854888.169815886, r4: 0, time: 86400 },
      { r1: 1471266.3489287, r2: 1961688.46523827, r3: 1471266.3489287, r4: 0, time: 216000 },
      { r1: 2497108.33129819, r2: 3329477.77506425, r3: 2497108.33129819, r4: 0, time: 302400 },
      { r1: 4086751.48181388, r2: 5449001.97575184, r3: 4086751.48181388, r4: 0, time: 345600 },
      { r1: 6188066.53345743, r2: 8250755.37794324, r3: 6188066.53345743, r4: 0, time: 388800 },
  ],
  buildCosts: [
      { r1: 42971, r2: 42971, r3: 21486, r4: 0, time: 3600 },
      { r1: 74495, r2: 74495, r3: 37248, r4: 0, time: 5400 },
      { r1: 129138, r2: 129138, r3: 64569, r4: 0, time: 8100 },
      { r1: 223821, r2: 223821, r3: 111910, r4: 0, time: 12600 },
      { r1: 387710, r2: 387710, r3: 193855, r4: 0, time: 18000 },
      { r1: 670501, r2: 670501, r3: 335250, r4: 0, time: 27000 },
      { r1: 1153934, r2: 1153934, r3: 576967, r4: 0, time: 41400 },
      { r1: 1958516, r2: 1958516, r3: 979258, r4: 0, time: 61200 },
      { r1: 3205295, r2: 3205295, r3: 1602648, r4: 0, time: 86400 },
      { r1: 4853386, r2: 4853386, r3: 2426693, r4: 0, time: 172800 },
  ],
};

/** All three, in Flash's order (`SiegeWeapons.as:20-24`). */
export const SIEGE_WEAPON_DATA: readonly SiegeWeaponData[] = [DECOY, VACUUM, JARS];

/** A weapon's figures by id, or undefined for anything else. */
export const siegeData = (id: string): SiegeWeaponData | undefined =>
  SIEGE_WEAPON_DATA.find((weapon) => weapon.id === id);

/** A whole level 0 to {@link SIEGE_MAX_LEVEL}, as `SiegeWeapon.level` holds it. */
export const siegeLevel = (level: number): number =>
  Number.isFinite(level) ? Math.max(0, Math.min(Math.floor(level), SIEGE_MAX_LEVEL)) : 0;

/**
 * A figure at a level (`SiegeWeaponProperty.getValueForLevel`): entry
 * `level - 1`, or null for level 0 and for a figure the weapon lacks.
 */
export const siegeValue = <T>(values: readonly T[], level: number): T | null =>
  values[siegeLevel(level) - 1] ?? null;

/** The Decoy's blast at a level, held to 0..23,500 as `Decoy.damage` holds it. */
export const decoyDamage = (level: number): number =>
  Math.max(0, Math.min(23_500, siegeValue(DECOY.damage, level) ?? 0));

/**
 * Researching the level after `level` (`SiegeWeapon.upgradeCosts` reads
 * `level + 1`), or null once at the top.
 */
export const siegeUpgradeCost = (weapon: SiegeWeaponData, level: number): SiegeCost | null =>
  siegeLevel(level) >= SIEGE_MAX_LEVEL ? null : siegeValue(weapon.upgradeCosts, level + 1);

/** Making one weapon at its level (`SiegeWeapon.buildCosts`), or null at level 0. */
export const siegeBuildCost = (weapon: SiegeWeaponData, level: number): SiegeCost | null =>
  siegeValue(weapon.buildCosts, level);

/** What `BASE.Charge` takes for a cost: each resource floored (`BASE.as:4418`). */
export const chargedCost = (cost: SiegeCost): SiegeCost => ({
  r1: Math.floor(cost.r1),
  r2: Math.floor(cost.r2),
  r3: Math.floor(cost.r3),
  r4: Math.floor(cost.r4),
  time: cost.time,
});

/**
 * The share of a Resource Outpost's resources the Vacuum may take
 * (`VacuumHose.MR3_MAX_LOOT_MULTIPLIER`, `VacuumHose.as:20`, `:205-214`).
 */
export const VACUUM_OUTPOST_LOOT_SHARE = 0.1;
