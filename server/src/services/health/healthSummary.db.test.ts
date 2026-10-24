import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { ALERTS_OPEN_KEY, redisAlertStore } from "../alerts/alerts.js";
import { ALERT_LOCK_KEY } from "../alerts/alertSweep.js";
import { healthSummary } from "./healthSummary.js";

/**
 * The health summary and the alert store against a real Postgres and Redis:
 * the database size query, Redis's INFO and PING as Bun's client returns them,
 * and the open-problem hash and the check lock.
 *
 * Opt-in: runs only when HEALTH_TEST_DB names a throwaway database (never the
 * shared `bym`) and HEALTH_TEST_REDIS a Redis URL with a database number other
 * than 0 (e.g. redis://localhost:6379/13). It writes only `alerts:*` keys there.
 */
const dbName = process.env.HEALTH_TEST_DB;
const redisUrl = process.env.HEALTH_TEST_REDIS;

describe.skipIf(!dbName || !redisUrl)("health on a real database and Redis", () => {
  let orm: MikroORM;
  let redis: RedisClient;

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("HEALTH_TEST_DB must be a throwaway database, not bym");
    if (!/\/([1-9]|1[0-5])$/.test(redisUrl ?? "")) throw new Error("HEALTH_TEST_REDIS must name a Redis database other than 0");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
    redis = new RedisClient(redisUrl);
    await redis.connect();
    await redis.del(ALERTS_OPEN_KEY, ALERT_LOCK_KEY);
  });

  afterAll(async () => {
    if (redis) {
      await redis.del(ALERTS_OPEN_KEY, ALERT_LOCK_KEY);
      redis.close();
    }
    await orm?.close();
  });

  test("the summary reads the database's size and Redis's memory", async () => {
    const health = await healthSummary({
      sql: (query) => orm.em.fork().execute(query),
      redisSend: (command, args) => redis.send(command, args),
      readHostStatus: async () => null,
    });
    expect(health.database.ok).toBe(true);
    expect(health.database.sizeBytes).toBeGreaterThan(1_000_000);
    expect(health.redis.ok).toBe(true);
    expect(health.redis.usedMemoryBytes).toBeGreaterThan(0);
    expect(health.redis.maxMemoryBytes).not.toBeNull();
  });

  test("the open problems hash and the check lock", async () => {
    const store = redisAlertStore(redis);
    expect((await store.all()).size).toBe(0);
    await store.put("disk", { title: "t", section: "health", since: 1, lastSentAt: 2 });
    expect((await store.all()).get("disk")).toEqual({ title: "t", section: "health", since: 1, lastSentAt: 2 });
    await store.remove("disk");
    expect((await store.all()).size).toBe(0);

    expect(await redis.send("SET", [ALERT_LOCK_KEY, "1", "NX", "PX", "5000"])).toBe("OK");
    expect(await redis.send("SET", [ALERT_LOCK_KEY, "2", "NX", "PX", "5000"])).toBeNull();
  });
});
