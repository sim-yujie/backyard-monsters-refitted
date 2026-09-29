import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { Save } from "../../../database/models/save.model.js";
import { World } from "../../../database/models/world.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { generateBaseId } from "../../../utils/generateBaseId.js";

/**
 * The attack load's Map Room is the attacker's own, not the request's
 * (issue #165): a Map Room 2 player who sends `mapversion` 3 or 1 is range
 * checked all the same, and a refused attack on a camp nobody has attacked
 * yet leaves no save row for it, only the report entry of an out-of-range
 * attempt. Drives `/base/load` over an in-memory stand-in for the rows it
 * reads, with the real range check.
 */

const WORLD = "63349203-5b5a-474d-9537-6f1d888e327a";
const OTHER_WORLD = "3cff3884-0998-419d-bb29-c45808019359";
const ATTACKER = 2505;

type Row = Record<string, unknown>;

let tables: Map<unknown, Row[]>;
let created: Row[];
let flushes: number;
let reports: string[];

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) =>
    value !== null && typeof value === "object" && "$in" in value
      ? (value.$in as unknown[]).includes(row[key])
      : row[key] === value
  );

const em = {
  findOne: async (entity: unknown, where: Row) =>
    (tables.get(entity) ?? []).find((row) => matches(row, where)) ?? null,
  find: async (entity: unknown, where: Row) => (tables.get(entity) ?? []).filter((row) => matches(row, where)),
  populate: async () => {},
  create: (entity: unknown, data: Row) => {
    if (entity === Save) created.push(data);
    return data;
  },
  persist: () => {},
  flush: async () => {
    flushes++;
  },
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

// The finaliser that runs first finds nothing to do here, and says so.
mock.module("../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module("../../../services/base/reportManager.js", () => ({
  logReport: async (_user: unknown, message: string) => {
    reports.push(message);
    await em.flush();
  },
  logAttackViolation: async () => {},
  logBanReport: async () => {},
}));

// The real range check, whatever another test file has put in its place:
// the query makes it a module of its own, which no mock replaces.
const REAL_RANGE = "../../../services/maproom/v2/validateRange.ts?real";
const realRange = (await import(REAL_RANGE)) as typeof import("../../../services/maproom/v2/validateRange.js");
mock.module("../../../services/maproom/v2/validateRange.js", () => realRange);

const { baseLoad } = await import("./baseLoad.js");
const { playerMapVersion } = await import("../../../services/maproom/playerMapVersion.js");

const campId = (x: number, y: number, world = WORLD) => generateBaseId(world, x, y);

/** Agenttester's main yard: 241,207, Flinger level 2 (6 cells of reach). */
const attackerRow = (extra: Row = {}): Row => ({
  basesaveid: 2526,
  baseid: "2291380241207",
  userid: ATTACKER,
  saveuserid: ATTACKER,
  type: "main",
  mapversion: 2,
  worldid: WORLD,
  homebase: ["241", "207"],
  flinger: 2,
  outposts: [],
  ...extra,
});

const attackerUser = () => {
  const save = tables.get(Save)!.find((row) => row.userid === ATTACKER);
  return { userid: ATTACKER, username: "agenttester", save, blockedUsers: [] };
};

const load = async (baseid: string, mapversion?: number): Promise<unknown> => {
  const ctx = {
    authUser: attackerUser(),
    meetsDiscordAgeCheck: true,
    request: {
      body: {
        type: "wmattack",
        userid: String(ATTACKER),
        baseid,
        ...(mapversion !== undefined && { mapversion: String(mapversion) }),
        attackData: JSON.stringify({ champions: [], monsters: [] }),
      },
    },
  } as unknown as Context;
  try {
    await baseLoad(ctx, async () => {});
    return null;
  } catch (caught) {
    return caught;
  }
};

beforeEach(() => {
  created = [];
  flushes = 0;
  reports = [];
  tables = new Map<unknown, Row[]>([
    [Save, [attackerRow()]],
    [World, [{ uuid: WORLD, map_version: 2 }, { uuid: OTHER_WORLD, map_version: 3 }]],
    [WorldMapCell, []],
  ]);
});

describe("the attack load takes the attacker's Map Room, not the request's (#165)", () => {
  const FAR_CAMP = campId(300, 300);

  for (const forged of [3, 1, 2, undefined]) {
    test(`an out-of-range camp is refused when the request says ${forged ?? "nothing"}`, async () => {
      const refusal = (await load(FAR_CAMP, forged)) as Error;

      expect(refusal).toBeInstanceOf(Error);
      expect(refusal.message).toBe("No outposts owned, and main base is out of range.");
      expect(created).toEqual([]);
    });
  }

  test("a Map Room 1 attacker cannot reach a Map Room 2 camp, and nothing is written", async () => {
    tables.set(Save, [attackerRow({ mapversion: 1, worldid: null, homebase: null })]);

    const refusal = (await load(FAR_CAMP, 1)) as Error & { data?: Row };

    expect(refusal.data).toEqual({ reason: "baseNotFound" });
    expect(created).toEqual([]);
    expect(flushes).toBe(0);
  });

  test("a base on another world is out of reach, even at the attacker's door", async () => {
    const foreign = campId(242, 207, OTHER_WORLD);
    tables.get(Save)!.push({ basesaveid: 5, baseid: foreign, type: "tribe", worldid: OTHER_WORLD, attacks: [] });

    const refusal = (await load(foreign, 2)) as Error & { data?: Row };

    expect(refusal.data).toEqual({ reason: "baseNotFound" });
  });

  test("a new camp is known only by this world's base id for its cell", async () => {
    const refusal = (await load(campId(242, 207, OTHER_WORLD), 2)) as Error & { data?: Row };

    expect(refusal.data).toEqual({ reason: "baseNotFound" });
    expect(created).toEqual([]);
  });
});

describe("an attack refused for range leaves no camp row (#165)", () => {
  test("out of reach of a nearby outpost: the report entry is written, and no camp row", async () => {
    // An outpost two cells from the camp, whose level 1 Flinger reaches one.
    const outpost = campId(300, 302);
    tables.set(Save, [
      attackerRow({ outposts: [[300, 302, outpost]] }),
      { basesaveid: 900, baseid: outpost, type: "outpost", worldid: WORLD, flinger: 1 },
    ]);

    const refusal = (await load(campId(300, 300), 3)) as Error;

    expect(refusal.message).toBe("No outposts are within attack range.");
    expect(reports).toEqual([`agenttester attacked out of range base: ${campId(300, 300)}`]);
    expect(flushes).toBe(1);
    expect(created).toEqual([]);
  });

  test("a camp in range is still given its row, once the range check has passed", async () => {
    const near = campId(243, 209);

    await load(near, 3);

    expect(created.map((row) => row.baseid)).toEqual([near]);
    expect(created[0]!.worldid).toBe(WORLD);
  });
});

describe("playerMapVersion", () => {
  test("a player on a world is in that world's Map Room, whatever their save says", async () => {
    expect(await playerMapVersion(em as never, { worldid: WORLD, mapversion: 1 })).toBe(2);
    expect(await playerMapVersion(em as never, { worldid: OTHER_WORLD, mapversion: 2 })).toBe(3);
  });

  test("without a world, the save's own Map Room stands", async () => {
    expect(await playerMapVersion(em as never, { worldid: null, mapversion: 1 })).toBe(1);
    expect(await playerMapVersion(em as never, { worldid: "gone", mapversion: 2 })).toBe(2);
  });
});
