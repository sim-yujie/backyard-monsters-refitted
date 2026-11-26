import type { AbandonedInput, AbandonedOutcome } from "./abandonedAttack.js";
import type { RaidFightInput, RaidFightOutcome } from "../../raids/raidFight.js";
import { logger } from "../../../utils/logger.js";
import { ReplayPool } from "./replayPool.js";
import { ReplayGate, type GateKind, type GateLog } from "./replayGate.js";
import { ReplayTimeoutError, ReplayWorkerLoadError } from "./replayErrors.js";

export { ReplayTimeoutError, ReplayWorkerLoadError } from "./replayErrors.js";

/**
 * Runs battle replays off the request thread (issue #23, C5;
 * `docs/design/server-combat.md` §3.5), on a pool of warm workers since patch
 * 9.1 (owner's option A on card repeat-busy-91, 26 Nov 2026).
 *
 * The engine is synchronous and takes from tens of milliseconds to a couple
 * of seconds of CPU for a full attack. Run inline, it held the event loop and
 * every other request waited, so each replay runs in a worker and the
 * request awaits it.
 *
 * - **A warm pool** (`replayPool.ts`): {@link REPLAY_POOL_SIZE} workers (2),
 *   loaded once and reused, each at a lower CPU priority; more battles wait
 *   in one first-come queue. A worker that runs past a deadline, crashes,
 *   never loads, or grows too big is replaced, so a stuck replay still cannot
 *   hold up the next one.
 * - **Deadline.** Counted from the ask, queue time included. A replay not
 *   answered in time rejects with {@link ReplayTimeoutError}. The attack save
 *   gives up on landing the attack and leaves it to the finaliser
 *   (`attackResultPendingErr`); the finaliser, which has no one waiting on it,
 *   leaves the checkpoint for its next pass.
 * - **Single flight.** Both callers run their replay holding the attack's final
 *   lock (`attack-final:<basesaveid>`, `attackCheckpointStore.ts`), so there is
 *   never more than one replay per base in flight; this module adds no lock of
 *   its own.
 * - **The door for attacks a player starts at will** (`replayGate.ts`):
 *   Repeat attack (issue #221), a raid start, a Trojan Horse and a baiter test
 *   first wait their turn in line ({@link reserveReplaySlot}); past the
 *   line's limits they are turned away "busy". Inside, they hold no worker:
 *   their battles queue like a save's. Saves and the finaliser never wait at
 *   the door: a player watching their own attack end comes before anyone's
 *   repeat.
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


const envNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Battles fought at once (owner: "2 at once", on the live box's 2 cores;
 * `REPLAY_POOL_SIZE` for a bigger box). Each worker runs at a lower CPU
 * priority (`replayWorker.ts`), so both fighting still leaves the server's
 * requests their CPU.
 */
export const REPLAY_POOL_SIZE = Math.floor(envNumber("REPLAY_POOL_SIZE", 2));

/** Battles a worker fights before it is replaced: bounds a slow leak, and ~1 new worker a day at today's load. */
export const REPLAY_WORKER_MAX_JOBS = 1_000;

/**
 * A worker whose heap is past this after a battle is replaced. A warm worker
 * sits at ~40-90 MB after the biggest battles of the diagnosis's job set.
 */
export const REPLAY_WORKER_MAX_HEAP_BYTES = 384 * 1024 * 1024;

/** How long a Repeat attack waits in line before it is turned away "busy". */
export const REPEAT_QUEUE_WAIT_MS = 15_000;

/** How long a raid start, a Trojan Horse or a baiter test waits in line (as before 9.1). */
export const AUTO_ATTACK_SLOT_WAIT_MS = 5_000;

/** Attacks started at will that may be inside at once (their database work and battles). */
export const REPLAY_GATE_MAX_ADMITTED = 6;

/** The longest the line gets; one more is turned away at once. */
export const REPLAY_GATE_MAX_WAITING = 20;

const logReplaced = (why: string, detail: string): void => {
  logger.warn("Battle replay worker replaced ({why}: {detail})", { event: "replay-worker-replaced", why, detail });
};

const pool = new ReplayPool({
  workerUrl: WORKER_URL,
  size: REPLAY_POOL_SIZE,
  maxJobs: REPLAY_WORKER_MAX_JOBS,
  maxHeapBytes: REPLAY_WORKER_MAX_HEAP_BYTES,
  onLoadFailure: (reason) => noteWorkerLoadFailure(reason),
  onLoaded: noteWorkerLoaded,
  onReplaced: logReplaced,
  onFree: () => gate.pump(),
});

const logGate = (line: GateLog): void => {
  const words =
    line.outcome === "served"
      ? "Battle queue: {kind} waited {waitedMs} ms from place {place}"
      : line.outcome === "gone"
        ? "Battle queue: {kind} left the line after {waitedMs} ms"
        : "Battle queue: {kind} turned away busy ({why}) after {waitedMs} ms";
  logger.info(words, {
    event: "replay-queue",
    ...line,
    fighting: pool.fighting,
    queued: pool.queued,
  });
};

const gate = new ReplayGate({
  maxAdmitted: REPLAY_GATE_MAX_ADMITTED,
  maxWaiting: REPLAY_GATE_MAX_WAITING,
  workerFree: () => pool.hasFreeSeat,
  log: logGate,
});

/** Starts the battle workers now and keeps them warm (`server.ts`, at boot). */
export const warmReplayPool = (): void => pool.warm();

/** What the pool and the door hold now, for the tests and the health page. */
export const replayLoad = () => ({
  fighting: pool.fighting,
  queued: pool.queued,
  alive: pool.alive,
  spawned: pool.spawned,
  replaced: { ...pool.replaced },
  waiting: gate.waiting,
  admitted: gate.admitted,
  totals: gate.totals,
});

export interface SlotOptions {
  /** For the log line. */
  readonly kind?: GateKind;
  /** The player, so their place in line can be read ({@link replayQueuePlace}). */
  readonly who?: number;
  /** The player left: give up the place. */
  readonly signal?: AbortSignal;
}

/**
 * Waits for a turn at the door (`replayGate.ts`) for an attack a player
 * starts at will, up to `waitMs`.
 *
 * @returns The release, to call once the attack is done (idempotent), or
 *   null when turned away (line full, waited too long, or the player left).
 */
export const reserveReplaySlot = (
  waitMs = AUTO_ATTACK_SLOT_WAIT_MS,
  { kind = "test", who, signal }: SlotOptions = {}
): Promise<(() => void) | null> =>
  gate.enter({ kind, waitMs, ...(who !== undefined && { who }), ...(signal && { signal }) });

/** The player's place in line (1 = next), or null when they are not waiting. */
export const replayQueuePlace = (who: number): number | null => gate.place(who);

/**
 * Runs one job: on the warm pool, or for a test's own worker module on a
 * pool of one made for the job and closed after it.
 */
const run = async (job: ReplayJob, deadlineMs: number, workerUrl: URL): Promise<ReplayReply & { ok: true }> => {
  if (workerUrl.href === WORKER_URL.href) return pool.run(job, deadlineMs);
  const own = new ReplayPool({
    workerUrl,
    size: 1,
    maxJobs: 1,
    maxHeapBytes: REPLAY_WORKER_MAX_HEAP_BYTES,
    onLoadFailure: (reason) => noteWorkerLoadFailure(reason),
    onLoaded: noteWorkerLoaded,
  });
  try {
    return await own.run(job, deadlineMs);
  } finally {
    own.close();
  }
};

/**
 * An abandoned attack's replay (`replayAbandonedAttack`), in a worker.
 *
 * @param deadlineMs - From now, queue time included.
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
  const reply = await run({ kind: "raid", input }, deadlineMs, WORKER_URL);
  if (reply.kind !== "raid") throw new Error("Battle replay answered the wrong job");
  return reply.result;
};
