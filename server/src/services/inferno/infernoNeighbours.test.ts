import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The Inferno map's other players (WP 3.1, `docs/design/inferno.md` §2.7):
 * real players' live Inferno yards within 7 levels, the newest first, at most
 * 25, never a bot's; the list kept and searched again by the Map Room 1 rules;
 * what each one can be done to read fresh.
 */

const ME = 100;
const NOW = 1_800_000_000;

type Row = Record<string, unknown>;

let infernoRows: Row[];
let mains: Row[];
let users: Row[];
let bots: Row[];
let friends: number[];
let onlineIds: number[];
let maproom: Row | null;
let searches = 0;

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "$in" in value) return (value.$in as unknown[]).includes(row[key]);
    if (value && typeof value === "object" && "$ne" in value) return row[key] !== value.$ne;
    return row[key] === value;
  });

const em = {
  find: async (entity: { name: string }, where: Row, options: { limit?: number } = {}) => {
    if (entity.name === "User") return users.filter((row) => matches(row, where));
    if (entity.name === "Bot") return bots.filter((row) => matches(row, where));
    const pool = where.type === "main" ? mains : infernoRows;
    if (where.userid && typeof where.userid === "object" && "$ne" in where.userid) searches += 1;
    const found = pool.filter((row) => matches(row, where));
    return options.limit ? found.slice(0, options.limit) : found;
  },
  findOne: async () => maproom,
  create: (entity: new () => object, data: object) => Object.assign(new entity(), data),
  persist: (row: Row) => {
    maproom = row;
  },
  flush: async () => {},
  transactional: async (run: (tx: unknown) => Promise<unknown>) => run(em),
  execute: async () => friends.map((friend_userid) => ({ friend_userid })),
};

mock.module("../../server.js", () => ({
  postgres: { em },
  redis: {
    // `onlinePlayers`: a presence mark and a real action now for the online ones.
    mget: async (...keys: string[]) =>
      keys.map((key) => {
        const userid = Number(key.split(":").at(-1));
        if (key.startsWith("presence-challenge")) return null;
        return onlineIds.includes(userid) ? String(NOW) : null;
      }),
  },
}));

const { loadInfernoNeighbours, searchInfernoNeighbours } = await import("./infernoNeighbours.js");
const { experiencePoints } = await import("../../game-data/stats/experiencePoints.js");
const { AttackPermission } = await import("../../enums/MapRoom.js");

/** Points that put an empty yard at `level`. */
const pointsFor = (level: number) => String(experiencePoints[level - 1]);

/** Player `userid` with a live Inferno yard at `level`, changed `age` seconds ago. */
const player = (userid: number, level: number, age = 0, yard: Row = {}) => {
  const baseid = String(6000 + userid);
  infernoRows.push({
    userid,
    baseid,
    type: "inferno",
    points: pointsFor(level),
    basevalue: "0",
    buildingdata: {},
    protected: 0,
    attackid: 0,
    attacks: [],
    lastupdateAt: new Date((NOW - age) * 1000),
    ...yard,
  });
  mains.push({ userid, type: "main", baseid_inferno: Number(baseid) });
  users.push({ userid, username: `player${userid}`, pic_square: "" });
};

beforeEach(() => {
  infernoRows = [];
  mains = [];
  users = [];
  bots = [];
  friends = [];
  onlineIds = [];
  maproom = null;
  searches = 0;
  // The player themself.
  player(ME, 10);
});

/** The search's rows newest first, as the query orders them. */
const newestFirst = () => infernoRows.sort((one, other) => (other.lastupdateAt as Date).getTime() - (one.lastupdateAt as Date).getTime());

describe("the search", () => {
  test("finds real players within 7 levels, newest first, never the player or a bot", async () => {
    player(1, 17, 10);
    player(2, 18, 20); // 8 above: out of range
    player(3, 3, 30);
    player(4, 2, 40); // 8 below
    player(5, 10, 5);
    bots.push({ userid: 5, state: "active" });
    player(6, 11, 50);
    bots.push({ userid: 6, state: "seeded" }); // a dev player, not a bot
    newestFirst();
    const found = await searchInfernoNeighbours(em as never, ME, 10);
    expect(found.map((one) => [one.userid, one.level])).toEqual([
      [1, 17],
      [3, 3],
      [6, 11],
    ]);
  });

  test("lists only the yard its owner plays", async () => {
    player(1, 10);
    // An old Inferno yard of player 1 that their main save no longer names.
    infernoRows.push({ ...infernoRows.at(-1)!, baseid: "9999", lastupdateAt: new Date(NOW * 1000 + 1000) });
    newestFirst();
    const found = await searchInfernoNeighbours(em as never, ME, 10);
    expect(found.map((one) => one.baseid)).toEqual(["6001"]);
  });

  test("at most 25", async () => {
    for (let id = 1; id <= 30; id += 1) player(id, 10, id);
    newestFirst();
    const found = await searchInfernoNeighbours(em as never, ME, 10);
    expect(found).toHaveLength(25);
    expect(found[0]!.userid).toBe(1);
  });
});

describe("the map's list", () => {
  test("is searched the first time and kept in the row", async () => {
    player(1, 10);
    const views = await loadInfernoNeighbours(em as never, ME, 10, NOW);
    expect(views.map((one) => one.userid)).toEqual([1]);
    expect((maproom!.neighbors as Row[]).map((one) => one.userid)).toEqual([1]);
    expect(searches).toBe(1);
  });

  test("reads what each one can be done to now", async () => {
    player(1, 10, 0, { protected: NOW + 600 });
    player(2, 10, 0, { attackid: 5, attacks: [{ name: "raider", starttime: NOW - 10 }] });
    player(3, 14);
    player(4, 2);
    player(5, 10);
    onlineIds = [5];
    friends = [3];
    const kept = [1, 2, 3, 4, 5].map((userid) => ({
      userid,
      baseid: String(6000 + userid),
      level: 10,
      username: "old name",
      attacksTodayCount: 0,
      attacksTodayDate: 0,
      ...(userid === 4 && { attacksfrom: 2, retaliatecount: 1 }),
    }));
    // A list of 10 searched 10 minutes ago: not searched again.
    maproom = {
      userid: ME,
      neighbors: [...kept, ...[6, 7, 8, 9, 10].map((userid) => ({ ...kept[4]!, userid }))],
      neighborsLastCalculated: new Date((NOW - 600) * 1000),
    };
    const views = await loadInfernoNeighbours(em as never, ME, 10, NOW);
    expect(searches).toBe(0);
    const byId = new Map(views.map((one) => [one.userid, one]));
    expect(byId.get(1)).toMatchObject({ attackpermitted: AttackPermission.DAMAGE_PROTECTION, protecteduntil: NOW + 600 });
    expect(byId.get(2)!.attackpermitted).toBe(AttackPermission.UNDER_ATTACK);
    expect(byId.get(3)).toMatchObject({ attackpermitted: AttackPermission.HIGHER_LEVEL, friend: 1, level: 14 });
    expect(byId.get(4)).toMatchObject({ attackpermitted: AttackPermission.VENGEANCE_MODE, vengeance: 1 });
    expect(byId.get(5)).toMatchObject({ attackpermitted: AttackPermission.ATTACKABLE, online: 1, name: "player5" });
    // Players 6-10 have no Inferno yard: left out of the view, kept in the list.
    expect(views).toHaveLength(5);
    expect(maproom!.neighbors as Row[]).toHaveLength(10);
  });

  test("a thin list is searched again after 30 minutes, keeping revenge", async () => {
    player(1, 10);
    maproom = {
      userid: ME,
      neighbors: [
        { userid: 1, baseid: "6001", level: 10, username: "p1", attacksTodayCount: 0, attacksTodayDate: 0, attacksto: 3 },
        // Attacked the player, not found again: kept for the revenge.
        { userid: 50, baseid: "6050", level: 10, username: "p50", attacksTodayCount: 0, attacksTodayDate: 0, attacksfrom: 1 },
      ],
      neighborsLastCalculated: new Date((NOW - 31 * 60) * 1000),
    };
    await loadInfernoNeighbours(em as never, ME, 10, NOW);
    expect(searches).toBe(1);
    const kept = maproom!.neighbors as Row[];
    expect(kept.map((one) => [one.userid, one.attacksto ?? 0, one.attacksfrom ?? 0])).toEqual([
      [1, 3, 0],
      [50, 0, 1],
    ]);
  });
});
