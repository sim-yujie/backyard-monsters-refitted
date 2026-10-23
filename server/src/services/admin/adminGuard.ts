import type { Context, Next } from "koa";

import { Status } from "../../enums/StatusCodes.js";

/**
 * The owner-only check in front of every dashboard route
 * (`controllers/admin/routes.ts`).
 *
 * The caller must pass the normal sign-in check (`authenticate`, the game's
 * `verifyUserAuth`) and then be one of `ADMIN_USER_IDS`
 * (`config/AdminConfig.ts`). Anyone else, signed in or not, gets the same
 * plain 404 an unknown address gets, so the dashboard's routes cannot be
 * found by trying them. The decision is the server's alone: nothing the
 * client sends besides its session token is looked at.
 *
 * A route's own errors are not caught here; only a failed sign-in is.
 */

export type Authenticate = (ctx: Context, next: Next) => Promise<unknown>;

/** The answer to anyone who may not see the dashboard. */
export const notFound = (ctx: Context): void => {
  ctx.status = Status.NOT_FOUND;
  ctx.body = "Not Found";
};

export const makeAdminGuard =
  (authenticate: Authenticate, isAdmin: (userid: unknown) => boolean, onRefused?: (ctx: Context) => void) =>
  async (ctx: Context, next: Next): Promise<void> => {
    let allowed = false;
    try {
      await authenticate(ctx, async () => {
        allowed = isAdmin(ctx.authUser?.userid);
      });
    } catch {
      allowed = false;
    }
    if (!allowed) {
      onRefused?.(ctx);
      notFound(ctx);
      return;
    }
    await next();
  };
