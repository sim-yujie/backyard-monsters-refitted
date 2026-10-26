import { molochTribes } from "../../game-data/tribes/inferno/molochTribes.js";
import {
  bucketCost,
  championByType,
  championStat,
  RESOURCE_KEYS,
  type FlingEvent,
  type FlingLog,
  type MonsterLevels,
  type ResourceAmounts,
} from "../../game-rules/combat/index.js";
import type { SaveData } from "../../types/EntityData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { EMERGENCE_LEVELS } from "./emergence.js";
import { DESCENT_YARDS, type InfernoProgressRecord } from "./infernoProgress.js";

/**
 * The Descent's rules (`docs/design/inferno.md` §2.4, WP 1.11-1.12): the 13
 * Moloch yards a player fights down through, one at a time, to capture their
 * Inferno yard. Pure; the routes are `controllers/inferno/descentAttack.ts`
 * (start) and `descentLanding.ts` (the save that ends the attack).
 */

/** The first Descent yard's base id (`maproom_inferno/DescentLayer.as:299-311`: 201-213). */
export const DESCENT_FIRST_BASEID = 201;

/** A Descent attack is won at this damage or more (`ATTACK.as:970`, `BYMConfig.k_sVICTORY_THRESHOLD`). */
export const DESCENT_WIN_DAMAGE = 90;

/**
 * Flash's Descent counter once the 13th yard falls (`MAPROOM_DESCENT.as:24`,
 * `_descentLvlMax`): 1 + yards beaten, so 14 is "passed".
 */
export const DESCENT_PASSED_LEVEL = DESCENT_YARDS + 1;

/**
 * The Flinger's payload by level in a Descent attack: the main yard table's,
 * `YARD_PROPS._yardProps[4].capacity` (`YARD_PROPS.as:709`), not Map Room 2's
 * pinned 2,250 (`ATTACK.as:589-591`). The attacker's own Flinger level counts
 * (`GLOBAL.as:830-832`: a Descent attack is loaded as `iwmattack`, so the
 * Map Room 2 pin to level 4 at `:863` never applies).
 */
export const DESCENT_FLINGER_CAPACITY: readonly number[] = [250, 850, 1500, 2500, 3500, 3500, 3500];

/** Declare War adds a quarter to the payload (`ATTACK.as:592-594`). */
export const DECLARE_WAR_PAYLOAD = 0.25;

const FLINGER_TYPE = 5;

/** The yard's index, 0-12, for a Descent base id, or null for any other base. */
export const descentIndexOf = (baseid: unknown): number | null => {
  const text = String(baseid ?? "");
  if (!/^\d+$/.test(text)) return null;
  const index = Number(text) - DESCENT_FIRST_BASEID;
  return Number.isInteger(index) && index >= 0 && index < DESCENT_YARDS ? index : null;
};

/** Whether `baseid` names one of the 13 Descent yards. */
export const isDescentBaseid = (baseid: unknown): boolean => descentIndexOf(baseid) !== null;

/** The base id of the yard at `index`. */
export const descentBaseidOf = (index: number): string => String(DESCENT_FIRST_BASEID + index);

/** Whether the yard at `index` has been beaten. */
export const descentBeaten = (progress: InfernoProgressRecord, index: number): boolean =>
  progress.descentDestroyed[index] === 1;

/**
 * The yard the player may attack now, 0-12: the first not yet beaten
 * (`DescentLayer.as:299-311`: only the next base is open), or null once the
 * Descent is passed.
 */
export const nextDescentIndex = (progress: InfernoProgressRecord): number | null => {
  if (progress.descentPassedAt !== null) return null;
  for (let index = 0; index < DESCENT_YARDS; index++) if (!descentBeaten(progress, index)) return index;
  return null;
};

/** Flash's counter: 1 + yards beaten, 14 once passed (`WMBASE.CheckDescentProgress`). */
export const descentLevelOf = (progress: InfernoProgressRecord): number =>
  progress.descentPassedAt !== null
    ? DESCENT_PASSED_LEVEL
    : 1 + Array.from({ length: DESCENT_YARDS }, (_, index) => (descentBeaten(progress, index) ? 1 : 0)).reduce(
        (sum: number, flag) => sum + flag,
        0
      );

/** Why a Descent attack cannot start. */
export type DescentRefusal = "caveClosed" | "descentPassed" | "notDescentBase" | "notNextBase";

/**
 * Whether the player may attack `baseid` now, or why not: the cave has to have
 * come up all five levels (`INFERNOPORTAL.as:249-256`: "Enter" shows at level
 * 5), the Descent must not be passed, and the base must be the next one.
 */
export const descentRefusal = (progress: InfernoProgressRecord, baseid: unknown): DescentRefusal | null => {
  if (progress.emergenceLevel < EMERGENCE_LEVELS) return "caveClosed";
  const index = descentIndexOf(baseid);
  if (index === null) return "notDescentBase";
  const next = nextDescentIndex(progress);
  if (next === null) return "descentPassed";
  return index === next ? null : "notNextBase";
};

/** A Descent yard as the data file has it (`game-data/tribes/inferno/molochTribes.ts`). */
export const descentYardOf = (index: number): SaveData => {
  const baseid = descentBaseidOf(index);
  const yard = molochTribes.find((tribe) => tribe.baseid === baseid);
  if (!yard) throw new Error(`No Descent yard ${baseid}`);
  return yard;
};

/** The level of the attacker's built Flinger, 0 with none (one still being built does not count). */
export const flingerLevelOf = (buildingdata: JsonObject | null | undefined): number => {
  let level = 0;
  for (const row of Object.values(buildingdata ?? {})) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    const building = row as JsonObject;
    if (building.t !== FLINGER_TYPE || building.cB !== undefined) continue;
    level = Math.max(level, typeof building.l === "number" ? building.l : 1);
  }
  return level;
};

/**
 * What one fling may carry in a Descent attack: the main table's payload at
 * the attacker's Flinger level, a quarter more under Declare War.
 */
export const descentFlingerCapacity = (flingerLevel: number, declareWar: boolean): number => {
  const base = flingerLevel >= 1 ? (DESCENT_FLINGER_CAPACITY[Math.min(flingerLevel, DESCENT_FLINGER_CAPACITY.length) - 1] ?? 0) : 0;
  return declareWar ? base + Math.floor(base * DECLARE_WAR_PAYLOAD) : base;
};

/**
 * The fling log cut down to what a Descent attack can do (`docs/design/inferno.md`
 * §2.4 "Army"): no catapult bombs and no siege weapons (`UI_TOP.as:289`,
 * `:296`, `:964-966` hide both in the Descent), and each fling no fuller than
 * the Flinger holds (`ATTACK.BucketAdd`, `:589-617`): a champion goes in first
 * and takes its own `bucket`, then monsters, in id order, while they fit. An
 * honest log comes back unchanged; anything else is the client's own doing.
 *
 * @param log - The save's fling log, parsed.
 * @param capacity - {@link descentFlingerCapacity}.
 * @param levels - The academy levels the attack is fought at.
 */
export const descentFightableLog = (log: FlingLog, capacity: number, levels: MonsterLevels | undefined): FlingLog => {
  const events: FlingEvent[] = [];
  for (const event of log.events) {
    if (event.kind === "bomb" || event.kind === "siege") continue;
    if (event.kind !== "fling") {
      events.push(event);
      continue;
    }
    let room = capacity;
    if (event.champion) {
      const id = championByType(event.champion.t);
      room -= id ? championStat(id, "bucket", event.champion.l) : 0;
    }
    const monsters: Record<string, number> = {};
    for (const id of Object.keys(event.monsters).sort()) {
      const each = bucketCost({ [id]: 1 }, levels);
      const sent = Math.max(0, Math.floor(event.monsters[id] ?? 0));
      const fits = each > 0 ? Math.min(sent, Math.floor(Math.max(0, room) / each)) : sent;
      if (fits <= 0) continue;
      monsters[id] = fits;
      room -= fits * each;
    }
    if (Object.keys(monsters).length === 0 && !event.champion) continue;
    events.push({ ...event, monsters });
  }
  return { ...log, events };
};

/** What one Descent yard keeps between attacks, by base id (`inferno_progress.descent_yards`). */
export interface DescentYardState {
  /** Its `buildinghealthdata` after the last attack. */
  readonly health: Readonly<Record<string, number>>;
  /** What it has given up so far. */
  readonly looted: Readonly<ResourceAmounts>;
}

/** The fight's result on one Descent yard, as the landing writes it. */
export interface DescentResult {
  readonly index: number;
  readonly damage: number;
  readonly health: Readonly<Record<string, number>>;
  /** The loot credited this attack. */
  readonly loot: ResourceAmounts;
}

/** The progress after a landed Descent attack, and what it changed. */
export interface DescentProgressUpdate {
  readonly descentDestroyed: number[];
  readonly descentBest: number[];
  readonly descentYards: Record<string, DescentYardState>;
  readonly won: boolean;
  /** The 13th yard just fell: the Descent is passed and the Inferno yard is to be made. */
  readonly captured: boolean;
  /** Flash's counter after the attack, for the achievements (`ATTACK.as:975`). */
  readonly level: number;
}

/**
 * The progress a landed Descent attack leaves (WP 1.12): a win at 90% damage
 * or more beats the yard (and forgets what it kept); a loss keeps the yard as
 * the fight left it, its health and what it has given up, so the next attack
 * goes on from there. The best damage only goes up.
 */
export const descentProgressAfter = (
  progress: InfernoProgressRecord,
  result: DescentResult
): DescentProgressUpdate => {
  const destroyed: number[] = Array.from({ length: DESCENT_YARDS }, (_, index) => (descentBeaten(progress, index) ? 1 : 0));
  const best = Array.from({ length: DESCENT_YARDS }, (_, index) => progress.descentBest[index] ?? 0);
  const yards: Record<string, DescentYardState> = { ...progress.descentYards };
  const baseid = descentBaseidOf(result.index);
  const damage = Math.max(0, Math.min(100, Math.floor(result.damage)));
  const won = damage >= DESCENT_WIN_DAMAGE;

  best[result.index] = Math.max(best[result.index] ?? 0, damage);
  if (won) {
    destroyed[result.index] = 1;
    delete yards[baseid];
  } else {
    const looted = { ...(yards[baseid]?.looted ?? { r1: 0, r2: 0, r3: 0, r4: 0 }) };
    for (const key of RESOURCE_KEYS) looted[key] = (looted[key] ?? 0) + result.loot[key];
    yards[baseid] = { health: { ...result.health }, looted };
  }

  const captured = won && destroyed.every((flag) => flag === 1);
  const level = captured ? DESCENT_PASSED_LEVEL : 1 + destroyed.reduce((sum: number, flag) => sum + flag, 0);
  return { descentDestroyed: destroyed, descentBest: best, descentYards: yards, won, captured, level };
};

/**
 * The Inferno purse after the Descent's loot: added in full, with no storage
 * cap. Flash's `ATTACK.Loot` caps an Inferno attacker's gain only once the
 * Descent is passed or when the yard was loaded in the mode it is fought in
 * (`ATTACK.as:703-709`); a Descent yard is loaded as `iwmattack` and fought
 * as `wmattack` (`GLOBAL.as:775-786`), so neither holds.
 */
export const purseAfterDescentLoot = (
  iresources: JsonObject | null | undefined,
  loot: ResourceAmounts
): JsonObject => {
  const purse: JsonObject = { ...(iresources ?? {}) };
  for (const key of RESOURCE_KEYS) {
    const held = Number(purse[key]);
    purse[key] = (Number.isFinite(held) ? Math.max(0, Math.floor(held)) : 0) + loot[key];
  }
  return purse;
};

/** Each resource of the purse as whole numbers, for the report's running total. */
export const purseAmounts = (iresources: JsonObject | null | undefined): ResourceAmounts => {
  const amounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const key of RESOURCE_KEYS) {
    const held = Number(iresources?.[key]);
    amounts[key] = Number.isFinite(held) ? Math.max(0, Math.floor(held)) : 0;
  }
  return amounts;
};
