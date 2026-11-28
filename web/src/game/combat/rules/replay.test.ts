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
  /** The attacker's Monster Lab ranks (beta 6's Lab abilities). */
  ranks?: Record<string, number>;
  /** Whether the log is a wild monster raid (issue #226). */
  raid?: boolean;
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

/** The sandbox yard's buildings less the fixture's `without` ids. */
const sandboxBuildings = <T>(buildingdata: Record<string, T>, without?: readonly number[]): Record<string, T> =>
  without?.length
    ? Object.fromEntries(Object.entries(buildingdata).filter(([key]) => !without.includes(Number(key))))
    : buildingdata;

const inputOf = (fixture: Fixture) => {
  if (fixture.yard === "sandbox") {
    const yard = (sandbox ??= read<SandboxYard>(SANDBOX));
    return {
      buildingdata: sandboxBuildings(yard.buildingdata as Record<string, unknown>, fixture.without),
      buildinghealthdata: yard.buildinghealthdata,
      resources: yard.resources,
      kind: fixture.kind,
      log: fixture.log,
      levels: fixture.levels,
      playerLevel: fixture.playerLevel,
      tailTicks: fixture.tailTicks,
      ...(fixture.defence ?? {}),
      ...(fixture.ranks ? { ranks: fixture.ranks } : {}),
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
    ...(fixture.ranks ? { ranks: fixture.ranks } : {}),
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

  // The champion fixtures fight on the sandbox without its Spurtz Cannons
  // (issue #313), so the champion lives and each Mode is its own fight.
  it("fights each champion Mode its own way, the champion alive at the end", () => {
    const champions = ["champion-offensive", "champion-defensive", "champion-brain"].map(
      (name) => read<Fixture>(`${FIXTURE_DIR}${name}.json`).expected as { digest: string; championHp: number },
    );
    expect(new Set(champions.map((one) => one.digest)).size).toBe(3);
    for (const one of champions) expect(one.championHp).toBeGreaterThan(0);
  });

  // Patch 8.6 (owner, 25 Nov 2026): Krallen keeps her route on her walking
  // look and turns only on a defender that reaches or hits her, as in Flash.
  // An attack started under older rules is replayed with `flashKrallen` off
  // and plays as it was fought: these are both Krallen fixtures' digests
  // under 8.6's rules before that change (mixed-waves moved with patch 9.1's
  // ground-circle pebble blast, which is not versioned).
  it.each([
    ["mixed-waves", "613d14a54e3264a7"],
    ["korath-and-krallen", "ba2e64367ed6247c"],
  ])("%s replays to its old digest under older rules (flashKrallen off)", (name, digest) => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}${name}.json`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const old = replayAttack({ ...(inputOf(fixture) as any), flashKrallen: false, wholeHealth: false });
    expect(old.digest).toBe(digest);
    expect(fixture.expected.digest).not.toBe(digest);
  }, REPLAY_TIMEOUT_MS);

  // Whole health (player report, Reii, 25 Nov 2026): Flash keeps a monster's
  // health whole (`SecNum.Set` rounds it). An attack started under older rules
  // is replayed with `wholeHealth` off and plays as it was fought: these are
  // every fixture's digests under patch 8.6's rules (mixed-waves moved with
  // patch 9.1's ground-circle pebble blast).
  it.each([
    ["both-caged-champions", "c07e954543467057"],
    ["bunker-defence", "2de3cd0499385cea"],
    ["burrow-rush", "53831507368691ad"],
    ["caged-champion", "3ed24369a24d4933"],
    ["caged-korath", "d2e32fb103b3d28f"],
    ["champion-and-bunkers", "4219b7c8ebcf4bf2"],
    ["champion-brain", "1380f0c9edcb5603"],
    ["champion-defensive", "fb4f893d5708a583"],
    ["champion-offensive", "6599382b177c1975"],
    ["champion-power", "603879c541246e9f"],
    ["empty-yard", "0541193f927361a1"],
    ["fomor-both-sides", "6ce49ed9d17d7a57"],
    ["korath-and-krallen", "6f9a4e725bdd0bf4"],
    ["lab-abilities", "51688836711f72f8"],
    ["lab-split", "b5eda6f428b9952a"],
    ["maze", "fa958d6ef25e02d4"],
    ["mixed-waves", "d6f153d8924ee18e"],
    ["outpost-core", "6713db87c1fb3e35"],
    ["pokey-rush", "08c500fd34fe817f"],
    ["raid-east", "5bad54817e80c9c3"],
  ])("%s replays to its 8.6 digest with wholeHealth off", (name, digest) => {
    const fixture = read<Fixture>(`${FIXTURE_DIR}${name}.json`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const old = replayAttack({ ...(inputOf(fixture) as any), wholeHealth: false });
    expect(old.digest).toBe(digest);
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
    // Level 4 Gorgo, power level 3 and no food bonus: the level's 140,000.
    expect(lesson).toMatchObject({ t: 1, startHp: 140_000 });
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
