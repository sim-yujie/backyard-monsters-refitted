import type { Server } from "node:http";
import { logger } from "./logger.js";

/**
 * A clean stop on SIGTERM (beta 10, owner's pick B+, 27 Nov 2026).
 *
 * A release restarts the game server (`deploy/prod.sh up -d --build`):
 * Docker sends SIGTERM, waits `stop_grace_period` (docker-compose.prod.yml),
 * then kills. Before this, a request being handled at that moment was cut
 * off: an attack start, a save, a purchase answered with a network error.
 * Now the server:
 *
 * 1. stops taking new connections, so Caddy's next try fails to connect and
 *    it holds the request until the new server is up (`lb_try_duration`,
 *    deploy/Caddyfile) instead of answering with an error;
 * 2. lets every request already being handled finish, closing each
 *    keep-alive connection as soon as it is idle, for up to `graceMs`;
 * 3. closes whatever is still open after that, then runs the closers (chat
 *    sockets, the error buffer, the database and Redis, the log files) and
 *    exits 0.
 *
 * SIGINT (Ctrl+C on a development server) is left as it was: it stops at once.
 */

export interface ShutdownOptions {
  /** The game API's HTTP server (`app.listen`). */
  readonly http: Pick<Server, "close" | "closeIdleConnections" | "closeAllConnections">;
  /** Run in order once the HTTP server is closed; one that fails or hangs does not stop the rest. */
  readonly closers?: ReadonlyArray<readonly [name: string, close: () => unknown]>;
  /** How long open requests get to finish. Keep it under the compose file's stop_grace_period. */
  readonly graceMs?: number;
  /** How long each closer gets. */
  readonly closerMs?: number;
  readonly exit?: (code: number) => void;
}

/** Open requests get 10 s; Docker waits 20 s (stop_grace_period) before it kills. */
export const SHUTDOWN_GRACE_MS = 10_000;
const CLOSER_MS = 2_000;
/** How often idle keep-alive connections are closed while requests finish. */
const IDLE_SWEEP_MS = 200;

const sleep = (ms: number) => new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));

/**
 * Stops the server as above. Resolves once it has called `exit`.
 */
export const shutdownGracefully = async (reason: string, options: ShutdownOptions): Promise<void> => {
  const { http, closers = [], graceMs = SHUTDOWN_GRACE_MS, closerMs = CLOSER_MS, exit = process.exit } = options;
  const started = Date.now();
  logger.info("Shutting down ({reason}): no new connections, finishing open requests", {
    event: "shutdown",
    reason,
  });

  const closed = new Promise<"closed">((resolve) => http.close(() => resolve("closed")));
  http.closeIdleConnections();
  // A keep-alive connection becomes idle once its request is answered; Bun's
  // server does not close those by itself while it is closing.
  const sweep = setInterval(() => http.closeIdleConnections(), IDLE_SWEEP_MS);
  const drained = await Promise.race([closed, sleep(graceMs)]);
  clearInterval(sweep);
  if (drained === "timeout") {
    logger.warn("Shutdown: requests still open after {ms} ms were cut off", { event: "shutdown", ms: graceMs });
    http.closeAllConnections();
  }

  // Said before the closers: the last of them closes the log files.
  logger.info("Shutdown: requests done in {ms} ms, closing services", { event: "shutdown", ms: Date.now() - started });
  for (const [name, close] of closers) {
    try {
      const result = await Promise.race([Promise.resolve().then(close), sleep(closerMs)]);
      if (result === "timeout") logger.warn("Shutdown: {name} did not close in time", { event: "shutdown", name });
    } catch (err) {
      logger.warn("Shutdown: {name} failed to close: {err}", { event: "shutdown", name, err: String(err) });
    }
  }

  exit(0);
};

/** Calls {@link shutdownGracefully} on SIGTERM, as Docker stops a container. */
export const stopGracefullyOnSigterm = (options: ShutdownOptions): void => {
  process.once("SIGTERM", () => void shutdownGracefully("SIGTERM", options));
};
