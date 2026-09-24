import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { replayAttack } from "./replay.js";

/**
 * The golden replays, under Bun, against the synced copy of the module.
 *
 * This is the other half of the cross-runtime proof `docs/design/
 * server-combat.md` §3.4 rule 5 asks for. `web/src/game/combat/rules/
 * replay.test.ts` runs the same fixture files under Vitest on Node against the
 * source; this runs them under Bun against the copy the sync script wrote. The
 * committed digests must come out of both, because the Wild Monster Baiter
 * simulates in the browser and the server replays under Bun, and a server that
 * disagreed would refuse a battle the player watched (§3.2).
 *
 * The fixtures are reached through `../../../../web/test/fixtures/combat/`, the
 * same relative reach `src/game-data/buildingCosts.test.ts` makes for the
 * sandbox yard. They are data, not part of the module, so the sync script
 * neither copies nor touches them.
 *
 * Regenerate with `bun tools/gen-combat-fixture.mjs` from `web/`. A changed
 * digest is a changed rule of combat.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../../../../web/test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(
  new URL("../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url),
);

interface Fixture {
  name: string;
  yard: "sandbox" | Record<string, Record<string, number>>;
  kind: "main" | "outpost" | "wild" | "tribe";
  resources?: Record<string, number>;
  levels: Record<string, number>;
  playerLevel: number;
  tailTicks: number;
  log: { v: 1; seed: number; events: unknown[] };
  expected: Record<string, unknown>;
}

const read = (path: string): any => JSON.parse(readFileSync(path, "utf8"));

const names = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort();

let sandbox: any = null;

const inputOf = (fixture: Fixture): any => {
  if (fixture.yard === "sandbox") {
    sandbox ??= read(SANDBOX);
    return {
      buildingdata: sandbox.buildingdata,
      buildinghealthdata: sandbox.buildinghealthdata,
      resources: sandbox.resources,
      kind: fixture.kind,
      log: fixture.log,
      levels: fixture.levels,
      playerLevel: fixture.playerLevel,
      tailTicks: fixture.tailTicks,
    };
  }
  return {
    buildingdata: fixture.yard,
    buildinghealthdata: {},
    resources: fixture.resources ?? {},
    kind: fixture.kind,
    log: fixture.log,
    levels: fixture.levels,
    playerLevel: fixture.playerLevel,
    tailTicks: fixture.tailTicks,
  };
};

const actualOf = (outcome: ReturnType<typeof replayAttack>) => ({
  ticks: outcome.ticks,
  damage: outcome.damage,
  destroyed: outcome.destroyed ?? null,
  attackloot: outcome.attackloot,
  defenderLoss: outcome.defenderLoss,
  firedTraps: outcome.firedTraps.length,
  destroyedBuildings: outcome.destroyedIds.length,
  creepsFlung: outcome.creepsFlung,
  creepsKilled: outcome.creepsKilled,
  championHp: outcome.championHp,
  damagedBuildings: Object.keys(outcome.health).length,
  rngDraws: outcome.rngDraws,
  checkpoints: outcome.checkpoints,
  digest: outcome.digest,
});

describe("golden replays under Bun", () => {
  test("the fixtures are there", () => {
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of names) {
    test(`${file} reproduces its committed outcome`, () => {
      const fixture = read(`${FIXTURE_DIR}${file}`) as Fixture;
      const outcome = replayAttack(inputOf(fixture));
      expect(actualOf(outcome)).toEqual(fixture.expected as any);
    });
  }

  test("the busiest replay stays inside the 5 s deadline of §3.5", () => {
    const fixture = read(`${FIXTURE_DIR}mixed-waves.json`) as Fixture;
    const started = Bun.nanoseconds();
    const outcome = replayAttack(inputOf(fixture));
    const elapsed = (Bun.nanoseconds() - started) / 1e6;
    expect(outcome.ticks).toBeGreaterThan(0);
    // The budget is 500 ms median; this guards the cliff, not the target.
    expect(elapsed).toBeLessThan(5000);
  });
});
