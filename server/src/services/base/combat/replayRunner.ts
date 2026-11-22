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

/** What the worker says first, once its modules have loaded: it can take the job. */
export interface ReplayWorkerReady {
  readonly ready: true;
}

/** Every message a replay worker sends. */
export type ReplayWorkerMessage = ReplayWorkerReady | ReplayReply;

/** The replay did not answer before its deadline, and was stopped. */
export class ReplayTimeoutError extends Error {
  constructor(readonly deadlineMs: number) {
    super(`The battle replay did not finish within ${deadlineMs} ms`);
    this.name = "ReplayTimeoutError";
  }
}

/**
 * The worker failed before it could take the job: its modules did not load,
 * so no battle was fought. On 22 Nov 2026 Bun 1.4.2's transpiler broke after
 * ~12,000 workers on the live server and every replay died like this
 * ("SyntaxError: Unexpected keyword 'else'"). It says nothing about the
 * attack, so a finaliser never counts it as a failed replay: the attack waits
 * for its next pass ({@link isReplayWorkerLoadError}).
 */
export class ReplayWorkerLoadError extends Error {
  constructor(readonly reason: string) {
    super(`Battle replay worker failed to load: ${reason}`);
    this.name = "ReplayWorkerLoadError";
  }
}

/** Whether `err` is a worker that never loaded ({@link ReplayWorkerLoadError}), not a replay that failed. */
export const isReplayWorkerLoadError = (err: unknown): err is ReplayWorkerLoadError =>
  err instanceof ReplayWorkerLoadError || (err instanceof Error && err.name === "ReplayWorkerLoadError");

/**
 * Whether `err` leaves the attack to land later as it is (the worker did not
 * load, or the replay ran past its deadline), rather than saying anything
 * about the battle itself.
 */
export const isReplayDeferred = (err: unknown): boolean =>
  isReplayWorkerLoadError(err) || err instanceof ReplayTimeoutError || (err instanceof Error && err.name === "ReplayTimeoutError");

const WORKER_URL = new URL("./replayWorker.ts", import.meta.url);

/**
 * Workers failing to load in a row, this many within
 * {@link WORKER_LOAD_FAILURE_WINDOW_MS}, mean the process itself is broken
 * (Bun 1.4.2's transpiler, 22 Nov 2026): every replay fails until it
 * restarts. The handler set by {@link onReplayWorkersBroken} is told once.
 */
export const WORKER_LOAD_FAILURE_LIMIT = 5;
export const WORKER_LOAD_FAILURE_WINDOW_MS = 60_000;

/** What the broken-workers handler is told. */
export interface ReplayWorkersBroken {
  /** Load failures in a row, within the window. */
  readonly failures: number;
  /** The last one's words (e.g. "SyntaxError: Unexpected keyword 'else'"). */
  readonly lastError: string;
}

let loadFailures: number[] = [];
let brokenHandler: ((broken: ReplayWorkersBroken) => void) | null = null;
let brokenTold = false;

/**
 * Sets what happens once workers keep failing to load (`replayWorkerWatch.ts`
 * alerts the owner and exits, so Docker restarts the server); null for
 * nothing. Starts the count afresh.
 */
export const onReplayWorkersBroken = (handler: ((broken: ReplayWorkersBroken) => void) | null): void => {
  brokenHandler = handler;
  brokenTold = false;
  loadFailures = [];
};

/** A worker loaded: the run of failures is over. */
const noteWorkerLoaded = (): void => {
  loadFailures = [];
};

const noteWorkerLoadFailure = (reason: string, now = Date.now()): void => {
  loadFailures = [...loadFailures.filter((at) => now - at < WORKER_LOAD_FAILURE_WINDOW_MS), now];
  if (loadFailures.length < WORKER_LOAD_FAILURE_LIMIT || brokenTold || !brokenHandler) return;
  brokenTold = true;
  brokenHandler({ failures: loadFailures.length, lastError: reason });
};

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

const run = (job: ReplayJob, deadlineMs: number, workerUrl: URL = WORKER_URL): Promise<ReplayReply & { ok: true }> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl);
    running++;
    let settled = false;
    /** Whether the worker said it loaded ({@link ReplayWorkerReady}). */
    let loaded = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      running--;
      clearTimeout(timer);
      worker.terminate();
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new ReplayTimeoutError(deadlineMs))), deadlineMs);
    worker.onmessage = (event: MessageEvent<ReplayWorkerMessage>) => {
      const message = event.data;
      if (!loaded) {
        loaded = true;
        noteWorkerLoaded();
      }
      if ("ready" in message) return;
      finish(() => (message.ok ? resolve(message) : reject(new Error(`Battle replay failed: ${message.error}`))));
    };
    worker.onerror = (event: ErrorEvent) => {
      const reason = String(event.message ?? "unknown error");
      if (loaded) {
        finish(() => reject(new Error(`Battle replay worker failed: ${reason}`)));
        return;
      }
      // Before the worker said it loaded: its modules never ran, so no battle was fought.
      finish(() => reject(new ReplayWorkerLoadError(reason)));
      noteWorkerLoadFailure(reason);
    };
    worker.postMessage(job);
  });

/**
 * An abandoned attack's replay (`replayAbandonedAttack`), in a worker.
 *
 * @param workerUrl - The worker module; tests pass one that fails to load.
 * @throws {ReplayTimeoutError} Past the deadline.
 * @throws {ReplayWorkerLoadError} The worker never loaded.
 */
export const replayAbandonedInWorker = async (
  input: AbandonedInput,
  deadlineMs = FINALISE_REPLAY_DEADLINE_MS,
  workerUrl: URL = WORKER_URL
): Promise<AbandonedOutcome> => {
  const reply = await run({ kind: "abandoned", input }, deadlineMs, workerUrl);
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
