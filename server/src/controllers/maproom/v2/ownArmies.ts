import type { KoaController } from "../../../utils/KoaController.js";
import { postgres } from "../../../server.js";
import { Save } from "../../../database/models/save.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import type { User } from "../../../database/models/user.model.js";
import { Status } from "../../../enums/StatusCodes.js";
import { BaseType } from "../../../enums/Base.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { catchUpArmyRow } from "../../../services/yard/armies.js";
import { housedCounts } from "../../../services/monsters/transferRules.js";
import { housingCapacityNow, housingExpansionActive } from "../../../services/yard/housing.js";
import { isAttackActive } from "../../../services/base/isAttackActive.js";

/**
 * `POST /worldmapv2/ownarmies` (beta 9 #7): every one of the caller's yards on
 * the main yard's world — the main yard and each outpost — with what it houses
 * and how much room it has, for the world map's move tray. The map's own cells
 * carry `m` only for the zones loaded, and a big empire's 200+ outposts are
 * never all loaded, so the tray asks here once when a move starts.
 *
 * Read only: each roster is caught up in memory (as the map's `m`,
 * `monstersForMap`), and the room is the housing the yard's own buildings give
 * (`deriveHousingCapacity`, what the transfer rules measure), never the
 * client's `space`. `attack` marks a yard with an attack running, which the
 * move refuses.
 */

/** One own yard as the tray shows it. */
export interface OwnArmyYard {
  baseid: string;
  main: boolean;
  x: number;
  y: number;
  housed: Record<string, number>;
  capacity: number;
  attack: boolean;
}

const FIELDS = [
  "basesaveid",
  "baseid",
  "saveuserid",
  "type",
  "savetime",
  "monsters",
  "buildingdata",
  "buildinghealthdata",
  "storedata",
  "academy",
  "resources",
  "outposts",
  "mapversion",
  "points",
  "attackid",
  "attacks",
] as const;

export const ownArmies: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"]);
  const main = user.save;
  if (!main) {
    ctx.status = Status.OK;
    ctx.body = { error: 0, yards: [] };
    return;
  }

  const rows = await postgres.em.find(
    Save,
    { saveuserid: user.userid, type: { $in: [BaseType.MAIN, BaseType.OUTPOST] } },
    { fields: [...FIELDS] }
  );
  const cells = await postgres.em.find(WorldMapCell, { baseid: { $in: rows.map((row) => row.baseid) } });
  const cellOf = new Map(cells.map((cell) => [cell.baseid, cell]));
  const world = cellOf.get(main.baseid)?.world?.uuid;
  const now = getCurrentDateTime();
  const boosted = housingExpansionActive(main.storedata, now);

  const yards: OwnArmyYard[] = [];
  for (const row of rows) {
    const cell = cellOf.get(row.baseid);
    // Only the main yard's world: a move never crosses worlds (transferMonsters.ts).
    if (!cell || (world !== undefined && cell.world?.uuid !== world)) continue;
    const isMain = row.type === BaseType.MAIN;
    const army = catchUpArmyRow(row, isMain ? row : main, now);
    yards.push({
      baseid: row.baseid,
      main: isMain,
      x: cell.x,
      y: cell.y,
      housed: housedCounts(army.monsters),
      // Housing that finished while the yard was closed counts (patch, 24 Nov 2026).
      capacity: housingCapacityNow(row, boosted || housingExpansionActive(row.storedata, now), now),
      attack: isAttackActive(row),
    });
  }
  // The main yard first, then the outposts in the order they were taken.
  yards.sort((a, b) => Number(b.main) - Number(a.main));

  ctx.status = Status.OK;
  ctx.body = { error: 0, yards };
};
