import { withContext } from "@logtape/logtape";
import type { Context, Next } from "koa";

/**
 * Which build of the game page sent a request (beta 10, owner's pick B+,
 * 27 Nov 2026), so the request log can count tabs still running an old page
 * after a release, and an "old page" refusal says which page it was.
 *
 * The page adds its entry script's hash (`/static/index-<hash>.js`) to every
 * API request's query string as `pb` (`web/src/api/http.ts`). A query
 * parameter needs no CORS change, unlike a header, and no route schema reads
 * it, unlike a body field. Pages from before beta 10, and development pages,
 * send none.
 *
 * Runs before the request logger, so the LogTape context it opens is still
 * open when the logger writes the request's record: the record, and every
 * line logged while the request is handled, carries `pageBuild`.
 */

/** The query parameter the page's build travels in. */
export const PAGE_BUILD_PARAM = "pb";

/** A build id as the page sends it: the bundle hash, at most 40 word characters or dashes. */
export const pageBuildOf = (value: unknown): string | null =>
  typeof value === "string" && /^[\w-]{1,40}$/.test(value) ? value : null;

export const pageBuildContext = (ctx: Context, next: Next): Promise<unknown> => {
  const pageBuild = pageBuildOf(ctx.query[PAGE_BUILD_PARAM]);
  return pageBuild ? withContext({ pageBuild }, next) : next();
};
