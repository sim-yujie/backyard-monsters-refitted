import { LockMode, type EntityManager } from "@mikro-orm/core";

import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { Status } from "../../enums/StatusCodes.js";
import { noInfernoYardErr } from "../../errors/errors.js";
import { postgres } from "../../server.js";
import { isAttackActive } from "../../services/base/isAttackActive.js";
import { requireInfernoEnabled } from "../../services/inferno/infernoGate.js";
import {
  infernoPurse,
  infernoStorageCap,
  syncInfernoCap,
  type InfernoPurse,
} from "../../services/inferno/infernoLoad.js";
import { catchUpYard } from "../../services/yard/catchUp.js";
import { visibleCredits } from "../../services/user/shinyLock.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/** What `POST /bm/inferno/load` answers: the yard, caught up, with the purse. */
export type InfernoLoadBody = Record<string, unknown> & {
  error: 0;
  id: number;
  baseid: string;
  currenttime: number;
  credits: number;
  resources: InfernoPurse;
};

/**
 * Locks the caller's own Inferno yard: the one their main save names
 * (`baseid_inferno`), of the Inferno type and theirs. `409 noInfernoYard`
 * when there is none: the route never makes one (the 13th Descent win does).
 */
const lockInfernoYard = async (em: EntityManager, main: Save, user: User): Promise<Save> => {
  const baseid = Number(main.baseid_inferno);
  if (!(baseid > 0)) throw noInfernoYardErr();
  const yard = await em.findOne(
    Save,
    { baseid: String(baseid) },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
  );
  if (!yard || yard.type !== BaseType.INFERNO || yard.userid !== user.userid) throw noInfernoYardErr();
  return yard;
};

/**
 * Loads the caller's Inferno yard (`docs/design/inferno.md` §3.2, WP 1.14):
 * under its row lock, the harvesters catch up to `now` and the row is written
 * (skipped while the yard is being attacked: the attack owns the row then),
 * and the answer carries the purse, the main save's `iresources`, with the
 * Inferno cap. Own yard only: no base id is read from the request.
 */
export const loadInfernoYard = async (em: EntityManager, user: User, now: number): Promise<InfernoLoadBody> => {
  await em.populate(user, ["save"]);
  const main = user.save;
  if (!main || !(Number(main.baseid_inferno) > 0)) throw noInfernoYardErr();

  const { yard, purse } = await em.transactional(async (tx) => {
    // The main row first, as the yard actions lock them: the main yard's
    // Inferno caps are written into its `iresources` below.
    const lockedMain =
      (await tx.findOne(
        Save,
        { basesaveid: main.basesaveid },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
      )) ?? main;
    const locked = await lockInfernoYard(tx, lockedMain, user);
    if (!isAttackActive(locked)) {
      catchUpYard(locked, now);
      syncInfernoCap(lockedMain, locked);
      await tx.flush();
    }
    return { yard: locked, purse: lockedMain.iresources };
  });

  const cap = infernoStorageCap(yard);
  return {
    ...FilterFrontendKeys(yard),
    error: 0,
    id: yard.basesaveid,
    baseid: String(yard.baseid),
    currenttime: now,
    // Shiny is the player's, shared with the main yard.
    credits: visibleCredits(user, Number(main.credits) || 0),
    resources: infernoPurse(purse, cap),
  };
};

export const infernoLoad: KoaController = async (ctx) => {
  requireInfernoEnabled();
  ctx.status = Status.OK;
  ctx.body = await loadInfernoYard(postgres.em, ctx.authUser, getCurrentDateTime());
};
