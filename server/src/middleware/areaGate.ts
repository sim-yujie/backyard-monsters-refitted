import type { Context, Next } from "koa";

/**
 * Back-pressure for the map's zone answers (`getarea`, `getareas`; live map,
 * beta 9). Each answer is about a dozen queries, and the database pool is 10
 * connections (`mikro-orm.config.ts`), so at most {@link AreaGateOptions.concurrency}
 * answers are worked on at once; a few more wait their turn. Past that, or once
 * a request has waited too long, it is answered at once with 503 and "retry
 * after N s" (`Retry-After` and `retry`), N spread over a few seconds so the
 * retries do not come back together. The map then waits and asks again.
 *
 * Without this a burst of re-asks (everyone looking at a busy area) queued
 * without limit in the server's memory and was answered too late to matter
 * (the live map's load check grew a local server to 17 GB). With it a burst
 * makes updates slower, never the server unwell.
 *
 * The count is this process's: each server protects its own pool.
 */

export interface AreaGateOptions {
  /** Answers worked on at once. */
  concurrency: number;
  /** Requests that may wait for a turn; more are refused at once. */
  maxWaiting: number;
  /** A request that has waited this long is refused rather than started late. */
  maxWaitMs: number;
  /** The shortest and longest "retry after", seconds. */
  retryMin: number;
  retryMax: number;
}

export const AREA_GATE_DEFAULTS: AreaGateOptions = {
  concurrency: Number(process.env.AREA_CONCURRENCY) || 6,
  maxWaiting: Number(process.env.AREA_MAX_WAITING) || 30,
  maxWaitMs: 4_000,
  retryMin: 2,
  retryMax: 6,
};

export interface AreaGate {
  /** True once a turn is free; false when refused. */
  acquire(): Promise<boolean>;
  release(): void;
  readonly stats: { active: number; waiting: number; refused: number };
}

export const createAreaGate = (options: AreaGateOptions = AREA_GATE_DEFAULTS): AreaGate => {
  let active = 0;
  let refused = 0;
  const waiting: { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  const refuse = (): boolean => {
    refused += 1;
    return false;
  };

  return {
    get stats() {
      return { active, waiting: waiting.length, refused };
    },
    acquire: () => {
      if (active < options.concurrency) {
        active += 1;
        return Promise.resolve(true);
      }
      if (waiting.length >= options.maxWaiting) return Promise.resolve(refuse());
      return new Promise<boolean>((resolve) => {
        const entry = {
          resolve,
          timer: setTimeout(() => {
            const at = waiting.indexOf(entry);
            if (at >= 0) waiting.splice(at, 1);
            resolve(refuse());
          }, options.maxWaitMs),
        };
        waiting.push(entry);
      });
    },
    release: () => {
      const next = waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        // The turn passes straight on: `active` stays the same.
        next.resolve(true);
        return;
      }
      active = Math.max(0, active - 1);
    },
  };
};

const sharedGate = createAreaGate();

/** The middleware: a turn, or 503 with when to try again. */
export const areaGate =
  (gate: AreaGate = sharedGate, options: AreaGateOptions = AREA_GATE_DEFAULTS) =>
  async (ctx: Context, next: Next): Promise<void> => {
    if (!(await gate.acquire())) {
      const retry = options.retryMin + Math.floor(Math.random() * (options.retryMax - options.retryMin + 1));
      ctx.status = 503;
      ctx.set("Retry-After", String(retry));
      ctx.body = { error: "The map is busy. It will try again in a moment.", retry };
      return;
    }
    try {
      await next();
    } finally {
      gate.release();
    }
  };
