import { baiterRun, baiterStart } from "@/api/goals";
import type { AttackEndReason } from "@/game/attack/AttackSession";

/**
 * The server's record of a finished Baiter practice run, which goal N1
 * counted until it became "survive a tribe attack" (#226 WP5,
 * `docs/design/tutorial.md` §6.2, issue #227). The run itself
 * stays on this screen, as before (#126): the battle, the army and the
 * outcome never leave it. Only these two small calls do:
 *
 * - as the run starts, `goals/baiter-start` asks for a one-use token;
 * - when it ends in a real finish (the yard flattened, the army spent, or the
 *   clock run out; not a stop or a walk-away), `goals/baiter-run` hands the
 *   token back and the server counts the run
 *   (`server/src/services/goals/baiterRun.ts`).
 *
 * Neither call ever gets in the way: a refusal or a lost connection only
 * means the run is not counted.
 */

export interface BaiterRecorder {
  /** The run started. */
  start(): void;
  /** The run ended; counted only for a real finish. */
  finish(reason: AttackEndReason | null): void;
}

/** The ends that count as a finished run. */
export const FINISHED_RUN: ReadonlySet<AttackEndReason> = new Set(["destroyed", "exhausted", "expired"]);

export interface BaiterRecordApi {
  start(): Promise<{ report: { token: string } }>;
  run(token: string): Promise<unknown>;
}

const goalsApi: BaiterRecordApi = { start: () => baiterStart(), run: (token) => baiterRun(token) };

/** One run's recorder. */
export const baiterRecorder = (api: BaiterRecordApi = goalsApi): BaiterRecorder => {
  let token: Promise<string | null> | null = null;
  return {
    start() {
      token = api.start().then(
        (answer) => answer.report.token,
        () => null,
      );
    },
    finish(reason) {
      const pending = token;
      token = null;
      if (!pending || reason === null || !FINISHED_RUN.has(reason)) return;
      void pending.then((issued) => (issued ? api.run(issued).catch(() => undefined) : undefined));
    },
  };
};
