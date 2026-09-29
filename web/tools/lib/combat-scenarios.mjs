/**
 * The golden replay scenarios, shared by the fixture generator and the bench.
 *
 * `docs/design/server-combat.md` §4.1 asks for a handful of scripted fling logs
 * over the sandbox yard whose outcome and checkpoint digests are committed, so
 * that the same log run under Vitest on Node and under `bun:test` on Bun gives
 * the same answer. This file is the one definition of those logs: the generator
 * writes `web/test/fixtures/combat/<name>.json` from it and the bench times the
 * heaviest one, so a scenario cannot mean two things.
 *
 * Regenerate with `bun tools/gen-combat-fixture.mjs` from `web/`, then review
 * the diff: a change to a committed digest is a change to the rules of combat
 * and should be explained in the pull request that makes it.
 *
 * ## Why there is no flying scenario
 *
 * §4.1 lists an `air` fixture, Teratorns against Flak Towers. There is nothing
 * to fly: `server/src/game-data/stats/monsterStats.ts` carries `movement` on
 * exactly one of its 27 Map Room 2 monsters, C13's `burrow`, and no
 * `movement: "fly"` row at all. The flyer rules are still exercised — the
 * tower flyer-mode table and `canHit` are covered by `targeting.test.ts` — but
 * a golden replay of them would have to invent a monster. `burrow-rush` takes
 * the slot, because C13 is the one monster that walks through walls and so
 * exercises the grid's `ignoreWalls` flood.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Where the committed fixtures live. */
export const FIXTURE_DIR = fileURLToPath(new URL("../../test/fixtures/combat/", import.meta.url));

/** The sandbox yard both trees already test against (§4.2). */
export const SANDBOX = fileURLToPath(
  new URL("../../test/fixtures/baseload-sandbox-yard.json", import.meta.url),
);

/** Every monster at level 1, which is what an academy-less attacker brings. */
const LEVEL_ONE = {};

/** A level 6 academy, the sandbox account's (`baseload-sandbox-yard.json`). */
const MAXED = Object.fromEntries(
  ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C13", "C14"].map((id) => [id, 6]),
);

/** A yard with a Town Hall and one Cannon Tower, for the trivial case. */
const TINY_YARD = {
  0: { id: 0, t: 14, l: 1, X: 0, Y: 0 },
  1: { id: 1, t: 20, l: 1, X: 200, Y: 200 },
};

/**
 * A player's Map Room 2 outpost: the core where an empty outpost places it
 * (`client/scripts/BASE.as:1605-1614`), the six-level laser, tesla and railgun
 * of the outpost table, a level 10 cannon, and one harvester of each resource.
 * The pebble harvester (6) and the goo harvester (8) are below half health, so
 * they hold a quarter of their capacity rather than half.
 */
const OUTPOST_YARD = {
  0: { id: 0, t: 112, l: 1, X: 0, Y: -50 },
  1: { id: 1, t: 23, l: 6, X: 200, Y: -50 },
  2: { id: 2, t: 25, l: 6, X: -200, Y: -50 },
  3: { id: 3, t: 118, l: 6, X: 0, Y: 150 },
  4: { id: 4, t: 20, l: 10, X: 0, Y: -250 },
  5: { id: 5, t: 1, l: 10, X: 300, Y: 200 },
  6: { id: 6, t: 2, l: 10, X: -300, Y: 200 },
  7: { id: 7, t: 3, l: 8, X: 300, Y: -300 },
  8: { id: 8, t: 4, l: 6, X: -300, Y: -300 },
};

export const SCENARIOS = [
  {
    name: "pokey-rush",
    description: "300 level-1 Pokeys, one fling into the south-west corner.",
    yard: "sandbox",
    kind: "main",
    levels: LEVEL_ONE,
    playerLevel: 20,
    tailTicks: 24000,
    log: {
      v: 1,
      seed: 1834027731,
      events: [{ kind: "fling", t: 480, x: -615, y: 115, r: 300, monsters: { C1: 300 } }],
    },
  },
  {
    name: "mixed-waves",
    description:
      "Four flings over five minutes with a level 5 Krallen and one pebble bomb; the bench case.",
    yard: "sandbox",
    kind: "main",
    levels: MAXED,
    playerLevel: 12,
    tailTicks: 24000,
    log: {
      v: 1,
      seed: 90210,
      events: [
        {
          kind: "fling",
          t: 400,
          x: -615,
          y: 115,
          r: 300,
          monsters: { C1: 120, C2: 30 },
          champion: { t: 5, l: 5 },
        },
        { kind: "bomb", t: 2400, x: 180, y: -480, id: "pb1" },
        { kind: "fling", t: 4800, x: 180, y: -480, r: 300, monsters: { C4: 40, C8: 20 } },
        { kind: "fling", t: 9600, x: 355, y: 375, r: 300, monsters: { C3: 40, C7: 30 } },
        { kind: "fling", t: 16000, x: 450, y: -470, r: 300, monsters: { C6: 30, C2: 30 } },
      ],
    },
  },
  {
    name: "maze",
    description: "Eye-ras and Crabatrons against the sandbox yard's 400 walls.",
    yard: "sandbox",
    kind: "main",
    levels: MAXED,
    playerLevel: 20,
    tailTicks: 16000,
    log: {
      v: 1,
      seed: 7,
      events: [
        { kind: "fling", t: 240, x: -615, y: 115, r: 300, monsters: { C5: 24 } },
        { kind: "fling", t: 3200, x: -615, y: 115, r: 300, monsters: { C8: 40 } },
      ],
    },
  },
  {
    name: "burrow-rush",
    description: "Sand Hogs, the one monster that walks through walls.",
    yard: "sandbox",
    kind: "main",
    levels: MAXED,
    playerLevel: 20,
    tailTicks: 16000,
    log: {
      v: 1,
      seed: 424242,
      events: [{ kind: "fling", t: 160, x: -720, y: -585, r: 300, monsters: { C13: 30 } }],
    },
  },
  {
    name: "empty-yard",
    description: "A Town Hall and one tower: the smallest battle that still ends.",
    yard: TINY_YARD,
    kind: "outpost",
    resources: { r1: 5000, r2: 0, r3: 0, r4: 0 },
    levels: LEVEL_ONE,
    playerLevel: 1,
    tailTicks: 8000,
    log: {
      v: 1,
      seed: 5,
      events: [{ kind: "fling", t: 80, x: 400, y: 400, r: 200, monsters: { C4: 12 } }],
    },
  },
  {
    name: "outpost-core",
    description:
      "A player outpost on a cell of height 250: the core, six-level outpost towers, four " +
      "harvesters (two damaged), one wave that levels it (issue #179).",
    yard: OUTPOST_YARD,
    health: { 6: 40000, 8: 3000 },
    height: 250,
    kind: "outpost",
    resources: { r1: 30_000_000, r2: 30_000_000, r3: 30_000_000, r4: 8_000_000 },
    levels: MAXED,
    playerLevel: 20,
    tailTicks: 24000,
    log: {
      v: 1,
      seed: 179,
      events: [
        { kind: "fling", t: 80, x: 600, y: 0, r: 300, monsters: { C3: 150, C6: 80, C8: 40 } },
      ],
    },
  },
  // The defence (issue #195): the sandbox yard's four Monster Bunkers (83-86,
  // in its east corner) and its Champion Cage (51), given garrisons and a
  // champion here as a defender's save would hold them.
  {
    name: "bunker-defence",
    description:
      "Pokeys and Finks into the sandbox yard's four bunkers, each holding a garrison at the " +
      "defender's own levels: survivors walk back in, one bunker is wiped out, one keeps its " +
      "healer in (issue #195).",
    yard: "sandbox",
    kind: "main",
    levels: LEVEL_ONE,
    playerLevel: 20,
    tailTicks: 12000,
    defence: {
      bunkers: {
        83: { C1: 10, C2: 4 },
        84: { C8: 6 },
        85: { C3: 8 },
        86: { C1: 6, C15: 2 },
      },
      defenderLevels: { C1: 6, C2: 6, C3: 6, C8: 6, C15: 1 },
    },
    log: {
      v: 1,
      seed: 19501,
      events: [{ kind: "fling", t: 240, x: 420, y: -560, r: 300, monsters: { C1: 60, C4: 10 } }],
    },
  },
  {
    name: "caged-champion",
    description:
      "An attack on the sandbox yard's Champion Cage: its level 4 Drull comes out at power " +
      "level 2 and part health, against ground monsters and Teratorns (issue #195).",
    yard: "sandbox",
    kind: "main",
    levels: MAXED,
    playerLevel: 20,
    tailTicks: 12000,
    defence: {
      defenderChampion: { t: 2, l: 4, hp: 60000, pl: 2 },
    },
    log: {
      v: 1,
      seed: 19502,
      events: [
        { kind: "fling", t: 160, x: 120, y: 120, r: 300, monsters: { C1: 80, C2: 20 } },
        { kind: "fling", t: 2400, x: 60, y: -180, r: 300, monsters: { C14: 12 } },
      ],
    },
  },
  {
    name: "champion-and-bunkers",
    description:
      "The cage and the bunkers together, attacked with Zafreeti healers and Rezghul raising " +
      "the dead on both sides (issue #195).",
    yard: "sandbox",
    kind: "main",
    levels: MAXED,
    playerLevel: 15,
    tailTicks: 12000,
    defence: {
      bunkers: {
        83: { C1: 8 },
        84: { C2: 6 },
        85: { C8: 4 },
        86: { C3: 6 },
      },
      defenderLevels: { C1: 3, C2: 3, C3: 3, C8: 3 },
      defenderChampion: { t: 1, l: 3, hp: 120000, pl: 1 },
    },
    log: {
      v: 1,
      seed: 19503,
      events: [
        {
          kind: "fling",
          t: 200,
          x: 300,
          y: -300,
          r: 300,
          monsters: { C1: 90, C15: 6, C19: 4 },
        },
        { kind: "fling", t: 3600, x: 480, y: -420, r: 300, monsters: { C8: 30, C3: 20 } },
      ],
    },
  },
];

/** The scenario the bench times, which is the busiest of them. */
export const BENCH_SCENARIO = "mixed-waves";

let sandbox = null;

/** The `replayAttack` input a scenario names, with its yard resolved. */
export const scenarioInput = (scenario) => {
  if (scenario.yard === "sandbox") {
    sandbox ??= JSON.parse(readFileSync(SANDBOX, "utf8"));
    return {
      buildingdata: sandbox.buildingdata,
      buildinghealthdata: sandbox.buildinghealthdata ?? {},
      resources: sandbox.resources,
      kind: scenario.kind,
      log: scenario.log,
      levels: scenario.levels,
      playerLevel: scenario.playerLevel,
      tailTicks: scenario.tailTicks,
      ...(scenario.defence ?? {}),
    };
  }
  return {
    buildingdata: scenario.yard,
    buildinghealthdata: scenario.health ?? {},
    resources: scenario.resources ?? {},
    kind: scenario.kind,
    ...(scenario.height === undefined ? {} : { height: scenario.height }),
    log: scenario.log,
    levels: scenario.levels,
    playerLevel: scenario.playerLevel,
    tailTicks: scenario.tailTicks,
    ...(scenario.defence ?? {}),
  };
};

/**
 * The committed shape of an outcome: what a fixture asserts, and nothing more.
 * A fixture with a defence (issue #195) also pins what became of it; one
 * without keeps exactly the shape it always had.
 */
export const expectedOf = (outcome, defended = false) => ({
  ...expectedBattleOf(outcome),
  ...(defended
    ? {
        bunkerLosses: outcome.bunkerLosses,
        bunkerGarrisons: outcome.bunkerGarrisons,
        defenderChampionHp: outcome.defenderChampionHp,
      }
    : {}),
});

const expectedBattleOf = (outcome) => ({
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
