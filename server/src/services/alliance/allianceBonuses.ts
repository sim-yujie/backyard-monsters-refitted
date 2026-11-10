import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import {
  ALLIANCE_STATS,
  CONSTELLATION_STEPS,
  CONSTELLATIONS,
  STEP_PRICES,
  TYPE_EXTRAS,
  TYPE_SCALE,
  type AllianceStat,
  type ConstellationRules,
} from "../../config/AllianceConfig.js";
import type { AllianceType } from "../../enums/Alliance.js";

/**
 * An alliance's strengths and weaknesses as numbers (design v5 §4, §5, §9):
 * the type's start values, moved by the constellation steps it has lit.
 * Every number lives in `config/AllianceConfig.ts`.
 */

/** Every stat, in percent (reach in cells). A player in no alliance has all zeros. */
export type AllianceBonuses = Record<AllianceStat, number>;

/** Steps lit per constellation id (0-5); what `alliance.stars` stores. */
export type LitSteps = Record<string, number>;

/** All zeros: no alliance. */
export const noBonuses = (): AllianceBonuses =>
  Object.fromEntries(ALLIANCE_STATS.map((stat) => [stat, 0])) as AllianceBonuses;

const round = (value: number): number => Math.round(value * 100) / 100;

/** The constellations of a type. */
export const constellationsOf = (type: AllianceType): readonly ConstellationRules[] => CONSTELLATIONS[type] ?? [];

/** The constellation `id` of a type, or null. */
export const constellationOf = (type: AllianceType, id: string): ConstellationRules | null =>
  constellationsOf(type).find((c) => c.id === id) ?? null;

/** Steps lit on one constellation, clamped to 0..CONSTELLATION_STEPS. */
export const stepsOf = (stars: LitSteps | null | undefined, id: string): number => {
  const raw = Math.trunc(Number(stars?.[id]));
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), CONSTELLATION_STEPS) : 0;
};

/** One effect's value after `steps` steps. */
export const effectValue = (effect: ConstellationRules["effects"][number], steps: number): number =>
  round(effect.start + effect.perStep * steps + (steps >= CONSTELLATION_STEPS ? (effect.atFull ?? 0) : 0));

/**
 * The bonuses of an alliance of `type` with `stars` lit. Unknown ids in
 * `stars` (another type's, kept by mistake) count for nothing.
 */
export const bonusesFor = (type: AllianceType | null | undefined, stars?: LitSteps | null): AllianceBonuses => {
  const out = noBonuses();
  if (!type || !CONSTELLATIONS[type]) return out;
  for (const [stat, value] of Object.entries(TYPE_EXTRAS[type] ?? {})) out[stat as AllianceStat] += value ?? 0;
  for (const constellation of constellationsOf(type)) {
    const steps = stepsOf(stars, constellation.id);
    for (const effect of constellation.effects) out[effect.stat] = round(out[effect.stat] + effectValue(effect, steps));
  }
  return out;
};

/** The point price of the next step of a constellation at `steps` lit, or null when full. */
export const nextStepPrice = (type: AllianceType, steps: number): number | null =>
  steps >= CONSTELLATION_STEPS ? null : (STEP_PRICES[steps] ?? STEP_PRICES.at(-1)!) * (TYPE_SCALE[type] ?? 1);

/** Points spent on `steps` steps of one constellation. */
export const spentOn = (type: AllianceType, steps: number): number => {
  let total = 0;
  for (let i = 0; i < Math.min(steps, CONSTELLATION_STEPS); i++) total += nextStepPrice(type, i) ?? 0;
  return total;
};

/** `amount` changed by `percent`% (negative = less), rounded; never below 0. */
export const byPercent = (amount: number, percent: number): number =>
  !percent || !(amount > 0) ? amount : Math.max(0, Math.round((amount * (100 + percent)) / 100));

/** Every resource of an amount map changed by `percent`%. */
export const mapByPercent = <T extends { readonly [K in keyof T]: number }>(amounts: T, percent: number): T =>
  percent
    ? (Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, byPercent(v as number, percent)])) as T)
    : amounts;

/** The production power factor for a harvester: 1 + production%. */
export const productionFactor = (bonuses: Pick<AllianceBonuses, "production"> | null | undefined): number =>
  Math.max(0, 1 + (bonuses?.production ?? 0) / 100);

/**
 * The bonuses of the alliance `userid` is in, all zeros when none. One small
 * query; safe to call inside a transaction.
 */
export const allianceBonusesOfUser = async (
  em: EntityManager,
  userid: number | null | undefined
): Promise<AllianceBonuses> => {
  if (!userid) return noBonuses();
  const [row] = await (em as SqlEntityManager).execute<{ type: AllianceType; stars: LitSteps | string | null }[]>(
    `SELECT a.type, a.stars FROM bym."user" u JOIN bym.alliance a ON a.id = u.alliance_id WHERE u.userid = ?`,
    [userid]
  );
  if (!row) return noBonuses();
  const stars = typeof row.stars === "string" ? (JSON.parse(row.stars) as LitSteps) : row.stars;
  return bonusesFor(row.type, stars);
};

/**
 * The alliance change, in percent, to what an attacker carries home: the
 * attacker's `loot` plus the defending owner's `raidersCarry`. What the
 * defender loses is not changed (as Tribe Plunder's extra).
 */
export const attackLootPercent = async (
  em: EntityManager,
  attackerId: number | null | undefined,
  defenderOwnerId: number | null | undefined
): Promise<number> => {
  const mine = await allianceBonusesOfUser(em, attackerId);
  const theirs =
    defenderOwnerId && defenderOwnerId !== attackerId ? await allianceBonusesOfUser(em, defenderOwnerId) : noBonuses();
  return mine.loot + theirs.raidersCarry;
};

/**
 * The alliance change, in percent, to a takeover's price: the taker's
 * `takeoverCost` plus, for a player's outpost, its owner's
 * `enemyTakeoverCost`. Pass no owner for a wild camp.
 */
export const takeoverPercent = async (
  em: EntityManager,
  takerId: number | null | undefined,
  ownerId: number | null | undefined
): Promise<number> => {
  const mine = await allianceBonusesOfUser(em, takerId);
  const theirs = ownerId && ownerId !== takerId ? await allianceBonusesOfUser(em, ownerId) : noBonuses();
  return mine.takeoverCost + theirs.enemyTakeoverCost;
};
