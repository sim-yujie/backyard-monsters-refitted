// Prototype (fixes a, b, c; NOT for merging): what replayRunner.ts could become.
// - a. A warm pool: `size` workers loaded once and reused; a worker past its deadline is
//   terminated and replaced (so a stuck replay still cannot hold the next one), and each worker
//   is replaced after `maxJobs` jobs to bound any slow leak. Far fewer spawns also removes the
//   22 Nov failure mode (Bun's transpiler broke after ~12,000 workers).
// - b. Fair admission: jobs that may wait (Repeat, raid start) queue FIFO with a position and a
//   longer wait; jobs that may not (attack saves, the finaliser) go to the head of the queue.
// - c. Workers at nice +10, so with `size` 2 on 2 cores the main thread still gets the CPU first.
export interface PoolOptions {
  size: number;
  nice: number;
  maxJobs: number;
  workerUrl: URL;
}
type Job = { kind: string; input: unknown };
interface Slot {
  worker: Worker;
  busy: boolean;
  jobs: number;
  ready: Promise<void>;
}
interface Pending {
  job: Job;
  deadlineMs: number;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  queuedAt: number;
  priority: boolean;
  giveUpAt: number | null;
}

export class ReplayPool {
  private slots: Slot[] = [];
  private queue: Pending[] = [];
  private nextId = 1;
  spawned = 0;
  constructor(private readonly opts: PoolOptions) {
    for (let i = 0; i < opts.size; i++) this.slots.push(this.spawn());
  }
  private spawn(): Slot {
    this.spawned++;
    const worker = new Worker(this.opts.workerUrl, { env: { ...process.env, REPLAY_NICE: String(this.opts.nice) } } as any);
    const ready = new Promise<void>((res) => {
      worker.onmessage = (e: MessageEvent<any>) => e.data?.ready && res();
    });
    return { worker, busy: false, jobs: 0, ready };
  }
  /** Where a waiting job stands (1 = next), for "you are number N" on the client. */
  position(p: Pending): number {
    return this.queue.indexOf(p) + 1;
  }
  get waiting(): number {
    return this.queue.length;
  }
  get idle(): number {
    return this.slots.filter((s) => !s.busy).length;
  }
  /**
   * Runs a job. `waitMs` null: never refused (saves, finaliser), queued ahead of the waiters.
   * Otherwise refused with "busy" once it has waited `waitMs` without a worker.
   */
  run<T>(job: Job, deadlineMs: number, waitMs: number | null): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { job, deadlineMs, resolve, reject, queuedAt: performance.now(), priority: waitMs === null, giveUpAt: waitMs === null ? null : performance.now() + waitMs };
      if (p.priority) {
        const firstWaiter = this.queue.findIndex((q) => !q.priority);
        this.queue.splice(firstWaiter < 0 ? this.queue.length : firstWaiter, 0, p);
      } else this.queue.push(p);
      if (p.giveUpAt !== null)
        setTimeout(() => {
          const at = this.queue.indexOf(p);
          if (at < 0) return;
          this.queue.splice(at, 1);
          reject(Object.assign(new Error("busy"), { name: "ReplayBusy" }));
        }, waitMs!);
      this.pump();
    });
  }
  private pump(): void {
    for (const slot of this.slots) {
      if (slot.busy || this.queue.length === 0) continue;
      const p = this.queue.shift()!;
      this.dispatch(slot, p);
    }
  }
  private async dispatch(slot: Slot, p: Pending): Promise<void> {
    slot.busy = true;
    await slot.ready;
    const id = this.nextId++;
    const done = (replace: boolean) => {
      clearTimeout(timer);
      if (replace || ++slot.jobs >= this.opts.maxJobs) {
        slot.worker.terminate();
        const fresh = this.spawn();
        Object.assign(slot, fresh);
      }
      slot.busy = false;
      this.pump();
    };
    const timer = setTimeout(() => {
      done(true);
      p.reject(Object.assign(new Error(`timeout ${p.deadlineMs}`), { name: "ReplayTimeoutError" }));
    }, p.deadlineMs);
    slot.worker.onmessage = (e: MessageEvent<any>) => {
      if (e.data?.id !== id) return;
      done(false);
      e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
    };
    slot.worker.onerror = (e: ErrorEvent) => {
      done(true);
      p.reject(new Error(String(e.message)));
    };
    slot.worker.postMessage({ id, job: p.job });
  }
  close(): void {
    for (const s of this.slots) s.worker.terminate();
  }
}
