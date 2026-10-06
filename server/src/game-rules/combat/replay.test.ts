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
  /** Building ids taken off the sandbox yard (issue #313: its Spurtz Cannons). */
  without?: number[];
  kind: "main" | "outpost" | "wild" | "tribe";
  /** `buildinghealthdata`, when the yard opens damaged. */
  health?: Record<string, number>;
  /** The map cell's height, which stretches an outpost's tower range. */
  height?: number;
  resources?: Record<string, number>;
  levels: Record<string, number>;
  playerLevel: number;
  tailTicks: number;
  /** The defender's garrisons, their levels and the caged champion (issue #195). */
  defence?: Record<string, unknown>;
  /** Whether the log is a wild monster raid (issue #226). */
  raid?: boolean;
  log: { v: 1; seed: number; events: unknown[] };
  expected: Record<string, unknown>;
}

const read = (path: string): any => JSON.parse(readFileSync(path, "utf8"));

// The largest fixture replays in about a second on an idle machine; Bun's
// 5 s default per test is a wall-clock watchdog a busy machine can blow
// through with nothing wrong with the replay (issue #141).
const REPLAY_TIMEOUT_MS = 30_000;

// Three runs of the busiest fixture, measured on CPU time, under the same
// generous watchdog `bench.test.ts` gives its three runs on the web side.
const DEADLINE_TEST_TIMEOUT_MS = 120_000;

const names = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort();

let sandbox: any = null;

/** The sandbox yard's buildings less the fixture's `without` ids. */
const sandboxBuildings = <T>(buildingdata: Record<string, T>, without?: readonly number[]): Record<string, T> =>
  without?.length
    ? Object.fromEntries(Object.entries(buildingdata).filter(([key]) => !without.includes(Number(key))))
    : buildingdata;

const inputOf = (fixture: Fixture): any => {
  if (fixture.yard === "sandbox") {
    sandbox ??= read(SANDBOX);
    return {
      buildingdata: sandboxBuildings(sandbox.buildingdata, fixture.without),
      buildinghealthdata: sandbox.buildinghealthdata,
      resources: sandbox.resources,
      kind: fixture.kind,
      log: fixture.log,
      levels: fixture.levels,
      playerLevel: fixture.playerLevel,
      tailTicks: fixture.tailTicks,
      ...(fixture.defence ?? {}),
      ...(fixture.raid ? { raid: fixture.raid } : {}),
    };
  }
  return {
    buildingdata: fixture.yard,
    buildinghealthdata: fixture.health ?? {},
    resources: fixture.resources ?? {},
    kind: fixture.kind,
    ...(fixture.height === undefined ? {} : { height: fixture.height }),
    log: fixture.log,
    levels: fixture.levels,
    playerLevel: fixture.playerLevel,
    tailTicks: fixture.tailTicks,
    ...(fixture.defence ?? {}),
    ...(fixture.raid ? { raid: fixture.raid } : {}),
  };
};

const actualOf = (outcome: ReturnType<typeof replayAttack>, defended: boolean) => ({
  ...battleOf(outcome),
  // A fixture with a defence also pins what became of it (issue #195).
  ...(defended
    ? {
        bunkerLosses: outcome.bunkerLosses,
        bunkerGarrisons: outcome.bunkerGarrisons,
        defenderChampionsHp: outcome.defenderChampions.map((caged) => caged.hp),
      }
    : {}),
});

const battleOf = (outcome: ReturnType<typeof replayAttack>) => ({
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
    test(
      `${file} reproduces its committed outcome`,
      () => {
        const fixture = read(`${FIXTURE_DIR}${file}`) as Fixture;
        const outcome = replayAttack(inputOf(fixture));
        expect(actualOf(outcome, Boolean(fixture.defence))).toEqual(fixture.expected as any);
      },
      REPLAY_TIMEOUT_MS,
    );
    // The landing replay records the champions' lessons (issue #219), which
    // must read the battle and never change it.
    test(
      `${file} reproduces it with the lessons recorded too`,
      () => {
        const fixture = read(`${FIXTURE_DIR}${file}`) as Fixture;
        const outcome = replayAttack({ ...inputOf(fixture), learn: true });
        expect(actualOf(outcome, Boolean(fixture.defence))).toEqual(fixture.expected as any);
      },
      REPLAY_TIMEOUT_MS,
    );
  }

  /**
   * The deadline is on the replay's own work, so this measures CPU time.
   *
   * Wall-clock time also counts the time the process sits preempted by
   * unrelated work: with several test suites, Vite servers and agents running
   * at once, it went past 5 s with the replay itself unchanged (issue #141,
   * as `web/src/game/combat/rules/bench.test.ts` found in #140). CPU time
   * does not, and on an idle machine it is close to the wall-clock figure, so
   * a replay that really slowed down past the deadline still fails. The median
   * of three runs keeps one stall from deciding it.
   */
  test(
    "the busiest replay stays inside the 5 s deadline of §3.5",
    () => {
      const fixture = read(`${FIXTURE_DIR}mixed-waves.json`) as Fixture;
      const runs: { wallMs: number; cpuMs: number }[] = [];
      for (let run = 0; run < 3; run += 1) {
        const startedCpu = process.cpuUsage();
        const started = Bun.nanoseconds();
        const outcome = replayAttack(inputOf(fixture));
        const wallMs = (Bun.nanoseconds() - started) / 1e6;
        const cpu = process.cpuUsage(startedCpu);
        runs.push({ wallMs, cpuMs: (cpu.user + cpu.system) / 1000 });
        expect(outcome.ticks).toBeGreaterThan(0);
      }
      const medianCpu = [...runs].sort((one, other) => one.cpuMs - other.cpuMs)[1]!.cpuMs;
      const medianWall = [...runs].sort((one, other) => one.wallMs - other.wallMs)[1]!.wallMs;
      console.warn(
        `combat replay mixed-waves under Bun: median ${medianCpu.toFixed(1)} ms CPU ` +
          `(${medianWall.toFixed(1)} ms wall) over ${runs.length} runs (deadline 5000 ms)`,
      );
      // The budget is 500 ms median; this guards the cliff, not the target.
      expect(medianCpu).toBeLessThan(5000);
    },
    DEADLINE_TEST_TIMEOUT_MS,
  );
});
