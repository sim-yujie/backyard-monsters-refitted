import type { User } from "../../../database/models/user.model.js";
import { postgres } from "../../../server.js";
import { allianceBonusesOfUser } from "../../alliance/allianceBonuses.js";
import { flingerLevelsNow } from "../../yard/flingerLevelsNow.js";
import { outpostsNearCell, yardsInReach, type CellCoords } from "./rangeCheck.js";

/**
 * The player's own yards whose flinger reaches a Map Room 2 cell
 * (`yardsInReach`), measured as the range check measures them
 * (`rangeCheckV2`): every flinger at its level as of now, plus the alliance's
 * extra reach. The yards an attack on the cell may fling from, and so the
 * only ones its roster counts and spends (`catchUpArmiesForAttack`, the
 * auto-attack's `housedFor`).
 *
 * @param user - The player, with their main save populated.
 * @param cell - The cell under attack.
 * @returns Base ids, the main yard's first when it reaches.
 */
export const ownYardsInReach = async (user: User, cell: CellCoords): Promise<string[]> => {
  const { baseid, homebase, outposts, flinger: storedFlinger } = user.save!;
  const extraReach = user.alliance_id ? (await allianceBonusesOfUser(postgres.em, user.userid)).reach : 0;
  const near = outpostsNearCell(cell, outposts ?? [], extraReach);
  const levels = await flingerLevelsNow([baseid, ...near.map((outpost) => outpost.baseid)]);
  return yardsInReach({
    mainBaseid: baseid,
    homebase,
    flinger: levels.has(baseid) ? levels.get(baseid) : storedFlinger,
    cell,
    outposts,
    outpostFlingers: levels,
    extraReach,
  });
};
