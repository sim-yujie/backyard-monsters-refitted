import type { EntityManager } from "@mikro-orm/core";

import type { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { infernoAttackRefusedErr } from "../../errors/errors.js";
import { postgres } from "../../server.js";
import { mapSaveData } from "../../services/base/mapSaveData.js";
import { requireInfernoEnabled } from "../../services/inferno/infernoGate.js";
import { attackedAt } from "../../services/inferno/infernoNeighbours.js";
import { infernoYardLevel } from "../../services/inferno/infernoTribes.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";
import { targetYard } from "./playerAttack.js";

/** What `POST /bm/inferno/view` answers: the yard as a visitor may see it. */
export type InfernoViewBody = Partial<Save> & {
  error: 0;
  currenttime: number;
  /** The yard's Inferno level. */
  level: number;
  /** The owner's name. */
  ownername: string;
};

/**
 * `POST /bm/inferno/view` `{ baseid }` (`docs/design/inferno.md` §2.7, WP
 * 3.4): another player's Inferno yard, to look at only, as Flash's `iview`
 * opened it from the Inferno map (`maproom_inferno/PlayerHandler.as` View).
 * The yard as stored, masked as every look at someone else's yard is
 * (`viewMask.ts`: no traps, art levels only, health re-measured), and nothing
 * written. No replays (owner, 27 Oct).
 *
 * Refused (`infernoAttackRefusedErr`, 409) for a base that is not another
 * real player's live Inferno yard (`notInfernoPlayer`), and while it is being
 * attacked (`targetUnderAttack`), when Flash greyed View out.
 */
export const viewInfernoYard = async (
  em: EntityManager,
  user: User,
  baseid: string,
  now: number
): Promise<InfernoViewBody> => {
  const { yard } = await targetYard(em, user, baseid);
  if (attackedAt(yard, now)) {
    throw infernoAttackRefusedErr("targetUnderAttack", { attacker: yard.attacks.at(-1)?.name ?? "" });
  }

  const owner = await em.findOne(User, { userid: yard.userid }, { fields: ["username"] });
  return {
    ...(await mapSaveData(yard, user)),
    error: 0,
    currenttime: now,
    level: infernoYardLevel(yard),
    ownername: owner?.username ?? "",
  };
};

export const infernoView: KoaController = async (ctx) => {
  requireInfernoEnabled();
  const body = (ctx.request.body ?? {}) as { baseid?: unknown };
  ctx.status = Status.OK;
  ctx.body = await viewInfernoYard(postgres.em, ctx.authUser, String(body.baseid ?? ""), getCurrentDateTime());
};
