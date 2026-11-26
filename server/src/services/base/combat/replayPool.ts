/**
 * A small pool of warm battle replay workers (patch 9.1, owner's option A on
 * card repeat-busy-91, 26 Nov 2026), in place of one new worker per battle.
 *
 * Why: a fresh worker loads the whole combat engine and fights 2-6x slower
 * than a warm one (the battle-load diagnosis, `diag/battle-load`), and Bun
 * 1.4.2 broke after ~12,000 workers on the live server (22 Nov 2026). A warm
 * worker gives the same answer as a fresh one (checked over the diagnosis's
 * 70 real jobs, three shuffled passes, no difference; and in the tests).
 *
 * - **Size.** `size` workers fight at once (2 on the live box's 2 cores); more
 *   jobs wait in one first-come queue. Each worker lowers its own thread's
 *   priority (`replayWorker.ts`), so the server's requests still get the CPU
 *   first while both fight.
 * - **Deadline from the ask.** A job's deadline counts from when it was asked
 *   for, queue time included: the finaliser's 20 s must stay inside its 30 s
 *   lock. A job still queued at its deadline is dropped without touching a
 *   worker; one still fighting has its worker stopped. Both reject with
 *   {@link ReplayTimeoutError}, which leaves the attack to land later.
 * - **Heals itself.** A worker is replaced (stopped, and a fresh one started)
 *   when it runs past a deadline, crashes or exits (busy or idle), never
 *   loads, has fought `maxJobs` battles, or reports a heap over
 *   `maxHeapBytes`. A worker that never loads fails its job with
 *   {@link ReplayWorkerLoadError} and its seat waits a growing pause (1 s
 *   doubling to 60 s) before the next try, so a broken process does not
 *   churn workers; `onLoadFailure` lets the runner restart the server.
 * - **Lazy unless warmed.** Nothing starts until the first job or
 *   {@link ReplayPool.warm} (the server calls it at boot). Workers are
 *   `unref`'d, so a test that imports the runner can still exit.
 */
import type { ReplayJob, ReplayReply, ReplayWorkerMessage } from "./replayRunner.js";
import { ReplayTimeoutError, ReplayWorkerLoadError } from "./replayErrors.js";

export interface ReplayPoolOptions {
  readonly workerUrl: URL;
  /** Workers fighting at once. */
  readonly size: number;
  /** Battles a worker fights before it is replaced (bounds a slow leak). */
  readonly maxJobs: number;
  /** A worker reporting more heap than this after a battle is replaced. */
  readonly maxHeapBytes: number;
  /** Told of every worker that failed to load (the broken-workers watch). */
  readonly onLoadFailure?: (reason: string) => void;
  /** Told of every worker that loaded (ends the run of failures). */
  readonly onLoaded?: () => void;
  /** Told why a worker was replaced (the log). */
  readonly onReplaced?: (why: ReplacedWhy, detail: string) => void;
  /** Told whenever a seat frees up (the admission gate looks again). */
  readonly onFree?: () => void;
  /**
   * Until {@link ReplayPool.warm}, a worker idle this long is stopped (tests
   * and scripts, which never warm the pool, leave no workers behind).
   */
  readonly idleMs?: number;
  /** First pause after a load failure (tests shorten it). */
  readonly loadBackoffMs?: number;
}

export type ReplacedWhy = "timeout" | "crash" | "exit" | "load" | "jobs" | "heap";

/** First pause after a load failure; doubles per failure in a row. */
export const LOAD_BACKOFF_MS = 1_000;
export const LOAD_BACKOFF_MAX_MS = 60_000;

interface Pending {
  readonly id: number;
  readonly job: ReplayJob;
  readonly deadlineMs: number;
  readonly resolve: (reply: ReplayReply & { ok: true }) => void;
  readonly reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  seat: Seat | null;
}

interface Seat {
  worker: Worker | null;
  /** The worker said it loaded. */
  loaded: boolean;
  job: Pending | null;
  jobs: number;
  /** A load failure in a row: no new worker before this time. */
  pauseUntil: number;
  failures: number;
  pauseTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** What a worker reports after each battle, besides the answer. */
interface WorkerReplyMeta {
  readonly id?: number;
  readonly heap?: number;
}

export class ReplayPool {
  private readonly seats: Seat[] = [];
  private readonly queue: Pending[] = [];
  private nextId = 1;
  private keepWarm = false;
  private closed = false;
  /** Workers started since the pool was made. */
  spawned = 0;
  /** Workers replaced, by why. */
  readonly replaced: Record<ReplacedWhy, number> = { timeout: 0, crash: 0, exit: 0, load: 0, jobs: 0, heap: 0 };

  constructor(private readonly opts: ReplayPoolOptions) {
    for (let i = 0; i < Math.max(1, opts.size); i++)
      this.seats.push({ worker: null, loaded: false, job: null, jobs: 0, pauseUntil: 0, failures: 0, pauseTimer: null, idleTimer: null });
  }

  get size(): number {
    return this.seats.length;
  }

  /** Jobs waiting for a worker. */
  get queued(): number {
    return this.queue.length;
  }

  /** Workers fighting a battle now. */
  get fighting(): number {
    return this.seats.filter((seat) => seat.job !== null).length;
  }

  /** Workers alive (fighting, idle or loading). */
  get alive(): number {
    return this.seats.filter((seat) => seat.worker !== null).length;
  }

  /** A job asked for now would start at once. */
  get hasFreeSeat(): boolean {
    return this.queue.length === 0 && this.seats.some((seat) => seat.job === null && seat.pauseUntil <= Date.now());
  }

  /** Starts every worker now and keeps them started (the server, at boot). */
  warm(): void {
    this.keepWarm = true;
    for (const seat of this.seats) this.stopIdle(seat);
    for (const seat of this.seats) if (!seat.worker && seat.pauseUntil <= Date.now()) this.spawn(seat);
  }

  /** Stops every worker and fails what is queued (tests, shutdown). */
  close(): void {
    this.closed = true;
    for (const pending of this.queue.splice(0)) this.settle(pending, () => pending.reject(new Error("Replay pool closed")));
    for (const seat of this.seats) {
      if (seat.pauseTimer) clearTimeout(seat.pauseTimer);
      this.stopIdle(seat);
      const job = seat.job;
      this.retire(seat);
      if (job) this.settle(job, () => job.reject(new Error("Replay pool closed")));
    }
  }

  /**
   * Fights `job` on the next free worker.
   *
   * @param deadlineMs - From now, queue time included.
   * @throws {ReplayTimeoutError} Not answered by the deadline.
   * @throws {ReplayWorkerLoadError} The worker it was given never loaded.
   */
  run(job: ReplayJob, deadlineMs: number): Promise<ReplayReply & { ok: true }> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error("Replay pool closed"));
        return;
      }
      const pending: Pending = { id: this.nextId++, job, deadlineMs, resolve, reject, timer: null, seat: null };
      pending.timer = setTimeout(() => this.expire(pending), deadlineMs);
      this.queue.push(pending);
      this.pump();
    });
  }

  private expire(pending: Pending): void {
    pending.timer = null;
    const at = this.queue.indexOf(pending);
    if (at >= 0) {
      // Never reached a worker: nothing to stop.
      this.queue.splice(at, 1);
      pending.reject(new ReplayTimeoutError(pending.deadlineMs));
      return;
    }
    const seat = pending.seat;
    if (!seat || seat.job !== pending) return;
    seat.job = null;
    this.replace(seat, "timeout", `${pending.deadlineMs} ms`);
    pending.reject(new ReplayTimeoutError(pending.deadlineMs));
    this.freed();
  }

  /** Settles a job once: clears its timer first. */
  private settle(pending: Pending, settle: () => void): void {
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = null;
    settle();
  }

  private pump(): void {
    if (this.closed) return;
    const now = Date.now();
    for (const seat of this.seats) {
      if (this.queue.length === 0) return;
      if (seat.job || seat.pauseUntil > now) continue;
      const pending = this.queue.shift()!;
      this.stopIdle(seat);
      if (!seat.worker) this.spawn(seat);
      seat.job = pending;
      pending.seat = seat;
      seat.worker!.postMessage({ id: pending.id, job: pending.job });
    }
  }

  private spawn(seat: Seat): void {
    const worker = new Worker(this.opts.workerUrl);
    this.spawned++;
    seat.worker = worker;
    seat.loaded = false;
    seat.jobs = 0;
    // Bun's Worker has unref(); the pool must not keep a finished process alive.
    (worker as Worker & { unref?: () => void }).unref?.();
    worker.onmessage = (event: MessageEvent<ReplayWorkerMessage & WorkerReplyMeta>) => {
      if (seat.worker !== worker) return;
      const message = event.data;
      if (!seat.loaded) {
        seat.loaded = true;
        seat.failures = 0;
        this.opts.onLoaded?.();
      }
      if ("ready" in message) return;
      const pending = seat.job;
      if (!pending || (message.id !== undefined && message.id !== pending.id)) return;
      seat.job = null;
      seat.jobs++;
      const heap = Number(message.heap ?? 0);
      if (heap > this.opts.maxHeapBytes) this.replace(seat, "heap", `${Math.round(heap / 1048576)} MB`);
      else if (seat.jobs >= this.opts.maxJobs) this.replace(seat, "jobs", String(seat.jobs));
      this.settle(pending, () =>
        message.ok ? pending.resolve(message) : pending.reject(new Error(`Battle replay failed: ${message.error}`))
      );
      this.freed();
    };
    worker.onerror = (event: ErrorEvent) => {
      if (seat.worker !== worker) return;
      event.preventDefault?.();
      this.died(seat, String(event.message ?? "unknown error"), "crash");
    };
    worker.addEventListener("close", (event: Event) => {
      if (seat.worker !== worker) return;
      this.died(seat, `exited with code ${(event as Event & { code?: number }).code ?? "?"}`, "exit");
    });
  }

  /** The seat's worker crashed or exited, fighting or idle. */
  private died(seat: Seat, reason: string, why: "crash" | "exit"): void {
    const pending = seat.job;
    seat.job = null;
    if (!seat.loaded) {
      // Its modules never ran: no battle was fought (22 Nov 2026).
      this.replace(seat, "load", reason);
      this.opts.onLoadFailure?.(reason);
      if (pending) this.settle(pending, () => pending.reject(new ReplayWorkerLoadError(reason)));
    } else {
      this.replace(seat, why, reason);
      if (pending) this.settle(pending, () => pending.reject(new Error(`Battle replay worker failed: ${reason}`)));
    }
    this.freed();
  }

  private retire(seat: Seat): void {
    this.stopIdle(seat);
    const worker = seat.worker;
    seat.worker = null;
    seat.loaded = false;
    seat.job = null;
    worker?.terminate();
  }

  /** Stops the seat's worker; a fresh one starts now if warm, after the pause after a load failure. */
  private replace(seat: Seat, why: ReplacedWhy, detail: string): void {
    this.replaced[why]++;
    this.opts.onReplaced?.(why, detail);
    this.retire(seat);
    if (why === "load") {
      seat.failures++;
      const pause = Math.min(LOAD_BACKOFF_MAX_MS, (this.opts.loadBackoffMs ?? LOAD_BACKOFF_MS) * 2 ** (seat.failures - 1));
      seat.pauseUntil = Date.now() + pause;
      if (seat.pauseTimer) clearTimeout(seat.pauseTimer);
      seat.pauseTimer = setTimeout(() => {
        seat.pauseTimer = null;
        if (this.closed) return;
        if (this.keepWarm && !seat.worker) this.spawn(seat);
        this.freed();
      }, pause);
      (seat.pauseTimer as { unref?: () => void }).unref?.();
      return;
    }
    if (this.keepWarm && !this.closed) this.spawn(seat);
  }

  private freed(): void {
    this.pump();
    if (!this.keepWarm && !this.closed) for (const seat of this.seats) this.idleLater(seat);
    this.opts.onFree?.();
  }

  /** An idle worker of a pool never warmed stops after `idleMs`. */
  private idleLater(seat: Seat): void {
    if (!seat.worker || seat.job || seat.idleTimer) return;
    seat.idleTimer = setTimeout(() => {
      seat.idleTimer = null;
      if (!seat.job && !this.keepWarm) this.retire(seat);
    }, this.opts.idleMs ?? 2_000);
    (seat.idleTimer as { unref?: () => void }).unref?.();
  }

  private stopIdle(seat: Seat): void {
    if (seat.idleTimer) clearTimeout(seat.idleTimer);
    seat.idleTimer = null;
  }
}
