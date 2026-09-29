import type { AbandonedInput, AbandonedOutcome } from "./abandonedAttack.js";
import type { ReplayedLoot, ReplayedLootInput } from "./attackLoot.js";

/**
 * Runs a battle replay in a Bun worker, with a deadline (issue #23, C5;
 * `docs/design/server-combat.md` §3.5).
 *
 * The engine is synchronous and takes from a few hundred milliseconds to a
 * couple of seconds of CPU for a full attack. Run inline, an attack save's
 * loot replay or the finaliser's replay held the event loop for all of it, and
 * every other request on the server waited. Each replay now runs in a worker
 * of its own: the request awaits it and the loop stays free.
 *
 * - **Deadline.** A replay that has not answered in time is terminated and the
 *   promise rejects with {@link ReplayTimeoutError}. The attack save gives up
 *   on landing the attack and leaves it to the finaliser
 *   (`attackResultPendingErr`); the finaliser, which has no one waiting on it,
 *   leaves the checkpoint for its next pass.
 * - **Single flight.** Both callers run their replay holding the attack's final
 *   lock (`attack-final:<basesaveid>`, `attackCheckpointStore.ts`), so there is
 *   never more than one replay per base in flight; this module adds no lock of
 *   its own.
 * - **One worker a job.** A worker is started for the job and terminated when
 *   it answers or times out, so a stuck replay cannot hold up the next one and
 *   a crashed one takes nothing else down. Starting one costs its module load,
 *   a few tens of milliseconds next to the replay itself.
 */

/** How long an attack save waits for its replay. */
export const SAVE_REPLAY_DEADLINE_MS = 5_000;

/**
 * How long the finaliser waits: longer, since nobody is waiting on it, and
 * short of the final lock's 30 s so the lock is still held when it lands.
 */
export const FINALISE_REPLAY_DEADLINE_MS = 20_000;

/** A replay to run: the save's loot cap, or an abandoned attack. */
export type ReplayJob =
  | { readonly kind: "loot"; readonly input: ReplayedLootInput }
  | { readonly kind: "abandoned"; readonly input: AbandonedInput };

/** What the worker sends back. */
export type ReplayReply =
  | { readonly ok: true; readonly kind: "loot"; readonly result: ReplayedLoot }
  | { readonly ok: true; readonly kind: "abandoned"; readonly result: AbandonedOutcome }
  | { readonly ok: false; readonly error: string };

/** The replay did not answer before its deadline, and was stopped. */
export class ReplayTimeoutError extends Error {
  constructor(readonly deadlineMs: number) {
    super(`The battle replay did not finish within ${deadlineMs} ms`);
    this.name = "ReplayTimeoutError";
  }
}

const WORKER_URL = new URL("./replayWorker.ts", import.meta.url);

const run = (job: ReplayJob, deadlineMs: number): Promise<ReplayReply & { ok: true }> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL);
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new ReplayTimeoutError(deadlineMs))), deadlineMs);
    worker.onmessage = (event: MessageEvent<ReplayReply>) => {
      const reply = event.data;
      finish(() => (reply.ok ? resolve(reply) : reject(new Error(`Battle replay failed: ${reply.error}`))));
    };
    worker.onerror = (event: ErrorEvent) => {
      finish(() => reject(new Error(`Battle replay worker failed: ${event.message}`)));
    };
    worker.postMessage(job);
  });

/**
 * The save's loot replay (`replayedLoot`), in a worker.
 *
 * @throws {ReplayTimeoutError} Past the deadline.
 */
export const replayLootInWorker = async (
  input: ReplayedLootInput,
  deadlineMs = SAVE_REPLAY_DEADLINE_MS
): Promise<ReplayedLoot> => {
  const reply = await run({ kind: "loot", input }, deadlineMs);
  if (reply.kind !== "loot") throw new Error("Battle replay answered the wrong job");
  return reply.result;
};

/**
 * An abandoned attack's replay (`replayAbandonedAttack`), in a worker.
 *
 * @throws {ReplayTimeoutError} Past the deadline.
 */
export const replayAbandonedInWorker = async (
  input: AbandonedInput,
  deadlineMs = FINALISE_REPLAY_DEADLINE_MS
): Promise<AbandonedOutcome> => {
  const reply = await run({ kind: "abandoned", input }, deadlineMs);
  if (reply.kind !== "abandoned") throw new Error("Battle replay answered the wrong job");
  return reply.result;
};
