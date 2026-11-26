// A measuring copy of src/services/base/combat/replayWorker.ts (not used by the game):
// the same two modules, the same job, plus timestamps (epoch ms, comparable across threads).
// It stays alive for more jobs, so the bench can also try a warm (reused) worker.
const loadStart = performance.timeOrigin + performance.now();
import { replayAbandonedAttack } from "../src/services/base/combat/abandonedAttack.js";
import { fightRaid } from "../src/services/raids/raidFight.js";
declare const self: Worker;
const now = () => performance.timeOrigin + performance.now();
self.onmessage = (event: MessageEvent<any>): void => {
  const got = now();
  const job = event.data;
  const fightStart = now();
  let result: unknown;
  let error: string | undefined;
  try {
    result = job.kind === "raid" ? fightRaid(job.input) : replayAbandonedAttack(job.input);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const fightEnd = now();
  self.postMessage({ done: true, got, fightStart, fightEnd, sent: now(), error, result });
};
self.postMessage({ ready: true, at: now(), loadStart });
