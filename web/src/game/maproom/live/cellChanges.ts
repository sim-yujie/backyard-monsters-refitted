import { isPlayerCell, type AreaCellGrid, type MapCell } from "@/api/types";

/**
 * What a live answer changed on the map (beta 9): the cells whose drawn
 * state differs from the copy the map held, and what kind of change each is,
 * for the growing ring (`CellRings.ts`) and the open panel. Fields only the
 * owner's panels read (`r`, `m`, `nh`) never count, as in `ZoneStore.drawnKey`.
 */

export type LiveChangeKind = "taken" | "attack" | "attackEnd" | "shield" | "shieldEnd" | "minor";

export interface CellChange {
  col: number;
  row: number;
  kind: LiveChangeKind;
}

const UNDRAWN = new Set(["r", "m", "nh"]);

const drawnText = (cell: MapCell | undefined): string =>
  cell === undefined ? "" : JSON.stringify(cell, (key, value) => (UNDRAWN.has(key) ? undefined : value));

/** The kind of change between two copies of one cell, or null when nothing drawn moved. */
export const changeOf = (before: MapCell | undefined, after: MapCell | undefined): LiveChangeKind | null => {
  if (before === undefined || after === undefined) return null;
  if (drawnText(before) === drawnText(after)) return null;
  const wasPlayer = isPlayerCell(before);
  const isPlayer = isPlayerCell(after);
  if (wasPlayer !== isPlayer) return "taken";
  if (wasPlayer && isPlayer) {
    if (before.uid !== after.uid || before.b !== after.b) return "taken";
    const attacked = (before.atk ?? 0) > 0;
    const attacking = (after.atk ?? 0) > 0;
    if (attacked !== attacking) return attacking ? "attack" : "attackEnd";
    if (before.p !== after.p) return after.p === 1 ? "shield" : "shieldEnd";
  }
  return "minor";
};

/**
 * Every changed cell of a zone's answer that belongs to that zone (`originX..originX+9`): a cell
 * on the shared edge is judged by its own zone's answer, so it rings once.
 */
export const zoneChanges = (
  originX: number,
  originY: number,
  before: AreaCellGrid,
  after: AreaCellGrid,
  size = 10,
): CellChange[] => {
  const out: CellChange[] = [];
  for (let col = originX; col < originX + size; col++) {
    for (let row = originY; row < originY + size; row++) {
      const kind = changeOf(before[String(col)]?.[String(row)], after[String(col)]?.[String(row)]);
      if (kind) out.push({ col, row, kind });
    }
  }
  return out;
};
