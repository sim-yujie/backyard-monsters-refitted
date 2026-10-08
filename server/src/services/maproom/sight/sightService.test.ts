import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { AlliancePowerupType } from "../../../enums/Alliance.js";
import { BaseType } from "../../../enums/Base.js";
import { AttackLogs } from "../../../database/models/attacklogs.model.js";
import { Save } from "../../../database/models/save.model.js";
import { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { matchesWhere } from "../../../testing/matchesWhere.js";
import { memoryRedis } from "../../../testing/memoryRedis.js";

/**
 * The Map Room 2 fog of war sight service (issue #329,
 * `docs/design/fog-of-war.md` §4, §9), over an in-memory stand-in for
 * Postgres and Redis: own sight, the alliance union (same world only), every
 * attacker's base, and the cache's hits, misses and invalidation.
 */

type Row = Record<string, unknown>;

let tables: Map<unknown, Row[]>;
let runningPowerups: { id: AlliancePowerupType; endtime: number }[];
let findCalls: { entity: unknown; where: Row }[];

const strings = new Map<string, string>();
const redis = memoryRedis(strings);

const em = {
  find: async (entity: unknown, where: Row) => {
    findCalls.push({ entity, where });
    return (tables.get(entity) ?? []).filter((row) => matchesWhere(row, where));
  },
  // `invalidateSight` reads a bare userid's alliance off `User` with this.
  findOne: async (entity: unknown, where: Row) =>
    (tables.get(entity) ?? []).find((row) => matchesWhere(row, where)) ?? null,
  // The fixtures below always attach `save` directly, so there is nothing to load.
  populate: async () => {},
};

mock.module("../../../server.js", () => ({ postgres: { em }, redis }));
// Spread the real module: bun's mock.module leaks into later test files, which import
// other exports (`isDeclareWarRunning`) from the same module.
const REAL_POWERUPS = "../../alliance/powerups.ts?real";
const realPowerups = (await import(REAL_POWERUPS)) as typeof import("../../alliance/powerups.js");
mock.module("../../alliance/powerups.js", () => ({
  ...realPowerups,
  runningPowerups: async (allianceId: number | null) => (allianceId ? runningPowerups : []),
}));

const {
  SIGHT_CACHE_TTL_SECONDS,
  allianceSightKey,
  getPlayerSight,
  invalidateAllianceSight,
  invalidatePlayerSight,
  invalidateSight,
  invalidateSightIfFlingerChanged,
  playerSightKey,
} = await import("./sightService.js");

const WORLD = "world-1";
const OTHER_WORLD = "world-2";

/** A main save row, as `postgres.em.find(Save, ...)` would return it. */
const mainSaveRow = (
  userid: number,
  over: Partial<Row> = {},
): Row => ({
  type: BaseType.MAIN,
  userid,
  worldid: WORLD,
  homebase: [String(100 + userid), String(100 + userid)],
  flinger: 2,
  outposts: [],
  ...over,
});

const user = (userid: number, over: Partial<Row> = {}): User =>
  ({
    userid,
    alliance_id: null,
    save: mainSaveRow(userid, over),
    ...over,
  }) as unknown as User;

beforeEach(() => {
  strings.clear();
  tables = new Map();
  runningPowerups = [];
  findCalls = [];
});

afterEach(() => {
  strings.clear();
});

describe("getPlayerSight: a player with no world placement", () => {
  test("sees nothing, and nothing is cached", async () => {
    const noWorld = { userid: 1, alliance_id: null, save: { worldid: null } } as unknown as User;

    const sight = await getPlayerSight(noWorld);

    expect(sight).toEqual({ sv: sight.sv, sources: [], revealed: [] });
    expect(await redis.get(playerSightKey(1))).toBeNull();
  });
});

describe("getPlayerSight: own circles and cells", () => {
  test("a main yard with no outposts gets one circle at its reach, and its own cell is always revealed", async () => {
    const p = user(1, { flinger: 2 }); // mainYardRange(2) = 6

    const sight = await getPlayerSight(p);

    expect(sight.sources).toEqual([{ x: 101, y: 101, reach: 6, kind: "own" }]);
    expect(sight.revealed).toEqual([{ x: 101, y: 101 }]);
  });

  test("flinger 0 still reveals the home cell, through a circle that reaches nothing", async () => {
    const p = user(1, { flinger: 0 });

    const sight = await getPlayerSight(p);

    expect(sight.sources).toEqual([{ x: 101, y: 101, reach: 0, kind: "own" }]);
    expect(sight.revealed).toEqual([{ x: 101, y: 101 }]);
  });

  test("each outpost gets its own circle from its own flinger level", async () => {
    const p = user(1, {
      flinger: 1, // mainYardRange(1) = 4
      outposts: [
        [200, 200, "out-a"],
        [300, 300, "out-b"],
      ],
    });
    tables.set(Save, [
      { baseid: "out-a", flinger: 3 }, // outpostRange(3) = 3
      { baseid: "out-b", flinger: 1 }, // outpostRange(1) = 1
    ]);

    const sight = await getPlayerSight(p);

    expect(sight.sources).toEqual([
      { x: 101, y: 101, reach: 4, kind: "own" },
      { x: 200, y: 200, reach: 3, kind: "own" },
      { x: 300, y: 300, reach: 1, kind: "own" },
    ]);
    expect(sight.revealed).toEqual([
      { x: 101, y: 101 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ]);
  });

  test("Declare War adds its two cells to every circle while the player's alliance has it running", async () => {
    const p = user(1, { flinger: 2, alliance_id: 9 }); // mainYardRange(2) = 6
    runningPowerups = [{ id: AlliancePowerupType.DECLARE_WAR, endtime: 9_999_999_999 }];

    const sight = await getPlayerSight(p);

    expect(sight.sources).toEqual([{ x: 101, y: 101, reach: 8, kind: "own" }]);
  });
});

describe("getPlayerSight: attackers", () => {
  test("reveals the current bases, on the player's world, of anyone who has ever attacked them", async () => {
    const p = user(1);
    tables.set(AttackLogs, [
      { defender_userid: 1, attacker_userid: 5 },
      { defender_userid: 1, attacker_userid: 5 }, // a second attack by the same player: not revealed twice
      { defender_userid: 1, attacker_userid: 6 },
      { defender_userid: 2, attacker_userid: 7 }, // attacked someone else, not this player
    ]);
    tables.set(WorldMapCell, [
      { world: WORLD, uid: 5, x: 500, y: 500 },
      { world: WORLD, uid: 6, x: 600, y: 600 },
      { world: WORLD, uid: 6, x: 601, y: 601 }, // an outpost of the same attacker: also revealed
      { world: WORLD, uid: 7, x: 700, y: 700 },
      { world: OTHER_WORLD, uid: 5, x: 1, y: 1 }, // same attacker, a base on a different world: ignored
    ]);

    const sight = await getPlayerSight(p);

    expect(sight.revealed).toEqual([
      { x: 101, y: 101 },
      { x: 500, y: 500 },
      { x: 600, y: 600 },
      { x: 601, y: 601 },
    ]);
  });

  test("seeing an attacker's base is not being in range of it: no circle is added for one", async () => {
    const p = user(1);
    tables.set(AttackLogs, [{ defender_userid: 1, attacker_userid: 5 }]);
    tables.set(WorldMapCell, [{ world: WORLD, uid: 5, x: 500, y: 500 }]);

    const sight = await getPlayerSight(p);

    expect(sight.sources).toEqual([{ x: 101, y: 101, reach: 6, kind: "own" }]);
  });

  test("never attacked: no revealed cells beyond the player's own", async () => {
    const p = user(1);

    const sight = await getPlayerSight(p);

    expect(sight.revealed).toEqual([{ x: 101, y: 101 }]);
  });
});

describe("getPlayerSight: alliance union", () => {
  test("unions an ally's circles and own cells with the player's own, on the same world", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [
      { userid: 1, alliance_id: 9 },
      { userid: 2, alliance_id: 9 },
    ]);
    tables.set(Save, [mainSaveRow(2, { flinger: 3 })]); // mainYardRange(3) = 8

    const sight = await getPlayerSight(p);

    expect(sight.sources).toContainEqual({ x: 102, y: 102, reach: 8, kind: "ally" });
    expect(sight.revealed).toContainEqual({ x: 102, y: 102 });
  });

  test("tags the player's own circle 'own', for the minimap's two-tint drawing (#331)", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [
      { userid: 1, alliance_id: 9 },
      { userid: 2, alliance_id: 9 },
    ]);
    tables.set(Save, [mainSaveRow(2, { flinger: 3 })]);

    const sight = await getPlayerSight(p);

    expect(sight.sources).toContainEqual({ x: 101, y: 101, reach: 6, kind: "own" });
  });

  test("ignores an ally on a different world (\"allies on another world ignored\")", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [
      { userid: 1, alliance_id: 9 },
      { userid: 2, alliance_id: 9 },
    ]);
    tables.set(Save, [mainSaveRow(2, { worldid: OTHER_WORLD, flinger: 4 })]);

    const sight = await getPlayerSight(p);

    expect(sight.sources).toEqual([{ x: 101, y: 101, reach: 6, kind: "own" }]);
  });

  test("does not share an ally's attacker history (rule 4 is not unioned)", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [
      { userid: 1, alliance_id: 9 },
      { userid: 2, alliance_id: 9 },
    ]);
    tables.set(Save, [mainSaveRow(2)]);
    tables.set(AttackLogs, [{ defender_userid: 2, attacker_userid: 99 }]);
    tables.set(WorldMapCell, [{ world: WORLD, uid: 99, x: 999, y: 999 }]);

    const sight = await getPlayerSight(p);

    expect(sight.revealed).not.toContainEqual({ x: 999, y: 999 });
  });

  test("no alliance: no union, and the alliance cache is never touched", async () => {
    const p = user(1);

    await getPlayerSight(p);

    expect(findCalls.some(({ entity }) => entity === User)).toBe(false);
  });
});

describe("the Redis cache", () => {
  test("a second call within the TTL reuses the cached own sight without asking Postgres again", async () => {
    const p = user(1, {
      outposts: [[200, 200, "out-a"]],
    });
    tables.set(Save, [{ baseid: "out-a", flinger: 2 }]);

    await getPlayerSight(p);
    const queriesAfterFirst = findCalls.length;

    await getPlayerSight(p);

    expect(findCalls.length).toBe(queriesAfterFirst);
  });

  test("caches the player's own sight and the alliance's separately", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [
      { userid: 1, alliance_id: 9 },
      { userid: 2, alliance_id: 9 },
    ]);
    tables.set(Save, [mainSaveRow(2)]);

    await getPlayerSight(p);

    expect(await redis.get(playerSightKey(1))).not.toBeNull();
    expect(await redis.get(allianceSightKey(9))).not.toBeNull();
  });

  test("the cache lives for the normal TTL with no Declare War running", async () => {
    const p = user(1);

    await getPlayerSight(p);

    expect(await redis.ttl(playerSightKey(1))).toBe(SIGHT_CACHE_TTL_SECONDS);
  });

  test("a running Declare War caps the TTL at however long is left of it", async () => {
    const p = user(1, { alliance_id: 9 });
    runningPowerups = [{ id: AlliancePowerupType.DECLARE_WAR, endtime: Math.floor(Date.now() / 1000) + 10 }];

    await getPlayerSight(p);

    const ttl = await redis.ttl(playerSightKey(1));
    expect(ttl).toBeLessThanOrEqual(10);
    expect(ttl).toBeGreaterThan(0);
  });

  test("invalidatePlayerSight drops only the player's own cache", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [{ userid: 1, alliance_id: 9 }]);
    tables.set(Save, []);

    await getPlayerSight(p);
    await invalidatePlayerSight(1);

    expect(await redis.get(playerSightKey(1))).toBeNull();
    expect(await redis.get(allianceSightKey(9))).not.toBeNull();
  });

  test("invalidateAllianceSight drops only the alliance's cache", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [{ userid: 1, alliance_id: 9 }]);
    tables.set(Save, []);

    await getPlayerSight(p);
    await invalidateAllianceSight(9);

    expect(await redis.get(allianceSightKey(9))).toBeNull();
    expect(await redis.get(playerSightKey(1))).not.toBeNull();
  });

  test("a dropped cache is rebuilt from Postgres on the next call", async () => {
    const p = user(1, {
      outposts: [[200, 200, "out-a"]],
    });
    tables.set(Save, [{ baseid: "out-a", flinger: 2 }]);

    const first = await getPlayerSight(p);
    await invalidatePlayerSight(1);

    // Change the underlying data: the next call must see it, not a stale cache.
    tables.set(Save, [{ baseid: "out-a", flinger: 4 }]);

    const second = await getPlayerSight(p);

    expect(second.sources).not.toEqual(first.sources);
    expect(second.sources).toContainEqual({ x: 200, y: 200, reach: 4, kind: "own" });
  });
});

describe("invalidateSight", () => {
  test("given an already-loaded user, drops their own cache and their alliance's, without a Postgres lookup", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [{ userid: 1, alliance_id: 9 }]);
    tables.set(Save, []);

    await getPlayerSight(p);
    findCalls.length = 0;

    await invalidateSight(p);

    expect(await redis.get(playerSightKey(1))).toBeNull();
    expect(await redis.get(allianceSightKey(9))).toBeNull();
    expect(findCalls).toEqual([]);
  });

  test("given an already-loaded user with no alliance, drops only their own cache", async () => {
    const p = user(1);
    tables.set(Save, []);

    await getPlayerSight(p);
    await invalidateSight(p);

    expect(await redis.get(playerSightKey(1))).toBeNull();
  });

  test("given a bare userid, reads their alliance off Postgres and drops both caches", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [{ userid: 1, alliance_id: 9 }]);
    tables.set(Save, []);

    await getPlayerSight(p);
    await invalidateSight(1);

    expect(await redis.get(playerSightKey(1))).toBeNull();
    expect(await redis.get(allianceSightKey(9))).toBeNull();
  });

  test("given a bare userid with no User row (already gone), still drops their own cache", async () => {
    const p = user(1);
    tables.set(Save, []);

    await getPlayerSight(p);
    await invalidateSight(1);

    expect(await redis.get(playerSightKey(1))).toBeNull();
  });
});

describe("invalidateSightIfFlingerChanged", () => {
  test("a no-op when the flinger level did not move", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [{ userid: 1, alliance_id: 9 }]);
    tables.set(Save, []);

    await getPlayerSight(p);
    await invalidateSightIfFlingerChanged(p, 3, 3);

    expect(await redis.get(playerSightKey(1))).not.toBeNull();
    expect(await redis.get(allianceSightKey(9))).not.toBeNull();
  });

  test("a no-op when both are undefined (an outpost whose level was never read)", async () => {
    const p = user(1);
    tables.set(Save, []);

    await getPlayerSight(p);
    await invalidateSightIfFlingerChanged(p, undefined, undefined);

    expect(await redis.get(playerSightKey(1))).not.toBeNull();
  });

  test("invalidates the player's own cache and their alliance's when the level moved", async () => {
    const p = user(1, { alliance_id: 9 });
    tables.set(User, [{ userid: 1, alliance_id: 9 }]);
    tables.set(Save, []);

    await getPlayerSight(p);
    await invalidateSightIfFlingerChanged(p, 3, 4);

    expect(await redis.get(playerSightKey(1))).toBeNull();
    expect(await redis.get(allianceSightKey(9))).toBeNull();
  });
});
