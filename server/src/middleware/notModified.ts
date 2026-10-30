import { ReadStream, type Stats } from "fs";
import type { ServerResponse } from "http";
import type { Context, Next } from "koa";

/**
 * Tags a file from disk with its size and exact modification time, for
 * koa-static's `setHeaders`.
 *
 * koa-send gives a file only a Last-Modified date, to the second, and a
 * picture copied in over an older one keeps the date it had where it came
 * from (Windows does that), so a date alone could call the new file the old
 * one. Size and time to the millisecond together change with any new copy.
 *
 * The tag is strong, as nginx's is for the same two numbers. A browser that
 * kept part of a picture (a reload cut the download off) asks for the rest
 * with `If-Range` naming this tag, and a weak tag can never match there
 * (RFC 9110 13.1.5): the server sent the whole file again where the browser
 * expected the rest, and Chrome failed the picture.
 *
 * @param {ServerResponse} res - The response the file goes out on.
 * @param {string} _path - The file's path on disk.
 * @param {Stats} stats - The file's stats, from koa-send.
 */
export const tagFile = (res: ServerResponse, _path: string, stats: Stats) => {
  res.setHeader("ETag", `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`);
};

/**
 * Answers 304 Not Modified for a file from disk the browser already holds.
 *
 * A browser that kept a file asks again with If-None-Match (and
 * If-Modified-Since); when the file has not changed it gets an empty 304 and
 * uses its own copy, rather than the whole file again. That is what makes the
 * local server's "keep it, but ask every time" (`corsCacheControlSetup.ts`)
 * cheap, and a live picture past its week is checked the same way.
 *
 * @param {Context} ctx - The Koa request/response context object.
 * @param {Next} next - The static file middleware.
 * @returns {Promise<void>} - A promise that resolves when the middleware is complete.
 */
export const notModified = async (ctx: Context, next: Next) => {
  await next();

  const file = ctx.body;
  if (ctx.status !== 200 || !(file instanceof ReadStream) || !ctx.fresh) return;

  // Koa leaves the old stream open when the body is dropped.
  file.destroy();
  ctx.status = 304;
};
