// Prototype (fix a + c, NOT for merging): a replay worker that stays loaded and takes job after
// job, optionally at a lower CPU priority. The same two engine modules as replayWorker.ts.
import os from "node:os";
import { replayAbandonedAttack } from "../../src/services/base/combat/abandonedAttack.js";
import { fightRaid } from "../../src/services/raids/raidFight.js";
declare const self: Worker;
const nice = Number(process.env.REPLAY_NICE ?? 0);
// Linux: priority is per thread, and pid 0 means the calling thread, so this lowers only this
// worker (checked in /proc/self/task/*/stat: main thread stays 0). Needs no capability in Docker.
if (nice > 0) {
  try {
    os.setPriority(0, nice);
  } catch {
    /* not Linux, or refused: run at normal priority */
  }
}
self.onmessage = (event: MessageEvent<any>): void => {
  const { id, job } = event.data;
  try {
    const result = job.kind === "raid" ? fightRaid(job.input) : replayAbandonedAttack(job.input);
    self.postMessage({ id, ok: true, kind: job.kind, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
self.postMessage({ ready: true });
