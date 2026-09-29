import type { BaseLoadResponse } from "@/api/types";
import {
  academyLevel,
  housedRows,
  type HousedRow,
  type HousingBuildingRow,
} from "./housing";
import { housingSpace, monsterEntry, type MonsterEntry } from "./monsterCatalogue";

/**
 * The figures of the Housing panel (#170, mock-up R-Housing): the space bar
 * split into one block per Housing, the monsters waiting for room and the
 * army as pictures, biggest space first. The arithmetic under them is
 * `housing.ts`'s, the same the Monsters screen's header and the server use.
 */

/** One Housing's block in the space bar. */
export interface HousingBlock {
  readonly id: number;
  /** What it houses now; 0 while it is built or too damaged. */
  readonly capacity: number;
  /** The share of the army it holds: the army fills the Housings in id order. */
  readonly used: number;
  /** 0 to 1 of its own capacity; 1 for a block the army overflows. */
  readonly fraction: number;
}

/**
 * The army spread over the Housings in id order, each filled before the next:
 * one block per Housing, as the mock-up draws it. Housing is one shared pool
 * (`housingCapacity`); the split only says how full the pool is in pieces the
 * player can point at.
 */
export const housingBlocks = (
  buildings: readonly HousingBuildingRow[],
  used: number,
): HousingBlock[] => {
  let left = Math.max(0, used);
  return buildings.map((row) => {
    const share = Math.min(left, row.capacity);
    left -= share;
    return {
      id: row.id,
      capacity: row.capacity,
      used: share,
      fraction: row.capacity > 0 ? share / row.capacity : 0,
    };
  });
};

/** The one room size every Housing shares, or null when they differ or one houses nothing. */
export const sharedRoom = (buildings: readonly HousingBuildingRow[]): number | null => {
  const first = buildings[0]?.capacity;
  if (first === undefined || first <= 0) return null;
  return buildings.every((row) => row.capacity === first) ? first : null;
};

/** A hatched monster that waits in its hatchery for room (#169). */
export interface WaitingMonster {
  readonly monster: MonsterEntry;
  /** How many hatcheries hold one. */
  readonly count: number;
  /** The space one takes, at its academy level. */
  readonly each: number;
}

/** `hstage` 2: finished and waiting for housing (`server/src/services/yard/production.ts`). */
const STAGE_WAITING = 2;

/**
 * The monsters waiting for room, one entry per type in the order the
 * hatcheries hold them. Each moves in by itself as soon as its space is free
 * (`production.ts`, `settle`).
 */
export const waitingForRoom = (save: BaseLoadResponse): WaitingMonster[] => {
  const stages = save.monsters?.hstage ?? [];
  const entries = save.monsters?.h ?? [];
  const byType = new Map<string, WaitingMonster>();
  stages.forEach((stage, index) => {
    const id = entries[index]?.[0];
    if (Number(stage) !== STAGE_WAITING || typeof id !== "string" || id === "") return;
    const monster = monsterEntry(id);
    if (!monster) return;
    const known = byType.get(id);
    byType.set(id, {
      monster,
      count: (known?.count ?? 0) + 1,
      each: housingSpace(id, academyLevel(save.academy, id)) ?? 0,
    });
  });
  return [...byType.values()];
};

/** "a Bolt", "an Eye-ra". */
const withArticle = (name: string): string => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;

/** "A Teratorn (70)", "2 Pokey (10 each)". */
const waitingName = (entry: WaitingMonster): string =>
  entry.count === 1
    ? `${withArticle(entry.monster.name)} (${entry.each})`
    : `${entry.count} ${entry.monster.name} (${entry.each} each)`;

/** "a, b and c". */
const listOf = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** The waiting card's heading and sentence, or null when nothing waits. */
export const waitingText = (
  waiting: readonly WaitingMonster[],
): { readonly title: string; readonly text: string } | null => {
  const monsters = waiting.reduce((sum, entry) => sum + entry.count, 0);
  if (monsters === 0) return null;
  const space = waiting.reduce((sum, entry) => sum + entry.each * entry.count, 0);
  const names = listOf(waiting.map(waitingName));
  const sentence = names.charAt(0).toUpperCase() + names.slice(1);
  if (monsters === 1) {
    return {
      title: "1 monster is waiting for room",
      text: `${sentence} has hatched. It moves in by itself once ${space} spaces are free. Until then its hatchery is paused.`,
    };
  }
  return {
    title: `${monsters} monsters are waiting for room`,
    text: `${sentence} have hatched. They move in by themselves once ${space} spaces are free. Until then those ${monsters} hatcheries are paused.`,
  };
};

/** The army as the panel's pictures: biggest space first, then by list order. */
export const livingHere = (save: BaseLoadResponse): HousedRow[] =>
  housedRows(save)
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.total - a.row.total || a.index - b.index)
    .map(({ row }) => row);
