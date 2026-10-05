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
  /** A wild monster raid's hit limit, when the log is a raid (issue #226). */
  raid?: { hitLimit: number };
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

/** The committed shape: exactly the fields a fixture pins, and nothing more. */
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

// The largest fixture replays in ~4 s on an idle machine; two runs under load pass 5 s.
const REPLAY_TIMEOUT_MS = 30_000;

describe("golden replays", () => {
  it("has fixtures to run", () => {
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  it.each(names)("%s reproduces its committed outcome", (file) => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}${file}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = replayAttack(inputOf(fixture) as any);
    expect(actualOf(outcome, Boolean(fixture.defence))).toEqual(fixture.expected);
  }, REPLAY_TIMEOUT_MS);

  it.each(names)("%s is reproducible within this runtime", (file) => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}${file}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const once = replayAttack(inputOf(fixture) as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const twice = replayAttack(inputOf(fixture) as any);
    expect(twice.digest).toBe(once.digest);
    expect(twice.checkpoints).toEqual(once.checkpoints);
  }, REPLAY_TIMEOUT_MS);

  // The server's landing replay records the champions' lessons (issue #219);
  // that must read the battle, never change it.
  it.each(names)("%s reproduces it with the lessons recorded too", (file) => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}${file}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = replayAttack({ ...(inputOf(fixture) as any), learn: true });
    expect(actualOf(outcome, Boolean(fixture.defence))).toEqual(fixture.expected);
  }, REPLAY_TIMEOUT_MS);

  it(
    "takes a checkpoint every 800 ticks",
    () => {
      const fixture = read<Fixture>(`${FIXTURE_DIR}pokey-rush.json`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcome = replayAttack(inputOf(fixture) as any);
      expect(outcome.checkpoints.length).toBeGreaterThan(20);
      outcome.checkpoints.forEach((checkpoint, at) => {
        expect(checkpoint.tick).toBe((at + 1) * 800);
        expect(checkpoint.digest).toMatch(/^[0-9a-f]{16}$/);
      });
    },
    // This checks behaviour, not speed, but replaying pokey-rush still takes
    // real work; the vitest default of 5 s is a wall-clock watchdog that a
    // busy machine (several agents' suites running at once) blows through
    // with no change in what the test is checking. Same generous budget as
    // the golden replays above.
    REPLAY_TIMEOUT_MS,
  );

  it("records no lessons unless asked", () => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}champion-brain.json`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(replayAttack(inputOf(fixture) as any).lessons).toBeUndefined();
  }, REPLAY_TIMEOUT_MS);

  it("does not mutate the yard it was handed", () => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}empty-yard.json`);
    const input = inputOf(fixture);
    const before = JSON.stringify(input.buildingdata);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    replayAttack(input as any);
    expect(JSON.stringify(input.buildingdata)).toBe(before);
  });
});

describe("a champion's lesson and brain (issue #219)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const learned = (file: string, change: (input: any) => any = (input) => input) => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}${file}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return replayAttack({ ...change(structuredClone(inputOf(fixture)) as any), learn: true });
  };

  it("gives the attacking champion one lesson, from its own picks and fight", () => {
    const outcome = learned("champion-brain.json");
    expect(outcome.lessons).toHaveLength(1);
    const [lesson] = outcome.lessons!;
    expect(lesson).toMatchObject({ t: 1, startHp: 190_000 });
    expect(lesson!.picks).toBeGreaterThan(10);
    expect(lesson!.dealt).toBeGreaterThan(0);
    expect(lesson!.dealt).toBeLessThanOrEqual(lesson!.potential);
    expect(lesson!.endHp).toBe(outcome.championHp);
    for (const value of Object.values(lesson!.credit)) expect(Number.isFinite(value)).toBe(true);
  }, REPLAY_TIMEOUT_MS);

  it("gives a defending champion none: only the attacker's champions learn", () => {
    // A caged Drull fights; the attacker flings no champion.
    expect(learned("caged-champion.json").lessons).toEqual([]);
    // Fomor on both sides: only the flung one learns.
    const both = learned("fomor-both-sides.json");
    expect(both.lessons?.map((lesson) => lesson.t)).toEqual([3]);
  }, REPLAY_TIMEOUT_MS);

  it("fights with the brain the log carries, and a log without one is a zero brain", () => {
    const withBrain = learned("champion-brain.json");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strip = (input: any) => {
      delete input.log.events[0].champion.b;
      return input;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zero = (input: any) => {
      input.log.events[0].champion.b = { tower: 0, loot: 0, finish: 0, focus: 0, threat: 0 };
      return input;
    };
    const without = learned("champion-brain.json", strip);
    expect(without.digest).not.toBe(withBrain.digest);
    expect(learned("champion-brain.json", zero).digest).toBe(without.digest);
  }, REPLAY_TIMEOUT_MS);

  it("clamps a brain past its bounds to them", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wild = (input: any) => {
      input.log.events[0].champion.b = { tower: 9e9, loot: -9e9, finish: 200, focus: 200, threat: 200 };
      return input;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bound = (input: any) => {
      input.log.events[0].champion.b = { tower: 200, loot: -200, finish: 200, focus: 200, threat: 200 };
      return input;
    };
    expect(learned("champion-brain.json", wild).digest).toBe(learned("champion-brain.json", bound).digest);
  }, REPLAY_TIMEOUT_MS);
});
