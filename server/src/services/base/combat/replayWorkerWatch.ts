import { logger } from "../../../utils/logger.js";
import { sendTelegram, type SendTelegram } from "../../alerts/telegram.js";
import {
  WORKER_LOAD_FAILURE_LIMIT,
  WORKER_LOAD_FAILURE_WINDOW_MS,
  onReplayWorkersBroken,
  type ReplayWorkersBroken,
} from "./replayRunner.js";

/**
 * When battle replay workers keep failing to load, the server restarts itself
 * (22 Nov 2026 outage: Bun 1.4.2's transpiler broke after ~12,000 workers,
 * about 40 hours on the live server, and every replay failed from then on
 * until a restart). After {@link WORKER_LOAD_FAILURE_LIMIT} load failures in
 * a row within a minute (`replayRunner.ts`), the owner gets one Telegram
 * message and the process exits; Docker's `restart: unless-stopped`
 * (`docker-compose.prod.yml`) starts it again, fresh. The pattern of
 * `utils/redisReconnectGuard.ts`. The message carries the error's words only,
 * never a player.
 */

/** How long the exit waits for Telegram: a dead network must not keep a broken server up. */
export const ALERT_WAIT_MS = 5_000;

/** The Telegram text. */
export const brokenWorkersText = ({ failures, lastError }: ReplayWorkersBroken): string =>
  [
    `BYMR: battle replays could not start (${failures} replay workers failed to load within ${Math.round(
      WORKER_LOAD_FAILURE_WINDOW_MS / 1000
    )} s). The game server is restarting itself.`,
    `Last error: ${lastError.slice(0, 200)}`,
  ].join("\n");

export interface WatchOptions {
  readonly send?: SendTelegram;
  readonly exit?: (code: number) => void;
  readonly alertWaitMs?: number;
}

/**
 * What the server runs once broken workers are seen: log, alert (waiting at
 * most `alertWaitMs`), exit with 1. Exported for the tests.
 */
export const restartForBrokenWorkers = async (
  broken: ReplayWorkersBroken,
  { send = (text) => sendTelegram(text), exit = (code) => process.exit(code), alertWaitMs = ALERT_WAIT_MS }: WatchOptions = {}
): Promise<void> => {
  logger.fatal(
    `Battle replay workers failed to load ${broken.failures} times in a row (${broken.lastError}); exiting so the server restarts.`
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      send(brokenWorkersText(broken)),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), alertWaitMs);
      }),
    ]);
    if (outcome === null) logger.warn("Alerts: the broken replay workers message did not go in time");
    else if (!outcome.sent) logger.warn(`Alerts: the broken replay workers message failed: ${outcome.reason}`);
  } catch (err) {
    logger.warn(`Alerts: the broken replay workers message failed: ${err}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  exit(1);
};

/** Starts watching (`server.ts`). */
export const startReplayWorkerWatch = (options: WatchOptions = {}): void =>
  onReplayWorkersBroken((broken) => void restartForBrokenWorkers(broken, options));
