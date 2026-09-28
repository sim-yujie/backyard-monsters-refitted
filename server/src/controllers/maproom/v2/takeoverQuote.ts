import z from "zod";
import type { KoaController } from "../../../utils/KoaController.js";
import type { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../server.js";
import { Status } from "../../../enums/StatusCodes.js";
import { MapRoomCell, MapRoomVersion, Terrain } from "../../../enums/MapRoom.js";
import { AlliancePowerupType } from "../../../enums/Alliance.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { generateBaseId } from "../../../utils/generateBaseId.js";
import { RESOURCE_KEYS } from "../../../services/base/updateResources.js";
import { isAttackActive } from "../../../services/base/isAttackActive.js";
import { readAttackSession } from "../../../services/base/attackSessionStore.js";
import { runningPowerups } from "../../../services/alliance/powerups.js";
import { isShinyLocked } from "../../../services/user/shinyLock.js";
import { generateNoise, getTerrainHeight } from "../../../services/maproom/v2/generateMap.js";
import { cellCoordsFromBaseId, type CellCoords } from "../../../services/maproom/v2/rangeCheck.js";
import { rangeCheckV2 } from "../../../services/maproom/v2/validateRange.js";
import { quoteTakeover, type TakeoverQuote } from "../../../services/maproom/v2/takeoverCost.js";
import { takeoverRefusal, type TakeoverRefusal } from "../../../services/maproom/v2/takeoverRules.js";
import { holdsTakeoverGrant } from "../../../services/maproom/v2/takeoverGrant.js";
import { readTakeoverGrant } from "../../../services/maproom/v2/takeoverGrantStore.js";

const TakeoverQuoteSchema = z.object({
  /** The cell's base id, as the map carries it (`bid`). */
  baseid: z.string(),
});

/**
 * Why a quote says no. The takeover's own refusals (`takeoverRules.ts`), plus
 * `outOfRange`, which `takeoverCell` meets as `validateRange`'s error.
 * `notEnoughResources` and `notEnoughShiny` never appear here: the quote
 * answers them per payment in `affordable`.
 */
export type TakeoverQuoteReason = Exclude<TakeoverRefusal, "notEnoughShiny" | "notEnoughResources"> | "outOfRange";

/** The quote's answer (`docs/server-api.md`, "Takeover quote"). */
export interface TakeoverQuoteBody extends Partial<TakeoverQuote> {
  error: 0;
  baseid: string;
  /** What the cell is; absent when it could not be found. */
  kind?: "camp" | "outpost";
  /** Whether `takeoverCell` would take it now, price aside. */
  eligible: boolean;
  /** Why not, or null when eligible. */
  reason: TakeoverQuoteReason | null;
  /** Server seconds when the caller's one chance at this player outpost ends; only while it runs. */
  grantExpiresAt?: number;
  /** Whether the caller can pay each way right now. */
  affordable?: { resources: boolean; shiny: boolean };
  /** The caller has turned Shiny off (`shinyLock.ts`); the Shiny payment is refused. */
  shinyLocked?: boolean;
  /** Server seconds, so the client can count down against the server's clock. */
  now: number;
}

/** A cell the quote can price: where it is, and the rows the rules read, if any. */
type QuotedCell = CellCoords & {
  row: WorldMapCell | null;
  isWildMonster: boolean;
};

/**
 * `POST /worldmapv2/takeoverquote { baseid }` (issue #82, outposts plan WP6):
 * what taking a Map Room 2 cell over would cost the caller, and whether
 * `POST /worldmapv2/takeoverCell` would allow it right now.
 *
 * It runs the takeover's own checks on the same rows, unlocked, and prices
 * the cell with the same `quoteTakeover`, so the web client never copies the
 * rules or the formula and keeps no clock of its own: a player outpost is
 * offered only while the caller holds its one-time grant, and the answer
 * carries the grant's end for the countdown. The takeover itself checks
 * everything again under its row locks; a quote is a forecast, not a hold.
 *
 * A wild camp nobody has attacked has no `world_map_cell` row (the attack
 * creates it, issue #26). Its coordinates are in its base id, so the quote
 * still prices it and says it is not destroyed.
 *
 * @returns {TakeoverQuoteBody} Always HTTP 200; a cell that cannot be found
 * answers `eligible: false, reason: "notFound"` with no price.
 */
export const takeoverQuote: KoaController = async (ctx) => {
  const { baseid } = TakeoverQuoteSchema.parse(ctx.request.body);

  const currentUser: User = ctx.authUser;

  await postgres.em.populate(currentUser, ["save"]);

  const userSave = currentUser.save;
  const now = getCurrentDateTime();

  const refuse = (reason: TakeoverQuoteReason): TakeoverQuoteBody => ({
    error: 0,
    baseid,
    eligible: false,
    reason,
    now,
  });

  ctx.status = Status.OK;

  if (!userSave?.worldid) {
    ctx.body = refuse("notFound");
    return;
  }

  const quoted = await findQuotedCell(baseid, userSave.worldid);

  if (!quoted) {
    ctx.body = refuse("notFound");
    return;
  }

  const powerups = await runningPowerups(currentUser.alliance_id);

  const save = quoted.row?.save ?? null;

  const price = quoteTakeover({
    cell: quoted,
    isWildMonster: quoted.isWildMonster,
    empireValue: save?.empirevalue ?? 0,
    takerHomebase: userSave.homebase,
    conquestActive: powerups.some(({ id }) => id === AlliancePowerupType.CONQUEST),
  });

  let reason: TakeoverQuoteReason | null;
  let grantExpiresAt: number | undefined;

  if (quoted.row && save) {
    const grant = await readTakeoverGrant(save.basesaveid);
    const holdsGrant = holdsTakeoverGrant(grant, currentUser.userid, now);

    if (holdsGrant) grantExpiresAt = grant!.expiresAt;

    reason = takeoverRefusal({
      takerId: currentUser.userid,
      outpostCount: userSave.outposts.length,
      now,
      cell: quoted.row,
      save,
      underAttack: isAttackActive(save) || (await readAttackSession(save.basesaveid)) !== null,
      holdsGrant,
    }) as TakeoverQuoteReason | null;
  } else {
    // Never attacked, so never destroyed.
    reason = "notDestroyed";
  }

  if (reason === null) {
    const { verdict } = await rangeCheckV2(currentUser, { cell: quoted });

    if (!verdict.ok) reason = "outOfRange";
  }

  const owned = userSave.resources ?? {};
  const shinyLocked = isShinyLocked(currentUser);

  const body: TakeoverQuoteBody = {
    error: 0,
    baseid,
    kind: quoted.isWildMonster ? "camp" : "outpost",
    eligible: reason === null,
    reason,
    ...price,
    affordable: {
      resources: RESOURCE_KEYS.every((key) => Number(owned[key] ?? 0) >= price.resources),
      shiny: !shinyLocked && Number(userSave.credits ?? 0) >= price.shiny,
    },
    shinyLocked,
    now,
  };

  if (grantExpiresAt !== undefined) body.grantExpiresAt = grantExpiresAt;

  ctx.body = body;
};

/**
 * The cell behind a base id in the caller's world: its row when it has one,
 * or, for a wild camp nobody has attacked yet, its coordinates from the id.
 * Null for an id that is not a cell of this world, or names water.
 *
 * @param {string} baseid - The base id.
 * @param {string} worldid - The caller's world.
 * @returns {Promise<QuotedCell | null>} The cell, or null.
 */
const findQuotedCell = async (baseid: string, worldid: string): Promise<QuotedCell | null> => {
  const row = await postgres.em.findOne(
    WorldMapCell,
    { baseid, world: worldid, map_version: MapRoomVersion.V2 },
    { populate: ["save"] }
  );

  if (row) {
    // A player's cell without its save cannot be priced or taken.
    if (row.base_type !== MapRoomCell.WM && !row.save) return null;

    return { x: row.x, y: row.y, row, isWildMonster: row.base_type === MapRoomCell.WM };
  }

  const coords = cellCoordsFromBaseId(baseid);

  if (!coords || generateBaseId(worldid, coords.x, coords.y) !== baseid) return null;

  if (getTerrainHeight(generateNoise(worldid), coords.x, coords.y) <= Terrain.WATER3) return null;

  return { ...coords, row: null, isWildMonster: true };
};
