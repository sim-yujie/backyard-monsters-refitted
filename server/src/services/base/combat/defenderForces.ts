import { BaseType } from "../../../enums/Base.js";
import { Save } from "../../../database/models/save.model.js";
import { defenderForcesOf, withAttackerBuffs, type DefenderForces } from "../../../game-rules/combat/index.js";
import { postgres } from "../../../server.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { championsHealedTo } from "../../yard/catchUpChampions.js";

/**
 * The defence an attack load serves (issue #195): the target row's bunker
 * garrisons and caged champion, at the academy levels of the player who owns
 * it, which for an outpost are its owner's main yard's (Q14). The load keeps it
 * in the attack session and hands the same to the client, so both fight one
 * defence.
 *
 * With it go the shop boosts running at attack start (beta.4): the attacked
 * row's own, off its `storedata`, and the attacker's monster boosts, off their
 * main yard's (`GLOBAL.as:816-822`). Only the shop writes those, so nothing
 * the client says can turn one on.
 *
 * The caged champion defends at the health it has healed to by `now`, not
 * the health stored at the owner's last visit: it heals in its cage while
 * the owner is away (`championsHealedTo`).
 *
 * @param save - The row being attacked.
 * @param attacker - The attacker's main yard, whose monster boosts they bring.
 * @param now - The attack's start, unix seconds.
 */
export const servedDefenderForces = async (
  save: Save,
  attacker?: Pick<Save, "storedata"> | null,
  now: number = getCurrentDateTime()
): Promise<DefenderForces> => {
  const forces = defenderForcesOf({
    buildingdata: save.buildingdata,
    academy: await defendingAcademy(save),
    champion: championsHealedTo(save.champion, Number(save.savetime), now),
    storedata: save.storedata,
    now,
    // An Inferno yard's housed monsters defend from its Housing Bunkers (Inferno WP 1.6).
    monsters: save.monsters,
    buildinghealthdata: save.buildinghealthdata,
  });
  return attacker ? withAttackerBuffs(forces, attacker.storedata, now) : forces;
};

/** The academy the row's monsters fight at: its own, or its owner's main yard's for an outpost. */
const defendingAcademy = async (save: Save): Promise<Save["academy"]> => {
  if (save.type !== BaseType.OUTPOST) return save.academy;
  const owner = await postgres.em.findOne(
    Save,
    { saveuserid: save.saveuserid, type: BaseType.MAIN },
    { fields: ["academy"] }
  );
  return owner?.academy ?? null;
};
