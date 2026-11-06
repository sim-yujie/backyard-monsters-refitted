import bodyParser from "koa-bodyparser";
import type { Context, Next } from "koa";

/**
 * How big a request body the server reads (security audit 2026-10-29, M4).
 *
 * The body is parsed before any route, sign-in or rate limit runs, so its
 * limit is what anyone can make the server read and parse per request. It
 * was 8 MB everywhere. The largest body a game route takes is an attack save
 * (`/base/save`), which resends the enemy yard, the fling log (at most
 * `MAX_CHECKPOINT_EVENTS`, 500 events) and the report on every save: built
 * at its worst in `bodyLimits.test.ts` it is about 0.58 MB form encoded,
 * with a yard twice the size of the largest one stored locally (690
 * buildings, 38 KB). 2 MB leaves more than three times that.
 *
 * Only the routes that carry pictures keep 8 MB: the bug reports (a 1.5 MB
 * screenshot and a 3 MB picture, base64 encoded, `BugReportConfig.ts`) and
 * the owner's announcement writes (three 1 MB pictures, `announcements.ts`).
 */
export const BODY_LIMIT = 2 * 1024 * 1024;

/** The limit for the {@link isLargeBodyRoute picture routes}. */
export const LARGE_BODY_LIMIT = 8 * 1024 * 1024;

/** The routes that carry pictures, as `METHOD path` patterns. */
const LARGE_BODY_ROUTES: ReadonlyArray<{ readonly method: string; readonly path: RegExp }> = [
  { method: "POST", path: /^\/api\/[^/]+\/bugreport(?:\/guest)?\/?$/ },
  { method: "POST", path: /^\/api\/[^/]+\/admin\/announcements\/?$/ },
  { method: "PUT", path: /^\/api\/[^/]+\/admin\/announcements\/[^/]+\/?$/ },
];

/**
 * Whether a request may carry the {@link LARGE_BODY_LIMIT larger body}.
 *
 * @param method - The request method.
 * @param path - The request path, before routing.
 */
export const isLargeBodyRoute = (method: string, path: string): boolean =>
  LARGE_BODY_ROUTES.some((route) => route.method === method && route.path.test(path));

// koa-bodyparser takes the limit as a `bytes` string ("2097152b").
const parserFor = (limit: number) =>
  bodyParser({ enableTypes: ["json", "form"], jsonLimit: `${limit}b`, formLimit: `${limit}b` });

/**
 * The body parser: {@link BODY_LIMIT} for every route, {@link LARGE_BODY_LIMIT}
 * for the picture routes. A body over its limit is answered 413 unread.
 */
export const bodyParsers = () => {
  const normal = parserFor(BODY_LIMIT);
  const large = parserFor(LARGE_BODY_LIMIT);
  return (ctx: Context, next: Next) => (isLargeBodyRoute(ctx.method, ctx.path) ? large(ctx, next) : normal(ctx, next));
};
