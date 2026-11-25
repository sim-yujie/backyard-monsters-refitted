import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { memoryRedis } from "../../../testing/memoryRedis.js";
import { setLiveMarkSink } from "./liveMarks.js";
import { checkOnline, LIVE_ONLINE_KEY, LIVE_SEEN_KEY, noteLiveSeen } from "./liveOnline.js";

/** The live map's online flag: who came online or went offline since the last check is marked. */
const marked: number[] = [];
beforeEach(() => {
  marked.length = 0;
  setLiveMarkSink({
    saves: () => {},
    saveOwners: () => {},
    homes: (ids) => marked.push(...ids),
    cells: () => {},
    users: () => {},
    alliances: () => {},
    sightUsers: () => {},
    sightAlliances: () => {},
  });
});
afterEach(() => setLiveMarkSink(null));

/** memoryRedis plus the lock's `SET NX PX`. */
const redisWithLock = () => {
  const base = memoryRedis();
  let held = false;
  return {
    ...base,
    release: () => {
      held = false;
    },
    send: async (command: string, args: string[]) => {
      if (command === "SET" && args.includes("NX")) {
        if (held) return null;
        held = true;
        return "OK";
      }
      return base.send(command, args);
    },
  };
};

describe("checkOnline", () => {
  test("marks players who came online, then those who went offline, and nobody twice", async () => {
    const redis = redisWithLock();
    let online = new Set([1, 2]);
    const deps = { redis, online: async () => online, now: () => 0, warn: () => {} };
    noteLiveSeen(redis, 1);
    noteLiveSeen(redis, 2);
    noteLiveSeen(redis, 3);
    await Bun.sleep(1);

    expect((await checkOnline(deps)).sort()).toEqual([1, 2]);
    expect(marked.sort()).toEqual([1, 2]);
    expect((await redis.smembers(LIVE_SEEN_KEY)).sort()).toEqual(["1", "2"]);

    redis.release();
    marked.length = 0;
    expect(await checkOnline(deps)).toEqual([]);

    redis.release();
    online = new Set([2]);
    expect(await checkOnline(deps)).toEqual([1]);
    expect(await redis.smembers(LIVE_ONLINE_KEY)).toEqual(["2"]);
  });

  test("only one server runs a check at a time", async () => {
    const redis = redisWithLock();
    noteLiveSeen(redis, 1);
    await Bun.sleep(1);
    const deps = { redis, online: async () => new Set([1]), now: () => 0, warn: () => {} };
    expect(await checkOnline(deps)).toEqual([1]);
    expect(await checkOnline(deps)).toEqual([]);
  });

  test("a Redis without sets never breaks the presence mark", () => {
    expect(() => noteLiveSeen({} as never, 1)).not.toThrow();
    expect(() => noteLiveSeen(undefined, 1)).not.toThrow();
  });
});
