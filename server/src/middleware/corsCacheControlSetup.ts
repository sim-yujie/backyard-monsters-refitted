import type { Context, Next } from "koa";
import { Env } from "../enums/Env.js";
import { Status } from "../enums/StatusCodes.js";
import { isStaticPath } from "../utils/staticPaths.js";

const STATIC_MAX_AGE = 3600;

/**
 * Pictures are kept a week (owner, 28 Oct 2026, the Quality setting): on a
 * slow, laggy link the hourly "is this still the same?" check for every
 * picture on screen was itself slow. A repainted monster sheet is asked for
 * with a new `?v=` (`web/src/game/attack/sheetVersions.ts`), so it is fetched
 * afresh; other changed art shows within the week, or at once if renamed.
 */
const PICTURE_MAX_AGE = 7 * 24 * 3600;

const PICTURE = /\.(png|jpe?g|gif|webp|svg)$/i;

const NO_STORE = "no-cache, no-store, must-revalidate";

const STATIC_CACHE_CONTROL = `public, max-age=${STATIC_MAX_AGE}`;

const PICTURE_CACHE_CONTROL = `public, max-age=${PICTURE_MAX_AGE}`;

const cacheStaticAssets = process.env.ENV !== Env.LOCAL;

/**
 * The Cache-Control for a request: a week for a picture in public/, an hour
 * for any other file there, and nothing kept for the API.
 *
 * @param {string} path - The request path.
 * @param {boolean} [cacheable] - Whether static files may be kept at all (not on a local server).
 * @returns {string} The header's value.
 */
export const cacheControlFor = (path: string, cacheable = cacheStaticAssets): string => {
  if (!cacheable || !isStaticPath(path)) return NO_STORE;
  return PICTURE.test(path) ? PICTURE_CACHE_CONTROL : STATIC_CACHE_CONTROL;
};

/**
 * Middleware to set CORS headers and apply cache control.
 *
 * @param {Context} ctx - The Koa request/response context object.
 * @param {Next} next - The next middleware function in the stack.
 * @returns {Promise<void>} - A promise that resolves when the middleware is complete.
 */
export const corsCacheControl = async (ctx: Context, next: Next) => {
  ctx.set("Access-Control-Allow-Origin", "*");

  ctx.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  ctx.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  ctx.set("Cache-Control", cacheControlFor(ctx.path));

  if (ctx.method === "OPTIONS") {
    ctx.status = Status.NO_CONTENT;
    return;
  }

  await next();
};
