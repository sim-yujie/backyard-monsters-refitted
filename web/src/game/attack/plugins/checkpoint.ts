import { sendAttackCheckpoint } from "@/api/base";
import { ApiError } from "@/api/http";
import { ATTACK_PLUGINS, type AttackMounts, type AttackPlugin } from "@/game/attack/attackPlugins";
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
 * One request at a time; a checkpoint that falls due while one is in flight
 * goes when it returns, carrying the newest state. Failures are silent — a
 * later checkpoint or the final save supersedes a lost one — except a refusal
 * that says the attack is no longer this player's to record, which stops it.
 */

/** How often the battle's progress is recorded while nothing new is dropped. */
export const CHECKPOINT_INTERVAL_MS = 5000;

/** Refusals after which no checkpoint of this attack can succeed. */
const FINAL_REASONS = new Set(["expired", "no-session", "wrong-attacker", "stale-attack", "rewound", "reseeded"]);

const refusalReason = (caught: unknown): string | null => {
  if (!(caught instanceof ApiError)) return null;
  const data = caught.details?.data;
  const reason = typeof data === "object" && data !== null ? (data as { reason?: unknown }).reason : null;
  return typeof reason === "string" ? reason : null;
};

export interface CheckpointPluginDeps {
  readonly send?: (checkpoint: AttackCheckpoint) => Promise<unknown>;
}

export const createCheckpointPlugin = (deps: CheckpointPluginDeps = {}): AttackPlugin => {
  const send = deps.send ?? sendAttackCheckpoint;

  return ({ session }: AttackMounts) => {
    let inFlight = false;
    let due = false;
    let stopped = false;
    let events = session.state().eventCount;

    const flush = (): void => {
      if (stopped || inFlight || !due) return;
      if (session.state().phase === "ended") {
        stopped = true;
        return;
      }
      const checkpoint = checkpointOf(session);
      due = false;
      if (!checkpoint) return;
      inFlight = true;
      send(checkpoint)
        .catch((caught: unknown) => {
          const reason = refusalReason(caught);
          if (reason && FINAL_REASONS.has(reason)) stopped = true;
        })
        .finally(() => {
          inFlight = false;
          flush();
        });
    };

    const request = (): void => {
      due = true;
      flush();
    };

    const unsubscribe = session.subscribe((state) => {
      if (state.eventCount === events) return;
      events = state.eventCount;
      request();
    });
    const timer = window.setInterval(() => {
      if (session.state().phase === "running" && session.hasActed()) request();
    }, CHECKPOINT_INTERVAL_MS);

    return () => {
      stopped = true;
      unsubscribe();
      window.clearInterval(timer);
    };
  };
};

ATTACK_PLUGINS.push(createCheckpointPlugin());
