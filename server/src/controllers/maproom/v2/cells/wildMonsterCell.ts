import type { Loaded } from "@mikro-orm/core";
import { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import { Tribes } from "../../../../enums/Tribes.js";
import { calculateTribeLevel } from "../../../../services/maproom/v2/calculateTribeLevel.js";
import { MapRoomCell } from "../../../../enums/MapRoom.js";
import { generateBaseId } from "../../../../utils/generateBaseId.js";
import { getCurrentDateTime } from "../../../../utils/getCurrentDateTime.js";
import { isWildMonsterExpired } from "../../../../services/maproom/wildMonsterExpiry.js";

export type WildMonsterCellFields =
  | "*"
  | "save.damage"
  | "save.destroyed"
  | "save.savetime"
  | "save.wmid";

type Cell = Loaded<WorldMapCell, "save", WildMonsterCellFields>;

export const wildMonsterCell = async (cell: Cell, worldId: string) => {
  const [cellX, cellY] = [cell.x, cell.y];

  const tribeIndex = (cellX + cellY) % Tribes.length;
  const tribe = Tribes[tribeIndex];

  const level = calculateTribeLevel(cell.x, cell.y, tribe);

  const baseid = generateBaseId(worldId, cellX, cellY);

  // A camp regenerates 12 hours after its last save, so report an expired one as
  // untouched rather than echoing the stored damage. getarea is a read, so the row
  // is left alone - baseModeView deletes and regenerates it when the yard is opened.
  const expired = isWildMonsterExpired(cell?.save, getCurrentDateTime());

  return {
    uid: 0,
    b: MapRoomCell.WM,
    i: cell.terrainHeight,
    bid: baseid,
    n: Tribes[tribeIndex],
    l: level,
    dm: expired ? 0 : cell?.save?.damage || 0,
    d: expired ? 0 : cell?.save?.destroyed || 0,
  };
};
