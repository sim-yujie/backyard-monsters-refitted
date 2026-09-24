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
 * a loaded continuous-integration machine would be noise. `bun
 * tools/bench-combat.mjs` from `web/` reports the real numbers on the runtime
 * the budget is written against; this only guards the cliff.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../../../../test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(
  new URL("../../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url),
);

/** The busiest scenario: four flings, a champion, a bomb, five minutes. */
const SCENARIO = "mixed-waves";

/** Where this test stops being a warning and starts being a failure. */
const CEILING_MS = 5000;

const read = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

describe("replay performance", () => {
  it(
    `replays ${SCENARIO} on the sandbox yard inside the ${CEILING_MS} ms ceiling`,
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

      const runs: number[] = [];
      for (let run = 0; run < 3; run += 1) {
        const started = process.hrtime.bigint();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outcome = replayAttack(input as any);
        runs.push(Number(process.hrtime.bigint() - started) / 1e6);
        expect(outcome.ticks).toBeGreaterThan(0);
      }

      const median = [...runs].sort((one, other) => one - other)[1] as number;
      // Reported rather than asserted: the target lives in the bench script.
      console.warn(
        `combat replay ${SCENARIO}: median ${median.toFixed(1)} ms ` +
          `over ${runs.length} runs (budget 500 ms, ceiling ${CEILING_MS} ms)`,
      );
      expect(median).toBeLessThan(CEILING_MS);
    },
    { timeout: 120000 },
  );
});
