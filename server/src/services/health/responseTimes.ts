import type { Context, Next } from "koa";

import { isStaticPath } from "../../utils/staticPaths.js";

/**
 * How fast the game server has been answering, for the dashboard's health
 * section (`healthSummary.ts`): the last few thousand API requests, kept in
 * memory only, so a restart starts afresh. Asset downloads and the /connection
 * heartbeat are left out; they say nothing about the game's speed.
 */

/** How many recent requests are kept. */
export const RESPONSE_SAMPLES = 2000;

/** Only requests from the last this long count. */
export const RESPONSE_WINDOW_MS = 15 * 60 * 1000;

export interface ResponseTimeSummary {
  /** Requests answered in the window. */
  readonly requests: number;
  /** Half of them took at most this long, in milliseconds; null with none. */
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
  /** How many were answered with a 5xx status. */
  readonly serverErrors: number;
  readonly windowMinutes: number;
}

/** A fixed-size ring of (finished at, took, status), newest overwriting oldest. */
export const responseTimeRecorder = (size: number = RESPONSE_SAMPLES) => {
  const at = new Float64Array(size);
  const took = new Float64Array(size);
  const status = new Uint16Array(size);
  let next = 0;
  let filled = 0;

  return {
    record(finishedAt: number, ms: number, code: number): void {
      at[next] = finishedAt;
      took[next] = ms;
      status[next] = code;
      next = (next + 1) % size;
      filled = Math.min(filled + 1, size);
    },

    summary(now: number = Date.now(), windowMs: number = RESPONSE_WINDOW_MS): ResponseTimeSummary {
      const times: number[] = [];
      let serverErrors = 0;
      for (let i = 0; i < filled; i++) {
        if (now - at[i] > windowMs) continue;
        times.push(took[i]);
        if (status[i] >= 500) serverErrors++;
      }
      times.sort((a, b) => a - b);
      const pick = (fraction: number) =>
        times.length ? Math.round(times[Math.min(times.length - 1, Math.ceil(fraction * times.length) - 1)]) : null;
      return {
        requests: times.length,
        p50Ms: pick(0.5),
        p95Ms: pick(0.95),
        maxMs: times.length ? Math.round(times[times.length - 1]) : null,
        serverErrors,
        windowMinutes: Math.round(windowMs / 60_000),
      };
    },
  };
};

/** The server's own recorder, fed by `trackResponseTimes`. */
export const responseTimes = responseTimeRecorder();

/**
 * Koa middleware: times every API request into `responseTimes`. It goes just
 * outside `ErrorInterceptor` (`server.ts`), so a failed request is timed with
 * the status the player got.
 */
export const trackResponseTimes = async (ctx: Context, next: Next): Promise<void> => {
  if (ctx.path === "/connection" || isStaticPath(ctx.path)) return next();
  const started = performance.now();
  try {
    await next();
  } finally {
    responseTimes.record(Date.now(), performance.now() - started, ctx.status);
  }
};
