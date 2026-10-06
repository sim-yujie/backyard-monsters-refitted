import { availableParallelism } from "node:os";
import type { AbandonedInput, AbandonedOutcome } from "./abandonedAttack.js";
import type { RaidFightInput, RaidFightOutcome } from "../../raids/raidFight.js";

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
 * - **A cap for auto-attacks (issue #221).** An auto-attack is a replay a
 *   player can ask for every few seconds, so it first takes one of
 *   {@link REPLAY_WORKER_CAP} slots, which it shares with every replay running
 *   ({@link reserveReplaySlot}), and is turned away when none frees up in
 *   time. Saves and the finaliser never wait: a player watching their own
 *   attack end comes before anyone's repeat. A slot covers the auto-attack's
 *   own worker too, so the cap errs on the side of fewer.
 */

/** How long an attack save waits for its replay. */
export const SAVE_REPLAY_DEADLINE_MS = 5_000;

/**
 * How long the finaliser waits: longer, since nobody is waiting on it, and
 * short of the final lock's 30 s so the lock is still held when it lands.
 */
export const FINALISE_REPLAY_DEADLINE_MS = 20_000;

/** A replay to run: an attack's battle (a save's or an abandoned one), or a wild monster raid's fight (#226). */
export type ReplayJob =
  | { readonly kind: "abandoned"; readonly input: AbandonedInput }
  | { readonly kind: "raid"; readonly input: RaidFightInput };

/** What the worker sends back. */
export type ReplayReply =
  | { readonly ok: true; readonly kind: "abandoned"; readonly result: AbandonedOutcome }
  | { readonly ok: true; readonly kind: "raid"; readonly result: RaidFightOutcome }
  | { readonly ok: false; readonly error: string };

/** The replay did not answer before its deadline, and was stopped. */
export class ReplayTimeoutError extends Error {
  constructor(readonly deadlineMs: number) {
    super(`The battle replay did not finish within ${deadlineMs} ms`);
    this.name = "ReplayTimeoutError";
  }
}

const WORKER_URL = new URL("./replayWorker.ts", import.meta.url);

/** How many replays may run at once before an auto-attack has to wait: a core is left for the server. */
export const REPLAY_WORKER_CAP = Math.max(1, availableParallelism() - 1);

/** How long an auto-attack waits for a slot before it is turned away. */
export const AUTO_ATTACK_SLOT_WAIT_MS = 5_000;

const SLOT_POLL_MS = 50;

/** Replay workers alive now, and auto-attack slots held. */
let running = 0;
let reserved = 0;

/** What the cap counts, for the tests and the log line. */
export const replayLoad = (): { running: number; reserved: number } => ({ running, reserved });

/**
 * Takes an auto-attack slot: waits while the replays running and the slots
 * held fill the cap, up to `waitMs`.
 *
 * @returns The release, to call once the auto-attack has landed (idempotent),
 *   or null when no slot freed up in time.
 */
export const reserveReplaySlot = async (
  waitMs = AUTO_ATTACK_SLOT_WAIT_MS,
  cap = REPLAY_WORKER_CAP
): Promise<(() => void) | null> => {
  const deadline = Date.now() + waitMs;
  while (running + reserved >= cap) {
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, SLOT_POLL_MS));
  }
  reserved++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reserved--;
  };
};

const run = (job: ReplayJob, deadlineMs: number): Promise<ReplayReply & { ok: true }> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL);
    running++;
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      running--;
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

/**
 * A wild monster raid's fight (`fightRaid`, #226), in a worker. The player
 * waits on it to start watching, so it gets the finaliser's longer deadline.
 *
 * @throws {ReplayTimeoutError} Past the deadline.
 */
export const fightRaidInWorker = async (
  input: RaidFightInput,
  deadlineMs = FINALISE_REPLAY_DEADLINE_MS
): Promise<RaidFightOutcome> => {
  const reply = await run({ kind: "raid", input }, deadlineMs);
  if (reply.kind !== "raid") throw new Error("Battle replay answered the wrong job");
  return reply.result;
};
