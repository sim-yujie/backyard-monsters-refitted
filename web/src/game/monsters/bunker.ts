import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { capacity } from "@/game/combat/rules";
import { academyLevel } from "./housing";
import { compareListOrder, hatchCost, housingSpace, monsterEntry, type MonsterEntry } from "./monsterCatalogue";

/**
 * The Monster Bunker on the client: what one holds, what it has room for, and
 * what filling it costs (`docs/design/yard-buildings.md` §7.1, decision D11).
 *
 * The same rules the server applies (`server/src/services/yard/bunker.ts`):
 * contents on the bunker's own entry, `buildingdata[id].m = { id: count }`;
 * room 380 / 450 / 540 / 660 / 800 by level, measured in `cStorage` at each
 * monster's academy level; nothing while it is being built. From housing
 * costs `floor(cResource × 0.5 × n)` putty per type; bought costs the
 * original's Shiny per monster. Only C1–C13 and C17 go in. The route charges
 * its own figures; these are for the labels and the steppers' limits.
 */

/** Monster Bunker type id (`client/scripts/YARD_PROPS.as:2410`). */
export const BUNKER_TYPE = 22;

/** Monsters a Map Room 2 bunker takes (`client/scripts/MONSTERBUNKERPOPUP.as:48-69`, Inferno left out). */
export const BUNKERABLE_MONSTERS: readonly string[] = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C17",
];

/** Shiny per monster bought straight into a bunker (`MONSTERBUNKERPOPUP.as:30-46`). */
export const BUNKER_BUY_PRICES: Readonly<Record<string, number>> = {
  C2: 2,
  C5: 16,
  C6: 5,
  C7: 8,
  C8: 12,
  C10: 14,
  C11: 24,
  C12: 65,
  C13: 24,
  C17: 17,
};

/** Putty per unit of hatch cost when a monster moves from housing into a bunker. */
export const BUNKER_PUTTY_RATE = 0.5;

export type BunkerSource = "housing" | "buy";

const LEGACY_IDS: Readonly<Record<string, string>> = { C100: "C12" };

const whole = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

/** A bunker's level: 0 while it is being built. */
export const bunkerLevel = (building: BuildingData): number =>
  Number(building.cB ?? 0) > 0 ? 0 : Math.max(1, Math.floor(Number(building.l ?? 1)) || 1);

/** What a bunker at `level` holds; 0 while it is being built. */
export const bunkerCapacity = (level: number): number => (level >= 1 ? capacity(BUNKER_TYPE, level) : 0);

/** A bunker's contents as whole positive counts of known monsters. */
export const bunkerContents = (building: BuildingData | undefined): Record<string, number> => {
  const raw = building?.["m"];
  const contents: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return contents;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = LEGACY_IDS[key] ?? key;
    const count = Array.isArray(value) ? value.length : whole(value);
    if (!monsterEntry(id) || count === 0) continue;
    contents[id] = (contents[id] ?? 0) + count;
  }
  return contents;
};

/** Space one `id` takes, at its academy level. */
export const spaceEach = (save: BaseLoadResponse, id: string): number =>
  housingSpace(id, academyLevel(save.academy, id)) ?? 0;

/** Space a set of monsters takes. */
export const bunkerSpace = (save: BaseLoadResponse, contents: Readonly<Record<string, number>>): number =>
  Object.entries(contents).reduce((total, [id, count]) => total + spaceEach(save, id) * count, 0);

/** Putty to move `count` of `id` from housing into a bunker, rounded down per type. */
export const bunkerPutty = (save: BaseLoadResponse, id: string, count: number): number =>
  Math.floor((hatchCost(id, academyLevel(save.academy, id)) ?? 0) * BUNKER_PUTTY_RATE * count);

/** What a selection would cost from `source`. */
export const fillCost = (
  save: BaseLoadResponse,
  selection: Readonly<Record<string, number>>,
  source: BunkerSource,
): { putty: number; shiny: number; count: number; space: number } => {
  let putty = 0;
  let shiny = 0;
  let count = 0;
  for (const [id, n] of Object.entries(selection)) {
    if (!(n > 0)) continue;
    count += n;
    if (source === "buy") shiny += (BUNKER_BUY_PRICES[id] ?? 0) * n;
    else putty += bunkerPutty(save, id, n);
  }
  return { putty, shiny, count, space: bunkerSpace(save, selection) };
};

/** One bunker as the panel reads it. */
export interface BunkerState {
  readonly id: number;
  readonly level: number;
  readonly capacity: number;
  readonly contents: Readonly<Record<string, number>>;
  readonly used: number;
  /** True while it is being built: it holds nothing yet. */
  readonly building: boolean;
}

/** The bunker `id` in the yard, or null when there is none by that id. */
export const bunkerState = (save: BaseLoadResponse, id: number): BunkerState | null => {
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    if (Number(building?.t) !== BUNKER_TYPE || Number(building.id ?? key) !== id) continue;
    const level = bunkerLevel(building);
    const contents = bunkerContents(building);
    return {
      id,
      level,
      capacity: bunkerCapacity(level),
      contents,
      used: bunkerSpace(save, contents),
      building: level === 0,
    };
  }
  return null;
};

/** One monster the fill list offers. */
export interface FillRow {
  readonly monster: MonsterEntry;
  /** How many there are to move: housed count, or null for bought (no limit but room). */
  readonly available: number | null;
  /** Space one takes. */
  readonly each: number;
  /** Shiny each (buy), or putty each rounded down (housing; the total is rounded per type). */
  readonly price: number;
  /** Buy only: still locked in the Monster Locker. */
  readonly locked: boolean;
}

/**
 * The monsters the fill list offers from `source`, in the hatchery's list
 * order: bunkerable monsters in housing, or the buyable ones (locked ones
 * flagged, since the route refuses them).
 */
export const fillRows = (save: BaseLoadResponse, source: BunkerSource): FillRow[] => {
  const rows: FillRow[] = [];
  const ids = source === "buy" ? Object.keys(BUNKER_BUY_PRICES) : BUNKERABLE_MONSTERS;
  for (const id of ids) {
    const monster = monsterEntry(id);
    if (!monster) continue;
    const each = spaceEach(save, id);
    if (source === "buy") {
      rows.push({
        monster,
        available: null,
        each,
        price: BUNKER_BUY_PRICES[id]!,
        locked: Number(save.lockerdata?.[id]?.t) !== 2,
      });
    } else {
      const housed = whole(save.monsters?.housed?.[id]) + (id === "C12" ? whole(save.monsters?.housed?.["C100"]) : 0);
      if (housed === 0) continue;
      rows.push({ monster, available: housed, each, price: bunkerPutty(save, id, 1), locked: false });
    }
  }
  return rows.sort((a, b) => compareListOrder(a.monster, b.monster));
};

/**
 * The most of one row the selection can hold: what is available, and what the
 * bunker's free room allows after everything else selected.
 */
export const rowMax = (
  save: BaseLoadResponse,
  row: FillRow,
  selection: Readonly<Record<string, number>>,
  free: number,
): number => {
  if (row.locked) return 0;
  const others = { ...selection };
  delete others[row.monster.id];
  const room = free - bunkerSpace(save, others);
  const byRoom = row.each > 0 ? Math.max(0, Math.floor(room / row.each)) : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(row.available ?? Number.MAX_SAFE_INTEGER, byRoom));
};
