import type { ChampionAbilityId } from "@/game/combat/rules";

/**
 * Monster Madness crystals on the page (owner's grilling, 27 Nov 2026): a
 * clear of a run pays a crystal; one spent on Gorgo, Drull, Fomor or Korath
 * unlocks his next ability. The server keeps them in the yard's `rewards`
 * (`server/src/services/events/championCrystals.ts`), which `/base/load`
 * carries and the crystal and ladder routes hand back; this reads them the
 * same way and holds the words the windows show.
 */

/** Gorgo, Drull, Fomor and Korath: the champions a crystal can be spent on. */
export const CRYSTAL_CHAMPION_TYPES: readonly number[] = [1, 2, 3, 4];

/** Abilities each champion can unlock. */
export const ABILITIES_PER_CHAMPION = 3;

/** Korath's type, whose abilities are his Flash powers. */
const KORATH_TYPE = 4;

/** The crystal's painted icon. */
export const CRYSTAL_ICON = "/events/mm-crystal.webp";

const valueOf = (rewards: unknown, key: string): unknown => {
  const held = rewards && typeof rewards === "object" ? (rewards as Record<string, unknown>)[key] : null;
  return held && typeof held === "object" ? (held as Record<string, unknown>).value : undefined;
};

const whole = (raw: unknown, top: number): number => {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), top) : 0;
};

/** Crystals the yard's `rewards` hold, not yet spent. */
export const crystalsHeld = (rewards: unknown): number => whole(valueOf(rewards, "mmCrystals"), 999);

/** How many abilities champion type `t` has unlocked, 0 to 3. */
export const abilitiesUnlocked = (rewards: unknown, t: number): number => {
  if (t === KORATH_TYPE) return whole(valueOf(rewards, "korathPower"), ABILITIES_PER_CHAMPION);
  if (!CRYSTAL_CHAMPION_TYPES.includes(t)) return 0;
  const counts = valueOf(rewards, "championAbilities");
  return whole(counts && typeof counts === "object" ? (counts as Record<string, unknown>)[String(t)] : 0, 3);
};

/** One ability as the windows show it. */
export interface AbilityInfo {
  readonly id: ChampionAbilityId | "burn" | "breathOfFire" | "fistsOfDoom";
  readonly name: string;
  /** One short sentence. */
  readonly line: string;
  /** The champion level it works from (Korath's Flash gates), else 1. */
  readonly fromLevel: number;
}

/** Each champion's three abilities, in unlock order. */
export const CHAMPION_ABILITIES: Readonly<Record<number, readonly AbilityInfo[]>> = {
  1: [
    { id: "stoneSkin", name: "Stone Skin", line: "Under half health he turns to stone and takes far less damage.", fromLevel: 1 },
    { id: "chestPound", name: "Chest Pound", line: "Towers near him shoot only him; attackers turn on him.", fromLevel: 1 },
    { id: "groundSlam", name: "Ground Slam", line: "Every 4th blow stuns towers and monsters near him.", fromLevel: 1 },
  ],
  2: [
    { id: "bloodthirst", name: "Bloodthirst", line: "Heals from the damage he deals.", fromLevel: 1 },
    { id: "twinBite", name: "Twin Bite", line: "Every 3rd blow his second head bites too.", fromLevel: 1 },
    { id: "pounce", name: "Pounce", line: "Leaps over walls onto far targets and hits twice as hard.", fromLevel: 1 },
  ],
  3: [
    { id: "healingMist", name: "Healing Mist", line: "Heals the hurt monsters around him.", fromLevel: 1 },
    { id: "bubble", name: "Bubble", line: "Shields the most hurt monster near him.", fromLevel: 1 },
    { id: "acidSpit", name: "Acid Spit", line: "Marks his target: every hit on it does more.", fromLevel: 1 },
  ],
  4: [
    { id: "burn", name: "Burn", line: "His hits set foes on fire.", fromLevel: 1 },
    { id: "breathOfFire", name: "Breath of Fire", line: "Shoots fireballs at flyers.", fromLevel: 4 },
    { id: "fistsOfDoom", name: "Fists of Doom", line: "Every few swings a quake hits all around him.", fromLevel: 5 },
  ],
};

/** The champion's id in the fight rules, `G1`..`G4`. */
export const championIdOf = (t: number): string => `G${t}`;

/** The champion's name. */
export const CRYSTAL_CHAMPION_NAMES: Readonly<Record<number, string>> = {
  1: "Gorgo",
  2: "Drull",
  3: "Fomor",
  4: "Korath",
};

/** The rewards after a crystal or ladder answer, merged over the ones held. */
export const mergedRewards = (held: unknown, answer: unknown): Record<string, unknown> | null => {
  if (!answer || typeof answer !== "object") return null;
  const base = held && typeof held === "object" ? (held as Record<string, unknown>) : {};
  return { ...base, ...(answer as Record<string, unknown>) };
};
