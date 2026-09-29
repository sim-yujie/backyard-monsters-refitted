import { beforeEach, describe, expect, mock, test } from "bun:test";
import { LockMode } from "@mikro-orm/core";
import type { Context } from "koa";
import type { KoaController } from "../../utils/KoaController.js";
import { OUTPOST_COSTS } from "../../game-data/buildingCosts.js";

/**
 * The Yard Planner routes on a Map Room 2 outpost (outposts WP3, issue #184):
 * Apply and the wall and trap batches act on the outpost the `baseid` names
 * and charge the main pool; saving and loading layouts is refused there.
 * Driven over an in-memory stand-in for the two rows. Also Apply's decoration
 * storage on the main yard (#128).
 */

type Row = Record<string, unknown>;

const USERID = 2503;
const OUTPOST_BASEID = "900";
const WORLD = "world-a";

let mainSave: Row;
let outpostSave: Row;
let locked: number[];
let persisted: number;

const rows = () => [mainSave, outpostSave];
const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);

const txEm = {
  findOne: async (_entity: unknown, where: Row, options?: { lockMode?: LockMode }) => {
    const row = rows().find((one) => matches(one, where)) ?? null;
    if (row && options?.lockMode === LockMode.PESSIMISTIC_WRITE) locked.push(row.basesaveid as number);
    return row;
  },
  flush: async () => {},
};

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Row) => {
        user.save = mainSave;
      },
      persist: () => {
        persisted += 1;
      },
      flush: async () => {},
      transactional: async (run: (em: typeof txEm) => Promise<unknown>) => run(txEm),
    },
  },
}));

const { applyLayout } = await import("./applyLayout.js");
const { upgradeWalls } = await import("./upgradeWalls.js");
const { saveLayout } = await import("./saveLayout.js");
const { layoutRoute } = await import("./layoutRoute.js");

const now = () => Math.floor(Date.now() / 1000);

const run = async (
  controller: KoaController,
  body: Row,
  params: Row = {}
) => {
  const ctx = {
    authUser: { userid: USERID, shiny_locked: false },
    request: { body },
    params,
    query: {},
  } as unknown as Context;
  await layoutRoute(controller)(ctx, async () => {});
  return { status: ctx.status, body: ctx.body as Row };
};

const CORE = { id: 1, t: 112, X: 0, Y: -50, l: 1 };

beforeEach(() => {
  locked = [];
  persisted = 0;
  mainSave = {
    basesaveid: 7,
    baseid: "7",
    userid: USERID,
    saveuserid: USERID,
    type: "main",
    mapversion: 2,
    worldid: WORLD,
    attackid: 0,
    attacks: [],
    savetime: now() - 10,
    credits: 0,
    points: "0",
    resources: { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 },
    buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 } },
    buildinghealthdata: {},
    storedata: {},
    mushrooms: { l: [], s: now() },
    outposts: [[241, 208, OUTPOST_BASEID]],
    savetemplate: {},
  };
  outpostSave = {
    basesaveid: 90,
    baseid: OUTPOST_BASEID,
    userid: USERID,
    saveuserid: USERID,
    type: "outpost",
    mapversion: 2,
    worldid: WORLD,
    attackid: 0,
    attacks: [],
    savetime: now() - 10,
    points: "0",
    resources: {},
    buildingdata: {
      "1": CORE,
      "2": { id: 2, t: 20, X: 150, Y: 150, l: 1 },
      "3": { id: 3, t: 17, X: -200, Y: 200, l: 1 },
    },
    buildinghealthdata: {},
    storedata: {},
    monsters: {},
    mushrooms: {},
  };
});

const layout = (nodes: Row[]) => JSON.stringify({ version: 2, expansion: 0, nodes });

describe("Apply on an outpost", () => {
  test("moves the outpost's buildings and starts its planned upgrade on the main pool", async () => {
    const data = layout([
      { id: 1, t: 112, x: 0, y: -50 },
      { id: 2, t: 20, x: 200, y: -200, plan: { level: 2, order: 0 } },
      { id: 3, t: 17, x: -200, y: 200 },
    ]);

    const answer = await run(applyLayout, { data, startUpgrades: 1, baseid: OUTPOST_BASEID });

    expect(answer.status).toBe(200);
    expect(locked).toEqual([7, 90]);
    const cannon = (outpostSave.buildingdata as Record<string, Row>)["2"]!;
    const [r1, , , , time] = OUTPOST_COSTS[20]!.costs[1]!;
    expect(cannon).toMatchObject({ X: 200, Y: -200, cU: time });
    expect((mainSave.resources as Record<string, number>).r1).toBe(1_000_000 - r1);
    expect(answer.body.resources).toBe(mainSave.resources);
    expect(outpostSave.resources).toEqual({});
    expect(mainSave.buildingdata).toEqual({ "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 } });
  });

  test("another player's outpost is refused 403", async () => {
    outpostSave.userid = 99;
    const answer = await run(applyLayout, { data: layout([]), baseid: OUTPOST_BASEID });
    expect(answer.status).toBe(403);
    expect(answer.body.reason).toBe("notYourYard");
  });

  test("without a baseid the main yard is applied as before, unlocked", async () => {
    const data = layout([{ id: 0, t: 14, x: 50, y: 50 }]);
    const answer = await run(applyLayout, { data });

    expect(answer.status).toBe(200);
    expect(locked).toEqual([]);
    expect(persisted).toBe(1);
    expect((mainSave.buildingdata as Record<string, Row>)["0"]).toMatchObject({ X: 50, Y: 50 });
  });
});

describe("the wall batch on an outpost", () => {
  test("upgrades the outpost's wall and charges the main pool", async () => {
    const answer = await run(upgradeWalls, { ids: "[3]", level: 2, baseid: OUTPOST_BASEID });

    expect(answer.status).toBe(200);
    expect((outpostSave.buildingdata as Record<string, Row>)["3"]).toMatchObject({ l: 2 });
    const [r1, r2] = OUTPOST_COSTS[17]!.costs[1]!;
    expect(mainSave.resources).toMatchObject({ r1: 1_000_000 - r1, r2: 1_000_000 - r2 });
  });
});

describe("layouts in an outpost", () => {
  test("saving one is refused", async () => {
    const answer = await run(
      saveLayout,
      { name: "x", data: layout([]), baseid: OUTPOST_BASEID },
      { slot: "0" }
    );
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("notInOutpost");
    expect(mainSave.savetemplate).toEqual({});
  });
});

describe("Apply and decoration storage (#128)", () => {
  const FLAG = 28;
  const TOTEM = 121;
  const main = () => mainSave.buildingdata as Record<string, Row>;
  const HALL_NODE = { id: 0, t: 14, x: 0, y: 0 };

  test("a decoration the layout leaves out goes into storage, a totem with its level", async () => {
    mainSave.buildingdata = {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 },
      "5": { id: 5, t: FLAG, X: 900, Y: 0 },
      "6": { id: 6, t: TOTEM, X: 200, Y: 200, l: 4 },
    };
    mainSave.buildinghealthdata = { "5": 3 };
    mainSave.researchdata = { b28: 1 };

    const answer = await run(applyLayout, { data: layout([HALL_NODE]) });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ stored: [5, 6], placed: [] });
    expect(Object.keys(main())).toEqual(["0"]);
    expect(mainSave.buildinghealthdata).toEqual({});
    expect(mainSave.researchdata).toEqual({ b28: 2, b121: 1, bl121: 4 });
    expect(answer.body.researchdata).toEqual(mainSave.researchdata);
  });

  test("a decoration left at its saved spot outside the plot stays there", async () => {
    mainSave.buildingdata = {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 },
      "5": { id: 5, t: FLAG, X: 900, Y: 0 },
    };
    const answer = await run(applyLayout, { data: layout([HALL_NODE, { id: 5, t: FLAG, x: 900, y: 0 }]) });

    expect(answer.status).toBe(200);
    expect(main()["5"]).toMatchObject({ X: 900, Y: 0 });
    expect(answer.body.stored).toEqual([]);
  });

  test("fromStorage puts stored decorations down, finished, with new ids", async () => {
    mainSave.buildingdata = {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 },
      "5": { id: 5, t: FLAG, X: 300, Y: 0 },
    };
    mainSave.buildinghealthdata = { "9": 1 };
    mainSave.researchdata = { b28: 2, b121: 1, bl121: 3 };
    const data = JSON.stringify({
      version: 2,
      expansion: 0,
      nodes: [HALL_NODE, { id: 5, t: FLAG, x: 300, y: 0 }],
      fromStorage: [
        { t: FLAG, x: 200, y: 200 },
        { t: TOTEM, x: -300, y: 200 },
      ],
    });

    const answer = await run(applyLayout, { data });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ stored: [], placed: [10, 11] });
    expect(main()["10"]).toEqual({ id: 10, t: FLAG, X: 200, Y: 200 });
    expect(main()["11"]).toEqual({ id: 11, t: TOTEM, X: -300, Y: 200, l: 3 });
    expect(mainSave.researchdata).toEqual({ b28: 1 });
  });

  test("one Apply can store a flag and put a stored one down elsewhere", async () => {
    mainSave.buildingdata = {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 },
      "5": { id: 5, t: FLAG, X: 300, Y: 0 },
    };
    mainSave.researchdata = {};
    const data = JSON.stringify({ version: 2, expansion: 0, nodes: [HALL_NODE], fromStorage: [{ t: FLAG, x: -300, y: 0 }] });

    const answer = await run(applyLayout, { data });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ stored: [5], placed: [6] });
    expect(main()["6"]).toMatchObject({ t: FLAG, X: -300, Y: 0 });
    expect(mainSave.researchdata).toEqual({});
  });

  test("refusals write nothing: not stored, outside the plot, on a building, not a decoration", async () => {
    mainSave.researchdata = { b28: 1 };
    const before = structuredClone(mainSave);
    const attempt = (fromStorage: Row[]) =>
      run(applyLayout, { data: JSON.stringify({ version: 2, expansion: 0, nodes: [HALL_NODE], fromStorage }) });

    expect((await attempt([{ t: 29, x: 200, y: 200 }])).body).toMatchObject({ fromStorageNotInStorage: [0] });
    expect(
      (await attempt([{ t: FLAG, x: 200, y: 200 }, { t: FLAG, x: -200, y: 200 }])).body
    ).toMatchObject({ fromStorageNotInStorage: [1] });
    expect((await attempt([{ t: FLAG, x: 900, y: 0 }])).body).toMatchObject({ fromStorageOutOfBounds: [0] });
    expect((await attempt([{ t: FLAG, x: 0, y: 0 }])).body).toMatchObject({ fromStorageOverlapping: [0] });
    expect((await attempt([{ t: 20, x: 200, y: 200 }])).body).toMatchObject({ fromStorageNotDecoration: [0] });
    expect(mainSave.buildingdata).toEqual(before.buildingdata);
    expect(mainSave.researchdata).toEqual({ b28: 1 });
  });

  test("an outpost takes nothing out of storage", async () => {
    const data = JSON.stringify({
      version: 2,
      expansion: 0,
      nodes: [
        { id: 1, t: 112, x: 0, y: -50 },
        { id: 2, t: 20, x: 150, y: 150 },
        { id: 3, t: 17, x: -200, y: 200 },
      ],
      fromStorage: [{ t: FLAG, x: 300, y: 300 }],
    });
    const answer = await run(applyLayout, { data, baseid: OUTPOST_BASEID });
    expect(answer.status).toBe(400);
    expect(answer.body.error).toBe("Decorations go in your main yard.");
  });
});
