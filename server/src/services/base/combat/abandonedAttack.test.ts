import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { replayAttack, type FlingLog } from "../../../game-rules/combat/index.js";
import {
  academyLevels,
  buildingDataWithout,
  combatKindOf,
  replayAbandonedAttack,
  siegeAfter,
  spendFlung,
  type AbandonedInput,
} from "./abandonedAttack.js";

/**
 * The server's result for an attack left without a save (issue #138): the
 * shared engine run over the checkpointed log up to the tick the attacker was
 * last seen at, and nothing after it.
 */

const SANDBOX = fileURLToPath(new URL("../../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

const LOG: FlingLog = {
  v: 1,
  seed: 1834027731,
  events: [
    { kind: "fling", t: 480, x: -615, y: 115, r: 300, monsters: { C1: 300 }, champion: { t: 5, l: 5 } },
    { kind: "bomb", t: 800, x: 180, y: -480, id: "pb1" },
  ],
};

const input = (tick: number, overrides: Partial<AbandonedInput> = {}): AbandonedInput => ({
  defender: {
    type: "main",
    buildingdata: sandbox.buildingdata,
    buildinghealthdata: sandbox.buildinghealthdata,
    resources: sandbox.resources,
  },
  attacker: {
    academy: { C1: { level: 3 } },
    champion: [
      { t: 5, l: 5, hp: 62000, status: 0 },
      { t: 3, l: 6, hp: 40000, status: 0 },
    ] as never,
    siege: { jars: { quantity: 2 } },
  },
  log: LOG,
  tick,
  declareWar: false,
  ...overrides,
});

describe("replayAbandonedAttack", () => {
  const early = replayAbandonedAttack(input(1600));
  const later = replayAbandonedAttack(input(4000));

  test("runs to the tick the attacker was last seen at", () => {
    expect(early.tick).toBe(1600);
    expect(later.tick).toBe(4000);
  });

  test("gives what the shared replay gives, cut at the same tick", () => {
    const replayed = replayAttack({
      buildingdata: sandbox.buildingdata,
      buildinghealthdata: sandbox.buildinghealthdata,
      resources: sandbox.resources,
      kind: "main",
      log: LOG,
      levels: { C1: 3 },
      tailTicks: 4000 - 800,
    });
    expect(replayed.ticks).toBe(4000);
    expect(later.buildinghealthdata).toEqual({ ...replayed.health });
    expect(later.firedTraps).toEqual([...replayed.firedTraps]);
    expect(later.attackloot.r1).toBe(Math.floor(replayed.attackloot.r1));
    expect(later.defenderDelta.r2).toBe(-Math.floor(replayed.defenderLoss.r2));
  });

  test("ends the battle there: nothing the creeps would have done afterwards counts", () => {
    expect(later.damage).toBeGreaterThan(early.damage);
    expect(Object.keys(later.buildinghealthdata).length).toBeGreaterThanOrEqual(
      Object.keys(early.buildinghealthdata).length
    );
  });

  test("never runs short of the log's own last event", () => {
    expect(replayAbandonedAttack(input(100)).tick).toBe(800);
  });

  test("reports the attacker's side: flung monsters, champions, siege", () => {
    expect(later.flung).toEqual({ C1: 300 });
    const [krallen, other] = later.attackerchampion!;
    expect(krallen!.t).toBe(5);
    expect(krallen!.hp).toBeLessThanOrEqual(62000);
    expect(other).toEqual({ t: 3, l: 6, hp: 40000, status: 0 } as never);
    expect(later.attackersiege).toEqual({ jars: { quantity: 2 } });
  });

  test("a main yard has no `destroyed`; the report names the moment it ended", () => {
    expect(later.destroyed).toBeUndefined();
    expect(later.attackreport).toContain("0:06 Flung 300 C1, the champion (G5)");
    expect(later.attackreport).toContain("0:50 Left the attack");
    expect(later.defenderDelta.r1).toBeLessThanOrEqual(0);
  });
});

describe("the attacker's cells", () => {
  test("flung monsters leave the first cell first, then the next", () => {
    const { updates, unpaid } = spendFlung(
      [
        { baseid: "1", m: { housed: { C1: 5, C2: 3 }, space: 40 } },
        { baseid: "2", m: { housed: { C1: 10 } } },
      ],
      { C1: 8, C2: 1 }
    );
    expect(updates).toEqual([
      { baseid: "1", m: { housed: { C1: 0, C2: 2 }, space: 40 } },
      { baseid: "2", m: { housed: { C1: 7 } } },
    ]);
    expect(unpaid).toEqual({});
  });

  test("anything the cells no longer hold is reported, not invented", () => {
    const { updates, unpaid } = spendFlung([{ baseid: "1", m: { housed: { C1: 2 } } }], { C1: 5, C3: 1 });
    expect(updates[0]!.m.housed).toEqual({ C1: 0 });
    expect(unpaid).toEqual({ C1: 3, C3: 1 });
  });
});

describe("helpers", () => {
  test("a wild monster camp is `wild`, as the client calls it", () => {
    expect(combatKindOf("tribe")).toBe("wild");
    expect(combatKindOf("outpost")).toBe("outpost");
    expect(combatKindOf("main")).toBe("main");
  });

  test("academy levels are read as the client reads them", () => {
    expect(academyLevels({ C1: { level: 4 }, C2: { level: "x" }, C3: null })).toEqual({ C1: 4 });
  });

  test("a siege weapon used spends one", () => {
    expect(siegeAfter({ jars: { quantity: 1 }, vacuum: { quantity: 3 } }, [
      { kind: "siege", t: 1, x: 0, y: 0, weapon: "jars" },
      { kind: "siege", t: 2, x: 0, y: 0, weapon: "jars" },
    ])).toEqual({ jars: { quantity: 0 }, vacuum: { quantity: 3 } });
    expect(siegeAfter(null, [])).toBeUndefined();
  });

  test("buildingdata loses only the traps that fired", () => {
    expect(buildingDataWithout({ "1": { t: 24 }, "2": { t: 1 } }, [1])).toEqual({ "2": { t: 1 } });
  });
});
