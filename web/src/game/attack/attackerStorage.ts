import type { BaseLoadResponse, Resources } from "@/api/types";
import {
  BOMBS,
  KRALLEN_ID,
  RESOURCE_KEYS,
  championStat,
  type FlingLog,
  type ResourceAmounts,
} from "@/game/combat/rules";
import { rowOf } from "@/game/yard/buildingCosts";

/**
 * How much of an attack's loot the attacker keeps (issue #166).
 *
 * Flash adds a gain to the attacker's pool only up to their storage cap, and
 * Krallen on the field raises that cap by her `buffs`
 * (`client/scripts/ATTACK.as:695-710`); the defender loses the whole amount
 * either way. The server applies the same cap when the save lands
 * (`server/src/services/base/combat/attackLoot.ts`, `bankAttackLoot`) and
 * says what it banked (`lootcredited`); this is the end panel's estimate of
 * that figure until the save answers.
 */

const SILO_TYPE = 6;
/** The pool every yard starts with, before silos (`client/scripts/BASE.as:4720-4723`). */
const BASE_STORAGE = 10_000;
/** Each owned outpost adds this much to every cap (`client/scripts/GLOBAL.as:806`). */
const OUTPOST_STORAGE = 2_000_000;
/** Krallen's champion type (`client/scripts/CHAMPIONCAGE.as:32`). */
const KRALLEN_TYPE = 5;

/** What the cap is derived from: the own-yard load. */
export type StorageCapSave = Pick<BaseLoadResponse, "buildingdata" | "storedata"> & {
  readonly outposts?: unknown;
};

/**
 * The attacker's storage cap, one figure for all four resources: 10,000 plus
 * every finished silo, times Improved Packing Skills, plus 2,000,000 per
 * outpost — the server's `storageCap` (`resourceBudget.ts`), from Flash's
 * `BASE.CalcResources` (`BASE.as:4705-4826`).
 */
export const storageCapOf = (save: StorageCapSave): number => {
  const capacity = rowOf(SILO_TYPE)?.[6]?.capacity ?? [];
  let pool = BASE_STORAGE;
  for (const building of Object.values(save.buildingdata ?? {})) {
    if (building?.t !== SILO_TYPE) continue;
    // A silo still on its first build adds nothing; a row without `l` is level 1.
    if (typeof building.cB === "number" && building.cB > 0) continue;
    const level = typeof building.l === "number" && building.l > 0 ? building.l : 1;
    pool += capacity[level - 1] ?? 0;
  }
  const bought = Math.max(0, Number(save.storedata?.["BIP"]?.q) || 0);
  const packing = Math.trunc((1 + 0.1 * bought) * 100) / 100;
  const outposts = Array.isArray(save.outposts) ? save.outposts.length : 0;
  return Math.floor(pool * packing) + outposts * OUTPOST_STORAGE;
};

/**
 * Krallen's raise of the cap, as a fraction: her `buffs` at the level she was
 * flung at, no higher than the one owned; 0 when the log flings no Krallen.
 * Flash raises it only while she is on the field; the server, which cannot
 * tell when each unit of loot fell, raises it for the whole battle, and so
 * does this.
 */
export const krallenBuffOf = (
  log: FlingLog,
  owned: readonly { readonly t: number; readonly l: number }[],
): number => {
  const krallen = owned.find((champion) => champion.t === KRALLEN_TYPE);
  if (!krallen) return 0;
  for (const event of log.events) {
    if (event.kind !== "fling" || event.champion?.t !== KRALLEN_TYPE) continue;
    return Math.max(
      0,
      championStat(KRALLEN_ID, "buffs", Math.min(event.champion.l, krallen.l)),
    );
  }
  return 0;
};

/** What the log's bombs cost, per resource (`ResourceBombs.as:301-306`). */
const bombSpendOf = (log: FlingLog): ResourceAmounts => {
  const spend = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const event of log.events) {
    if (event.kind !== "bomb") continue;
    const bomb = BOMBS.find((one) => one.id === event.id);
    if (bomb) spend[`r${bomb.resource}` as keyof ResourceAmounts] += bomb.cost;
  }
  return spend;
};

/**
 * The part of `taken` that fits: each resource up to the room under the cap
 * (raised by Krallen) after the bombs' cost has left the pool, as the server
 * banks it. A pool at or over the cap keeps nothing. Without a pool or a cap
 * to read, all of it.
 *
 * @param taken - What the battle looted, whole units.
 * @param held - The attacker's pool when the attack began.
 * @param cap - {@link storageCapOf}, or null when unknown.
 * @param log - The attack's fling log, for Krallen and the bombs.
 * @param owned - The attacker's champions.
 */
export const keptLoot = (
  taken: ResourceAmounts,
  held: Resources | null,
  cap: number | null,
  log: FlingLog,
  owned: readonly { readonly t: number; readonly l: number }[],
): ResourceAmounts => {
  if (!held || cap === null) return { ...taken };
  const limit = Math.floor(cap * (1 + krallenBuffOf(log, owned)));
  const spend = bombSpendOf(log);
  const kept = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const key of RESOURCE_KEYS) {
    const value = Number(held[key]);
    const pool = Math.max(0, (Number.isFinite(value) ? value : 0) - spend[key]);
    kept[key] = Math.max(0, Math.min(taken[key], limit - pool));
  }
  return kept;
};
