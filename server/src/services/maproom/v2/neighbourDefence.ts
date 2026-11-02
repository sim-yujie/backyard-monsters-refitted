import { MapRoom2, MapRoomCell, MapRoomVersion, Terrain } from "../../../enums/MapRoom.js";
import { Tribes } from "../../../enums/Tribes.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../server.js";
import { generateNoise, getTerrainHeight } from "./generateMap.js";

/**
 * Map Room 2's neighbour defence bonus (`docs/mr2-neighbours.md`): how many
 * friendly cells sit around the cell under attack.
 *
 * - A player's cell (main yard or outpost) counts that player's own cells.
 * - A wild monster camp counts the camps of its own tribe. A camp's tribe is
 *   `(x + y) % 4` (`wildMonsterCell.ts`), and on Map Room 2's odd-q grid only
 *   one of the six neighbours shares that sum, so a camp has at most one
 *   same-tribe neighbour: 0 when that cell is water or a player's.
 *
 * The bonus each count gives is the combat rules' `neighbourDefenceBonus`.
 */

/** A cell's position. */
export interface CellAt {
  readonly x: number;
  readonly y: number;
}

/** A stored world map cell around the target, as far as the count reads it. */
export interface StoredNeighbour extends CellAt {
  readonly uid: number;
  readonly base_type: number;
  readonly terrainHeight?: number | null;
}

/** The cell under attack. */
export interface TargetCell extends CellAt {
  readonly uid: number;
  readonly base_type: number;
}

const wrap = (value: number, size: number): number => ((value % size) + size) % size;

/**
 * The six cells around `(x, y)` on Map Room 2's wrapping odd-q grid: the two
 * above and below in its column, and in each side column the one on its row
 * and the one a row up (even column) or down (odd column). The same adjacency
 * as `isAdjacentToMainYard` (`PopupTakeover.as:62-75`). The world is 800 wide,
 * an even number, so a wrapped column keeps its parity.
 */
export const mr2NeighbourCoords = (x: number, y: number): CellAt[] => {
  const side = x % 2 === 0 ? y - 1 : y + 1;
  return [
    [x, y - 1],
    [x, y + 1],
    [x - 1, y],
    [x + 1, y],
    [x - 1, side],
    [x + 1, side],
  ].map(([cx, cy]) => ({ x: wrap(cx!, MapRoom2.WIDTH), y: wrap(cy!, MapRoom2.HEIGHT) }));
};

/** Whether a stored cell is a player's main yard or outpost. */
const isPlayerCell = (cell: { uid: number; base_type: number }): boolean =>
  cell.base_type >= MapRoomCell.HOMECELL && cell.uid > 0;

/** A camp's tribe, by its coordinates (`wildMonsterCell.ts`). */
const tribeOf = (cell: CellAt): number => (cell.x + cell.y) % Tribes.length;

/**
 * How many friendly cells sit around `target`, 0 to 6.
 *
 * @param target - The cell under attack.
 * @param stored - The stored world map cells at its neighbours' positions (any others are ignored).
 * @param heightAt - The terrain height of a cell with no stored row (the world's noise).
 * @param playersOnly - Count for players' cells only: a camp then has none (`MR2_NEIGHBOUR_BONUS=players`).
 */
export const friendlyNeighbourCount = (
  target: TargetCell,
  stored: readonly StoredNeighbour[],
  heightAt: (x: number, y: number) => number,
  playersOnly = false
): number => {
  const rows = new Map(stored.map((cell) => [`${cell.x},${cell.y}`, cell]));
  const around = mr2NeighbourCoords(target.x, target.y);

  if (isPlayerCell(target)) {
    return around.filter(({ x, y }) => {
      const row = rows.get(`${x},${y}`);
      return row !== undefined && isPlayerCell(row) && row.uid === target.uid;
    }).length;
  }

  if (playersOnly || target.base_type !== MapRoomCell.WM) return 0;
  const tribe = tribeOf(target);
  return around.filter(({ x, y }) => {
    const row = rows.get(`${x},${y}`);
    if (row && isPlayerCell(row)) return false;
    const height = row?.terrainHeight ?? heightAt(x, y);
    if (height <= Terrain.WATER3) return false;
    return tribeOf({ x, y }) === tribe;
  }).length;
};

/**
 * The friendly neighbours of a Map Room 2 cell under attack, read from the
 * world's stored cells and its terrain noise.
 *
 * @param target - The attacked cell.
 * @param worldid - The world it is in.
 * @param playersOnly - Count for players' cells only.
 */
export const loadFriendlyNeighbourCount = async (
  target: TargetCell,
  worldid: string,
  playersOnly = false
): Promise<number> => {
  if (playersOnly && !isPlayerCell(target)) return 0;
  const around = mr2NeighbourCoords(target.x, target.y);
  const stored = await postgres.em.find(
    WorldMapCell,
    {
      $and: [
        { $or: around.map(({ x, y }) => ({ x, y })) },
        { map_version: MapRoomVersion.V2 },
        { world: worldid },
      ],
    },
    { fields: ["x", "y", "uid", "base_type", "terrainHeight"] }
  );
  let noise: ReturnType<typeof generateNoise> | undefined;
  const heightAt = (x: number, y: number): number => {
    noise ??= generateNoise(worldid);
    return getTerrainHeight(noise, x, y);
  };
  return friendlyNeighbourCount(target, stored, heightAt, playersOnly);
};
