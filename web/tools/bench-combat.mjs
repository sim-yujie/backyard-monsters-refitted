/**
 * Times a full attack replay on the sandbox yard.
 *
 *   cd web && bun tools/bench-combat.mjs           # the default scenario
 *   cd web && bun tools/bench-combat.mjs --all     # every scenario
 *   cd web && bun tools/bench-combat.mjs -n 11     # a different sample size
 *
 * `docs/design/server-combat.md` §3.5 budgets a Phase B replay at **under
 * 500 ms median and under 2 s worst on Bun**, with 5 s the point at which the
 * test fails. The figure matters because the replay runs in a worker behind a
 * 5 s deadline on the save request (§3.5), and a replay that misses it falls
 * back to Phase A's bound.
 *
 * Bun rather than Node, because Bun is what the server runs and the budget is
 * written against it. The same scenarios run under Vitest in `bench.test.ts`,
 * which asserts the ceiling rather than reporting the number.
 */

import { replayAttack } from "../src/game/combat/rules/replay.js";
import { BENCH_SCENARIO, SCENARIOS, scenarioInput } from "./lib/combat-scenarios.mjs";

const args = process.argv.slice(2);
const all = args.includes("--all");
const sampleFlag = args.indexOf("-n");
const samples = sampleFlag >= 0 ? Number(args[sampleFlag + 1]) : 7;

const chosen = all ? SCENARIOS : SCENARIOS.filter((one) => one.name === BENCH_SCENARIO);

/**
 * Wall-clock milliseconds for one replay; nothing inside the engine is timed.
 *
 * `process.hrtime` rather than Bun's own clock, so the script stays a plain
 * Node script that Bun happens to run — the module under it is what needs Bun.
 */
const time = (input) => {
  const started = process.hrtime.bigint();
  const outcome = replayAttack(input);
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, outcome };
};

const median = (values) => {
  const sorted = [...values].sort((one, other) => one - other);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const runtime = process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`;
console.log(`${runtime}, ${samples} runs per scenario`);
console.log("scenario        median      worst      ticks   creeps  damage");

let worstMedian = 0;

for (const scenario of chosen) {
  const input = scenarioInput(scenario);
  // One untimed run so the JIT has seen the code before the sample starts.
  const warm = time(input);
  const runs = [];
  for (let run = 0; run < samples; run += 1) runs.push(time(input).ms);
  const mid = median(runs);
  worstMedian = Math.max(worstMedian, mid);
  console.log(
    `${scenario.name.padEnd(14)} ${mid.toFixed(1).padStart(7)} ms ${Math.max(...runs)
      .toFixed(1)
      .padStart(7)} ms ${String(warm.outcome.ticks).padStart(7)} ` +
      `${String(warm.outcome.creepsFlung).padStart(7)}  ${warm.outcome.damage.toFixed(2)}%`,
  );
}

const BUDGET_MS = 500;
console.log(
  worstMedian <= BUDGET_MS
    ? `\nWithin the ${BUDGET_MS} ms median budget (§3.5).`
    : `\nOVER the ${BUDGET_MS} ms median budget (§3.5): ${worstMedian.toFixed(1)} ms.`,
);
