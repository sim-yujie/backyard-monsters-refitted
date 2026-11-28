import { ticks } from "./stats.js";

/**
 * Gorgo's, Drull's and Fomor's own abilities (Monster Madness redesign,
 * owner's grilling 27 Nov 2026): three each, unlocked one at a time with the
 * crystals a Monster Madness clear pays. Korath keeps Flash's three powers
 * (`champions.ts`, Burn, Breath of Fire, Fists of Doom); Krallen has none.
 *
 * ## How many a champion has
 *
 * The count rides on the champion's power level, `pl`, which every attack
 * log, cage and replay already carries. Flash hatched Gorgo, Drull and Fomor
 * at power level 1 (`CHAMPIONCAGE.as`, the catalogue's `powerLevel`), and
 * every live one holds 1 (27 Nov 2026), so for them 1 means none and each
 * ability adds one: power level 2 is ability 1, 4 is all three
 * ({@link championAbilities}). Korath hatches at 0, so his count is his
 * power level, as before.
 *
 * ## The engine's part
 *
 * Every number below is read by `engine.ts`, which applies them on both
 * sides of a fight: an attacking champion against buildings, towers and the
 * defenders it meets, and a caged champion against the attackers. Every
 * trigger is a count of blows, a cadence of ticks or a health threshold, so
 * the server's replay plays them exactly as the page did; none draws from
 * the battle's random stream.
 *
 * Every per-level table is indexed by the champion's evolution level, 1 to 6.
 */

/** The most abilities a champion unlocks. */
export const MAX_CHAMPION_ABILITIES = 3;

/**
 * The power level a champion hatches with (`CHAMPIONCAGE.as`): 1 for Gorgo,
 * Drull and Fomor, 0 for the rest. Abilities count up from it.
 */
export const CHAMPION_BASE_POWER: Readonly<Record<string, number>> = { G1: 1, G2: 1, G3: 1 };

/** The champions with the new abilities: Gorgo, Drull, Fomor. */
export const ABILITY_CHAMPIONS: readonly string[] = ["G1", "G2", "G3"];

/** Korath's three powers are his abilities; Krallen has none. */
const KORATH = "G4";
const KRALLEN = "G5";

/** The power level a champion hatches with, 0 for one not in {@link CHAMPION_BASE_POWER}. */
export const championBasePower = (id: string): number => CHAMPION_BASE_POWER[id] ?? 0;

/** The highest power level a champion can hold: its base plus three (Krallen: 2). */
export const championMaxPower = (id: string): number =>
  id === KRALLEN ? 2 : championBasePower(id) + MAX_CHAMPION_ABILITIES;

/**
 * How many abilities a champion at power level `power` has unlocked, 0 to 3:
 * Gorgo, Drull and Fomor count from their base of 1, Korath from 0, Krallen
 * has none.
 */
export const championAbilities = (id: string, power: number): number => {
  if (id !== KORATH && !ABILITY_CHAMPIONS.includes(id)) return 0;
  const count = Math.floor(power) - championBasePower(id);
  return Math.min(Math.max(count, 0), MAX_CHAMPION_ABILITIES);
};

/** The power level that holds `count` abilities. */
export const powerForAbilities = (id: string, count: number): number =>
  championBasePower(id) + Math.min(Math.max(Math.floor(count), 0), MAX_CHAMPION_ABILITIES);

/** A per-level figure: the champion's evolution level 1 to 6, clamped. */
const atLevel = (table: readonly number[], level: number): number =>
  table[Math.min(Math.max(Math.floor(level), 1), table.length) - 1] ?? 0;

/** The id the engine and the drawing use for each ability. */
export type ChampionAbilityId =
  | "stoneSkin"
  | "chestPound"
  | "groundSlam"
  | "bloodthirst"
  | "twinBite"
  | "pounce"
  | "healingMist"
  | "bubble"
  | "acidSpit";

/** Each champion's abilities, in unlock order. */
export const CHAMPION_ABILITY_IDS: Readonly<Record<string, readonly ChampionAbilityId[]>> = {
  G1: ["stoneSkin", "chestPound", "groundSlam"],
  G2: ["bloodthirst", "twinBite", "pounce"],
  G3: ["healingMist", "bubble", "acidSpit"],
};

/** Whether champion `id` with `count` abilities has `ability`. */
export const hasAbility = (id: string, count: number, ability: ChampionAbilityId): boolean => {
  const list = CHAMPION_ABILITY_IDS[id];
  if (!list) return false;
  const at = list.indexOf(ability);
  return at >= 0 && at < count;
};

/* ── Gorgo (G1), the tank ─────────────────────────────────────────────────── */

/**
 * Stone Skin (ability 1): a blow that leaves him under half health turns his
 * hide to stone for {@link STONE_SKIN_TICKS}; every blow on him then does
 * {@link stoneSkinCut} less. Ready again {@link STONE_SKIN_COOLDOWN} after it
 * began, while he is still under half.
 */
export const STONE_SKIN_BELOW = 0.5;
export const STONE_SKIN_TICKS = ticks(5);
export const STONE_SKIN_COOLDOWN = ticks(20);
export const STONE_SKIN_CUT: readonly number[] = [0.4, 0.4, 0.45, 0.5, 0.55, 0.6];
export const stoneSkinCut = (level: number): number => atLevel(STONE_SKIN_CUT, level);

/**
 * Chest Pound (ability 2): every {@link CHEST_POUND_EVERY} while he fights,
 * when something is near, he beats his chest. Attacking: every tower within
 * {@link chestPoundRadius} (yard units from its middle) that can reach him
 * shoots only him for {@link chestPoundTicks}. Defending: every attacker within
 * the radius that can fight turns on him for as long. When the hold ends, each
 * goes back to what it was on before the pound (owner, desk mm-abilities3,
 * 28 Nov 2026: 4 s at every level, both sides).
 */
export const CHEST_POUND_EVERY = ticks(12);
/** How often he looks again when nothing was near to pound at. */
export const CHEST_POUND_RETRY = ticks(1);
export const CHEST_POUND_RADIUS: readonly number[] = [250, 250, 275, 275, 300, 300];
export const CHEST_POUND_SECONDS: readonly number[] = [4, 4, 4, 4, 4, 4];
export const chestPoundRadius = (level: number): number => atLevel(CHEST_POUND_RADIUS, level);
export const chestPoundTicks = (level: number): number =>
  ticks(atLevel(CHEST_POUND_SECONDS, level));

/**
 * Ground Slam (ability 3): every {@link GROUND_SLAM_BLOWS}th blow he slams
 * the ground. Towers within {@link groundSlamRadius} (attacking) or attackers
 * within it (defending) are stunned for {@link groundSlamTicks}: a tower holds
 * its fire, a monster stands still and does not swing.
 */
export const GROUND_SLAM_BLOWS = 4;
export const GROUND_SLAM_RADIUS: readonly number[] = [120, 130, 140, 150, 160, 170];
export const GROUND_SLAM_SECONDS: readonly number[] = [1.5, 1.5, 2, 2, 2.5, 3];
export const groundSlamRadius = (level: number): number => atLevel(GROUND_SLAM_RADIUS, level);
export const groundSlamTicks = (level: number): number =>
  ticks(atLevel(GROUND_SLAM_SECONDS, level));

/* ── Drull (G2), the hard hitter ──────────────────────────────────────────── */

/** Bloodthirst (ability 1): every blow heals him by this share of the health it took. */
export const BLOODTHIRST_SHARE: readonly number[] = [0.1, 0.1, 0.12, 0.12, 0.15, 0.15];
export const bloodthirstShare = (level: number): number => atLevel(BLOODTHIRST_SHARE, level);

/**
 * Twin Bite (ability 2): every {@link TWIN_BITE_BLOWS}rd blow his second head
 * bites the same target too, for {@link twinBiteShare} of his damage.
 */
export const TWIN_BITE_BLOWS = 3;
export const TWIN_BITE_SHARE: readonly number[] = [0.5, 0.5, 0.6, 0.6, 0.75, 0.75];
export const twinBiteShare = (level: number): number => atLevel(TWIN_BITE_SHARE, level);

/**
 * Pounce (ability 3): when his next target is between {@link POUNCE_MIN} and
 * {@link POUNCE_MAX} screen px away, he leaps there in {@link POUNCE_TICKS},
 * over walls, and his first blow after landing is doubled. Ready again
 * {@link pounceCooldown} after he took off.
 */
export const POUNCE_MIN = 120;
export const POUNCE_MAX = 400;
export const POUNCE_TICKS = ticks(0.6);
export const POUNCE_MULTIPLIER = 2;
export const POUNCE_SECONDS: readonly number[] = [12, 12, 11, 10, 9, 8];
export const pounceCooldown = (level: number): number => ticks(atLevel(POUNCE_SECONDS, level));

/* ── Fomor (G3), the support ──────────────────────────────────────────────── */

/**
 * The ring Fomor's abilities reach: his rage ring (`ENRAGE_RADIUS`, cartesian
 * units as the creep index measures them).
 */
export const FOMOR_ABILITY_RADIUS = 250;

/**
 * Healing Mist (ability 1): every {@link HEALING_MIST_EVERY} while he fights,
 * every hurt ally in his ring but himself heals {@link healingMistShare} of
 * its full health.
 */
export const HEALING_MIST_EVERY = ticks(8);
export const HEALING_MIST_SHARE: readonly number[] = [0.04, 0.04, 0.05, 0.05, 0.06, 0.06];
export const healingMistShare = (level: number): number => atLevel(HEALING_MIST_SHARE, level);

/**
 * Bubble (ability 2): every {@link BUBBLE_EVERY} while he fights, the ally in
 * his ring that has lost the most of its health (not himself) gets a bubble
 * that soaks up the next {@link bubbleHealth} damage, or pops after
 * {@link BUBBLE_TICKS}.
 */
export const BUBBLE_EVERY = ticks(10);
export const BUBBLE_TICKS = ticks(8);
export const BUBBLE_HEALTH: readonly number[] = [1500, 2000, 2500, 3000, 4000, 5000];
export const bubbleHealth = (level: number): number => atLevel(BUBBLE_HEALTH, level);

/**
 * Acid Spit (ability 3): every {@link ACID_SPIT_EVERY} his spit marks the
 * building or creep he is shooting; for {@link ACID_SPIT_TICKS} every blow on
 * it, from anyone on his side, does {@link acidSpitShare} more.
 */
export const ACID_SPIT_EVERY = ticks(6);
export const ACID_SPIT_TICKS = ticks(5);
export const ACID_SPIT_SHARE: readonly number[] = [0.25, 0.25, 0.3, 0.3, 0.35, 0.4];
export const acidSpitShare = (level: number): number => atLevel(ACID_SPIT_SHARE, level);
