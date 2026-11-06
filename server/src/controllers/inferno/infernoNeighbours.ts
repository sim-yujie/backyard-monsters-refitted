import type { EntityManager } from "@mikro-orm/core";

import type { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { postgres } from "../../server.js";
import { requireInfernoEnabled } from "../../services/inferno/infernoGate.js";
import { loadInfernoNeighbours, type InfernoNeighbourView } from "../../services/inferno/infernoNeighbours.js";
import { findInfernoYard } from "../../services/inferno/infernoTribeMap.js";
import { infernoYardLevel } from "../../services/inferno/infernoTribes.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/** What `GET /bm/inferno/neighbours` answers. */
export interface InfernoNeighboursBody {
  error: 0;
  currenttime: number;
  /** The player's Inferno yard level, which the range is measured from. */
  level: number;
  neighbours: InfernoNeighbourView[];
}

/**
 * The Inferno map's other players (`docs/design/inferno.md` §2.7, §3.2, WP
 * 3.1): real players' Inferno yards within 7 levels, each with what the
 * player can do to it now (`services/inferno/infernoNeighbours.ts`).
 * `409 noInfernoYard` without an Inferno yard.
 */
export const readInfernoNeighbours = async (em: EntityManager, user: User, now: number): Promise<InfernoNeighboursBody> => {
  await em.populate(user, ["save"]);
  const yard = await findInfernoYard(em, user, user.save!);
  const level = infernoYardLevel(yard);
  const neighbours = await loadInfernoNeighbours(em, user.userid, level, now);
  return { error: 0, currenttime: now, level, neighbours };
};

export const infernoNeighbours: KoaController = async (ctx) => {
  requireInfernoEnabled();
  ctx.status = Status.OK;
  ctx.body = await readInfernoNeighbours(postgres.em, ctx.authUser, getCurrentDateTime());
};
