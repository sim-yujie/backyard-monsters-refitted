import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { Save } from "../../../database/models/save.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";

/**
 * Issue #262: the planner's range rings and info panel are only honest about
 * an outpost's range once the client has the cell's height to scale it by.
 * The attack load already sent `cellheight` (issue #179); this drives
 * `/base/load` over an in-memory stand-in for the rows it reads to check
 * that the owner's own build-mode load of their outpost sends it too, and
 * that nothing else starts sending it by accident.
 */

const OWNER = 2505;
const MAIN_BASEID = "2291380241207";
const OUTPOST_BASEID = "2291380300302";

type Row = Record<string, unknown>;

let tables: Map<unknown, Row[]>;

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) => row[key] === value);

const em = {
  findOne: async (entity: unknown, where: Row) =>
    (tables.get(entity) ?? []).find((row) => matches(row, where)) ?? null,
  find: async (entity: unknown, where: Row) => (tables.get(entity) ?? []).filter((row) => matches(row, where)),
  populate: async () => {},
  nativeUpdate: async () => 0,
  create: (_entity: unknown, data: Row) => data,
  persist: () => {},
  flush: async () => {},
};

mock.module("../../../server.js", () => ({
  postgres: { em },
  redis: {
    get: async () => null,
    setex: async () => "OK",
    del: async () => 0,
    smembers: async () => [],
  },
}));

mock.module("../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module("../../../services/base/reportManager.js", () => ({
  logReport: async () => {},
  logAttackViolation: async () => {},
  logBanReport: async () => {},
}));

// The outpost's own catch-up (locks and advances timers) is not what this
// file is testing; it is given its own coverage elsewhere. Standing in for it
// keeps this file about the one thing issue #262 changed: whether `baseLoad`
// asks `combatCellHeight` for the owner's own outpost build load.
mock.module("../../yard/yardRoute.js", () => ({
  catchUpOwnerYard: async (save: unknown) => ({ save, completed: [] }),
  catchUpOwnerOutpost: async (_user: unknown, outpost: unknown) => ({ save: outpost, completed: [] }),
}));

const { baseLoad } = await import("./baseLoad.js");

const mainSave = (extra: Row = {}): Row => ({
  basesaveid: 2526,
  baseid: MAIN_BASEID,
  userid: OWNER,
  saveuserid: OWNER,
  type: "main",
  mapversion: 2,
  worldid: "63349203-5b5a-474d-9537-6f1d888e327a",
  homebase: ["241", "207"],
  flinger: 2,
  outposts: [[300, 302, OUTPOST_BASEID]],
  attackid: 0,
  attacks: [],
  protected: 0,
  savetime: Math.floor(Date.now() / 1000) - 10,
  credits: 0,
  points: "0",
  catapult: 0,
  resources: { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 },
  buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 } },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  researchdata: {},
  ...extra,
});

const outpostSave = (extra: Row = {}): Row => ({
  basesaveid: 9001,
  baseid: OUTPOST_BASEID,
  userid: OWNER,
  saveuserid: OWNER,
  type: "outpost",
  mapversion: 2,
  worldid: "63349203-5b5a-474d-9537-6f1d888e327a",
  attackid: 0,
  attacks: [],
  savetime: Math.floor(Date.now() / 1000) - 10,
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  buildingdata: { "0": { id: 0, t: 112, X: 0, Y: 0, l: 1 } },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  researchdata: {},
  ...extra,
});

const ownerUser = () => {
  const save = tables.get(Save)!.find((row) => row.userid === OWNER && row.type === "main");
  return { userid: OWNER, username: "agenttester", save, last_seen_at: new Date(), blockedUsers: [] };
};

const load = async (baseid: string): Promise<Record<string, unknown>> => {
  const ctx = {
    authUser: ownerUser(),
    meetsDiscordAgeCheck: true,
    request: {
      body: {
        type: "build",
        userid: String(OWNER),
        baseid,
        mapversion: "2",
      },
    },
  } as unknown as Context;
  await baseLoad(ctx, async () => {});
  return (ctx as unknown as { body: Record<string, unknown> }).body;
};

beforeEach(() => {
  tables = new Map<unknown, Row[]>([
    [Save, [mainSave(), outpostSave()]],
    [WorldMapCell, [{ baseid: OUTPOST_BASEID, map_version: 2, terrainHeight: 250 }]],
  ]);
});

describe("the owner's own outpost build load serves the cell height (#262)", () => {
  test("sends cellheight for the outpost's own build-mode load", async () => {
    const response = await load(OUTPOST_BASEID);

    expect(response.cellheight).toBe(250);
  });

  test("a cell below the terrain floor is still served as given, unadjusted here", async () => {
    tables.set(WorldMapCell, [{ baseid: OUTPOST_BASEID, map_version: 2, terrainHeight: 40 }]);

    const response = await load(OUTPOST_BASEID);

    expect(response.cellheight).toBe(40);
  });

  test("the main yard's own build load sends no cellheight: the terrain never scales it", async () => {
    const response = await load(MAIN_BASEID);

    expect(response.cellheight).toBeUndefined();
  });

  test("an outpost with no map cell on record sends no cellheight", async () => {
    tables.set(WorldMapCell, []);

    const response = await load(OUTPOST_BASEID);

    expect(response.cellheight).toBeUndefined();
  });
});
