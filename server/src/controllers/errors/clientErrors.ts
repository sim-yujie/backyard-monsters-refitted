import type { Context } from "koa";

import type { KoaController } from "../../utils/KoaController.js";
import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import { ClientErrorsSchema } from "../../schemas/ClientErrorSchemas.js";
import { acceptClientErrors } from "../../services/errors/clientErrors.js";

/**
 * Browser errors the web client sends on its own (`services/errors/
 * clientErrors.ts`), for the owner's dashboard. `clientErrors` is signed in
 * and keeps the account number and name from the login token
 * (`ctx.authUser`); `guestClientErrors` is the login screen's and keeps no
 * account. Both keep the sender's address (`ctx.ip`, `middleware/clientIp.ts`),
 * shown only on the owner's dashboard. Nothing about the sender is read from
 * the body (`ClientErrorsSchema` keeps only the errors). Both are rate limited
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
  const { userid, username } = ctx.authUser;
  answer(ctx, await acceptClientErrors(postgres.em.fork(), body, { userid, username, ip: ctx.ip }));
};

export const guestClientErrors: KoaController = async (ctx) => {
  const body = ClientErrorsSchema.parse(ctx.request.body ?? {});
  answer(ctx, await acceptClientErrors(postgres.em.fork(), body, { userid: null, username: "", ip: ctx.ip }));
};
