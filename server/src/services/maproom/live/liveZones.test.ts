import { describe, expect, test } from "bun:test";

import {
  channelPrefix,
  coveringZones,
  LIVE_OWN_CHANNEL,
  LIVE_PRESENT_KEY,
  LIVE_SIGHT_CHANNEL,
  LIVE_ZONES_CHANNEL,
  LiveZoneWriter,
  MAX_PUSH_CELLS,
  type LiveCellBuilder,
  readZoneVersions,
  zoneId,
  zoneVersionsKey,
  type CellRow,
} from "./liveZones.js";

/** A Redis with hashes and a publish log, enough for the writer. */
const fakeRedis = () => {
  const hashes = new Map<string, Map<string, number>>();
  const published: { channel: string; message: unknown }[] = [];
  const log: { id: string; fields: string[] }[] = [];
  const zsets = new Map<string, Map<string, number>>();
  /** Every command, in order, to check what happened before what. */
  const calls: string[] = [];
  return {
    hashes,
    published,
    log,
    zsets,
    calls,
    send: async (command: string, args: string[]) => {
      calls.push(command);
      const [key = "", ...rest] = args;
      if (command === "XADD") {
        const id = `${1000 + log.length}-0`;
        log.push({ id, fields: rest.slice(rest.indexOf("*") + 1) });
        return id;
      }
      if (command === "ZMSCORE") return rest.map((member) => zsets.get(key)?.get(member) ?? null);
      const hash = hashes.get(key) ?? new Map<string, number>();
      hashes.set(key, hash);
      if (command === "HINCRBY") {
        const next = (hash.get(rest[0]!) ?? 0) + Number(rest[1]);
        hash.set(rest[0]!, next);
        return next;
      }
      if (command === "HMGET") return rest.map((field) => (hash.has(field) ? String(hash.get(field)) : null));
      if (command === "HGET") return hash.has(rest[0]!) ? String(hash.get(rest[0]!)) : null;
      throw new Error(`unexpected ${command}`);
    },
    publish: async (channel: string, message: string) => {
      calls.push(`PUBLISH ${channel}`);
      published.push({ channel, message: JSON.parse(message) });
      return 1;
    },
  };
};

const writerWith = (rows: (sql: string, params: unknown[]) => CellRow[] = () => []) => {
  const redis = fakeRedis();
  const queries: { sql: string; params: unknown[] }[] = [];
  const warnings: string[] = [];
  const writer = new LiveZoneWriter({
    redis,
    query: async (sql, params) => {
      queries.push({ sql, params });
      return rows(sql, params);
    },
    warn: (message) => warnings.push(message),
  });
  return { writer, redis, queries, warnings };
};

describe("zones (live map, beta 9)", () => {
  test("a zone id is the client's zoneX * 10000 + zoneY", () => {
    expect(zoneId(120, 340)).toBe(120034);
  });

  test("a cell inside a zone is in one answer; on a multiple of ten it is in the zone before's too", () => {
    expect(coveringZones(123, 345)).toEqual([zoneId(120, 340)]);
    expect(coveringZones(120, 345).sort()).toEqual([zoneId(110, 340), zoneId(120, 340)].sort());
    expect(coveringZones(120, 340)).toHaveLength(4);
    expect(coveringZones(0, 0)).toEqual([zoneId(0, 0)]);
    expect(coveringZones(-1, 5)).toEqual([]);
    expect(coveringZones(800, 5)).toEqual([]);
  });
});

describe("LiveZoneWriter", () => {
  test("cell marks raise each covering zone once per bundle and publish one message per world", async () => {
    const { writer, redis } = writerWith();
    writer.cells("w1", [[123, 345], [124, 346]]);
    writer.cells("w1", [[123, 345]]);
    writer.cells("w2", [[5, 5]]);
    await writer.flush();
    expect(redis.hashes.get(zoneVersionsKey("w1"))?.get(String(zoneId(120, 340)))).toBe(1);
    // Each push also has its place in the replay log (`id`), not checked here.
    const messages = redis.published
      .filter((entry) => entry.channel === LIVE_ZONES_CHANNEL)
      .map((entry) => ({ ...(entry.message as Record<string, unknown>), id: undefined }) as Record<string, unknown>);
    expect(messages).toContainEqual({ w: "w1", z: { [zoneId(120, 340)]: 1 }, id: undefined });
    expect(messages).toContainEqual({ w: "w2", z: { [zoneId(0, 0)]: 1 }, id: undefined });

    writer.cells("w1", [[123, 345]]);
    await writer.flush();
    expect(redis.published.at(-1)?.message).toMatchObject({ w: "w1", z: { [zoneId(120, 340)]: 2 } });
  });

  test("an empty bundle publishes nothing and asks nothing", async () => {
    const { writer, redis, queries } = writerWith();
    await writer.flush();
    expect(redis.published).toEqual([]);
    expect(queries).toEqual([]);
  });

  test("yards, players and alliances are looked up in one query each, with their neighbours' zones", async () => {
    const { writer, redis, queries } = writerWith((sql) =>
      sql.includes("s.basesaveid IN") && sql.includes("c.baseid = s.baseid")
        ? [{ world_id: "w1", x: 51, y: 55 }]
        : sql.includes("alliance_id IN")
          ? [{ world_id: "w1", x: 300, y: 300 }]
          : [{ world_id: "w1", x: 15, y: 15 }],
    );
    writer.saves([11, 12]);
    writer.users([7, 7, 8]);
    writer.alliances([3]);
    await writer.flush();
    expect(queries).toHaveLength(3);
    expect(queries[0]!.params).toEqual([11, 12]);
    expect(queries[1]!.params).toEqual([7, 8]);
    const z = (redis.published[0]!.message as { z: Record<string, number> }).z;
    // The yard (55,55) alone; the player's (15,15) and the alliance's (300,300) cells with their neighbours.
    expect(Object.keys(z).map(Number).sort()).toEqual(
      [zoneId(50, 50), zoneId(10, 10), zoneId(300, 300), zoneId(290, 290), zoneId(290, 300), zoneId(300, 290)].sort(),
    );
    writer.saves([13]);
    await writer.flush();
    expect(Object.keys((redis.published.at(-1)!.message as { z: object }).z)).toEqual([String(zoneId(50, 50))]);
  });

  test("sight nudges go on their own channel", async () => {
    const { writer, redis } = writerWith();
    writer.sightUsers([4]);
    writer.sightAlliances([9]);
    await writer.flush();
    expect(redis.published).toEqual([{ channel: LIVE_SIGHT_CHANNEL, message: { u: [4], a: [9] } }]);
  });

  test("a failing lookup is logged, never thrown, and the next bundle starts clean", async () => {
    let fail = true;
    const redis = fakeRedis();
    const warnings: string[] = [];
    const writer = new LiveZoneWriter({
      redis,
      query: async () => {
        if (fail) throw new Error("db down");
        return [];
      },
      warn: (message) => warnings.push(message),
    });
    writer.saves([1]);
    await writer.flush();
    expect(warnings).toHaveLength(1);
    fail = false;
    writer.cells("w", [[1, 1]]);
    await writer.flush();
    expect(redis.published).toHaveLength(1);
  });

  test("readZoneVersions answers 0 for a zone that never changed", async () => {
    const redis = fakeRedis();
    await redis.send("HINCRBY", [zoneVersionsKey("w"), "5", "1"]);
    expect(await readZoneVersions(redis, "w", [5, 6])).toEqual([1, 0]);
  });
});

describe("LiveZoneWriter homes", () => {
  test("an online flag marks the main yard alone, no neighbours", async () => {
    const { writer, redis, queries } = writerWith(() => [{ world_id: "w1", x: 51, y: 55 }]);
    writer.homes([4]);
    await writer.flush();
    expect(queries[0]!.sql).toContain("base_type = 2");
    expect(Object.keys((redis.published[0]!.message as { z: object }).z)).toEqual([String(zoneId(50, 50))]);
  });
});

/** Stage 2: pushes carry their cells. */
describe("LiveZoneWriter cells (stage 2)", () => {
  const NOW = 2_000_000_000_000;
  const player = (uid: number, extra: Record<string, unknown> = {}) => ({ uid, b: 2, n: `p${uid}`, l: 30, p: 0, ...extra });

  const withCells = (builder: Partial<LiveCellBuilder> = {}) => {
    const redis = fakeRedis();
    const warnings: string[] = [];
    const built: string[] = [];
    const writer = new LiveZoneWriter({
      redis,
      query: async () => [],
      warn: (message) => warnings.push(message),
      now: () => NOW,
      cells: {
        publicCells: async (_world, coords) => {
          built.push(`public:${redis.calls.filter((call) => call === "HINCRBY").length}`);
          return {
            cells: coords.map(([x, y]) => [x, y, player(x === 15 ? 7 : 8, { atk: 99 })]),
            alliances: [{ alliance_id: 3, name: "A", image: 1, relationships: {} }],
            owners: [...new Set(coords.map(([x]) => (x === 15 ? 7 : 8)))],
          };
        },
        ownerCells: async (uid, _world, coords) =>
          coords.filter(([x]) => (x === 15 ? 7 : 8) === uid).map(([x, y]) => [x, y, player(uid, { mine: 1, r: { r1: 5 }, m: { C1: 2 } })]),
        defendersOf: async () => [],
        ...builder,
      },
    });
    return { writer, redis, warnings, built };
  };

  const pushes = (redis: ReturnType<typeof fakeRedis>) =>
    redis.published.filter((entry) => entry.channel === LIVE_ZONES_CHANNEL).map((entry) => entry.message as Record<string, unknown>);

  test("versions are raised before the cells are read, and the push carries the cells, crests and log id", async () => {
    const { writer, redis, built } = withCells();
    writer.cells("w1", [[15, 15]]);
    await writer.flush();
    // The zone was raised (1 HINCRBY) before the cells were built.
    expect(built).toEqual(["public:1"]);
    const [push] = pushes(redis);
    expect(push).toEqual({
      w: "w1",
      z: { [zoneId(10, 10)]: 1 },
      c: [[15, 15, player(7, { atk: 99 })]],
      ad: [{ alliance_id: 3, name: "A", image: 1, relationships: {} }],
      id: "1000-0",
    });
    // The log holds the same push (without its id), kept for the replay window.
    expect(JSON.parse(redis.log[0]!.fields[1]!)).toEqual({ ...push, id: undefined });
    expect(redis.calls.indexOf("XADD")).toBeLessThan(redis.calls.indexOf(`PUBLISH ${LIVE_ZONES_CHANNEL}`));
  });

  test("an owner with a map open gets their own cells in full on their own channel, first; the public push names them", async () => {
    const { writer, redis } = withCells();
    redis.zsets.set(LIVE_PRESENT_KEY, new Map([["7", NOW - 1000], ["8", NOW - 10 * 60_000]]));
    writer.cells("w1", [[15, 15], [16, 15]]);
    await writer.flush();
    const own = redis.published.filter((entry) => entry.channel === LIVE_OWN_CHANNEL);
    // Player 7 is here; player 8 left ten minutes ago: nothing built for them.
    expect(own).toEqual([{ channel: LIVE_OWN_CHANNEL, message: { u: 7, w: "w1", c: [[15, 15, player(7, { mine: 1, r: { r1: 5 }, m: { C1: 2 } })]] } }]);
    const [push] = pushes(redis);
    expect(push!.ow).toEqual([7]);
    expect(redis.calls.indexOf(`PUBLISH ${LIVE_OWN_CHANNEL}`)).toBeLessThan(redis.calls.indexOf(`PUBLISH ${LIVE_ZONES_CHANNEL}`));
  });

  test("the public push never carries owner fields", async () => {
    const { writer, redis } = withCells();
    redis.zsets.set(LIVE_PRESENT_KEY, new Map([["7", NOW]]));
    writer.cells("w1", [[15, 15]]);
    await writer.flush();
    const text = JSON.stringify(pushes(redis));
    for (const field of ['"mine"', '"r"', '"m"']) expect(text).not.toContain(field);
  });

  test("a bundle too big for one push goes out as versions only, marked to ask again", async () => {
    const { writer, redis, built } = withCells();
    writer.cells(
      "w1",
      Array.from({ length: MAX_PUSH_CELLS + 1 }, (_, i) => [i % 800, Math.floor(i / 800)] as [number, number]),
    );
    await writer.flush();
    expect(built).toEqual([]);
    const [push] = pushes(redis);
    expect(push!.x).toBe(1);
    expect(push!.c).toBeUndefined();
  });

  test("cells that cannot be built still move the versions: the push says to ask again", async () => {
    const { writer, redis, warnings } = withCells({
      publicCells: async () => {
        throw new Error("db down");
      },
    });
    writer.cells("w1", [[15, 15]]);
    await writer.flush();
    expect(pushes(redis)[0]).toMatchObject({ x: 1, z: { [zoneId(10, 10)]: 1 } });
    expect(warnings[0]).toContain("db down");
  });

  test("a relation change tells only the two players (with a map open) who the other is; nothing public moves", async () => {
    const { writer, redis } = withCells();
    redis.zsets.set(LIVE_PRESENT_KEY, new Map([["7", NOW]]));
    writer.relations([[7, 8]]);
    await writer.flush();
    // Player 8 has no map open: only 7 hears.
    expect(redis.published).toEqual([{ channel: LIVE_OWN_CHANNEL, message: { u: 7, ro: [8] } }]);
    expect(pushes(redis)).toEqual([]);
  });

  test("an attacker's cells moving nudges the sight of the players they attacked who have a map open", async () => {
    const asked: number[][] = [];
    const { writer, redis } = withCells({
      defendersOf: async (ids) => {
        asked.push([...ids]);
        return [21, 22];
      },
    });
    redis.zsets.set(LIVE_PRESENT_KEY, new Map([["21", NOW]]));
    writer.revealsOf([7]);
    await writer.flush();
    expect(asked).toEqual([[7]]);
    expect(redis.published).toEqual([{ channel: LIVE_SIGHT_CHANNEL, message: { u: [21], a: [] } }]);
  });
});

describe("the live map's channel prefix", () => {
  test("one per Redis database, none on database 0 (the live game), or as set", () => {
    expect(channelPrefix({ REDIS_URL: "redis://localhost:6379" })).toBe("");
    expect(channelPrefix({ REDIS_URL: "redis://localhost:6379/0" })).toBe("");
    expect(channelPrefix({ REDIS_URL: "redis://localhost:6379/12" })).toBe("db12:");
    expect(channelPrefix({ REDIS_URL: "redis://user:pw@host:6379/3" })).toBe("db3:");
    expect(channelPrefix({ REDIS_URL: "redis://localhost:6379/12", LIVE_MAP_CHANNEL_PREFIX: "lm2:" })).toBe("lm2:");
    expect(channelPrefix({ REDIS_URL: "redis://localhost:6379/12", LIVE_MAP_CHANNEL_PREFIX: "" })).toBe("");
  });
});
