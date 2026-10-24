import type { Context } from "koa";

import type { KoaController } from "../../utils/KoaController.js";
import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import { ClientErrorsSchema } from "../../schemas/ClientErrorSchemas.js";
import { acceptClientErrors } from "../../services/errors/clientErrors.js";

/**
 * Browser errors the web client sends on its own (`services/errors/
 * clientErrors.ts`), for the owner's dashboard. `clientErrors` is signed in
 * and keeps the account number with each error; `guestClientErrors` is the
 * login screen's and keeps nothing about the sender. Both are rate limited
 * per account or address (`clientErrorLimiter`) and answer `{ kept }`.
 *
 * Neither goes through `logRequest`: an error report must not make more log
 * lines than the error did.
 */

const answer = (ctx: Context, kept: number): void => {
  ctx.status = Status.OK;
  ctx.body = { error: 0, kept };
};

export const clientErrors: KoaController = async (ctx) => {
  const body = ClientErrorsSchema.parse(ctx.request.body ?? {});
  answer(ctx, await acceptClientErrors(postgres.em.fork(), body, ctx.authUser.userid));
};

export const guestClientErrors: KoaController = async (ctx) => {
  const body = ClientErrorsSchema.parse(ctx.request.body ?? {});
  answer(ctx, await acceptClientErrors(postgres.em.fork(), body, null));
};
