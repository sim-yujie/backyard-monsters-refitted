import {
  CellType,
  isPlayerCell,
  isWaterCell,
  type AreaCellGrid,
  type BaseLoadResponse,
  type ChampionSaveEntry,
  type MapCell,
  type PlayerCell,
} from "@/api/types";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import type { OffsetCell } from "@/game/HexGrid";
import type {
  AttackRoster,
  AttackTargetKind,
  RosterSource,
  SiegeInventory,
} from "./attackTarget";

/**
 * Whether a map cell can be attacked, and with what.
 *
 * The client-side half of the attack gate (`docs/design/attack-flow.md` §F1;
 * `docs/specs/maproom2.md:365-379` for the Flash client's own checks). Every
 * rule here is also enforced by the server (`baseModeAttack.ts:71-104`,
 * `docs/server-api.md:388-394`), so this is UX — a button that says why it is
 * off — and never the authority. A refusal the client misses still comes back
 * from the server and is shown the same way.
 *
 * Pure, and read only from what the map already holds: the cell payloads in
 * the loaded zones and the player's own save from the map's opening
 * `loadOwnYard`. Nothing here fetches.
 */

/**
 * Cells of extra reach the server always grants (`rangeCheck.ts:23`, `:79`).
 *
 * The server adds Declare War's two cells whether or not the powerup is
 * running; the Flash client added them only when it was
 * (`POWERUPS.as:341-344`). This gate mirrors the server, because the server is
 * what decides — offering a cell the server would then refuse is the worse
 * error, and no cell the server accepts is hidden.
 */
export const DECLARE_WAR_RANGE = 2;

/** Reach of a main yard's flinger by level (`rangeCheck.ts:87-104`). */
export const mainYardReach = (flinger: number): number => {
  if (flinger <= 0) return 0;
  return [0, 4, 6, 8, 10][Math.min(flinger, 4)]!;
};

/** Reach of an outpost's flinger by level (`rangeCheck.ts:111-128`). */
export const outpostReach = (flinger: number): number => {
  if (flinger <= 0) return 0;
  return Math.min(flinger, 4);
};

/** How far one of the player's own cells can fling, Declare War included. */
export const cellReach = (cell: PlayerCell): number => {
  const base = cell.b === CellType.OUTPOST ? outpostReach(cell.f) : mainYardReach(cell.f);
  return base > 0 ? base + DECLARE_WAR_RANGE : 0;
};

/**
 * Square (Chebyshev) distance on the toroidal grid, which is what the server's
 * range rule measures (`rangeCheck.ts:136-158`) — not the hex distance the map
 * is drawn with.
 */
export const cellDistance = (a: OffsetCell, b: OffsetCell): number => {
  const dx = Math.abs(a.col - b.col);
  const dy = Math.abs(a.row - b.row);
  return Math.max(Math.min(dx, WORLD_WIDTH - dx), Math.min(dy, WORLD_HEIGHT - dy));
};

/** One of the player's own cells, with where it is. */
export interface OwnCell {
  readonly col: number;
  readonly row: number;
  readonly cell: PlayerCell;
}

/** Every cell marked `mine` across the loaded zones. */
export const ownCellsIn = (zones: Iterable<{ data: AreaCellGrid }>): OwnCell[] => {
  const own: OwnCell[] = [];
  for (const zone of zones) {
    for (const [x, column] of Object.entries(zone.data)) {
      for (const [y, cell] of Object.entries(column)) {
        if (isPlayerCell(cell) && cell.mine === 1) {
          own.push({ col: Number(x), row: Number(y), cell });
        }
      }
    }
  }
  return own;
};

/** Which load mode family a cell payload takes. */
export const targetKind = (payload: MapCell): AttackTargetKind | null => {
  if (isWaterCell(payload)) return null;
  if (payload.b === CellType.WILD_MONSTER) return "wild";
  return payload.b === CellType.OUTPOST ? "outpost" : "main";
};

/** Owner username, or a wild monster camp's tribe name. */
export const targetName = (payload: MapCell): string =>
  isWaterCell(payload) ? "Water" : payload.n;

/**
 * What the player can fling at `target`: the housed monsters of every own cell
 * whose flinger reaches it, summed per type
 * (`PopupAttackA.as:214-239`; `docs/specs/combat.md:278-286`).
 *
 * `ownSave` is the map's own-yard load, which carries the champions, the
 * academy levels, the catapult and the siege inventory; all belong to the
 * player, not to any one cell.
 *
 * `sources` keeps each contributing cell's whole `m` blob, keyed by its base
 * id, because the attack save has to write the cell's housing back in full
 * (see `RosterSource`). Ordered by base id so two builds from the same zones
 * agree regardless of which zone arrived first.
 */
export const rosterInRange = (
  target: OffsetCell,
  ownCells: readonly OwnCell[],
  ownSave:
    | (Pick<BaseLoadResponse, "champion" | "academy" | "catapult"> & { siege?: unknown })
    | null,
): AttackRoster => {
  const monsters: Record<string, number> = {};
  const sources: RosterSource[] = [];
  let flingerLevel = 0;

  for (const own of ownCells) {
    const reach = cellReach(own.cell);
    if (reach === 0 || cellDistance(own, target) > reach) continue;
    flingerLevel = Math.max(flingerLevel, own.cell.f);

    const m = own.cell.m;
    if (typeof m !== "object" || m === null) continue;
    sources.push({ baseid: own.cell.bid, m });

    const housed = m["housed"];
    if (typeof housed !== "object" || housed === null) continue;
    for (const [id, count] of Object.entries(housed as Record<string, unknown>)) {
      if (typeof count !== "number" || count <= 0) continue;
      monsters[id] = (monsters[id] ?? 0) + count;
    }
  }
  sources.sort((a, b) => (a.baseid < b.baseid ? -1 : a.baseid > b.baseid ? 1 : 0));

  const levels: Record<string, number> = {};
  for (const [id, entry] of Object.entries(ownSave?.academy ?? {})) {
    if (typeof entry?.level === "number") levels[id] = entry.level;
  }

  const siege = ownSave?.siege;

  return {
    monsters,
    levels,
    champions: ownSave?.champion ?? [],
    flingerLevel,
    catapultLevel: ownSave?.catapult ?? 0,
    sources,
    siege: typeof siege === "object" && siege !== null ? (siege as SiegeInventory) : null,
  };
};

/** A champion that may be flung (`combat.md:750-751`). */
export const isHealthyChampion = (champion: ChampionSaveEntry): boolean =>
  champion.hp > 0 && champion.status === 0;

/** True when the roster holds at least one monster or a healthy champion. */
export const hasAnythingToSend = (roster: AttackRoster): boolean =>
  Object.values(roster.monsters).some((count) => count > 0) ||
  roster.champions.some(isHealthyChampion);

/**
 * Why Attack is not offered on this cell, or null when it is.
 *
 * The order is the Flash client's (`maproom2.md:365-379`), minus the feature
 * flag (the server no longer reads one) and the two confirmation prompts,
 * which do not block. The wording is what the button shows.
 */
export const attackRefusal = (
  payload: MapCell | undefined,
  roster: AttackRoster,
  nowSeconds: number,
): string | null => {
  if (!payload) return "Waiting for this zone to load.";
  if (isWaterCell(payload)) return "Water cannot be attacked.";
  if (isPlayerCell(payload)) {
    if (payload.mine === 1) return "This is your own yard.";
    if (payload.p === 1) return "This yard is under damage protection.";
    if (payload.t !== undefined && payload.t > nowSeconds) return "You have a truce with this player.";
  }
  if (roster.flingerLevel === 0) return "None of your flingers can reach this cell.";
  if (!hasAnythingToSend(roster)) return "You have no monsters or healthy champion in range.";
  return null;
};
