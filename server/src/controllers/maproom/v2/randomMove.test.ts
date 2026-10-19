import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * `POST /worldmapv2/randommove` (issue #366): the main yard moves to a random
 * free land cell in the same world, once a week, and every outpost goes back
 * to the wild monsters. These drive the controller over an in-memory stand-in
 * for the rows it reads and deletes.
 */

const ME = 2505;
const THEM = 77;
const WORLD = "world-a";
const HOME_BASEID = "2000241207";
const OUTPOST_A = "2000241208";
const OUTPOST_B = "2000243210";
const THEIR_OUTPOST = "2000240208";
const FREE_CELL = { x: 50, y: 60, terrainHeight: 130 };
const DAY = 24 * 60 * 60;

type Row = Record<string, unknown>;

let saves: Row[];
let cells: Row[];
let mainSave: Row;
let homeCell: Row;
/** `userid`s whose invitations to move onto their outposts were voided (#205). */
let voidedFrom: number[];
let flushed: number;
/** Defender rows with a live attack session, and who started it. */
let sessions: Map<number, number>;
/** Redis keys `get` answers: the attacker index `isPlayerAttacking` reads. */
let keys: Map<string, string>;
let noFreeCell: boolean;
let delCalls: string[];

const sameValue = (have: unknown, want: unknown): boolean => {
  if (want && typeof want === "object" && "$in" in want) {
    return (want.$in as unknown[]).some((one) => sameValue(have, one));
  }
  if (want && typeof want === "object" && "uuid" in want) return sameValue(have, want.uuid);
  if (have && typeof have === "object" && "uuid" in have) return sameValue(have.uuid, want);
  return have === want;
};

const matches = (row: Row, where: Row) => Object.entries(where).every(([key, want]) => sameValue(row[key], want));

const table = (entity: { name: string }): Row[] => {
  if (entity.name === "Save") return saves;
  if (entity.name === "WorldMapCell") return cells;
  return [];
};

const em = {
  findOne: async (entity: { name: string }, where: Row) => table(entity).find((row) => matches(row, where)) ?? null,
  find: async (entity: { name: string }, where: Row) => table(entity).filter((row) => matches(row, where)),
  nativeDelete: async (entity: { name: string }, where: Row) => {
    const rows = table(entity);
    const doomed = rows.filter((row) => matches(row, where));
    for (const row of doomed) rows.splice(rows.indexOf(row), 1);
    return doomed.length;
  },
  nativeUpdate: async (entity: { name: string }, where: Row) => {
    if (entity.name === "Message") voidedFrom.push(where.userid as number);
    return 0;
  },
  persist: () => {},
  flush: async () => {
    flushed += 1;
  },
  populate: async (user: Row) => {
    user.save = mainSave;
  },
  transactional: async (run: (tx: unknown) => Promise<unknown>) => run(em),
};

mock.module("../../../server.js", () => ({
  postgres: { em },
  redis: {
    get: async (key: string) => keys.get(key) ?? null,
    del: async (key: string) => {
      delCalls.push(key);
      return 0;
    },
  },
}));

mock.module("../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async () => {},
  readAttackSession: async (basesaveid: number) => {
    const attackerid = sessions.get(basesaveid);
    return attackerid === undefined ? null : { attackerid, attackid: 1, startedat: Math.floor(Date.now() / 1000) };
  },
  endAttackSession: async () => {},
}));

mock.module("../../../services/maproom/v2/findFreeCell.js", () => ({
  findFreeCell: async () => {
    if (noFreeCell) throw new Error("Failed to find land position after several attempts");
    return { ...FREE_CELL };
  },
}));

const { randomMove } = await import("./randomMove.js");

const now = () => Math.floor(Date.now() / 1000);

const run = async (user: Row = { userid: ME, alliance_id: 12 }) => {
  const ctx = { authUser: user, request: { body: {} } } as unknown as Context;
  try {
    await randomMove(ctx, async () => {});
    return { ok: true as const, body: ctx.body as Row, reason: undefined, data: undefined, message: undefined };
  } catch (caught) {
    const error = caught as { data?: Row; message?: string };
    return {
      ok: false as const,
      body: undefined,
      reason: error.data?.reason as string | undefined,
      data: error.data,
      message: error.message,
    };
  }
};

const outpostSave = (baseid: string, basesaveid: number, userid = ME): Row => ({
  baseid,
  basesaveid,
  userid,
  saveuserid: userid,
  type: "outpost",
  mapversion: 2,
  attackid: 0,
  attacks: [],
});

const cell = (baseid: string, uid: number, x: number, y: number, base_type = 3): Row => ({
  cellid: Number(baseid.slice(-6)),
  baseid,
  uid,
  x,
  y,
  terrainHeight: 120,
  base_type,
  map_version: 2,
  world: { uuid: WORLD },
});

beforeEach(() => {
  mainSave = {
    basesaveid: 2526,
    baseid: HOME_BASEID,
    userid: ME,
    saveuserid: ME,
    type: "main",
    worldid: WORLD,
    mapversion: 2,
    mr2upgraded: true,
    storedata: {},
    savetime: now(),
    buildingdata: { "4": { id: 4, t: 11, X: 0, Y: 0, l: 2 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 1000, r3: 1000, r4: 1000 },
    outposts: [
      [241, 208, OUTPOST_A],
      [243, 210, OUTPOST_B],
    ],
    buildingresources: { t: now(), [`b${OUTPOST_A}`]: {}, [`b${OUTPOST_B}`]: {} },
    homebase: ["241", "207"],
    randommoveat: null,
    attackid: 0,
    attacks: [],
  };
  homeCell = cell(HOME_BASEID, ME, 241, 207, 2);
  saves = [
    mainSave,
    outpostSave(OUTPOST_A, 901),
    outpostSave(OUTPOST_B, 902),
    outpostSave(THEIR_OUTPOST, 903, THEM),
  ];
  cells = [
    homeCell,
    cell(OUTPOST_A, ME, 241, 208),
    cell(OUTPOST_B, ME, 243, 210),
    cell(THEIR_OUTPOST, THEM, 240, 208),
  ];
  voidedFrom = [];
  flushed = 0;
  sessions = new Map();
  keys = new Map();
  noFreeCell = false;
  delCalls = [];
});

const untouched = () => {
  expect(homeCell).toMatchObject({ x: 241, y: 207 });
  expect(mainSave.homebase).toEqual(["241", "207"]);
  expect(saves.map((row) => row.baseid)).toEqual([HOME_BASEID, OUTPOST_A, OUTPOST_B, THEIR_OUTPOST]);
  expect(cells.map((row) => row.baseid)).toEqual([HOME_BASEID, OUTPOST_A, OUTPOST_B, THEIR_OUTPOST]);
  expect(mainSave.outposts).toHaveLength(2);
  expect(voidedFrom).toEqual([]);
};

describe("randomMove", () => {
  test("moves the home cell to a free spot in the same world and stamps the move time", async () => {
    const before = now();
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.body).toMatchObject({ error: 0, coords: [50, 60], outpostsLost: 2 });
    expect(homeCell).toMatchObject({ x: 50, y: 60, terrainHeight: 130, cellid: 241207, base_type: 2 });
    expect(homeCell.world).toEqual({ uuid: WORLD });
    expect(mainSave.homebase).toEqual(["50", "60"]);
    expect(mainSave.worldid).toBe(WORLD);
    expect(mainSave.randommoveat as number).toBeGreaterThanOrEqual(before);
    expect(result.body?.randommoveat).toBe(mainSave.randommoveat);
  });

  test("every outpost goes back to the wild: its save and its cell are gone, so the map draws a camp there", async () => {
    await run();
    // Only the other player's outpost and the moved home cell are left.
    expect(saves.map((row) => row.baseid)).toEqual([HOME_BASEID, THEIR_OUTPOST]);
    expect(cells.map((row) => row.baseid)).toEqual([HOME_BASEID, THEIR_OUTPOST]);
    expect(mainSave.outposts).toEqual([]);
    // The autobank's clock stays; the per-outpost entries go.
    expect(Object.keys(mainSave.buildingresources as Row)).toEqual(["t"]);
    // Invitations to move onto them are void (#205).
    expect(voidedFrom).toEqual([ME]);
  });

  test("the player keeps their alliance", async () => {
    const user = { userid: ME, alliance_id: 12 };
    await run(user);
    expect(user.alliance_id).toBe(12);
  });

  test("sight and the world list are refreshed after the move", async () => {
    await run({ userid: ME, alliance_id: null });
    expect(delCalls.some((key) => key.includes(String(ME)))).toBe(true);
    expect(delCalls.length).toBeGreaterThanOrEqual(2);
  });

  test("a player with no outposts moves and loses none", async () => {
    saves = [mainSave, outpostSave(THEIR_OUTPOST, 903, THEM)];
    cells = [homeCell, cell(THEIR_OUTPOST, THEM, 240, 208)];
    mainSave.outposts = [];
    const result = await run();
    expect(result.body).toMatchObject({ coords: [50, 60], outpostsLost: 0 });
    expect(cells.map((row) => row.baseid)).toEqual([HOME_BASEID, THEIR_OUTPOST]);
  });

  test("once per week: refused inside the week with when it opens again, allowed after", async () => {
    const last = now() - 3 * DAY;
    mainSave.randommoveat = last;
    const refused = await run();
    expect(refused.reason).toBe("coolingDown");
    expect(refused.data?.availableAt).toBe(last + 7 * DAY);
    expect(refused.message).toContain("already moved this week");
    untouched();
    expect(mainSave.randommoveat).toBe(last);

    mainSave.randommoveat = now() - 7 * DAY - 1;
    expect((await run()).ok).toBe(true);
  });

  test("a second move straight after the first is refused", async () => {
    expect((await run()).ok).toBe(true);
    expect((await run()).reason).toBe("coolingDown");
  });

  test("refused while the main yard is under attack", async () => {
    sessions.set(2526, THEM);
    const result = await run();
    expect(result.reason).toBe("underAttack");
    expect(result.message).toContain("under attack");
    untouched();
  });

  test("refused while one of the outposts is under attack", async () => {
    sessions.set(902, THEM);
    expect((await run()).reason).toBe("outpostUnderAttack");
    untouched();
  });

  test("an attack on someone else's outpost does not stop it", async () => {
    sessions.set(903, 1234);
    expect((await run()).ok).toBe(true);
  });

  test("refused while the player is in an attack of their own", async () => {
    // The player's own attack on someone else's yard, row 950.
    keys.set(`attacker-session:${ME}`, "950");
    sessions.set(950, ME);
    expect((await run()).reason).toBe("attacking");
    untouched();
  });

  test("refused off Map Room 2", async () => {
    mainSave.mapversion = 1;
    mainSave.mr2upgraded = false;
    mainSave.buildingdata = {};
    expect((await run()).reason).toBe("notMapRoom2");
    untouched();
  });

  test("refused without a home cell on the map", async () => {
    cells.splice(0, 1);
    expect((await run()).reason).toBe("noHomeCell");
  });

  test("no free spot found: refused and nothing is lost", async () => {
    noFreeCell = true;
    expect((await run()).reason).toBe("noFreeCell");
    untouched();
    expect(mainSave.randommoveat).toBeNull();
  });
});
