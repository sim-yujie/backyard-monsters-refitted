import { replayAbandonedAttack } from "./abandonedAttack.js";
import { fightRaid } from "../../raids/raidFight.js";
import type { ReplayJob, ReplayReply } from "./replayRunner.js";

/**
 * The combat engine off the request thread (issue #23, C5): one job in, one
 * answer out, then `replayRunner.ts` terminates the worker.
 *
 * Only the pure replay modules load here: nothing reaches the database, Redis
 * or the logger (`abandonedAttack.ts` and `raidFight.ts` import none of
 * them), so a worker costs its own copy of the engine and nothing else.
 */
// Bun types a worker's global scope as the `Worker` it talks back through.
declare const self: Worker;

self.onmessage = (event: MessageEvent<ReplayJob>): void => {
  const job = event.data;
  let reply: ReplayReply;
  try {
    reply =
      job.kind === "raid"
        ? { ok: true, kind: "raid", result: fightRaid(job.input) }
        : { ok: true, kind: "abandoned", result: replayAbandonedAttack(job.input) };
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
