import { KORATH_MAX_POWER, korathPowerOf } from "../../game-data/events/monsterMadness.js";
import { Reward } from "../../enums/Rewards.js";
import {
  MAX_CHAMPION_ABILITIES,
  championByType,
  powerForAbilities,
} from "../../game-rules/combat/index.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { yardRefusedErr } from "../yard/yardErrors.js";
import { grantKorathPower } from "./korathPower.js";
import { readChampions } from "../yard/champion.js";

/** Korath's type, written here so this module never waits on `champion.ts` loading. */
const KORATH_TYPE = 4;

/**
 * Monster Madness crystals (owner's grilling, 27 Nov 2026).
 *
 * A clear of a Monster Madness run pays a crystal (`grant.ts`, kind
 * `crystal`). The player spends one on Gorgo, Drull, Fomor or Korath (not
 * Krallen) to unlock that champion's next ability, 1 then 2 then 3: 12
 * crystals unlock everything. Crystals are kept until spent, and may be
 * spent on a champion the player does not have yet: the ability waits for
 * him, as a Korath power always did.
 *
 * Kept in the main yard's `rewards`:
 * - `Reward.MM_CRYSTALS` `{ value: n }`, the crystals not yet spent;
 * - `Reward.CHAMPION_ABILITIES` `{ value: { "1": n, "2": n, "3": n } }`,
 *   Gorgo's, Drull's and Fomor's unlocked counts;
 * - Korath's count stays `Reward.KORATH_POWER`, his power level, as before
 *   (`korathPower.ts`): his abilities are his three Flash powers.
 *
 * Every champion of that type in the `champion` list (frozen ones too) is
 * lifted to the power level that holds its count (`powerForAbilities`: 1 + n
 * for Gorgo, Drull and Fomor, who hatch at 1; n for Korath); one raised
 * later hatches with it (`planChampionRaise`). The fight rules read nothing
 * else (`game-rules/combat/championAbilities.ts`).
 *
 * Pure: every function hands back fresh `rewards` and, when a champion
 * changed, a fresh list.
 */

/** The champions a crystal can be spent on: Gorgo, Drull, Fomor, Korath. */
export const CRYSTAL_CHAMPION_TYPES: readonly number[] = [1, 2, 3, KORATH_TYPE];

/** The most crystals a player can hold: every ability of every champion. */
export const MAX_CRYSTALS = CRYSTAL_CHAMPION_TYPES.length * MAX_CHAMPION_ABILITIES;

const rewardValue = (rewards: unknown, key: string): unknown => {
  const held = rewards && typeof rewards === "object" ? (rewards as Record<string, unknown>)[key] : null;
  return held && typeof held === "object" ? (held as Record<string, unknown>).value : undefined;
};

const wholeIn = (raw: unknown, top: number): number => {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), top) : 0;
};

/** The crystals a yard's `rewards` hold, not yet spent. */
export const crystalsOf = (rewards: unknown): number => wholeIn(rewardValue(rewards, Reward.MM_CRYSTALS), 999);

/** How many abilities champion type `t` has unlocked, 0 to 3; 0 for Krallen or an unknown type. */
export const abilitiesOf = (rewards: unknown, t: number): number => {
  if (t === KORATH_TYPE) return korathPowerOf(rewards);
  if (!CRYSTAL_CHAMPION_TYPES.includes(t)) return 0;
  const counts = rewardValue(rewards, Reward.CHAMPION_ABILITIES);
  const raw = counts && typeof counts === "object" ? (counts as Record<string, unknown>)[String(t)] : 0;
  return wholeIn(raw, MAX_CHAMPION_ABILITIES);
};

/** Every crystal champion's unlocked count, by type, for the page. */
export const abilityCountsOf = (rewards: unknown): Record<string, number> =>
  Object.fromEntries(CRYSTAL_CHAMPION_TYPES.map((t) => [String(t), abilitiesOf(rewards, t)]));

/**
 * The power level a champion of type `t` hatches or is lifted to: the
 * catalogue's `base` plus its unlocked abilities (Korath: his power).
 */
export const powerLevelFor = (rewards: unknown, t: number, base: number): number => {
  if (t === KORATH_TYPE) return Math.max(base, korathPowerOf(rewards));
  const id = championByType(t);
  if (!id || !CRYSTAL_CHAMPION_TYPES.includes(t)) return base;
  return Math.max(base, powerForAbilities(id, abilitiesOf(rewards, t)));
};

const baseRewards = (rewards: unknown): JsonObject =>
  rewards && typeof rewards === "object" ? { ...(rewards as JsonObject) } : {};

/** `count` crystals more in `rewards`. */
export const grantCrystals = (rewards: unknown, count: number): { rewards: JsonObject; held: number } => {
  const held = crystalsOf(rewards) + Math.max(0, Math.floor(count) || 0);
  return {
    rewards: { ...baseRewards(rewards), [Reward.MM_CRYSTALS]: { id: Reward.MM_CRYSTALS, value: held } },
    held,
  };
};

export interface CrystalSpend {
  rewards: JsonObject;
  /** The new list, only when a champion in it changed. */
  champions?: ChampionData[];
  /** The champion type spent on, and its unlocked count now (1-3). */
  type: number;
  abilities: number;
  /** Crystals left. */
  crystals: number;
  /** Whether the player has that champion now; without one, the ability waits for him. */
  hasChampion: boolean;
}

/**
 * Spends one crystal on champion type `t`: its next ability.
 *
 * Refusals: `409 notCrystalChampion` (Krallen or an unknown type),
 * `409 noCrystal`, `409 allAbilities` (it has all three).
 */
export const spendCrystal = (save: { rewards?: unknown; champion?: unknown }, t: number): CrystalSpend => {
  if (!CRYSTAL_CHAMPION_TYPES.includes(t)) {
    throw yardRefusedErr("notCrystalChampion", "Crystals unlock Gorgo, Drull, Fomor and Korath only.", { type: t });
  }
  const crystals = crystalsOf(save.rewards);
  if (crystals < 1) throw yardRefusedErr("noCrystal", "You have no crystal to spend.");
  const before = abilitiesOf(save.rewards, t);
  if (before >= MAX_CHAMPION_ABILITIES) {
    throw yardRefusedErr("allAbilities", "That champion has all three abilities already.", { type: t });
  }
  const abilities = before + 1;
  let rewards: JsonObject = {
    ...baseRewards(save.rewards),
    [Reward.MM_CRYSTALS]: { id: Reward.MM_CRYSTALS, value: crystals - 1 },
  };

  if (t === KORATH_TYPE) {
    const won = grantKorathPower({ rewards }, Math.min(abilities, KORATH_MAX_POWER), save.champion);
    return {
      rewards: won.rewards,
      ...(won.champions && { champions: won.champions }),
      type: t,
      abilities,
      crystals: crystals - 1,
      hasChampion: won.hasKorath,
    };
  }

  const counts = abilityCountsOf(save.rewards);
  delete counts[String(KORATH_TYPE)];
  counts[String(t)] = abilities;
  rewards = { ...rewards, [Reward.CHAMPION_ABILITIES]: { id: Reward.CHAMPION_ABILITIES, value: counts } };

  const id = championByType(t)!;
  const power = powerForAbilities(id, abilities);
  const list = readChampions(save.champion);
  let changed = false;
  let hasChampion = false;
  for (const [index, one] of list.entries()) {
    if (Math.trunc(Number(one.t)) !== t) continue;
    hasChampion = true;
    if ((Number(one.pl) || 0) >= power) continue;
    list[index] = { ...one, pl: power };
    changed = true;
  }
  return { rewards, ...(changed && { champions: list }), type: t, abilities, crystals: crystals - 1, hasChampion };
};
