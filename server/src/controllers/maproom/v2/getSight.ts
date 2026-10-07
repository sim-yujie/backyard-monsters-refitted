import type { KoaController } from "../../../utils/KoaController.js";
import { User } from "../../../database/models/user.model.js";
import { devConfig } from "../../../config/GameConfig.js";
import { Status } from "../../../enums/StatusCodes.js";
import { mapRoomDisabledErr } from "../../../errors/errors.js";
import { getPlayerSight } from "../../../services/maproom/sight/sightService.js";

/**
 * `POST /worldmapv2/sight` (issue #330, `docs/design/fog-of-war.md` §5.2):
 * the caller's whole Map Room 2 fog of war sight — every sight circle and
 * every always-visible cell — so the client can draw the fog edge and the
 * minimap without waiting on individual `getarea` zones, and skip a zone
 * entirely outside it with no request at all.
 *
 * Everything this returns is already visible to the caller (`isVisible`
 * would answer true for all of it, `game-rules/maproom/sight.ts`), so
 * nothing here leaks a cell `getarea` would not already show them.
 *
 * The design's suggested shape (§5.2) tags each source `own`/`ally` and each
 * revealed cell with its owner's `uid`, for the minimap's two-tint drawing
 * (§7). `sightService.ts`'s `getPlayerSight` does not track that split
 * today — it only ever needed the merged list for `isVisible` — so this
 * starts without it. Neither tag is security-relevant (the design says so
 * directly), so #331, the first real client of this route, can add the
 * split later with no change to what is or is not revealed here.
 *
 * @param {Context} ctx - The Koa request/response context object.
 * @returns {Promise<void>} A promise that resolves when the sight is sent.
 */
export const getSight: KoaController = async (ctx) => {
  if (!devConfig.maproom) throw mapRoomDisabledErr();

  const user: User = ctx.authUser;
  const sight = await getPlayerSight(user);

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    sv: sight.sv,
    sources: sight.sources,
    revealed: sight.revealed,
  };
};
