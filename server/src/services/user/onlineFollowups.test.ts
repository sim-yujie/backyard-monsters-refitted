import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import type { Context } from "koa";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { EnumYardType } from "../../enums/EnumYardType.js";
import { MapRoomCell } from "../../enums/MapRoom.js";

/**
 * Follow-ups to the online rule (#275):
 *
 * 1. Everything that shows a player as online to others (Map Room 2's cell
 *    lock, the Map Room 1 neighbour lists, the alliance tables) follows
 *    `isOnline`: a ping alone shows nobody as online.
 * 2. The presence ping answers with the server's clock, the last real action
 *    and an attack running on the main yard.
 * 3. The "Stay protected?" tap is a real action.
 *
 * Runs the real controllers, middleware and services over an in-memory Redis
 * and a small stand-in for the database, on a clock moved by hand.
 */

const store = new Map<string, string>();
const tables = new Map<unknown, Record<string, unknown>[]>();

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      find: async (entity: unknown) => tables.get(entity) ?? [],
      findOne: async (entity: unknown, where: { basesaveid?: number }) =>
        (tables.get(entity) ?? []).find((row) => row.basesaveid === where.basesaveid) ?? null,
      persist: () => {},
      flush: async () => {},
    },
  },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    mget: async (...keys: string[]) => keys.map((key) => store.get(key) ?? null),
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  },
}));

const { presence, stayProtected } = await import("../../controllers/maproom/presence.js");
const { realActionTracker } = await import("../../middleware/realAction.js");
const { userCell } = await import("../../controllers/maproom/v2/cells/userCell.js");
const { playerCell } = await import("../../controllers/maproom/v3/cells/playerCell.js");
const { updateNeighbourData } = await import("../maproom/updateNeighbourData.js");
const { toAllianceMember } = await import("../alliance/allianceMember.js");
const { ATTACK_TIMEOUT } = await import("../base/isAttackActive.js");
const { attackSessionKey } = await import("../base/attackSession.js");
const { REAL_ACTION_WINDOW_SECONDS, isPlayerOnline, onlinePlayers, setChallengePending } = await import("./online.js");

const PLAYER = 2505;
const OTHER = 77;
const BASESAVEID = 2526;
const T0 = 1_900_000_000;
let clock = T0;
const at = (seconds: number) => {
  clock = seconds;
  setSystemTime(new Date(seconds * 1000));
};
const track = realActionTracker();

/** One request from `userid` through the tracker and a controller; returns the body. */
const call = async (userid: number, route: string, controller: (ctx: Context) => Promise<void> | void) => {
  const ctx = {
    method: "POST",
    _matchedRoute: route,
    request: { body: {} },
    authUser: { userid, save: { basesaveid: BASESAVEID } },
  } as unknown as Context;
  await track(ctx, async () => {
    await controller(ctx);
  });
  return ctx.body as Record<string, unknown>;
};

const ping = (userid: number) => call(userid, "/api/:apiVersion/bm/presence", (ctx) => presence(ctx, async () => {}));
const stay = (userid: number) =>
  call(userid, "/api/:apiVersion/bm/presence/stay", (ctx) => stayProtected(ctx, async () => {}));
const upgrade = (userid: number) =>
  call(userid, "/api/:apiVersion/bm/yard/upgrade", (ctx) => {
    ctx.status = 200;
    ctx.body = { error: 0 };
  });

afterEach(() => {
  store.clear();
  tables.clear();
  setSystemTime();
});

describe("onlinePlayers", () => {
  test("is isOnline for each player, in the attack load's window", async () => {
    at(T0);
    await ping(PLAYER);
    await upgrade(PLAYER);
    await ping(OTHER);
    expect([...(await onlinePlayers([PLAYER, OTHER], clock))]).toEqual([PLAYER]);
    expect(await isPlayerOnline(OTHER, clock, 60)).toBe(false);

    // A minute without a ping: the attack load would let them be attacked.
    at(T0 + 61);
    expect((await onlinePlayers([PLAYER], clock)).size).toBe(0);

    // Pinging for ten minutes with no real action.
    at(T0 + REAL_ACTION_WINDOW_SECONDS + 1);
    await ping(PLAYER);
    expect((await onlinePlayers([PLAYER], clock)).size).toBe(0);
  });

  test("a pending in-game check reads as offline", async () => {
    at(T0);
    await upgrade(PLAYER);
    await ping(PLAYER);
    await setChallengePending(PLAYER, true);
    expect((await onlinePlayers([PLAYER], clock)).size).toBe(0);
  });

  test("asks nothing for no players", async () => {
    expect((await onlinePlayers([], T0)).size).toBe(0);
  });
});

describe("the indicators other players see", () => {
  const owners = new Map([
    [OTHER, { userid: OTHER, username: "neighbour", pic_square: "", alliance_id: null, save: { points: "0", basevalue: "0" } }],
  ]);
  const homeCell = (base_type: number) => ({
    uid: OTHER,
    x: 241,
    y: 208,
    base_type,
    baseid: "2000241208",
    terrainHeight: 100,
    save: { damage: 0, protected: 0, locked: 0, empirevalue: 0, flinger: 0, catapult: 0, attackid: 0, attacks: [] },
  });
  const viewer = async () =>
    ({
      authUser: { userid: PLAYER },
      state: { online: await onlinePlayers([OTHER], clock), truces: new Map() },
    }) as unknown as Context;
  const v2Lock = async () =>
    ((await userCell(await viewer(), homeCell(MapRoomCell.HOMECELL) as never, owners as never)) as { lo: number }).lo;
  const v3Lock = async () =>
    ((await playerCell(await viewer(), homeCell(EnumYardType.PLAYER) as never, owners as never)) as unknown as { lo: number }).lo;

  test("Map Room 2 locks a home cell only while its owner is online by the rule", async () => {
    at(T0);
    await ping(OTHER);
    // Seen, but no real action: attackable, so not locked.
    expect(await v2Lock()).toBe(0);
    expect(await v3Lock()).toBe(0);
    await upgrade(OTHER);
    expect(await v2Lock()).toBe(1);
    expect(await v3Lock()).toBe(1);
    at(T0 + REAL_ACTION_WINDOW_SECONDS + 1);
    await ping(OTHER);
    expect(await v2Lock()).toBe(0);
  });

  test("the Map Room 1 neighbour list says online only by the rule", async () => {
    tables.set(User, [{ userid: OTHER, username: "neighbour", pic_square: "" }]);
    tables.set(Save, [{ userid: OTHER, baseid: "1", protected: 0, createtime: 0, attackid: 0, attacks: [], damage: 0, points: "0", basevalue: "0" }]);
    const neighbours = () =>
      updateNeighbourData([{ userid: OTHER, baseid: "1", level: 1, username: "", attacksTodayCount: 0, attacksTodayDate: 0 }], BaseType.MAIN, PLAYER);

    at(T0);
    await ping(OTHER);
    const [seen] = await neighbours();
    expect(seen).toMatchObject({ saved: T0, online: 0 });

    await upgrade(OTHER);
    const [playing] = await neighbours();
    expect(playing).toMatchObject({ saved: T0, online: 1 });
  });

  test("the alliance tables say online only by the rule", async () => {
    const member = { userid: OTHER, username: "neighbour", pic_square: "", alliance_role: 0, save: { points: "0", basevalue: "0", baseid: "1", protected: 0 } };
    at(T0);
    await ping(OTHER);
    expect(toAllianceMember(member as never, await onlinePlayers([OTHER], clock), clock)?.status.online).toBe(false);
    await upgrade(OTHER);
    expect(toAllianceMember(member as never, await onlinePlayers([OTHER], clock), clock)?.status.online).toBe(true);
  });
});

describe("the presence answer", () => {
  test("carries the server's clock and the last real action, 0 when none counts", async () => {
    at(T0);
    expect(await ping(PLAYER)).toEqual({ error: 0, now: T0, lastAction: 0 });
    await upgrade(PLAYER);
    at(T0 + 100);
    expect(await ping(PLAYER)).toEqual({ error: 0, now: T0 + 100, lastAction: T0 });
  });

  test("names the attacker while an attack runs on the main yard, and drops it once it ends", async () => {
    at(T0);
    const row = { basesaveid: BASESAVEID, attackid: 4242, attacks: [{ name: "Raider", starttime: T0 - 30 }] };
    tables.set(Save, [row]);
    // No attack session: the row is not even read.
    expect(await ping(PLAYER)).not.toHaveProperty("attack");

    store.set(attackSessionKey(BASESAVEID), JSON.stringify({ attackerid: OTHER, attackid: 4242, startedat: T0 - 30 }));
    expect(await ping(PLAYER)).toMatchObject({ attack: { by: "Raider", ends: T0 - 30 + ATTACK_TIMEOUT } });

    // The attack's save cleared the row's attackid: over.
    row.attackid = 0;
    expect(await ping(PLAYER)).not.toHaveProperty("attack");

    // Or it ran out of time.
    row.attackid = 4242;
    at(T0 - 30 + ATTACK_TIMEOUT);
    expect(await ping(PLAYER)).not.toHaveProperty("attack");
  });
});

describe("the Stay protected tap", () => {
  test("is a real action: a player who only pinged is online again", async () => {
    at(T0);
    await ping(PLAYER);
    expect(await isPlayerOnline(PLAYER, clock, 60)).toBe(false);

    at(T0 + 540);
    const answer = await stay(PLAYER);
    expect(answer).toEqual({ error: 0, now: T0 + 540, lastAction: T0 + 540 });
    expect(await isPlayerOnline(PLAYER, clock, 60)).toBe(true);
  });

  test("any real action's answer says when it was recorded", async () => {
    at(T0 + 5);
    expect(await upgrade(PLAYER)).toEqual({ error: 0, lastAction: T0 + 5 });
  });
});
