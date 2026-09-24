/**
 * Writes the golden replay fixtures.
 *
 *   cd web && bun tools/gen-combat-fixture.mjs             # every scenario
 *   cd web && bun tools/gen-combat-fixture.mjs pokey-rush  # one of them
 *
 * Bun rather than Node, for the same reason `gen:combat` uses it: the engine is
 * TypeScript with `.js` import suffixes and Bun runs it with no build step.
 *
 * Each fixture carries the scenario and the outcome the engine produced for it:
 * the totals, the 800-tick checkpoint digests and the final digest
 * (`docs/design/server-combat.md` §4.1). `replay.test.ts` re-runs them under
 * Vitest on Node and `server/src/game-rules/combat/replay.test.ts` under Bun,
 * and both must reproduce the file. That is the cross-runtime proof §3.4 asks
 * for, so a regenerated digest is a change to the rules of combat and belongs
 * in a pull request with a reason.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { replayAttack } from "../src/game/combat/rules/replay.js";
import {
  FIXTURE_DIR,
  SCENARIOS,
  expectedOf,
  scenarioInput,
} from "./lib/combat-scenarios.mjs";

const wanted = process.argv.slice(2).filter((one) => !one.startsWith("-"));
const chosen = wanted.length > 0 ? SCENARIOS.filter((one) => wanted.includes(one.name)) : SCENARIOS;

if (chosen.length === 0) {
  console.error(`No scenario matched ${wanted.join(", ")}.`);
  console.error(`Known: ${SCENARIOS.map((one) => one.name).join(", ")}`);
  process.exit(1);
}

mkdirSync(FIXTURE_DIR, { recursive: true });

for (const scenario of chosen) {
  const started = process.hrtime.bigint();
  const outcome = replayAttack(scenarioInput(scenario));
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;

  const fixture = {
    name: scenario.name,
    description: scenario.description,
    yard: scenario.yard,
    kind: scenario.kind,
    ...(scenario.resources ? { resources: scenario.resources } : {}),
    levels: scenario.levels,
    playerLevel: scenario.playerLevel,
    tailTicks: scenario.tailTicks,
    log: scenario.log,
    expected: expectedOf(outcome),
  };

  const path = resolve(FIXTURE_DIR, `${scenario.name}.json`);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(
    `${scenario.name.padEnd(14)} ${elapsed.toFixed(1).padStart(8)} ms  ` +
      `tick ${String(outcome.ticks).padStart(6)}  ` +
      `damage ${outcome.damage.toFixed(2).padStart(6)}%  ` +
      `killed ${String(outcome.creepsKilled).padStart(4)}  ` +
      `digest ${outcome.digest}`,
  );
}
