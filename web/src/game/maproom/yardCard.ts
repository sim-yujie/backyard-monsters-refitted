import { CellType, type PlayerCell } from "@/api/types";
import { STARTER_KIT_SUMMARIES, type StarterKitSummary } from "@/game/yard/starterKitData";
import { countsList, housedOf, spaceOf, type MonsterCount } from "./moveYards";

/**
 * What the yard info card shows about one of the player's own yards on Map
 * Room 2 (beta 7, the owner's design B of the "monsters housed" proposal,
 * 9 Nov 2026): Flash's `PopupInfoMine` made over. Everything comes from the
 * own cell the map already loads; nothing here asks the server.
 *
 * - Monsters housed: `m.housed`, the counts the server catches up for the
 *   player's own cells (`userCell.ts`, `ownMonsters`).
 * - Housing: `m.space`, the yard's housing capacity, which the server's
 *   catch-up keeps (`moveYards.ts`, `spaceOf`); used = each monster's
 *   housing size at the player's academy level, times its count.
 * - Kit: the outpost's Starter Kit, `kit` (0 none, 1 Regular, 2 Mega, 3
 *   Ultra), the server's `save.starterkit` column.
 * - Worker: an own outpost's `wi` (idle) or `wb` (building).
 * - Storage: the main yard's `r` with its caps. An outpost banks into the
 *   main yard and keeps no store of its own (`resourceHandler.ts`,
 *   `skipCapacity`), so an outpost shows none.
 */

export type YardWorker = "idle" | "busy";

export interface YardStorage {
  readonly key: "r1" | "r2" | "r3" | "r4";
  /** 0..100, rounded down: "100%" only when it is truly full. */
  readonly percent: number;
}

export interface YardCardFacts {
  readonly outpost: boolean;
  /** Housed monsters with a count, in roster order. */
  readonly housed: readonly MonsterCount[];
  /** Every housed monster, counted one each. */
  readonly monsters: number;
  /** Housing taken by the housed monsters. */
  readonly used: number;
  /** The yard's housing capacity; 0 when the server sent none. */
  readonly capacity: number;
  /**
   * The outpost's Starter Kit; null for an outpost with none, and for the
   * main yard, which never has one (`kit` is absent on a main yard cell).
   */
  readonly kit: StarterKitSummary | null;
  /** The outpost's one worker; null on the main yard and when not known. */
  readonly worker: YardWorker | null;
  /** The main yard's four stores; null on an outpost or when no caps came. */
  readonly storage: readonly YardStorage[] | null;
}

const STORES = ["r1", "r2", "r3", "r4"] as const;

/** The kit an outpost's `kit` id names, or null for 0 / unknown. */
export const kitSummary = (id: number | undefined): StarterKitSummary | null =>
  STARTER_KIT_SUMMARIES.find((kit) => kit.id === id) ?? null;

/** The main yard's stores as a share of their caps, or null without caps. */
export const storageOf = (payload: PlayerCell): YardStorage[] | null => {
  const resources = payload.r;
  if (!resources) return null;
  const stores: YardStorage[] = [];
  for (const key of STORES) {
    const max = Number(resources[`${key}max`]);
    if (!Number.isFinite(max) || max <= 0) return null;
    const have = Math.max(0, Number(resources[key]) || 0);
    stores.push({ key, percent: Math.min(100, Math.floor((have / max) * 100)) });
  }
  return stores;
};

/**
 * The card's facts for one of the player's own cells. `sizeOf` is the
 * housing one monster of a type takes at the player's academy level.
 */
export const yardCardFacts = (payload: PlayerCell, sizeOf: (id: string) => number): YardCardFacts => {
  const outpost = payload.b === CellType.OUTPOST;
  const housed = countsList(housedOf(payload));
  let monsters = 0;
  let used = 0;
  for (const { id, count } of housed) {
    monsters += count;
    used += count * Math.max(0, sizeOf(id));
  }
  return {
    outpost,
    housed,
    monsters,
    used,
    capacity: spaceOf(payload),
    kit: outpost ? kitSummary(payload.kit) : null,
    worker: !outpost ? null : payload.wb === 1 ? "busy" : payload.wi === 1 ? "idle" : null,
    storage: outpost ? null : storageOf(payload),
  };
};

/** The housing bar's fill, 0..100. A yard with no capacity reads full if anything is housed. */
export const housingPercent = (facts: Pick<YardCardFacts, "used" | "capacity">): number => {
  if (facts.capacity <= 0) return facts.used > 0 ? 100 : 0;
  return Math.min(100, Math.round((facts.used / facts.capacity) * 100));
};
