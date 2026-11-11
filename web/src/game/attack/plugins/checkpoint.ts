import { sendAttackCheckpoint } from "@/api/base";
import { ApiError } from "@/api/http";
import {
  ATTACK_PLUGINS,
  type AttackMounts,
  type AttackPlugin,
} from "@/game/attack/attackPlugins";
import { checkpointOf, type AttackCheckpoint } from "@/game/attack/attackCheckpoint";

/**
 * Attack-scene plugin that keeps the server's record of the attack current
 * (issue #138, `attackCheckpoint.ts`).
 *
 * Leaving the attack screen ends the attack, and the end plugin sends the
 * save as the page goes. This is for when that save never arrives: the
 * browser is killed, the machine sleeps, the connection drops. The server
 * finishes such an attack from the last checkpoint it holds, so one is sent
 * the moment anything is dropped, bombed or sieged, and again every few
 * seconds while the battle runs, which is how the server knows how far the
 * battle got. Nothing is sent before the first drop (#79) or after the end.
 *
 * A hidden tab does not end the attack (owner, #138), but a hidden page is
 * the one a browser or phone may later discard without a `pagehide`, so one
 * more is sent the moment the page is hidden: the server then holds the
 * attack as it stood when the player looked away.
 *
 * One request at a time; a checkpoint that falls due while one is in flight
 * goes when it returns, carrying the newest state. A failed one is tried
 * again shortly, and one that hangs is given up and sent again. Failures are
 * otherwise silent — a later checkpoint or the final save supersedes a lost
 * one — except a refusal that says the attack is no longer this player's to
 * record, which stops it.
 *
 * Drops pause while the server is behind (owner, 2 Nov 2026). Whatever the
 * server has not recorded is undone if the tab is then closed, so a player
 * could cut the connection, drop freely, and close the tab if the fight went
 * badly. Once a drop has gone {@link DROP_HOLD_AFTER_MS} without the server
 * confirming a record that holds it, new drops, bombs and siege weapons are
 * refused ("Reconnecting…", `AttackSession.holdDrops`) until one is
 * confirmed. The battle itself runs on, and Retreat still works.
 */

/** How often the battle's progress is recorded while nothing new is dropped. */
export const CHECKPOINT_INTERVAL_MS = 5000;

/**
 * How long a drop may go without the server confirming a record that holds
 * it before new drops pause.
 *
 * A checkpoint is one small request sent the moment something is dropped,
 * one at a time, so a drop normally waits at most two round trips (the one
 * in flight, then its own): well under a second on a good line, about six
 * seconds on a poor phone connection with three-second round trips. Ten
 * seconds leaves room for that, so a slow phone is not stopped, and caps
 * what a player who cuts the connection can drop unseen to about ten
 * seconds of dropping.
 */
export const DROP_HOLD_AFTER_MS = 10_000;

/** How soon a checkpoint that failed is tried again. */
export const RETRY_MS = 2000;

/**
 * How long a checkpoint may hang before it is given up and sent again.
 * Shorter than {@link DROP_HOLD_AFTER_MS}, so one request lost on the way is
 * replaced (after {@link RETRY_MS}) before the drops pause rather than after.
 */
export const REQUEST_TIMEOUT_MS = 7000;

/** How often the pause is checked. */
const HOLD_CHECK_MS = 500;

const RECONNECTING = "attack-reconnecting";

/** Refusals after which no checkpoint of this attack can succeed. */
const FINAL_REASONS = new Set([
  "expired",
  "no-session",
  "wrong-attacker",
  "stale-attack",
  "rewound",
  "reseeded",
  // A fling fuller than the Flinger holds: every later checkpoint carries it too.
  "flingOverRoom",
]);

const refusalReason = (caught: unknown): string | null => {
  if (!(caught instanceof ApiError)) return null;
  const data = caught.details?.data;
  const reason =
    typeof data === "object" && data !== null ? (data as { reason?: unknown }).reason : null;
  return typeof reason === "string" ? reason : null;
};

export interface CheckpointPluginDeps {
  readonly send?: (
    checkpoint: AttackCheckpoint,
    options: { signal?: AbortSignal },
  ) => Promise<unknown>;
}

export const createCheckpointPlugin = (deps: CheckpointPluginDeps = {}): AttackPlugin => {
  const send = deps.send ?? sendAttackCheckpoint;

  return ({ session, notices }: AttackMounts) => {
    let inFlight = false;
    let due = false;
    let stopped = false;
    let retry: number | undefined;
    let events = session.state().eventCount;
    /** When each event of the log was first seen here, by index. */
    const seenAt: number[] = Array.from({ length: events }, () => Date.now());
    /** How many events of the log the server has confirmed holding. */
    let confirmed = 0;
    let held = false;

    const setHeld = (next: boolean): void => {
      if (next === held) return;
      held = next;
      session.holdDrops(next);
      if (next) notices.show(RECONNECTING, "Reconnecting…", { level: "warning" });
      else notices.clear(RECONNECTING);
    };

    /** Drops pause while one has gone too long unconfirmed; never once the attack is over or no longer recorded. */
    const checkHold = (): void => {
      if (stopped || session.state().phase === "ended") {
        setHeld(false);
        return;
      }
      const oldest = seenAt[confirmed];
      setHeld(oldest !== undefined && Date.now() - oldest >= DROP_HOLD_AFTER_MS);
    };

    const request = (): void => {
      due = true;
      flush();
    };

    const flush = (): void => {
      if (stopped || inFlight || !due) return;
      if (session.state().phase === "ended") {
        stopped = true;
        checkHold();
        return;
      }
      const checkpoint = checkpointOf(session);
      due = false;
      if (!checkpoint) {
        // Nothing the server keeps for this attack (a practice attack, a
        // raid): there is nothing to wait for.
        confirmed = seenAt.length;
        checkHold();
        return;
      }
      const covers = checkpoint.flinglog.events.length;
      const abort = new AbortController();
      const timeout = window.setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
      inFlight = true;
      send(checkpoint, { signal: abort.signal })
        .then(() => {
          confirmed = Math.max(confirmed, covers);
        })
        .catch((caught: unknown) => {
          const reason = refusalReason(caught);
          if (reason && FINAL_REASONS.has(reason)) {
            stopped = true;
            return;
          }
          // Lost, hung or refused for now: try again shortly.
          window.clearTimeout(retry);
          retry = window.setTimeout(request, RETRY_MS);
        })
        .finally(() => {
          window.clearTimeout(timeout);
          inFlight = false;
          checkHold();
          flush();
        });
    };

    const unsubscribe = session.subscribe((state) => {
      if (state.eventCount === events) return;
      for (let at = seenAt.length; at < state.eventCount; at++) seenAt.push(Date.now());
      events = state.eventCount;
      request();
    });
    const timer = window.setInterval(() => {
      if (session.state().phase === "running" && session.hasActed()) request();
    }, CHECKPOINT_INTERVAL_MS);
    const holdTimer = window.setInterval(checkHold, HOLD_CHECK_MS);
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden" && session.hasActed()) request();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      setHeld(false);
      unsubscribe();
      window.clearInterval(timer);
      window.clearInterval(holdTimer);
      window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  };
};

ATTACK_PLUGINS.push(createCheckpointPlugin());
