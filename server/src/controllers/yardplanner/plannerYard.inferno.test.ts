import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { LockMode } from "@mikro-orm/core";
import type { Context } from "koa";
import type { KoaController } from "../../utils/KoaController.js";
import { INFERNO_COSTS } from "../../game-data/buildingCosts.js";

/**
 * The Yard Planner routes on the Inferno yard (owner decision 2026-10-29,
 * overriding Flash's "no planner in the Inferno", `BASE.as:1072`): layouts are
 * saved, listed and deleted in the Inferno yard's own slots, with its own
 * footprints (Under Hall 160); Apply, the batch wall upgrade and the trap
 * re-arm act on the Inferno yard and charge the Inferno purse (the main save's
 * `iresources`), never the main yard's pool. Driven over an in-memory
 * stand-in for the two rows.
 */

type Row = Record<string, unknown>;

const USERID = 2504;
const INFERNO_BASEID = "950";
const OUTPOST_BASEID = "900";

const POOL = { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 };
const PURSE = { r1: 500_000, r2: 500_000, r3: 500_000, r4: 500_000 };

let mainSave: Row;
let infernoSave: Row;
let locked: number[];

const rows = () => [mainSave, infernoSave];
const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);

const findOne = async (_entity: unknown, where: Row, options?: { lockMode?: LockMode }) => {
  const row = rows().find((one) => matches(one, where)) ?? null;
  if (row && options?.lockMode === LockMode.PESSIMISTIC_WRITE) locked.push(row.basesaveid as number);
  return row;
};

const txEm = { findOne, flush: async () => {} };

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Row) => {
        user.save = mainSave;
      },
      findOne,
      persist: () => {},
      flush: async () => {},
      transactional: async (run: (em: typeof txEm) => Promise<unknown>) => run(txEm),
    },
  },
  redis: { del: async () => 0 },
}));

const { applyLayout } = await import("./applyLayout.js");
const { upgradeWalls } = await import("./upgradeWalls.js");
const { saveLayout } = await import("./saveLayout.js");
const { getLayouts } = await import("./getLayouts.js");
const { deleteLayout } = await import("./deleteLayout.js");
const { rearmTraps } = await import("./rearmTraps.js");
const { layoutRoute } = await import("./layoutRoute.js");
const { readLayouts } = await import("../../services/yardplanner/layoutStorage.js");

const now = () => Math.floor(Date.now() / 1000);

/** Runs a controller as the router would; `ClientSafeError`s land in the body. */
const run = async (controller: KoaController, body: Row, params: Row = {}, query: Row = {}) => {
  const ctx = {
    authUser: { userid: USERID, shiny_locked: false },
    request: { body },
    params,
    query,
  } as unknown as Context;
  try {
    await layoutRoute(controller)(ctx, async () => {});
  } catch (err) {
    // Refusals from outside `layoutRoute`'s reach (the yard lock) carry a status.
    const caught = err as { status?: number; message?: string; data?: Row };
    if (typeof caught.status !== "number") throw err;
    ctx.status = caught.status;
    ctx.body = { error: caught.message, ...caught.data };
  }
  return { status: ctx.status, body: ctx.body as Row };
};

const UNDER_HALL = { id: 1, t: 14, X: 0, Y: 0, l: 4 };
const HALL_NODE = { id: 1, t: 14, x: 0, y: 0 };

let infernoEnv: string | undefined;

beforeEach(() => {
  infernoEnv = process.env.INFERNO_ENABLED;
  process.env.INFERNO_ENABLED = "on";
  locked = [];
  mainSave = {
    basesaveid: 7,
    baseid: "7",
    baseid_inferno: Number(INFERNO_BASEID),
    userid: USERID,
    saveuserid: USERID,
    type: "main",
    mapversion: 2,
    worldid: "world-a",
    attackid: 0,
    attacks: [],
    savetime: now() - 10,
    credits: 0,
    points: "0",
    resources: { ...POOL },
    iresources: { ...PURSE },
    buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 } },
    buildinghealthdata: {},
    storedata: {},
    mushrooms: { l: [], s: now() },
    outposts: [[241, 208, OUTPOST_BASEID]],
    savetemplate: {},
    researchdata: {},
  };
  infernoSave = {
    basesaveid: 95,
    baseid: INFERNO_BASEID,
    userid: USERID,
    saveuserid: USERID,
    type: "inferno",
    attackid: 0,
    attacks: [],
    savetime: now() - 10,
    credits: 0,
    points: "0",
    flinger: 0,
    resources: {},
    iresources: {},
    buildingdata: {
      "1": UNDER_HALL,
      "2": { id: 2, t: 6, X: 300, Y: -300, l: 6 },
      "3": { id: 3, t: 17, X: -300, Y: 300, l: 1 },
      "4": { id: 4, t: 17, X: -260, Y: 300, l: 1 },
    },
    buildinghealthdata: {},
    storedata: {},
    monsters: {},
    lockerdata: {},
    academy: {},
    champion: [],
    mushrooms: {},
    researchdata: {},
    outposts: [],
    firedtraps: [],
    savetemplate: {},
  };
});

afterEach(() => {
  if (infernoEnv === undefined) delete process.env.INFERNO_ENABLED;
  else process.env.INFERNO_ENABLED = infernoEnv;
});

const layout = (nodes: Row[], expansion = 0) => JSON.stringify({ version: 2, expansion, nodes });
const ALL_NODES = [
  HALL_NODE,
  { id: 2, t: 6, x: 300, y: -300 },
  { id: 3, t: 17, x: -300, y: 300 },
  { id: 4, t: 17, x: -260, y: 300 },
];
const purse = () => mainSave.iresources as Record<string, number>;
const infernoBuildings = () => infernoSave.buildingdata as Record<string, Row>;

describe("layouts in the Inferno", () => {
  test("are saved in the Inferno yard's own slots, never the main yard's", async () => {
    const answer = await run(
      saveLayout,
      { name: "Cave", data: layout(ALL_NODES), baseid: INFERNO_BASEID },
      { slot: "2" }
    );
    expect(answer.status).toBe(200);

    const [saved] = readLayouts(infernoSave.savetemplate as unknown[]);
    expect(saved?.slot).toBe(2);
    expect(saved?.name).toBe("Cave");
    expect(readLayouts(mainSave.savetemplate as unknown[])).toEqual([]);
    // Written under the Inferno row's lock.
    expect(locked).toEqual([95]);
  });

  test("are listed per yard: the Inferno's with its baseid, the main yard's without", async () => {
    await run(saveLayout, { name: "Cave", data: layout(ALL_NODES), baseid: INFERNO_BASEID }, { slot: "1" });
    await run(
      saveLayout,
      { name: "Surface", data: layout([{ id: 0, t: 14, x: 0, y: 0 }]) },
      { slot: "1" }
    );

    const inferno = await run(getLayouts, {}, {}, { baseid: INFERNO_BASEID });
    expect(inferno.status).toBe(200);
    expect((inferno.body.layouts as Row[]).map((one) => one.name)).toEqual(["Cave"]);

    const main = await run(getLayouts, {}, {}, {});
    expect((main.body.layouts as Row[]).map((one) => one.name)).toEqual(["Surface"]);
  });

  test("are deleted from the Inferno yard's slots only", async () => {
    await run(saveLayout, { name: "Cave", data: layout(ALL_NODES), baseid: INFERNO_BASEID }, { slot: "1" });
    await run(saveLayout, { name: "Surface", data: layout([{ id: 0, t: 14, x: 0, y: 0 }]) }, { slot: "1" });

    const answer = await run(deleteLayout, {}, { slot: "1" }, { baseid: INFERNO_BASEID });
    expect(answer.status).toBe(200);
    expect(readLayouts(infernoSave.savetemplate as unknown[])).toEqual([]);
    expect(readLayouts(mainSave.savetemplate as unknown[]).map((one) => one.name)).toEqual(["Surface"]);
  });

  test("are checked with the Inferno's footprints: the Under Hall is 160 wide there, 130 on the surface", async () => {
    // A wall at x 140 is clear of a 130-wide Town Hall but inside a 160-wide Under Hall.
    const nodes = [HALL_NODE, { id: 2, t: 6, x: 300, y: -300 }, { id: 3, t: 17, x: 140, y: 0 }];
    const answer = await run(saveLayout, { name: "Tight", data: layout(nodes), baseid: INFERNO_BASEID }, { slot: "0" });
    expect(answer.status).toBe(400);
    expect(answer.body.overlapping).toEqual([1, 3]);
    expect(infernoSave.savetemplate).toEqual({});
  });

  test("are refused while the Inferno is switched off", async () => {
    process.env.INFERNO_ENABLED = "off";
    const answer = await run(saveLayout, { name: "Cave", data: layout(ALL_NODES), baseid: INFERNO_BASEID }, { slot: "0" });
    expect(answer.status).toBe(403);
    expect(answer.body.reason).toBe("infernoOff");
  });

  test("an outpost still has none (BasePlanner.as:41)", async () => {
    const answer = await run(saveLayout, { name: "Op", data: layout(ALL_NODES), baseid: OUTPOST_BASEID }, { slot: "0" });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("notInOutpost");
  });
});

describe("Apply in the Inferno", () => {
  test("moves the Inferno yard's buildings", async () => {
    const nodes = ALL_NODES.map((node) => (node.id === 3 ? { ...node, x: -300, y: 200 } : node));
    const answer = await run(applyLayout, { data: layout(nodes), baseid: INFERNO_BASEID });
    expect(answer.status).toBe(200);
    expect(answer.body.moved).toBe(1);
    expect(infernoBuildings()["3"]).toMatchObject({ X: -300, Y: 200 });
    expect((mainSave.buildingdata as Record<string, Row>)["0"]).toMatchObject({ X: 0, Y: 0 });
    expect(locked).toEqual([7, 95]);
  });

  test("refuses a building on the Under Hall's Inferno footprint", async () => {
    const nodes = ALL_NODES.map((node) => (node.id === 3 ? { ...node, x: 140, y: 0 } : node));
    const answer = await run(applyLayout, { data: layout(nodes), baseid: INFERNO_BASEID });
    expect(answer.status).toBe(400);
    expect(infernoBuildings()["3"]).toMatchObject({ X: -300, Y: 300 });
  });

  test("takes no decorations out of the main yard's storage", async () => {
    const data = JSON.stringify({ version: 2, expansion: 0, nodes: ALL_NODES, fromStorage: [{ t: 41, x: 200, y: 200 }] });
    const answer = await run(applyLayout, { data, baseid: INFERNO_BASEID });
    expect(answer.status).toBe(400);
    expect(answer.body.fromStorage).toBe(1);
  });
});

describe("batch wall upgrade in the Inferno", () => {
  test("raises the walls to level 3 at the Inferno table's price, paid from the Inferno purse", async () => {
    const answer = await run(upgradeWalls, { ids: "[3,4]", level: 3, baseid: INFERNO_BASEID });
    expect(answer.status).toBe(200);
    expect(answer.body.upgraded).toBe(2);
    expect(infernoBuildings()["3"]).toMatchObject({ l: 3 });
    expect(infernoBuildings()["4"]).toMatchObject({ l: 3 });

    // Level 1 to 2 is 10,000 Coal; 2 to 3 is 100,000 Bone and 100,000 Coal.
    const [a1, a2] = INFERNO_COSTS[17]!.costs[1]!;
    const [b1, b2] = INFERNO_COSTS[17]!.costs[2]!;
    expect(purse()).toMatchObject({ r1: PURSE.r1 - 2 * (a1 + b1), r2: PURSE.r2 - 2 * (a2 + b2) });
    expect(mainSave.resources).toEqual(POOL);
    expect(Number(infernoSave.points)).toBeGreaterThan(0);
    expect(mainSave.points).toBe("0");
  });

  test("stops at the Inferno ladder's top, level 3", async () => {
    const answer = await run(upgradeWalls, { ids: "[3]", level: 4, baseid: INFERNO_BASEID });
    expect(answer.status).toBe(400);
    expect(answer.body.level).toBe(4);
    expect(purse()).toEqual(PURSE);
  });

  test("waits for the Under Hall level each step needs", async () => {
    (infernoBuildings()["1"] as Row).l = 3;
    const answer = await run(upgradeWalls, { ids: "[3]", level: 3, baseid: INFERNO_BASEID });
    expect(answer.status).toBe(409);
    expect(infernoBuildings()["3"]).toMatchObject({ l: 1 });
    expect(purse()).toEqual(PURSE);
  });

  test("refuses when the Inferno purse is short, whatever the main pool holds", async () => {
    mainSave.iresources = { r1: 0, r2: 0, r3: 0, r4: 0 };
    const answer = await run(upgradeWalls, { ids: "[3]", level: 2, baseid: INFERNO_BASEID });
    expect(answer.status).toBe(409);
    expect(answer.body.shortfall).toMatchObject({ r2: INFERNO_COSTS[17]!.costs[1]![1] });
    expect(mainSave.resources).toEqual(POOL);
  });
});

describe("trap re-arm in the Inferno", () => {
  test("puts a fired Booby Trap back from the Inferno purse and strikes it off the Inferno's list", async () => {
    infernoSave.firedtraps = [{ t: 24, X: 200, Y: 200, at: now() - 60 }];
    const answer = await run(rearmTraps, {
      traps: JSON.stringify([{ t: 24, x: 200, y: 200 }]),
      baseid: INFERNO_BASEID,
    });
    expect(answer.status).toBe(200);
    expect(answer.body.placed).toBe(1);
    const trap = Object.values(infernoBuildings()).find((one) => one.t === 24)!;
    expect(trap).toMatchObject({ X: 200, Y: 200 });
    expect(infernoSave.firedtraps).toEqual([]);

    const [r1, r2, r3, r4] = INFERNO_COSTS[24]!.costs[0]!;
    expect(purse()).toMatchObject({ r1: PURSE.r1 - r1, r2: PURSE.r2 - r2, r3: PURSE.r3 - r3, r4: PURSE.r4 - r4 });
    expect(mainSave.resources).toEqual(POOL);
  });

  test("refuses a Heavy Trap, which the Inferno cannot hold", async () => {
    const answer = await run(rearmTraps, {
      traps: JSON.stringify([{ t: 117, x: 200, y: 200 }]),
      baseid: INFERNO_BASEID,
    });
    expect(answer.status).toBe(400);
    expect(answer.body.notBuildable).toEqual([0]);
    expect(purse()).toEqual(PURSE);
  });

  test("refuses a trap on the Under Hall's Inferno footprint", async () => {
    const answer = await run(rearmTraps, {
      traps: JSON.stringify([{ t: 24, x: 140, y: 40 }]),
      baseid: INFERNO_BASEID,
    });
    expect(answer.status).toBe(400);
    expect(purse()).toEqual(PURSE);
  });
});
