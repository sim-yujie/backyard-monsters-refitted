import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { replayAttack } from "./replay.js";

/**
 * The performance budget of `docs/design/server-combat.md` §3.5.
 *
 * Phase B runs a replay in a Bun worker behind a **5 s deadline** on the save
 * request; a replay that misses it falls back to Phase A's bound and logs
 * `replayTimeout`. The budget is therefore **under 500 ms median and under 2 s
 * worst on Bun**, and this test fails above 5 s — the point at which the
 * feature stops working rather than merely getting slow.
 *
 * It asserts the ceiling rather than the target, because a test that failed on
 * a loaded continuous-integration machine would be noise. It still needs to be
 * tolerant of *this* machine being loaded (several agents' test suites running
 * at once routinely pushed a wall-clock measurement from ~500 ms to 5.1-18.9 s
 * with no change to the code under test), so it measures CPU time
 * (`process.cpuUsage`) rather than wall-clock time: time the process spends
 * preempted by other work is not time `replayAttack` spent computing, and only
 * the latter is what the §3.5 budget is about. `bun tools/bench-combat.mjs`
 * from `web/` reports the real wall-clock numbers on the runtime the budget is
 * written against; this only guards the cliff, and does so on an idle or a
 * busy machine alike.
 *
 * The suite runs in worker threads (`vite.config.ts`), where the process's
 * CPU time is every test file's at once; the measure is this thread's
 * (`process.threadCpuUsage`, Node 23.9+), and the process's only on a
 * runtime without it.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../../../../test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(
  new URL("../../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url),
);

/** The busiest scenario: four flings, a champion, a bomb, five minutes. */
const SCENARIO = "mixed-waves";

/** Where this test stops being a warning and starts being a failure. */
const CEILING_MS = 5000;

/** CPU time used so far by this thread, or by the process where the runtime cannot say. */
const cpuUsage = (since?: NodeJS.CpuUsage): NodeJS.CpuUsage => {
  const thread = (process as { threadCpuUsage?: (previous?: NodeJS.CpuUsage) => NodeJS.CpuUsage })
    .threadCpuUsage;
  return thread ? thread.call(process, since) : process.cpuUsage(since);
};

const read = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

describe("replay performance", () => {
  it(
    `replays ${SCENARIO} on the sandbox yard inside the ${CEILING_MS} ms ceiling`,
    { timeout: 120000 },
    () => {
      const fixture = read(`${FIXTURE_DIR}${SCENARIO}.json`);
      const sandbox = read(SANDBOX);
      const input = {
        buildingdata: sandbox.buildingdata,
        buildinghealthdata: sandbox.buildinghealthdata,
        resources: sandbox.resources,
        kind: fixture.kind,
        log: fixture.log,
        levels: fixture.levels,
        playerLevel: fixture.playerLevel,
        tailTicks: fixture.tailTicks,
      };

      const runs: { wallMs: number; cpuMs: number }[] = [];
      for (let run = 0; run < 3; run += 1) {
        const startedCpu = cpuUsage();
        const started = process.hrtime.bigint();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outcome = replayAttack(input as any);
        const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
        const cpu = cpuUsage(startedCpu);
        runs.push({ wallMs, cpuMs: (cpu.user + cpu.system) / 1000 });
        expect(outcome.ticks).toBeGreaterThan(0);
      }

      const byWall = [...runs].sort((one, other) => one.wallMs - other.wallMs);
      const byCpu = [...runs].sort((one, other) => one.cpuMs - other.cpuMs);
      const medianWall = byWall[1]!.wallMs;
      const medianCpu = byCpu[1]!.cpuMs;
      // Wall time is reported rather than asserted: on a busy machine it also
      // counts time this process spent preempted by unrelated work, which the
      // §3.5 budget was never meant to cover. CPU time is not, and stays close
      // to the wall-clock number on an idle machine.
      console.warn(
        `combat replay ${SCENARIO}: median ${medianCpu.toFixed(1)} ms CPU ` +
          `(${medianWall.toFixed(1)} ms wall) over ${runs.length} runs ` +
          `(budget 500 ms, ceiling ${CEILING_MS} ms)`,
      );
      expect(medianCpu).toBeLessThan(CEILING_MS);
    },
  );
});
