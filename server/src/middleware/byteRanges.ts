import { createReadStream, ReadStream } from "fs";
import type { Context, Next } from "koa";

/** A byte range to send, both ends included. */
export type ByteRange = { start: number; end: number };

/** The answer for a range that asks only for bytes past the end of the file. */
export const UNSATISFIABLE = "unsatisfiable";

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Reads a Range header for one range of bytes.
 *
 * Covers the three forms a browser sends: `bytes=0-99`, `bytes=100-` (to the
 * end) and `bytes=-100` (the last 100 bytes). An end past the file is cut to
 * the file. A header it cannot read, a list of several ranges, or a start after
 * its end gives undefined, and the whole file goes out instead, which the HTTP
 * rules allow.
 *
 * @param {string} header - The Range header as sent.
 * @param {number} size - The file's size in bytes.
 * @returns {ByteRange | typeof UNSATISFIABLE | undefined} The range to send,
 * UNSATISFIABLE when it lies wholly past the file, or undefined to send it all.
 */
export const parseByteRange = (header: string, size: number): ByteRange | typeof UNSATISFIABLE | undefined => {
  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return undefined;

  const [, first, last] = match;

  if (first === "") {
    // Suffix form: the last N bytes.
    if (last === "") return undefined;
    const length = Number(last);
    if (length === 0 || size === 0) return UNSATISFIABLE;
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(first);
  if (last !== "" && Number(last) < start) return undefined;
  if (start >= size) return UNSATISFIABLE;

  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return { start, end };
};

/**
 * Whether an If-Range header still matches the file, so the range can be sent.
 * koa-send sets Last-Modified but no ETag, so only a date can match.
 *
 * @param {Context} ctx - The Koa request/response context object.
 * @returns {boolean} True when there is no If-Range or it names this version.
 */
const ifRangeMatches = (ctx: Context) => {
  const ifRange = ctx.get("If-Range");
  return !ifRange || ifRange === ctx.response.get("Last-Modified");
};

/**
 * Answers Range requests for files sent from disk by koa-static.
 *
 * koa-static always sends the whole file with a 200, which Safari on iPhone
 * will not play `<audio>` from. Once a file is chosen, this swaps in just the
 * asked-for bytes with a 206, or a 416 when the range lies past the end, and
 * marks every file response with Accept-Ranges so players know they can seek.
 * Requests without a Range header, HEAD requests and compressed copies keep
 * the whole-file response, headers and all.
 *
 * @param {Context} ctx - The Koa request/response context object.
 * @param {Next} next - The static file middleware.
 * @returns {Promise<void>} - A promise that resolves when the middleware is complete.
 */
export const byteRanges = async (ctx: Context, next: Next) => {
  await next();

  const file = ctx.body;
  if (ctx.status !== 200 || !(file instanceof ReadStream)) return;
  if (ctx.response.get("Content-Encoding")) return;

  ctx.set("Accept-Ranges", "bytes");

  const header = ctx.get("Range");
  if (ctx.method !== "GET" || !header || !ifRangeMatches(ctx)) return;

  const size = ctx.length;
  if (size === undefined) return;

  const range = parseByteRange(header, size);
  if (range === undefined) return;

  if (range === UNSATISFIABLE) {
    ctx.status = 416;
    ctx.set("Content-Range", `bytes */${size}`);
    ctx.body = "";
    return;
  }

  // Koa leaves the old stream open when a new one replaces it.
  file.destroy();

  ctx.status = 206;
  ctx.body = createReadStream(file.path, range);
  ctx.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  ctx.length = range.end - range.start + 1;
};
