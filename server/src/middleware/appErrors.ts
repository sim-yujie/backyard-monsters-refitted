import type { Context } from "koa";
import { logger } from "../utils/logger.js";

/** An error as Koa hands it to the app's `error` listeners. */
type AppError = Error & { status?: number; expose?: boolean; code?: string };

/**
 * What a socket or stream reports when the client went away mid-response: a
 * closed tab, a reload, a cancelled fetch.
 */
const CLIENT_GONE_CODES = new Set(["ERR_STREAM_PREMATURE_CLOSE", "ECONNRESET", "EPIPE", "ECONNABORTED"]);

/** Whether the error only says the client stopped listening (issue #274). */
export const isClientGone = (err: AppError): boolean =>
  (err.code !== undefined && CLIENT_GONE_CODES.has(err.code)) || err.message === "Premature close";

/**
 * The app's `error` listener, in place of Koa's default (issue #274).
 *
 * Koa sends every error it sees outside the middleware chain here: above all a
 * streamed body (a static file, `koa-static`) whose `pipeline` fails because
 * the client closed the connection before it finished. Koa's default printed
 * each one's stack to stderr, hundreds of `Error: Premature close` a day on a
 * dev server. A client that went away is logged at debug; anything else is a
 * real error and logged as one. Like the default, a 404 or an error meant for
 * the client (`expose`) is not logged: Koa has already answered it.
 *
 * Errors inside the routes never reach here: `ErrorInterceptor` answers them.
 *
 * @param err - The error.
 * @param ctx - The request it belongs to, when there is one.
 */
export const onAppError = (err: AppError, ctx?: Context): void => {
  if (err.status === 404 || err.expose) return;
  const where = { method: ctx?.method, path: ctx?.path };
  if (isClientGone(err)) {
    logger.debug("Client left {method} {path} before its response finished: {message}", {
      ...where,
      message: err.message,
    });
    return;
  }
  logger.error("Unhandled app error on {method} {path}: {error}", { ...where, error: err });
};
