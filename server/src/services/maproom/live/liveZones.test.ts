import { describe, expect, test } from "bun:test";

import {
  coveringZones,
  LIVE_SIGHT_CHANNEL,
  LIVE_ZONES_CHANNEL,
  LiveZoneWriter,
  readZoneVersions,
  zoneId,
  zoneVersionsKey,
  type CellRow,
} from "./liveZones.js";

/** A Redis with hashes and a publish log, enough for the writer. */
const fakeRedis = () => {
  const hashes = new Map<string, Map<string, number>>();
  const published: { channel: string; message: unknown }[] = [];
  return {
    hashes,
    published,
    send: async (command: string, args: string[]) => {
      const [key = "", ...rest] = args;
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
    const messages = redis.published.filter((entry) => entry.channel === LIVE_ZONES_CHANNEL).map((entry) => entry.message);
    expect(messages).toContainEqual({ w: "w1", z: { [zoneId(120, 340)]: 1 } });
    expect(messages).toContainEqual({ w: "w2", z: { [zoneId(0, 0)]: 1 } });

    writer.cells("w1", [[123, 345]]);
    await writer.flush();
    expect(redis.published.at(-1)?.message).toEqual({ w: "w1", z: { [zoneId(120, 340)]: 2 } });
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
