import type { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { AlliancePowerupType } from "../../../enums/Alliance.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { postgres } from "../../../server.js";
import { runningPowerups } from "../../alliance/powerups.js";
import { cellCoordsFromBaseId } from "./rangeCheck.js";
import { quoteTakeover, type TakeoverQuote } from "./takeoverCost.js";
import type { TakeoverGrant } from "./takeoverGrant.js";

/** A takeover grant as the client sees it: when the chance ends and what it costs. */
export interface TakeoverOffer extends Partial<TakeoverQuote> {
  baseid: string;
  /** Server seconds when the chance ends. */
  expiresAt: number;
}

/**
 * What the attacker needs to act on a grant: its end and the price, worked out
 * as `takeoverCell` will charge it (`takeoverCost.ts`). The final save of the
 * attack answers with this (`takeovergrant`), and a takeover quote route can
 * answer with it too. The price is left out only if the outpost's cell cannot
 * be placed, which the takeover itself would refuse anyway.
 *
 * @param {TakeoverGrant} grant - The grant.
 * @param {User} taker - The attacker who holds it.
 * @param {Save} takerSave - The attacker's main save, for the adjacency half.
 * @param {Save} outpost - The outpost, for its empire value.
 * @returns {Promise<TakeoverOffer>} The offer.
 */
export const takeoverOffer = async (
  grant: TakeoverGrant,
  taker: User,
  takerSave: Save,
  outpost: Save
): Promise<TakeoverOffer> => {
  const offer: TakeoverOffer = { baseid: grant.baseid, expiresAt: grant.expiresAt };

  const cell =
    (await postgres.em.findOne(
      WorldMapCell,
      { baseid: outpost.baseid, map_version: MapRoomVersion.V2 },
      { fields: ["x", "y"] }
    )) ?? cellCoordsFromBaseId(outpost.baseid);

  if (!cell) return offer;

  const powerups = await runningPowerups(taker.alliance_id);

  return {
    ...offer,
    ...quoteTakeover({
      cell,
      isWildMonster: false,
      empireValue: outpost.empirevalue,
      takerHomebase: takerSave.homebase,
      conquestActive: powerups.some(({ id }) => id === AlliancePowerupType.CONQUEST),
    }),
  };
};
