import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { replayAttack } from "./replay.js";

/**
 * The golden replays, under Vitest on Node.
 *
 * `server/src/game-rules/combat/replay.test.ts` runs the same files under
 * `bun:test` against the synced copy of this module. Both must reproduce every
 * committed number, which is the cross-runtime proof `docs/design/
 * server-combat.md` §3.4 rule 5 asks for: the Wild Monster Baiter's simulation
 * in the browser and the server's replay under Bun are the same battle, so the
 * server cannot refuse a result the player watched.
 *
 * Regenerate with `bun tools/gen-combat-fixture.mjs` from `web/`. A changed
 * digest is a changed rule of combat and belongs in a pull request with a
 * reason, not in a passing test run.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../../../../test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(
  new URL("../../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url),
);

interface Fixture {
  name: string;
  description: string;
  yard: "sandbox" | Record<string, Record<string, number>>;
  kind: "main" | "outpost" | "wild" | "tribe";
  resources?: Record<string, number>;
  levels: Record<string, number>;
  playerLevel: number;
  tailTicks: number;
  log: { v: 1; seed: number; events: unknown[] };
  expected: Record<string, unknown>;
}

const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

const names = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort();

interface SandboxYard {
  buildingdata: unknown;
  buildinghealthdata: unknown;
  resources: unknown;
}

let sandbox: SandboxYard | undefined;

const inputOf = (fixture: Fixture) => {
  if (fixture.yard === "sandbox") {
    const yard = (sandbox ??= read<SandboxYard>(SANDBOX));
    return {
      buildingdata: yard.buildingdata,
      buildinghealthdata: yard.buildinghealthdata,
      resources: yard.resources,
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

/** The committed shape: exactly the fields a fixture pins, and nothing more. */
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

describe("golden replays", () => {
  it("has fixtures to run", () => {
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  it.each(names)("%s reproduces its committed outcome", (file) => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}${file}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = replayAttack(inputOf(fixture) as any);
    expect(actualOf(outcome)).toEqual(fixture.expected);
  });

  it.each(names)("%s is reproducible within this runtime", (file) => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}${file}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const once = replayAttack(inputOf(fixture) as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const twice = replayAttack(inputOf(fixture) as any);
    expect(twice.digest).toBe(once.digest);
    expect(twice.checkpoints).toEqual(once.checkpoints);
  });

  it("takes a checkpoint every 800 ticks", () => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}pokey-rush.json`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = replayAttack(inputOf(fixture) as any);
    expect(outcome.checkpoints.length).toBeGreaterThan(20);
    outcome.checkpoints.forEach((checkpoint, at) => {
      expect(checkpoint.tick).toBe((at + 1) * 800);
      expect(checkpoint.digest).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  it("does not mutate the yard it was handed", () => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}empty-yard.json`);
    const input = inputOf(fixture);
    const before = JSON.stringify(input.buildingdata);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    replayAttack(input as any);
    expect(JSON.stringify(input.buildingdata)).toBe(before);
  });
});
