import os from "node:os";
import { replayAbandonedAttack } from "./abandonedAttack.js";
import { fightRaid } from "../../raids/raidFight.js";
import type { ReplayJob, ReplayReply, ReplayWorkerReady } from "./replayRunner.js";

/**
 * The combat engine off the request thread (issue #23, C5): a warm worker of
 * `replayPool.ts` (patch 9.1) that takes job after job and answers each with
 * its id and its heap size (the pool replaces a worker grown too big).
 *
 * Only the pure replay modules load here: nothing reaches the database, Redis
 * or the logger (`abandonedAttack.ts` and `raidFight.ts` import none of
 * them), so a worker costs its own copy of the engine and nothing else. They
 * keep no state between battles: a warm worker gives the answer a fresh one
 * does (`replayPool.test.ts`).
 */
// Bun types a worker's global scope as the `Worker` it talks back through.
declare const self: Worker;

/**
 * Battles at a lower CPU priority than the server's requests (nice +10,
 * `REPLAY_WORKER_NICE`): on Linux the priority is per thread and pid 0 is
 * the calling thread, so this lowers only this worker (and the collector
 * threads it starts after), never the main thread. Needs no capability in
 * Docker. Elsewhere, or if refused, the worker runs at normal priority.
 */
const nice = Number(process.env.REPLAY_WORKER_NICE ?? 10);
if (Number.isFinite(nice) && nice > 0) {
  try {
    os.setPriority(0, Math.min(19, nice));
  } catch {
    /* not allowed here: normal priority */
  }
}

self.onmessage = (event: MessageEvent<{ id: number; job: ReplayJob }>): void => {
  const { id, job } = event.data;
  let reply: ReplayReply;
  try {
    reply =
      job.kind === "raid"
        ? { ok: true, kind: "raid", result: fightRaid(job.input) }
        : { ok: true, kind: "abandoned", result: replayAbandonedAttack(job.input) };
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage({ ...reply, id, heap: process.memoryUsage().heapUsed });
};

// Every module above has loaded: say so first, so a failure from here on is
// the replay's own and not a worker that never started (`ReplayWorkerLoadError`).
const ready: ReplayWorkerReady = { ready: true };
self.postMessage(ready);
