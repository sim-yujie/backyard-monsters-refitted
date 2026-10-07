import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * `POST /base/migrate` with `type=outpost` (issue #181). The route used to move
 * the caller's home onto whatever cell `baseid` named, deleting that cell and
 * its save, and charged whatever `shiny`/`resources` the client posted. These
 * drive the controller over an in-memory stand-in for the rows it reads.
 */

const ME = 2505;
const THEM = 77;
const WORLD = "world-a";
const HOME_BASEID = "2000241207";
const MY_OUTPOST = "2000241208";
const THEIR_OUTPOST = "2000240208";
const THEIR_HOME = "2000239208";
const FAR_OUTPOST = "3000100100";
const CAMP = "2000242208";
const COST = 30_000_000;

type Row = Record<string, unknown>;

let mainSave: Row;
let homeCell: Row;
let cells: Row[];
let removed: Row[];
/** Outposts whose invitations to move were voided (#205). */
let voided: string[];
let flushed: number;
let sessions: Set<number>;

const outpostCell = (
  baseid: string,
  uid: number,
  { world = WORLD, base_type = 3, type = "outpost", x = 241, y = 208, basesaveid = 900 } = {}
): Row => ({
  baseid,
  uid,
  x,
  y,
  terrainHeight: 120,
  base_type,
  map_version: 2,
  world: { uuid: world },
  save: { baseid, basesaveid, userid: uid, saveuserid: uid, type, attackid: 0, attacks: [] },
});

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) =>
    key === "world" ? (row.world as Row).uuid === value : row[key] === value
  );

let lockedRows: number[];

const txEm = {
  findOne: async (_entity: unknown, where: Row) => {
    if ("basesaveid" in where) {
      lockedRows.push(where.basesaveid as number);
      if (where.basesaveid === mainSave.basesaveid) return mainSave;
      return (cells.map((cell) => cell.save as Row).find((save) => save.basesaveid === where.basesaveid) ??
        null);
    }
    return matches(homeCell, where) ? homeCell : null;
  },
  find: async (_entity: unknown, where: Row) => cells.filter((cell) => cell.baseid === where.baseid),
  persist: () => {},
  remove: (rows: Row[]) => removed.push(...rows),
  nativeUpdate: async (_entity: unknown, where: Row) => {
    voided.push(where.baseid as string);
    return 0;
  },
  flush: async () => {
    flushed += 1;
  },
};

/** Keys `invalidateSight` dropped (issue #329, #330 WP1). */
let delCalls: string[] = [];

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Row) => {
        user.save = mainSave;
      },
      transactional: async (run: (em: typeof txEm) => Promise<unknown>) => run(txEm),
    },
  },
  redis: {
    del: async (key: string) => {
      delCalls.push(key);
      return 0;
    },
  },
}));

mock.module("../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async () => {},
  readAttackSession: async (basesaveid: number) =>
    sessions.has(basesaveid) ? { attackerid: THEM, attackid: 1, startedat: 0 } : null,
  endAttackSession: async () => {},
}));

const moves: string[] = [];

mock.module("../../../services/maproom/v2/leaveWorld.js", () => ({
  leaveWorld: async () => {
    moves.push("leave");
  },
}));

mock.module("../../../services/maproom/v2/joinOrCreateWorld.js", () => ({
  joinOrCreateWorld: async () => {
    moves.push("join");
  },
}));

const { migrateBase } = await import("./migrateBase.js");

const run = async (body: Row, user: Row = { userid: ME, shiny_locked: false }) => {
  const ctx = { authUser: user, request: { body: { type: "outpost", ...body } } } as unknown as Context;
  try {
    await migrateBase(ctx, async () => {});
    return { ok: true as const, body: ctx.body as Row, reason: undefined };
  } catch (caught) {
    return { ok: false as const, body: undefined, reason: (caught as { data?: { reason?: string } }).data?.reason };
  }
};

const resources = () => mainSave.resources as Record<string, number>;

beforeEach(() => {
  mainSave = {
    basesaveid: 2526,
    baseid: HOME_BASEID,
    userid: ME,
    saveuserid: ME,
    type: "main",
    worldid: WORLD,
    credits: 2000,
    resources: { r1: 40_000_000, r2: 40_000_000, r3: 40_000_000, r4: 40_000_000 },
    outposts: [[241, 208, MY_OUTPOST]],
    buildingresources: { [`b${MY_OUTPOST}`]: {} },
    homebase: ["241", "207"],
    cantmovetill: 0,
    attackid: 0,
    attacks: [],
  };
  homeCell = {
    baseid: HOME_BASEID,
    uid: ME,
    x: 241,
    y: 207,
    terrainHeight: 100,
    base_type: 2,
    map_version: 2,
    world: { uuid: WORLD },
  };
  cells = [
    outpostCell(MY_OUTPOST, ME),
    outpostCell(THEIR_OUTPOST, THEM, { x: 240, basesaveid: 901 }),
    outpostCell(THEIR_HOME, THEM, { base_type: 2, type: "main", x: 239, basesaveid: 902 }),
    outpostCell(FAR_OUTPOST, ME, { world: "world-b", x: 100, y: 100, basesaveid: 903 }),
    outpostCell(CAMP, 0, { base_type: 1, type: "tribe", x: 242, basesaveid: 904 }),
  ];
  removed = [];
  voided = [];
  flushed = 0;
  sessions = new Set();
  lockedRows = [];
  delCalls = [];
});

const untouched = () => {
  expect(flushed).toBe(0);
  expect(removed).toEqual([]);
  expect(voided).toEqual([]);
  expect(mainSave.credits).toBe(2000);
  expect(resources().r1).toBe(40_000_000);
  expect(homeCell.x).toBe(241);
  expect(homeCell.y).toBe(207);
};

describe("migrateBase, type=outpost", () => {
  test("happy path: resources, 30M of each taken, the outpost row and cell removed, home moved", async () => {
    const result = await run({ baseid: MY_OUTPOST, resources: JSON.stringify({ r1: 1, r2: 1, r3: 1, r4: 1 }) });
    expect(result.body).toEqual({ error: 0, coords: [241, 208] });
    expect(resources()).toEqual({ r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000 });
    expect(mainSave.credits).toBe(2000);
    expect(homeCell).toMatchObject({ x: 241, y: 208, terrainHeight: 120 });
    expect(mainSave.homebase).toEqual(["241", "208"]);
    expect(mainSave.outposts).toEqual([]);
    expect(mainSave.buildingresources).toEqual({});
    expect(mainSave.cantmovetill as number).toBeGreaterThan(Date.now() / 1000);
    expect(removed.map((row) => row.baseid)).toEqual([MY_OUTPOST, MY_OUTPOST]);
    expect(flushed).toBe(1);
    // An invitation to move onto it is void with it (#205).
    expect(voided).toEqual([MY_OUTPOST]);
  });

  test("happy path: Shiny, 1,500 taken whatever amount was posted", async () => {
    const result = await run({ baseid: MY_OUTPOST, shiny: "1" });
    expect(result.ok).toBe(true);
    expect(mainSave.credits).toBe(500);
    expect(resources().r1).toBe(40_000_000);
  });

  test("Shiny is refused on a shiny-locked account", async () => {
    const result = await run({ baseid: MY_OUTPOST, shiny: "1500" }, { userid: ME, shiny_locked: true });
    expect(result.ok).toBe(false);
    untouched();
  });

  test("another player's outpost is refused and nothing is written", async () => {
    const result = await run({ baseid: THEIR_OUTPOST, shiny: "1500" });
    expect(result.reason).toBe("notYours");
    untouched();
  });

  test("another player's main yard is refused and nothing is written", async () => {
    const result = await run({ baseid: THEIR_HOME, shiny: "1500" });
    expect(result.reason).toBe("notAnOutpost");
    untouched();
  });

  test("a wild camp is refused", async () => {
    const result = await run({ baseid: CAMP, shiny: "1500" });
    expect(result.reason).toBe("notAnOutpost");
    untouched();
  });

  test("an outpost of mine in another world is refused", async () => {
    const result = await run({ baseid: FAR_OUTPOST, shiny: "1500" });
    expect(result.reason).toBe("wrongWorld");
    untouched();
  });

  test("an unknown base id is refused", async () => {
    const result = await run({ baseid: "123", shiny: "1500" });
    expect(result.reason).toBe("notFound");
    untouched();
  });

  test("a zero price is not a free move: resources are charged in full", async () => {
    const result = await run({
      baseid: MY_OUTPOST,
      shiny: "0",
      resources: JSON.stringify({ r1: 0, r2: 0, r3: 0, r4: 0 }),
    });
    expect(result.ok).toBe(true);
    expect(resources().r1).toBe(40_000_000 - COST);
    expect(mainSave.credits).toBe(2000);
  });

  test("a negative price adds nothing: resources are charged in full", async () => {
    const result = await run({
      baseid: MY_OUTPOST,
      shiny: "-5000",
      resources: JSON.stringify({ r1: -1e9, r2: -1e9, r3: -1e9, r4: -1e9 }),
    });
    expect(result.ok).toBe(true);
    expect(resources()).toEqual({ r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000 });
    expect(mainSave.credits).toBe(2000);
  });

  test("cannot pay in resources: refused and nothing is written", async () => {
    resources().r4 = COST - 1;
    const result = await run({ baseid: MY_OUTPOST, resources: "{}" });
    expect(result.reason).toBe("notEnoughResources");
    expect(flushed).toBe(0);
    expect(removed).toEqual([]);
    expect(resources().r1).toBe(40_000_000);
  });

  test("cannot pay in Shiny: refused and nothing is written", async () => {
    mainSave.credits = 1499;
    const result = await run({ baseid: MY_OUTPOST, shiny: "1500" });
    expect(result.reason).toBe("notEnoughShiny");
    expect(flushed).toBe(0);
    expect(mainSave.credits).toBe(1499);
  });

  test("an outpost with an attack running on it is refused", async () => {
    sessions.add(900);
    const result = await run({ baseid: MY_OUTPOST, shiny: "1500" });
    expect(result.reason).toBe("underAttack");
    untouched();
  });

  test("an attack running on the main yard is refused too (WP7)", async () => {
    sessions.add(2526);
    expect((await run({ baseid: MY_OUTPOST, shiny: "1500" })).reason).toBe("underAttack");
    untouched();

    sessions.clear();
    Object.assign(mainSave, { attackid: 7, attacks: [{ starttime: Math.floor(Date.now() / 1000) - 30 }] });
    expect((await run({ baseid: MY_OUTPOST, shiny: "1500" })).reason).toBe("underAttack");
    untouched();
  });

  test("the main yard's row is locked first, then the outpost's", async () => {
    await run({ baseid: MY_OUTPOST, shiny: "1500" });
    expect(lockedRows).toEqual([2526, 900]);
  });

  test("inside the cooldown the client is told when it may move, and nothing is charged", async () => {
    const until = Math.floor(Date.now() / 1000) + 3600;
    mainSave.cantmovetill = until;
    const result = await run({ baseid: MY_OUTPOST, shiny: "1500" });
    expect(result.body).toMatchObject({ error: 0, cantMoveTill: until });
    untouched();
    // Never reaches `invalidateSight` (issue #329, #330 WP1): nothing moved.
    expect(delCalls).toEqual([]);
  });

  describe("sight cache invalidation (#329, #330 WP1)", () => {
    test("a completed relocate drops the caller's own cached sight", async () => {
      const result = await run({ baseid: MY_OUTPOST, shiny: "1" });
      expect(result.ok).toBe(true);
      expect(delCalls).toContain(`sight:${ME}`);
    });

    test("...and their alliance's too, if they have one", async () => {
      const result = await run({ baseid: MY_OUTPOST, shiny: "1" }, { userid: ME, shiny_locked: false, alliance_id: 7 });
      expect(result.ok).toBe(true);
      expect(delCalls).toContain(`sight:${ME}`);
      expect(delCalls).toContain("sight:ally:7");
    });

    test("a refused relocate (another refusal reason) does not invalidate", async () => {
      const result = await run({ baseid: MY_OUTPOST, shiny: "1500" }, { userid: ME, shiny_locked: true });
      expect(result.ok).toBe(false);
      expect(delCalls).toEqual([]);
    });
  });
});

describe("migrateBase, type=random (Flash's lost-main-base gate, owner's answer D)", () => {
  /**
   * Two level 1 Twig Snappers (500 health each), a whole wall, which does not
   * count, and the level 2 Map Room a Map Room 2 yard has (10,000 health),
   * battered down to 1,000 so the sums stay easy: 10% of the 11,000 total is
   * 1,100, which the Map Room plus 100 from the Snappers reaches. A Map Room 2
   * yard without one would have a whole one added by the catch-up
   * (`mapRoom.ts` `migrateYard`) and move the numbers.
   */
  const yardAt = (hp1: number, hp2: number, extra: Row = {}) => {
    Object.assign(mainSave, {
      mapversion: 2,
      outposts: [],
      attackid: 0,
      attacks: [],
      mr2upgraded: false,
      storedata: {},
      savetime: Math.floor(Date.now() / 1000),
      buildingdata: {
        "1": { id: 1, t: 1, X: 0, Y: 0, hp: hp1 },
        "2": { id: 2, t: 1, X: 0, Y: 0, hp: hp2 },
        "3": { id: 3, t: 17, X: 0, Y: 0 },
        "4": { id: 4, t: 11, X: 0, Y: 0, l: 2, hp: 1000 },
      },
      buildinghealthdata: { "1": hp1, "2": hp2, "4": 1000 },
      ...extra,
    });
  };

  const random = (user: Row = { userid: ME, alliance_id: null }) => run({ type: "random", baseid: "0", shiny: "0" }, user);

  beforeEach(() => {
    moves.length = 0;
  });

  test("a main yard below 10% health, no alliance, no outposts: moved to a new world", async () => {
    yardAt(0, 99);
    const result = await random();
    expect(result.body).toEqual({ error: 0 });
    expect(moves).toEqual(["leave", "join"]);
  });

  test("10% health or more is refused", async () => {
    yardAt(0, 100);
    expect((await random()).reason).toBe("yardStanding");
    yardAt(500, 500);
    expect((await random()).reason).toBe("yardStanding");
    expect(moves).toEqual([]);
  });

  test("a player not on Map Room 2 is refused and stays where they are", async () => {
    // A Map Room 1 yard: its Map Room is level 1, or the catch-up would move it
    // to Map Room 2 (`mapRoom.ts` `joinMapRoom2`).
    yardAt(0, 0, { mapversion: 1 });
    (mainSave.buildingdata as Record<string, Row>)["4"]!.l = 1;
    expect((await random()).reason).toBe("notMapRoom2");
    yardAt(0, 0, { mapversion: 3 });
    expect((await random()).reason).toBe("notMapRoom2");
    expect(moves).toEqual([]);
  });

  test("a member of an alliance is refused", async () => {
    yardAt(0, 0);
    expect((await random({ userid: ME, alliance_id: 12 })).reason).toBe("inAlliance");
    expect(moves).toEqual([]);
  });

  test("a player with outposts is refused", async () => {
    yardAt(0, 0);
    mainSave.outposts = [[241, 208, MY_OUTPOST]];
    expect((await random()).reason).toBe("hasOutposts");
    expect(moves).toEqual([]);
  });

  test("an attack running on the main yard is refused", async () => {
    yardAt(0, 0);
    sessions.add(2526);
    expect((await random()).reason).toBe("underAttack");
    expect(moves).toEqual([]);
  });

  test("repairs that finished while away count: the yard is caught up first", async () => {
    // Snapper 1 is repairing (rE) from an hour ago and is whole by now.
    yardAt(0, 0, { savetime: Math.floor(Date.now() / 1000) - 3600 });
    (mainSave.buildingdata as Record<string, Row>)["1"]!.rE = 1;
    expect((await random()).reason).toBe("yardStanding");
    expect(moves).toEqual([]);
  });
});
