import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { AttackLogs } from "../../../database/models/attacklogs.model.js";
import { Save } from "../../../database/models/save.model.js";
import { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { devConfig } from "../../../config/GameConfig.js";
import { matchesWhere } from "../../../testing/matchesWhere.js";
import { memoryRedis } from "../../../testing/memoryRedis.js";

/**
 * `POST /worldmapv2/getarea`'s fog of war redaction (issue #330,
 * `docs/design/fog-of-war.md` §5.1). Driven over an in-memory stand-in for
 * the rows it and `getPlayerSight` (#329, exercised for real here, not
 * mocked) read: a hidden cell comes back as nothing but `{fog:1}`, a fully
 * fogged zone never queries `world_map_cell` at all, and owners/alliancedata
 * are built only from what the viewer can actually see.
 */

type Row = Record<string, unknown>;

const WORLD = "world-a";

let tables: Map<unknown, Row[]>;
let findCalls: { entity: unknown; where: Row }[];

const strings = new Map<string, string>();
const redis = memoryRedis(strings);

const em = {
  find: async (entity: unknown, where: Row) => {
    findCalls.push({ entity, where });
    return (tables.get(entity) ?? []).filter((row) => matchesWhere(row, where));
  },
  findOne: async (entity: unknown, where: Row) =>
    (tables.get(entity) ?? []).find((row) => matchesWhere(row, where)) ?? null,
  // The fixtures below always attach `save` directly onto the viewer, so
  // there is nothing for either `getArea` or `getPlayerSight`'s own
  // populate calls to actually load.
  populate: async () => {},
};

mock.module("../../../server.js", () => ({ postgres: { em }, redis }));

// These four modules have other real exports that files *other* than this
// one's unit under test rely on unmocked (e.g. `powerups.ts`'s
// `alliancePowerup`, `online.ts`'s `isOnline`/`readPresenceMarks`,
// `inviteRules.ts`'s invite-thread helpers, `shinyLock.ts`'s
// `isShinyLocked`). `mock.module` replaces a module for the whole `bun
// test` process, not just this file, so each mock below is the real module
// (imported through a `?real` specifier, same trick
// `baseSave.attack.test.ts` uses, so it is never itself intercepted by the
// mock it is about to feed) with only the one function `getArea` actually
// calls swapped out - never a bare object that would silently drop every
// other export out from under an unrelated test file sharing this process.
// A bare string variable, not a string literal, in the `import()` call
// below: TypeScript only tries (and fails) to resolve a `?real` module
// specifier statically when it is given as a literal (same reason
// `baseLoad.mapversion.test.ts`'s `REAL_RANGE` and
// `baseSave.attack.test.ts`'s `REAL_RUNNER` are their own constants too).
const REAL_POWERUPS = "../../../services/alliance/powerups.ts?real";
const REAL_ONLINE = "../../../services/user/online.ts?real";
const REAL_INVITE_RULES = "../../../services/mail/inviteRules.ts?real";
const REAL_SHINY_LOCK = "../../../services/user/shinyLock.ts?real";
const REAL_ALLIANCE_DATA = "../../../services/alliance/allianceData.ts?real";

const realPowerups = (await import(REAL_POWERUPS)) as typeof import("../../../services/alliance/powerups.js");
const realOnline = (await import(REAL_ONLINE)) as typeof import("../../../services/user/online.js");
const realInviteRules = (await import(REAL_INVITE_RULES)) as typeof import("../../../services/mail/inviteRules.js");
const realShinyLock = (await import(REAL_SHINY_LOCK)) as typeof import("../../../services/user/shinyLock.js");
const realAllianceData = (await import(REAL_ALLIANCE_DATA)) as typeof import("../../../services/alliance/allianceData.js");

mock.module("../../../services/alliance/powerups.js", () => ({
  ...realPowerups,
  runningPowerups: async () => [],
}));
mock.module("../../../services/user/online.js", () => ({
  ...realOnline,
  onlinePlayers: async () => new Set<number>(),
}));
mock.module("../../../services/mail/inviteRules.js", () => ({
  ...realInviteRules,
  pendingInvitesOn: async () => new Map(),
}));
mock.module("../../../services/user/shinyLock.js", () => ({
  ...realShinyLock,
  visibleCredits: (_user: unknown, credits: number) => credits,
}));
mock.module("../../../services/alliance/allianceData.js", () => ({
  ...realAllianceData,
  // Real-ish: turns whatever alliance ids `getArea` asks for into an
  // inspectable roster entry, so a test can assert the exact ids returned
  // without needing an `Alliance` table of its own.
  getAllianceRoster: async (allianceIds: number[]) =>
    allianceIds.map((allianceId) => ({
      alliance_id: allianceId,
      name: `alliance-${allianceId}`,
      image: 0,
      relationships: {},
    })),
}));
// `getTruces.ts` has no other runtime export, so replacing it outright
// drops nothing out from under anyone else.
mock.module("../../../services/maproom/getTruces.js", () => ({
  getTruces: async () => new Map(),
}));
// `generateMap.ts` is left real (not mocked): it is used widely elsewhere
// (`findFreeCell.ts`, `terrainMap.ts`, MR3's `getCells.ts`,
// `takeoverQuote.ts`'s own tests loop `getTerrainHeight` until it finds a
// particular height - a constant stub would spin that forever), and
// `getArea.ts`'s own in-memory cells never reach a real terrain height
// through anything these tests check (the stubbed `createCellData` below
// ignores it).
mock.module("../../../services/maproom/v2/createCellData.js", () => ({
  // A real `world_map_cell` row (our `cellRow` fixture, always given a
  // `baseid`) renders as its owner and id; an in-memory generated cell (no
  // `baseid` - `getArea.ts` only ever builds those with `new
  // WorldMapCell(undefined, x, y, height)`) renders as plain terrain. Real
  // terrain/owner-card rendering is not this controller's fog logic and is
  // covered by its own tests elsewhere.
  createCellData: async (cell: Row, _worldid: string, _ctx: unknown, cellOwners?: Map<number, Row>) => {
    if (typeof cell.baseid === "string") {
      const owner = cellOwners?.get(cell.uid as number);
      return { uid: cell.uid, baseid: cell.baseid, username: owner?.username, alliance_id: owner?.alliance_id };
    }
    return { terrain: true, x: cell.x, y: cell.y };
  },
}));

const { getArea } = await import("./getArea.js");

/** A main save row, as `postgres.em.populate`'s real implementation would attach it. */
const mainSaveRow = (userid: number, over: Partial<Row> = {}): Row => ({
  basesaveid: userid * 100,
  type: "main",
  userid,
  worldid: WORLD,
  homebase: [String(userid), String(userid)],
  flinger: 2,
  outposts: [],
  credits: 0,
  resources: {},
  points: "0",
  basevalue: "0",
  ...over,
});

/** A viewer, ready to be `ctx.authUser`. `over` reaches both the user row and its save. */
const viewer = (userid: number, over: Partial<Row> = {}): Row => ({
  userid,
  alliance_id: null,
  shiny_locked: false,
  save: mainSaveRow(userid, over),
  ...over,
});

/** Another player's own user row, for the `User` table a cell's owner is looked up on. */
const ownerRow = (userid: number, username: string, allianceId: number | null = null): Row => ({
  userid,
  username,
  alliance_id: allianceId,
  pic_square: null,
});

/** A persisted `world_map_cell` row, as `getArea`'s own DB query would return it. */
const cellRow = (baseid: string, uid: number, x: number, y: number, over: Partial<Row> = {}): Row => ({
  baseid,
  uid,
  x,
  y,
  base_type: 2,
  map_version: 2,
  world: WORLD,
  ...over,
});

const run = async (authUser: Row, body: Row): Promise<Row> => {
  const ctx = { authUser, request: { body }, state: {} } as unknown as Context;
  await getArea(ctx, async () => {});
  return ctx.body as Row;
};

beforeEach(() => {
  tables = new Map();
  findCalls = [];
  strings.clear();
});

const startingDisableFog = devConfig.disableFogOfWar;
afterEach(() => {
  devConfig.disableFogOfWar = startingDisableFog;
});

describe("getArea: a fully fogged zone", () => {
  test("every cell comes back as bare {fog:1}, alliancedata is own-alliance-only, and world_map_cell is never queried", async () => {
    // Home far outside the queried zone; nothing in it is in reach or revealed.
    const p = viewer(1, { alliance_id: 42, flinger: 0, homebase: ["500", "500"] });

    const body = await run(p, { x: 0, y: 0 });

    expect(Object.keys(body.data as Row).length).toBe(11);
    for (let x = 0; x <= 10; x++) {
      for (let y = 0; y <= 10; y++) {
        expect((body.data as Record<number, Record<number, unknown>>)[x]![y]).toEqual({ fog: 1 });
      }
    }
    expect(body.alliancedata).toEqual([{ alliance_id: 42, name: "alliance-42", image: 0, relationships: {} }]);
    expect(typeof body.sv).toBe("string");
    expect((body.sv as string).length).toBeGreaterThan(0);
    expect(findCalls.some(({ entity }) => entity === WorldMapCell)).toBe(false);
  });

  test("no alliance: alliancedata is empty, not just own-alliance", async () => {
    const p = viewer(1, { flinger: 0, homebase: ["500", "500"] });

    const body = await run(p, { x: 0, y: 0 });

    expect(body.alliancedata).toEqual([]);
  });
});

describe("getArea: a partially visible zone with a hidden base nearby", () => {
  test("the hidden base is fog, never queried into owners, and leaves no trace of its alliance or identity", async () => {
    // Home at (1,1), flinger 1 -> mainYardRange(1) = 4 steps.
    const p = viewer(1, { flinger: 1, homebase: ["1", "1"] });
    tables.set(User, [ownerRow(3, "near-owner", 100), ownerRow(4, "far-owner", 200)]);
    tables.set(WorldMapCell, [
      cellRow("near-base", 3, 3, 1), // 2 steps from (1,1): in reach
      cellRow("far-base", 4, 10, 10), // far corner of the zone: well out of reach, not revealed
    ]);

    const body = await run(p, { x: 0, y: 0 });
    const data = body.data as Record<number, Record<number, unknown>>;

    expect(data[3]![1]).toEqual({ uid: 3, baseid: "near-base", username: "near-owner", alliance_id: 100 });
    expect(data[10]![10]).toEqual({ fog: 1 });

    const ownerFind = findCalls.find(({ entity, where }) => entity === User && "userid" in where);
    expect((ownerFind!.where.userid as Row).$in).not.toContain(4);
    expect((ownerFind!.where.userid as Row).$in).toContain(3);

    const allianceIds = (body.alliancedata as Row[]).map((a) => a.alliance_id);
    expect(allianceIds).toContain(100);
    expect(allianceIds).not.toContain(200);

    const json = JSON.stringify(body);
    expect(json).not.toContain("far-owner");
    expect(json).not.toContain("far-base");
  });
});

describe("getArea: sv", () => {
  test("changes once the viewer's own sight changes", async () => {
    const p = viewer(1, { flinger: 1, homebase: ["1", "1"] });

    const first = await run(p, { x: 0, y: 0 });

    // The flinger level moved - clear the sight cache (30s TTL in real use)
    // the same way an invalidation would, then ask again.
    (p.save as Row).flinger = 4;
    strings.clear();

    const second = await run(p, { x: 0, y: 0 });

    expect(second.sv).not.toBe(first.sv);
  });
});

describe("getArea: alliance shared sight", () => {
  test("an ally's own base, outside the viewer's own reach, still comes through with real data", async () => {
    const p = viewer(1, { alliance_id: 9, flinger: 1, homebase: ["1", "1"] }); // reach 4
    tables.set(User, [
      { userid: 1, alliance_id: 9 },
      { userid: 5, alliance_id: 9 },
      ownerRow(5, "ally-member", 9),
    ]);
    tables.set(Save, [mainSaveRow(5, { homebase: ["10", "10"], flinger: 0, outposts: [] })]);
    tables.set(WorldMapCell, [cellRow("ally-base", 5, 10, 10)]); // 7 steps from (1,1): out of the viewer's own reach

    const body = await run(p, { x: 0, y: 0 });
    const data = body.data as Record<number, Record<number, unknown>>;

    expect(data[10]![10]).toEqual({ uid: 5, baseid: "ally-base", username: "ally-member", alliance_id: 9 });
  });
});

describe("getArea: an attacker's base", () => {
  test("revealed through getarea, outside the viewer's own reach", async () => {
    const p = viewer(1, { flinger: 1, homebase: ["1", "1"] }); // reach 4
    tables.set(AttackLogs, [{ defender_userid: 1, attacker_userid: 6 }]);
    tables.set(User, [ownerRow(6, "attacker", null)]);
    tables.set(WorldMapCell, [cellRow("attacker-base", 6, 9, 0)]); // well out of reach, but an attacker's base is always revealed

    const body = await run(p, { x: 0, y: 0 });
    const data = body.data as Record<number, Record<number, unknown>>;

    expect(data[9]![0]).toEqual({ uid: 6, baseid: "attacker-base", username: "attacker", alliance_id: null });
  });
});

describe("getArea: devConfig.disableFogOfWar", () => {
  test("bypasses the redaction end to end: an otherwise-hidden base comes through real", async () => {
    devConfig.disableFogOfWar = true;
    const p = viewer(1, { flinger: 0, homebase: ["500", "500"] }); // sees nothing of the queried zone, normally
    tables.set(User, [ownerRow(4, "far-owner", 200)]);
    tables.set(WorldMapCell, [cellRow("far-base", 4, 10, 10)]);

    const body = await run(p, { x: 0, y: 0 });
    const data = body.data as Record<number, Record<number, unknown>>;

    expect(data[10]![10]).toEqual({ uid: 4, baseid: "far-base", username: "far-owner", alliance_id: 200 });
  });
});
