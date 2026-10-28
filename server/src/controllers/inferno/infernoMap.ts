import type { EntityManager } from "@mikro-orm/core";

import type { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { postgres } from "../../server.js";
import { requireInfernoEnabled } from "../../services/inferno/infernoGate.js";
import {
  findInfernoYard,
  infernoTribeViews,
  loadInfernoTribes,
  type InfernoTribeView,
} from "../../services/inferno/infernoTribeMap.js";
import { infernoYardLevel } from "../../services/inferno/infernoTribes.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/** What `GET /bm/inferno/map` answers. */
export interface InfernoMapBody {
  error: 0;
  currenttime: number;
  /** The Inferno yard's level, which picks the tribes. */
  level: number;
  tribes: InfernoTribeView[];
}

/**
 * The Inferno map's Moloch tribes (`docs/design/inferno.md` §2.7, §3.2, WP
 * 2.7): the seven the player's Inferno yard faces at its level, each with its
 * map level, whether it lies wrecked and until when. Respawns that are due
 * are written. `409 noInfernoYard` without an Inferno yard. The PvP
 * neighbours are WP 3.1.
 */
export const readInfernoMap = async (em: EntityManager, user: User, now: number): Promise<InfernoMapBody> => {
  await em.populate(user, ["save"]);
  const yard = await findInfernoYard(em, user, user.save!);
  const level = infernoYardLevel(yard);
  const tribes = await loadInfernoTribes(em, user.userid, level, now);
  if (tribes.changed) await em.flush();
  return { error: 0, currenttime: now, level, tribes: infernoTribeViews(tribes) };
};

export const infernoMap: KoaController = async (ctx) => {
  requireInfernoEnabled();
  ctx.status = Status.OK;
  ctx.body = await readInfernoMap(postgres.em, ctx.authUser, getCurrentDateTime());
};
