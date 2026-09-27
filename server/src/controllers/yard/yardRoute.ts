import type z from "zod";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import type { KoaController } from "../../utils/KoaController.js";
import { catchUpLockedYard, runYardAction, type YardAction } from "./yardAction.js";

/**
 * `yardRoute(action)`: a yard action as a Koa controller, run against the
 * request's `postgres.em` (`docs/design/yard-buildings.md` §2.1). Everything
 * it does is in `yardAction.ts`; this file only binds it to Koa.
 *
 * FROZEN (2026-09-27): `yardRoute(action: YardAction<Schema, Report>): KoaController`.
 */
export const yardRoute =
  <Schema extends z.ZodType, Report>(action: YardAction<Schema, Report>): KoaController =>
  async (ctx) => {
    const user: User = ctx.authUser;
    const answer = await runYardAction(postgres.em, user, action, ctx.request.body);

    ctx.status = answer.status;
    ctx.body = answer.body;
  };

/**
 * The catch-up on the owner's build-mode `/base/load` of their main yard,
 * locked and written (`catchUpLockedYard`).
 */
export const catchUpOwnerYard = (save: Save): Promise<Save> =>
  catchUpLockedYard(postgres.em, save);
