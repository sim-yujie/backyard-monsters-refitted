import type { Context, Next } from "koa";
import { inspect } from "util";
import { Env } from "../enums/Env.js";

/** Body fields never echoed, even locally: passwords and tokens. */
const SECRET_FIELDS = /password|token|secret/i;

/**
 * A request body with its secret fields replaced, for the console.
 *
 * @param {Record<string, unknown>} body - The parsed request body.
 * @returns {Record<string, unknown>} The same fields, secrets shown as "[hidden]".
 */
export const withoutSecrets = (body: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, SECRET_FIELDS.test(key) ? "[hidden]" : value])
  );

/**
 * Middleware to log request data for debugging purposes.
 *
 * This middleware logs request information to the console in local environments
 * with formatted output for better readability. Passwords and tokens in the
 * body are hidden.
 *
 * @param {string} [logMessage=""] - Optional label for the log entry.
 * @returns {Function} Koa middleware function.
 */
export const logRequest = async (ctx: Context, next: Next) => {
  if (process.env.ENV === Env.LOCAL) {
    console.log("=".repeat(70));
    console.log(`📦 ${ctx.method} ${ctx.path}`);

    if (ctx.request.body && Object.keys(ctx.request.body).length > 0) {
      console.log();
      console.log(
        inspect(withoutSecrets(ctx.request.body as Record<string, unknown>), { colors: true, depth: 5, compact: false })
      );
    }

    console.log("=".repeat(70) + "\n");
  }
  await next();
};
