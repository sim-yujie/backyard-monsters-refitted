import { beforeEach, describe, expect, mock, test } from "bun:test";
import { LockMode } from "@mikro-orm/core";
import type { Context } from "koa";
import type { KoaController } from "../../utils/KoaController.js";
import { COSTS, OUTPOST_COSTS } from "../../game-data/buildingCosts.js";

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
const { rearmTraps } = await import("./rearmTraps.js");
const { MUSHROOM_TYPE, TROJAN_HORSE_TYPE } = await import("../../game-data/buildingFootprints.js");
const { overlaps, rectOf } = await import("../../services/yardplanner/layoutGeometry.js");
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

describe("Apply, the trap re-arm and mushrooms (#263)", () => {
  type Entry = [number, number, number];
  const saved = () => (mainSave.mushrooms as { l: Entry[]; s: number }).l;
  /** Whether a mushroom at `entry` stands clear of every building of the main yard. */
  const clear = ([, x, y]: Entry) =>
    Object.values(mainSave.buildingdata as Record<string, Row>).every(
      (one) => !overlaps(rectOf(MUSHROOM_TYPE, x, y), rectOf(Number(one.t), Number(one.X), Number(one.Y)))
    );

  test("a building moved onto a mushroom is applied, and the mushroom pops up on free ground", async () => {
    const s = now();
    mainSave.mushrooms = { l: [[2, -400, 300], [4, 210, -190]], s };

    const answer = await run(applyLayout, { data: layout([{ id: 0, t: 14, x: 200, y: -200 }]) });

    expect(answer.status).toBe(200);
    expect((mainSave.buildingdata as Record<string, Row>)["0"]).toMatchObject({ X: 200, Y: -200 });
    const [kept, moved] = saved() as [Entry, Entry];
    expect(kept).toEqual([2, -400, 300]);
    expect(moved[0]).toBe(4);
    expect(clear(moved)).toBe(true);
    expect((mainSave.mushrooms as { s: number }).s).toBe(s);
    // The answer carries them, so the client draws them where the server put them.
    expect(answer.body.mushrooms).toEqual(mainSave.mushrooms);
  });

  test("a decoration out of storage onto a mushroom is placed too", async () => {
    mainSave.researchdata = { b28: 1 };
    mainSave.mushrooms = { l: [[1, 300, 300]], s: now() };

    const answer = await run(applyLayout, {
      data: JSON.stringify({
        version: 2,
        expansion: 0,
        nodes: [{ id: 0, t: 14, x: 0, y: 0 }],
        fromStorage: [{ t: 28, x: 300, y: 300 }],
      }),
    });

    expect(answer.status).toBe(200);
    expect(clear(saved()[0]!)).toBe(true);
  });

  test("a trap re-armed onto a mushroom is built, and the mushroom moves", async () => {
    mainSave.mushrooms = { l: [[3, 300, 300]], s: now() };

    const answer = await run(rearmTraps, { traps: JSON.stringify([{ t: 24, x: 300, y: 300 }]) });

    expect(answer.status).toBe(200);
    expect(answer.body.placed).toBe(1);
    expect(clear(saved()[0]!)).toBe(true);
    expect(answer.body.mushrooms).toEqual(mainSave.mushrooms);
  });
});

describe("Apply and the Trojan Horse (#324)", () => {
  const HORSE = { id: 9, t: TROJAN_HORSE_TYPE, X: -70, Y: -800 };

  test("does not hard-block on it, even though the client never lists it", async () => {
    mainSave.buildingdata = { ...(mainSave.buildingdata as Row), "9": HORSE };

    const answer = await run(applyLayout, { data: layout([{ id: 0, t: 14, x: 50, y: 50 }]) });

    expect(answer.status).toBe(200);
    expect((mainSave.buildingdata as Record<string, Row>)["9"]).toEqual(HORSE);
  });

  test("never moves it, even if a forged layout lists it", async () => {
    mainSave.buildingdata = { ...(mainSave.buildingdata as Row), "9": HORSE };

    const answer = await run(applyLayout, {
      data: layout([
        { id: 0, t: 14, x: 50, y: 50 },
        // Clear of id 0's footprint, so this is a geometry-valid forged move.
        { id: 9, t: TROJAN_HORSE_TYPE, x: 200, y: -200 },
      ]),
    });

    expect(answer.status).toBe(200);
    expect((mainSave.buildingdata as Record<string, Row>)["9"]).toEqual(HORSE);
  });
});

describe("basevalue (#209)", () => {
  /** `time + r1 + r2 + r3 + r4` of `type`'s step that left `level - 1`. */
  const worth = (type: number, level: number): number => {
    const [r1, r2, r3, r4, time] = COSTS[type]!.costs[level - 1]!;
    return time + r1 + r2 + r3 + r4;
  };

  test("Apply on the main yard writes the yard's worth", async () => {
    const answer = await run(applyLayout, { data: layout([{ id: 0, t: 14, x: 0, y: 0 }]) });

    expect(answer.status).toBe(200);
    expect(mainSave.basevalue).toBe(String(Math.ceil(0.1 * worth(14, 10))));
  });

  test("the wall batch on the main yard counts the walls' new level", async () => {
    mainSave.buildingdata = {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 },
      "5": { id: 5, t: 17, X: 300, Y: 0, l: 1 },
    };

    const answer = await run(upgradeWalls, { ids: "[5]", level: 2 });

    expect(answer.status).toBe(200);
    expect(mainSave.basevalue).toBe(String(Math.ceil(0.1 * (worth(14, 10) + worth(17, 2)))));
  });

  test("Apply on an outpost writes no base value to either row", async () => {
    mainSave.basevalue = "0";
    const data = layout([
      { id: 1, t: 112, x: 0, y: -50 },
      { id: 2, t: 20, x: 150, y: 150 },
      { id: 3, t: 17, x: -200, y: 200 },
    ]);

    const answer = await run(applyLayout, { data, baseid: OUTPOST_BASEID });

    expect(answer.status).toBe(200);
    expect(mainSave.basevalue).toBe("0");
    expect(outpostSave.basevalue).toBeUndefined();
  });
});

describe("a half-finished layout (owner decision 2026-10-05)", () => {
  const HALL_NODE = { id: 0, t: 14, x: 0, y: 0 };
  const half = (stored: Row[]) =>
    JSON.stringify({ version: 2, expansion: 0, nodes: [HALL_NODE], stored });

  beforeEach(() => {
    mainSave.buildingdata = {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 },
      "5": { id: 5, t: 20, X: 300, Y: 300, l: 1 },
    };
  });

  test("saves with a building still in the drawer, and keeps it in the slot", async () => {
    const answer = await run(saveLayout, { name: "Half", data: half([{ id: 5, t: 20 }]) }, { slot: "3" });
    expect(answer.status).toBe(200);
    expect((answer.body.layout as Row).stored).toEqual([{ id: 5, t: 20 }]);

    const { readLayouts } = await import("../../services/yardplanner/layoutStorage.js");
    const [saved] = readLayouts(mainSave.savetemplate as unknown[]);
    expect(saved?.slot).toBe(3);
    expect(saved?.nodes).toEqual([HALL_NODE]);
    expect(saved?.stored).toEqual([{ id: 5, t: 20 }]);
  });

  test("an empty drawer writes no `stored` field", async () => {
    const answer = await run(saveLayout, { name: "Full", data: half([]) }, { slot: "0" });
    expect(answer.status).toBe(200);
    expect("stored" in (answer.body.layout as Row)).toBe(false);
  });

  test("a stored building the yard does not have is refused", async () => {
    const answer = await run(saveLayout, { name: "Half", data: half([{ id: 77, t: 20 }]) }, { slot: "0" });
    expect(answer.status).toBe(400);
    expect(answer.body.unknown).toEqual([77]);
    expect(mainSave.savetemplate).toEqual({});
  });

  test("a stored building of the wrong type is refused", async () => {
    const answer = await run(saveLayout, { name: "Half", data: half([{ id: 5, t: 21 }]) }, { slot: "0" });
    expect(answer.status).toBe(400);
    expect(answer.body.mismatched).toEqual([5]);
  });

  test("a building both on the plot and in the drawer is refused", async () => {
    const answer = await run(saveLayout, { name: "Half", data: half([{ id: 0, t: 14 }]) }, { slot: "0" });
    expect(answer.status).toBe(400);
    expect(answer.body.duplicated).toEqual([0]);
  });

  test("Apply still refuses a layout with a building in the drawer", async () => {
    const answer = await run(applyLayout, { data: half([{ id: 5, t: 20 }]) });
    expect(answer.status).toBe(409);
    expect(answer.body.unplaced).toEqual([5]);
    expect((mainSave.buildingdata as Record<string, Row>)["5"]?.X).toBe(300);
  });
});
