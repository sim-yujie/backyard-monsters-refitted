import type { Save } from "../../../database/models/save.model.js";
import { takeoverPercent } from "../../alliance/allianceBonuses.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { postgres } from "../../../server.js";
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
 * @param {Save} takerSave - The attacker's main save, for the adjacency half.
 * @param {Save} outpost - The outpost, whose buildings set its price.
 * @returns {Promise<TakeoverOffer>} The offer.
 */
export const takeoverOffer = async (
  grant: TakeoverGrant,
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

  return {
    ...offer,
    ...quoteTakeover({
      cell,
      isWildMonster: false,
      buildingdata: outpost.buildingdata,
      takerHomebase: takerSave.homebase,
      alliancePercent: await takeoverPercent(postgres.em, takerSave.saveuserid, outpost.saveuserid),
    }),
  };
};
