import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { matchesWhere } from "../../testing/matchesWhere.js";

/**
 * Invitations to move (#205) through the routes: sent with `sendmessage`
 * "migraterequest" on one of the sender's outposts, withdrawn with
 * "migraterevoke", accepted with `/base/migratetofriend` (the invited
 * player's main yard moves onto the outpost, at their charge) or declined
 * with `/base/rejectmigratetofriend`. The thread list, the thread and the
 * map say where it stands. Driven over an in-memory stand-in for the rows.
 */

const ALICE = 2505;
const BOB = 77;
const CAROL = 88;
const DAVE = 99;
const WORLD = "world-a";
const OUTPOST = "2000241208";
const SECOND_OUTPOST = "2000242208";
const BOB_OUTPOST = "2000246210";
const CAMP = "2000240208";
const PRICE = 10_000_000;

type Row = Record<string, unknown>;
type Entity = { name: string; new (): object };

const now = () => Math.floor(Date.now() / 1000);

let tables: Map<string, Row[]>;
let sessions: Set<number>;

const table = (entity: Entity) => tables.get(entity.name) ?? [];

/** `matchesWhere`, reading a cell's `world` by its uuid as MikroORM does. */
const matches = (row: Row, where: Row) => {
  const { world, ...rest } = where;
  if (world !== undefined && (row.world as Row | undefined)?.uuid !== world) return false;
  return matchesWhere(row, rest);
};

const sortBy = (rows: Row[], orderBy: Record<string, string> | undefined) => {
  if (!orderBy) return rows;
  const keys = Object.entries(orderBy);
  const value = (row: Row, key: string) => {
    const raw = row[key];
    return raw instanceof Date ? raw.getTime() : Number(raw ?? 0);
  };
  return [...rows].sort((a, b) => {
    for (const [key, direction] of keys) {
      const diff = value(a, key) - value(b, key);
      if (diff !== 0) return direction === "DESC" ? -diff : diff;
    }
    return 0;
  });
};

const em = {
  find: async (entity: Entity, where: Row, options: { orderBy?: Record<string, string>; limit?: number } = {}) => {
    const rows = sortBy(
      table(entity).filter((row) => matches(row, where)),
      options.orderBy
    );
    return options.limit ? rows.slice(0, options.limit) : rows;
  },
  findOne: async (entity: Entity, where: Row) => table(entity).find((row) => matches(row, where)) ?? null,
  count: async (entity: Entity, where: Row) => table(entity).filter((row) => matches(row, where)).length,
  create: (entity: Entity, data: Row) => {
    const row = Object.assign(new entity(), data) as Row;
    tables.get(entity.name)?.push(row);
    return row;
  },
  persist: (value: unknown) => {
    for (const one of [value].flat() as Row[]) {
      const rows = tables.get(one?.constructor?.name ?? "");
      if (rows && !rows.includes(one)) rows.push(one);
    }
  },
  remove: (value: unknown) => {
    for (const one of [value].flat() as Row[]) {
      for (const rows of tables.values()) {
        const at = rows.indexOf(one);
        if (at >= 0) rows.splice(at, 1);
      }
    }
  },
  nativeUpdate: async (entity: Entity, where: Row, data: Row) => {
    const rows = table(entity).filter((row) => matches(row, where));
    for (const row of rows) Object.assign(row, data);
    return rows.length;
  },
  flush: async () => {},
  populate: async () => {},
  transactional: async <T>(run: (tx: object) => Promise<T>): Promise<T> => run(em),
};

const { attackSessionKey, serialiseAttackSession } = await import("../../services/base/attackSession.js");

/**
 * Redis as the attack session store reads it: a yard in `sessions` has an
 * attack running. Stubbed here rather than the store itself, whose module
 * mock would outlive this file.
 */
const redis = {
  get: async (key: string) => {
    const basesaveid = [...sessions].find((id) => attackSessionKey(id) === key);
    return basesaveid === undefined ? null : serialiseAttackSession({ attackerid: DAVE, attackid: 1, startedat: 0 });
  },
};

mock.module("../../server.js", () => ({ postgres: { em }, redis }));

const { sendMessage } = await import("./sendMessage.js");
const { getMessageThreads } = await import("./getMessageThreads.js");
const { getMessageThread } = await import("./getMessageThread.js");
const { migrateToFriend, rejectMigrateToFriend } = await import("../maproom/v2/migrateToFriend.js");
const { pendingInvitesOn, voidOutpostInvites, INVITE_LIFETIME } = await import("../../services/mail/inviteRules.js");

const rows = (name: string) => tables.get(name)!;
const user = (userid: number) => rows("User").find((row) => row.userid === userid)!;
const mainOf = (userid: number) => user(userid).save as Row;
const cellOf = (baseid: string) => rows("WorldMapCell").find((row) => row.baseid === baseid);
const invites = () => rows("Message").filter((row) => row.messagetype === "migraterequest");

const run = async (controller: (ctx: Context) => Promise<void>, from: number, body: Row) => {
  const ctx = { authUser: user(from), request: { body }, status: 0, body: undefined as unknown };
  await controller(ctx as unknown as Context);
  return ctx.body as Row;
};

const send = (from: number, body: Row) =>
  run(sendMessage, from, {
    threadid: "0",
    targetid: "0",
    subject: "Let's Join Forces",
    message: "Move your main yard next to mine and we can work together to dominate the world map!",
    targetbaseid: "0",
    ...body,
  });

/** Alice invites a player to her outpost, in a new thread. */
const invite = (to = BOB, baseid = OUTPOST, from = ALICE) =>
  send(from, { type: "migraterequest", targetid: String(to), baseid });

const revoke = (from: number, threadid: number) =>
  send(from, { type: "migraterevoke", threadid: String(threadid), message: "Never mind." });

const accept = (from: number, threadid: number, shiny?: string) =>
  run(migrateToFriend, from, { threadid: String(threadid), ...(shiny && { shiny }) });

const decline = (from: number, threadid: number) => run(rejectMigrateToFriend, from, { threadid: String(threadid) });

/**
 * The thread list, as `from` sees it. The route rewrites each last message's
 * `userid` for the answer and never flushes; here the rows are the entities,
 * so they are put back as they were.
 */
const threadList = async (from: number) => {
  const before = rows("Message").map((row) => [row, { userid: row.userid, targetid: row.targetid }] as const);
  const threads = (await run(getMessageThreads, from, {})).threads as Record<string, Row>;
  for (const [row, ids] of before) Object.assign(row, ids);
  return threads;
};

const threadMessages = async (from: number, threadid: number) =>
  Object.values((await run(getMessageThread, from, { threadid: String(threadid) })).thread as Record<string, Row>);

const noticesTo = (userid: number) =>
  rows("Message").filter((row) => row.userid === 0 && row.targetid === userid);

const mainSave = (userid: number, basesaveid: number, x: number, y: number, over: Row = {}): Row => ({
  basesaveid,
  baseid: `20${String(basesaveid).padStart(8, "0")}`,
  userid,
  saveuserid: userid,
  type: "main",
  worldid: WORLD,
  mapversion: 2,
  credits: 2_000,
  resources: { r1: 25_000_000, r2: 25_000_000, r3: 25_000_000, r4: 25_000_000 },
  outposts: [],
  buildingresources: {},
  homebase: [String(x), String(y)],
  cantmovetill: 0,
  attackid: 0,
  attacks: [],
  unreadmessages: 0,
  ...over,
});

const outpostSave = (baseid: string, userid: number, basesaveid: number): Row => ({
  basesaveid,
  baseid,
  userid,
  saveuserid: userid,
  type: "outpost",
  worldid: WORLD,
  mapversion: 2,
  attackid: 0,
  attacks: [],
});

const cell = (baseid: string, uid: number, x: number, y: number, base_type: number, save: Row | null, world = WORLD): Row => ({
  baseid,
  uid,
  x,
  y,
  terrainHeight: 100 + x,
  base_type,
  map_version: 2,
  world: { uuid: world },
  save,
});

beforeEach(async () => {
  sessions = new Set();
  const aliceMain = mainSave(ALICE, 2526, 241, 207, {
    outposts: [
      [241, 208, OUTPOST],
      [242, 208, SECOND_OUTPOST],
    ],
    buildingresources: { [`b${OUTPOST}`]: { r1: 5 }, [`b${SECOND_OUTPOST}`]: { r1: 6 } },
  });
  const bobMain = mainSave(BOB, 300, 246, 211, { outposts: [[246, 210, BOB_OUTPOST]] });
  const carolMain = mainSave(CAROL, 400, 10, 10, { worldid: "world-b" });
  const daveMain = mainSave(DAVE, 500, 250, 250, { mapversion: 1 });
  const outpost = outpostSave(OUTPOST, ALICE, 900);
  const second = outpostSave(SECOND_OUTPOST, ALICE, 901);
  const bobsOutpost = outpostSave(BOB_OUTPOST, BOB, 902);
  const camp = { ...outpostSave(CAMP, 0, 903), type: "tribe" };

  tables = new Map<string, Row[]>([
    ["Save", [aliceMain, bobMain, carolMain, daveMain, outpost, second, bobsOutpost, camp]],
    ["User", [
      { userid: ALICE, username: "alice", blockedUsers: [], alliance_id: null, shiny_locked: false, save: aliceMain },
      { userid: BOB, username: "bob", blockedUsers: [], alliance_id: null, shiny_locked: false, save: bobMain },
      { userid: CAROL, username: "carol", blockedUsers: [], alliance_id: null, shiny_locked: false, save: carolMain },
      { userid: DAVE, username: "dave", blockedUsers: [], alliance_id: null, shiny_locked: false, save: daveMain },
    ]],
    ["WorldMapCell", [
      cell(aliceMain.baseid as string, ALICE, 241, 207, 2, aliceMain),
      cell(bobMain.baseid as string, BOB, 246, 211, 2, bobMain),
      cell(carolMain.baseid as string, CAROL, 10, 10, 2, carolMain, "world-b"),
      cell(OUTPOST, ALICE, 241, 208, 3, outpost),
      cell(SECOND_OUTPOST, ALICE, 242, 208, 3, second),
      cell(BOB_OUTPOST, BOB, 246, 210, 3, bobsOutpost),
      cell(CAMP, 0, 240, 208, 1, camp),
    ]],
    ["Thread", []],
    ["Message", []],
  ]);
});

describe("sending an invitation", () => {
  test("a new thread holding the invitation: its outpost, where, and waiting", async () => {
    const body = await invite();

    expect(body).toEqual({ error: 0, messageid: 0, threadid: 1 });
    expect(invites()).toMatchObject([
      {
        threadid: 1,
        userid: ALICE,
        targetid: BOB,
        baseid: OUTPOST,
        worldid: WORLD,
        coords: [241, 208],
        migratestate: "requested",
      },
    ]);
    expect(mainOf(BOB).unreadmessages).toBe(1);
  });

  test("into a thread the pair already has", async () => {
    const threadid = (await send(ALICE, { type: "message", targetid: String(BOB) })).threadid as number;
    await send(ALICE, { type: "migraterequest", threadid: String(threadid), baseid: OUTPOST });

    expect(invites()).toMatchObject([{ threadid, targetid: BOB }]);
  });

  test("refused softly, and nothing written, for an outpost not hers, herself, another world, Map Room 1, an alliance", async () => {
    const refusals = [
      [await invite(BOB, BOB_OUTPOST), "notYourOutpost"],
      [await invite(BOB, CAMP), "notYourOutpost"],
      [await invite(BOB, "2000000000"), "notYourOutpost"],
      [await send(ALICE, { type: "migraterequest", targetid: String(BOB) }), "notYourOutpost"],
      [await invite(CAROL), "otherWorld"],
      [await invite(DAVE), "notMapRoom2"],
    ];
    user(BOB).alliance_id = 3;
    refusals.push([await invite(BOB), "inAlliance"]);

    for (const [body, reason] of refusals) expect(body).toMatchObject({ error: 1, reason });
    expect(invites()).toEqual([]);
  });

  test("an outpost holds one invitation waiting: a second is refused, whoever it is to", async () => {
    await invite(BOB);

    await expect(invite(BOB)).rejects.toMatchObject({ status: 409 });
    expect(invites()).toHaveLength(1);

    // Her other outpost is free to offer.
    expect(await invite(BOB, SECOND_OUTPOST)).toMatchObject({ error: 0 });
  });

  test("once it lapses, is withdrawn or declined, the outpost may be offered again", async () => {
    const first = (await invite(BOB)).threadid as number;
    invites()[0]!.updatetime = now() - INVITE_LIFETIME;
    const second = (await invite(BOB)).threadid as number;
    await revoke(ALICE, second);
    const third = (await invite(BOB)).threadid as number;
    await decline(BOB, third);

    expect(await invite(BOB)).toMatchObject({ error: 0 });
    expect(new Set([first, second, third]).size).toBe(3);
  });
});

describe("withdrawing an invitation", () => {
  test("its sender withdraws it, and the thread says so", async () => {
    const threadid = (await invite()).threadid as number;
    expect(await revoke(ALICE, threadid)).toMatchObject({ error: 0 });

    expect(invites()[0]).toMatchObject({ migratestate: "revoked" });
    expect(rows("Message").at(-1)).toMatchObject({ messagetype: "migraterevoke", userid: ALICE, targetid: BOB, message: "Never mind." });
  });

  test("not by the one invited, not twice, and not once answered", async () => {
    const threadid = (await invite()).threadid as number;
    await expect(revoke(BOB, threadid)).rejects.toMatchObject({ status: 403 });

    await revoke(ALICE, threadid);
    await expect(revoke(ALICE, threadid)).rejects.toMatchObject({ status: 409 });
  });

  test("not in a thread with no invitation", async () => {
    const threadid = (await send(ALICE, { type: "message", targetid: String(BOB) })).threadid as number;
    await expect(revoke(ALICE, threadid)).rejects.toMatchObject({ status: 404 });
  });
});

describe("accepting an invitation", () => {
  test("paid in resources: the main yard moves onto the outpost, which is gone, and Alice is told", async () => {
    const threadid = (await invite()).threadid as number;
    const home = cellOf(mainOf(BOB).baseid as string)!;

    expect(await accept(BOB, threadid)).toEqual({ error: 0, coords: [241, 208] });

    expect(mainOf(BOB).resources).toEqual({ r1: 15_000_000, r2: 15_000_000, r3: 15_000_000, r4: 15_000_000 });
    expect(mainOf(BOB).credits).toBe(2_000);
    expect(home).toMatchObject({ x: 241, y: 208, terrainHeight: 341 });
    expect(mainOf(BOB).homebase).toEqual(["241", "208"]);
    expect(mainOf(BOB).cantmovetill as number).toBeGreaterThan(now());
    // Bob's own outpost stays his.
    expect(mainOf(BOB).outposts).toEqual([[246, 210, BOB_OUTPOST]]);

    expect(cellOf(OUTPOST)).toBeUndefined();
    expect(rows("Save").some((row) => row.baseid === OUTPOST)).toBe(false);
    expect(mainOf(ALICE).outposts).toEqual([[242, 208, SECOND_OUTPOST]]);
    expect(mainOf(ALICE).buildingresources).toEqual({ [`b${SECOND_OUTPOST}`]: { r1: 6 } });

    expect(invites()[0]).toMatchObject({ migratestate: "accepted" });
    expect(noticesTo(ALICE)).toMatchObject([
      { messagetype: "inviteaccepted", subject: "bob accepted your invitation to (241, 208)", coords: [241, 208] },
    ]);
  });

  test("paid in Shiny: 1,200, whatever was posted", async () => {
    const threadid = (await invite()).threadid as number;

    expect(await accept(BOB, threadid, "5")).toMatchObject({ error: 0 });
    expect(mainOf(BOB).credits).toBe(800);
    expect((mainOf(BOB).resources as Row).r1).toBe(25_000_000);
  });

  test("refused softly, with nothing charged or moved and the invitation still open", async () => {
    const threadid = (await invite()).threadid as number;
    const untouched = () => {
      expect(invites()[0]).toMatchObject({ migratestate: "requested" });
      expect(mainOf(BOB).credits).toBe(2_000);
      expect((mainOf(BOB).resources as Row).r1).toBe(25_000_000);
      expect(cellOf(mainOf(BOB).baseid as string)).toMatchObject({ x: 246, y: 211 });
      expect(cellOf(OUTPOST)).toBeDefined();
    };

    user(BOB).alliance_id = 5;
    expect(await accept(BOB, threadid)).toMatchObject({ error: 1, reason: "inAlliance" });
    user(BOB).alliance_id = null;

    mainOf(BOB).cantmovetill = now() + 3_600;
    expect(await accept(BOB, threadid)).toMatchObject({ error: 1, reason: "coolingDown", retryat: now() + 3_600 });
    mainOf(BOB).cantmovetill = 0;

    sessions.add(900);
    expect(await accept(BOB, threadid)).toMatchObject({ error: 1, reason: "underAttack" });
    sessions.clear();
    sessions.add(300);
    expect(await accept(BOB, threadid)).toMatchObject({ error: 1, reason: "underAttack" });
    sessions.clear();

    mainOf(BOB).credits = 1_199;
    expect(await accept(BOB, threadid, "1")).toMatchObject({ error: 1, reason: "notEnoughShiny" });
    mainOf(BOB).credits = 2_000;

    (mainOf(BOB).resources as Row).r4 = PRICE - 1;
    expect(await accept(BOB, threadid)).toMatchObject({ error: 1, reason: "notEnoughResources" });
    (mainOf(BOB).resources as Row).r4 = 25_000_000;

    untouched();
    expect(noticesTo(ALICE)).toEqual([]);
    // Once all is well it goes through.
    expect(await accept(BOB, threadid)).toMatchObject({ error: 0 });
  });

  test("only the one invited may accept, and not with Shiny turned off", async () => {
    const threadid = (await invite()).threadid as number;
    await expect(accept(ALICE, threadid)).rejects.toMatchObject({ status: 403 });

    user(BOB).shiny_locked = true;
    await expect(accept(BOB, threadid, "1")).rejects.toMatchObject({ status: 403 });
  });

  test("closed once accepted, declined, withdrawn, lapsed or void", async () => {
    const accepted = (await invite()).threadid as number;
    await accept(BOB, accepted);
    await expect(accept(BOB, accepted)).rejects.toMatchObject({ status: 409 });

    const declined = (await invite(BOB, SECOND_OUTPOST)).threadid as number;
    await decline(BOB, declined);
    await expect(accept(BOB, declined)).rejects.toMatchObject({ status: 409 });
    await expect(decline(BOB, declined)).rejects.toMatchObject({ status: 409 });

    const withdrawn = (await invite(BOB, SECOND_OUTPOST)).threadid as number;
    await revoke(ALICE, withdrawn);
    await expect(accept(BOB, withdrawn)).rejects.toMatchObject({ status: 409 });

    mainOf(BOB).cantmovetill = 0;
    const lapsed = (await invite(BOB, SECOND_OUTPOST)).threadid as number;
    invites().at(-1)!.updatetime = now() - INVITE_LIFETIME - 1;
    await expect(accept(BOB, lapsed)).rejects.toMatchObject({ status: 409 });

    // Taken from Alice: void, whatever else holds.
    const taken = (await invite(BOB, SECOND_OUTPOST)).threadid as number;
    const second = rows("Save").find((row) => row.baseid === SECOND_OUTPOST)!;
    second.saveuserid = DAVE;
    await expect(accept(BOB, taken)).rejects.toMatchObject({ status: 409 });
    expect(second.saveuserid).toBe(DAVE);
  });
});

describe("declining an invitation", () => {
  test("Alice keeps her outpost and is told", async () => {
    const threadid = (await invite()).threadid as number;

    expect(await decline(BOB, threadid)).toEqual({ error: 0 });
    expect(invites()[0]).toMatchObject({ migratestate: "rejected" });
    expect(cellOf(OUTPOST)?.uid).toBe(ALICE);
    expect(noticesTo(ALICE)).toMatchObject([
      { messagetype: "invitedeclined", subject: "bob declined your invitation to (241, 208)" },
    ]);
  });

  test("only by the one invited", async () => {
    const threadid = (await invite()).threadid as number;
    await expect(decline(ALICE, threadid)).rejects.toMatchObject({ status: 403 });
  });
});

describe("what the mailbox and the map are told", () => {
  test("the thread list and the thread give where it stands and when it lapses, to both sides", async () => {
    const threadid = (await invite()).threadid as number;
    const lapses = (invites()[0]!.updatetime as number) + INVITE_LIFETIME;

    for (const who of [ALICE, BOB]) {
      expect((await threadList(who))[threadid]).toMatchObject({ migratestate: "requested", migrateexpire: lapses });
      expect(await threadMessages(who, threadid)).toMatchObject([
        { messagetype: "migraterequest", migratestate: "requested", migrateexpire: lapses, coords: [241, 208] },
      ]);
    }

    // A reply after it: the list still speaks of the invitation.
    await send(BOB, { type: "message", threadid: String(threadid), message: "Thinking about it." });
    expect((await threadList(BOB))[threadid]).toMatchObject({ migratestate: "requested", messagetype: "message" });
  });

  test("lapsed and void are read, not written", async () => {
    const threadid = (await invite()).threadid as number;
    rows("Save").find((row) => row.baseid === OUTPOST)!.saveuserid = DAVE;
    expect((await threadList(BOB))[threadid]).toMatchObject({ migratestate: "void" });

    rows("Save").find((row) => row.baseid === OUTPOST)!.saveuserid = ALICE;
    invites()[0]!.updatetime = now() - INVITE_LIFETIME;
    expect((await threadList(ALICE))[threadid]).toMatchObject({ migratestate: "expired" });
    expect(invites()[0]).toMatchObject({ migratestate: "requested" });
  });

  test("an outpost taken and won back does not bring its invitation back", async () => {
    const threadid = (await invite()).threadid as number;
    await voidOutpostInvites(em as never, OUTPOST);

    expect((await threadList(ALICE))[threadid]).toMatchObject({ migratestate: "void" });
    await expect(accept(BOB, threadid)).rejects.toMatchObject({ status: 409 });
    expect(await invite(BOB)).toMatchObject({ error: 0 });
  });

  test("the map's pending mark: the thread of each invitation still waiting on the player's own outposts", async () => {
    const threadid = (await invite()).threadid as number;
    const withdrawn = (await invite(BOB, SECOND_OUTPOST)).threadid as number;
    await revoke(ALICE, withdrawn);

    const pending = await pendingInvitesOn(em as never, ALICE, [OUTPOST, SECOND_OUTPOST], now());
    expect([...pending]).toEqual([[OUTPOST, threadid]]);
    expect([...(await pendingInvitesOn(em as never, BOB, [OUTPOST], now()))]).toEqual([]);

    invites()[0]!.updatetime = now() - INVITE_LIFETIME;
    expect([...(await pendingInvitesOn(em as never, ALICE, [OUTPOST], now()))]).toEqual([]);
  });
});
