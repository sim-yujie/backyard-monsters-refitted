import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * The open wild monster raid in Redis (#226 WP2, `docs/design/wild-raids.md`
 * §7.1 and §8.2): its lives by phase, one open raid at a time, the finish's
 * checks with `GETDEL` taking it exactly once, and the cancel rules.
 *
 * Keys age off `Date.now()`, moved by hand.
 */

const strings = new Map<string, string>();
const redis = memoryRedis(strings);

mock.module("../../server.js", () => ({
  postgres: { em: {} },
  redis,
}));

const {
  FIGHT_GRACE_SECONDS,
  WARNING_GRACE_SECONDS,
  WARNING_SECONDS,
  cancelOpenRaid,
  cancelRaidOnYardLoad,
  earliestFinish,
  newRaidId,
  openRaid,
  openRaidTtl,
  parseRaidScreen,
  presenceLapsed,
  raidKey,
  readOpenRaid,
  readRaidScreen,
  recordRaidScreen,
  checkRaidForFinish,
  dropOpenRaid,
  openFightingRaid,
  updateOpenRaid,
} = await import("./raidStore.js");
type OpenRaid = NonNullable<Awaited<ReturnType<typeof readOpenRaid>>>;

const USER = 2505;
const T0 = 1_900_000_000;
const FIGHT = 180;

const at = (seconds: number) => setSystemTime(new Date(seconds * 1000));

const warning = (extra: Partial<OpenRaid> = {}): OpenRaid => ({
  id: "r_one",
  phase: "warning",
  tribe: "Kozu",
  plan: { monsters: { C1: 10 } },
  seed: 12345,
  attackAt: T0 + WARNING_SECONDS,
  warned: 0,
  ...extra,
});

/** The open raid moved into its fight at `startedAt`. */
const fighting = (startedAt: number): OpenRaid =>
  warning({ phase: "fighting", attackAt: startedAt, startedAt, fightSeconds: FIGHT, outcome: { health: 0.95 } });

/** A presence ping at `now`; the clock moves there. */
const ping = (now: number) => {
  at(now);
  return redis.setex(`last-seen:main:${USER}`, 120, String(now));
};

beforeEach(() => {
  redis.clear();
  at(T0);
});

afterEach(() => setSystemTime());

describe("lives", () => {
  test("a warning lives until attackAt plus 15 minutes; a fight its length plus 2 minutes", async () => {
    expect(openRaidTtl(warning(), T0)).toBe(WARNING_SECONDS + WARNING_GRACE_SECONDS);
    expect(openRaidTtl(fighting(T0), T0)).toBe(FIGHT + FIGHT_GRACE_SECONDS);
    // A warning long past its time still gets a moment, never a zero or negative life.
    expect(openRaidTtl(warning({ attackAt: T0 - 10_000 }), T0)).toBe(1);

    expect(await openRaid(USER, warning(), T0)).toBe(true);
    expect(await redis.ttl(raidKey(USER))).toBe(WARNING_SECONDS + WARNING_GRACE_SECONDS);

    at(T0 + WARNING_SECONDS + WARNING_GRACE_SECONDS - 1);
    expect(await readOpenRaid(USER)).not.toBeNull();
    at(T0 + WARNING_SECONDS + WARNING_GRACE_SECONDS);
    expect(await readOpenRaid(USER)).toBeNull();
  });

  test("a fight not finished in its length plus 2 minutes is gone (cancel rule 1)", async () => {
    await openRaid(USER, warning(), T0);
    expect(await updateOpenRaid(USER, fighting(T0 + 10), T0 + 10, "warning")).toBe(true);
    expect(await redis.ttl(raidKey(USER))).toBe(FIGHT + FIGHT_GRACE_SECONDS);

    at(T0 + 10 + FIGHT + FIGHT_GRACE_SECONDS);
    expect(await readOpenRaid(USER)).toBeNull();
  });
});

describe("one open raid", () => {
  test("a second raid cannot open over the first", async () => {
    expect(await openRaid(USER, warning(), T0)).toBe(true);
    expect(await openRaid(USER, warning({ id: "r_two", tribe: "Dreadnaut" }), T0)).toBe(false);
    expect((await readOpenRaid(USER))?.id).toBe("r_one");
  });

  test("opening always starts in the warning phase", async () => {
    await openRaid(USER, fighting(T0), T0);
    expect((await readOpenRaid(USER))?.phase).toBe("warning");
  });

  test("an update never brings back a raid that has gone", async () => {
    expect(await updateOpenRaid(USER, warning({ warned: 1 }), T0, "warning")).toBe(false);
    expect(await readOpenRaid(USER)).toBeNull();
  });

  test("Engage now and Prepare defences rewrite it, its life following attackAt", async () => {
    await openRaid(USER, warning(), T0);
    expect(await updateOpenRaid(USER, warning({ attackAt: T0 + 20 }), T0 + 20, "warning")).toBe(true);
    expect(await redis.ttl(raidKey(USER))).toBe(WARNING_GRACE_SECONDS);
    expect(await updateOpenRaid(USER, warning({ attackAt: T0 + 20, warned: 1 }), T0 + 20, "warning")).toBe(true);
    expect(await readOpenRaid(USER)).toMatchObject({ attackAt: T0 + 20, warned: 1 });
  });

  test("an update writes only over the same raid, still in the phase the caller read (sol's fifth review)", async () => {
    await openRaid(USER, warning(), T0);
    const stored = () => strings.get(raidKey(USER));

    // Another raid's id, or a phase the raid has left, changes nothing.
    expect(await updateOpenRaid(USER, warning({ id: "r_two", warned: 1 }), T0, "warning")).toBe(false);
    expect(await updateOpenRaid(USER, fighting(T0), T0, "fighting")).toBe(false);
    expect(stored()).toBe(JSON.stringify(warning()));

    // The fight started: a late "Prepare defences" or a second start, read from the warning, is refused.
    expect(await updateOpenRaid(USER, fighting(T0 + 10), T0 + 10, "warning")).toBe(true);
    expect(await updateOpenRaid(USER, warning({ warned: 1 }), T0 + 11, "warning")).toBe(false);
    expect(await updateOpenRaid(USER, fighting(T0 + 12), T0 + 12, "warning")).toBe(false);
    expect(await readOpenRaid(USER)).toEqual(fighting(T0 + 10));
    expect(await redis.ttl(raidKey(USER))).toBe(FIGHT + FIGHT_GRACE_SECONDS);
  });

  test("a stale update for raid A never writes over raid B opened since", async () => {
    await openRaid(USER, warning(), T0);
    expect(await dropOpenRaid(USER, "r_one")).toBe(true);
    const b = { ...fighting(T0 + 20), id: "r_two", tribe: "Trojan" };
    expect(await openFightingRaid(USER, b, T0 + 20)).toBe(true);

    expect(await updateOpenRaid(USER, warning({ warned: 1 }), T0 + 21, "warning")).toBe(false);
    expect(await updateOpenRaid(USER, fighting(T0 + 21), T0 + 21, "warning")).toBe(false);
    expect(await updateOpenRaid(USER, fighting(T0 + 21), T0 + 21, "fighting")).toBe(false);
    expect(strings.get(raidKey(USER))).toBe(JSON.stringify(b));
  });

  test("an update over a broken value writes nothing", async () => {
    strings.set(raidKey(USER), "{not json");
    expect(await updateOpenRaid(USER, warning({ warned: 1 }), T0, "warning")).toBe(false);
    expect(strings.get(raidKey(USER))).toBe("{not json");
  });

  test("ids are fresh and say what they are", () => {
    const a = newRaidId();
    expect(a).toMatch(/^r_[0-9a-f-]{36}$/);
    expect(newRaidId()).not.toBe(a);
  });

  test("a broken value reads as no raid", async () => {
    strings.set(raidKey(USER), "{not json");
    expect(await readOpenRaid(USER)).toBeNull();
  });
});

describe("finish", () => {
  const start = T0 + 300;
  const ready = earliestFinish(start, FIGHT);

  beforeEach(async () => {
    await openRaid(USER, warning(), T0);
    at(start);
    await updateOpenRaid(USER, fighting(start), start, "warning");
  });

  test("not sooner than the fight at 2x less 5 seconds; refused finishes leave it open", async () => {
    expect(ready).toBe(start + FIGHT / 2 - 5);
    at(ready - 1);
    await ping(ready - 1);
    expect(await checkRaidForFinish(USER, "r_one", ready - 1)).toEqual({ kind: "tooEarly", readyAt: ready });
    expect(await readOpenRaid(USER)).not.toBeNull();
  });

  test("ready to land, and left open: it is landed and dropped under the yard's lock (raidFlow.ts)", async () => {
    at(ready);
    await ping(ready);
    const [a, b] = await Promise.all([checkRaidForFinish(USER, "r_one", ready), checkRaidForFinish(USER, "r_one", ready)]);
    expect(a).toMatchObject({ kind: "finished", raid: { id: "r_one", outcome: { health: 0.95 } } });
    expect(b.kind).toBe("finished");
    expect(await readOpenRaid(USER)).not.toBeNull();
    expect(await dropOpenRaid(USER, "r_other")).toBe(false);
    expect(await readOpenRaid(USER)).not.toBeNull();
    expect(await dropOpenRaid(USER, "r_one")).toBe(true);
    expect(await checkRaidForFinish(USER, "r_one", ready + 1)).toEqual({ kind: "gone" });
  });

  test("the drop compares and deletes in one step: a raid opened since is never dropped for the old one", async () => {
    // Two settlements both read r_one; one drops it, a Trojan Horse spring opens r_two, the other drops "r_one".
    expect(await dropOpenRaid(USER, "r_one")).toBe(true);
    await openFightingRaid(USER, { ...fighting(start), id: "r_two" }, start);
    expect(await dropOpenRaid(USER, "r_one")).toBe(false);
    expect((await readOpenRaid(USER))?.id).toBe("r_two");
  });

  test("another raid's id finds nothing and leaves it", async () => {
    at(ready);
    expect(await checkRaidForFinish(USER, "r_other", ready)).toEqual({ kind: "gone" });
    expect(await readOpenRaid(USER)).not.toBeNull();
  });

  test("a raid still in its warning cannot be finished", async () => {
    await cancelOpenRaid(USER);
    await openRaid(USER, warning(), T0);
    expect(await checkRaidForFinish(USER, "r_one", T0 + 1000)).toEqual({ kind: "notFighting" });
    expect(await readOpenRaid(USER)).not.toBeNull();
  });

  test("no presence mark in the last 2 minutes: to be cancelled (cancel rule 2)", async () => {
    await ping(start);
    at(start + 200);
    const result = await checkRaidForFinish(USER, "r_one", start + 200);
    expect(result.kind).toBe("cancelled");
  });

  test("a mark just inside the 2 minutes still finishes", async () => {
    await ping(ready - 100);
    at(ready);
    expect((await checkRaidForFinish(USER, "r_one", ready)).kind).toBe("finished");
  });
});

describe("a yard load (cancel rule 3)", () => {
  test("cancels a fight", async () => {
    await openRaid(USER, warning(), T0);
    await updateOpenRaid(USER, fighting(T0 + 300), T0 + 300, "warning");
    expect(await cancelRaidOnYardLoad(USER, false)).toBe(true);
    expect(await readOpenRaid(USER)).toBeNull();
  });

  test("drops only the raid it read: a newer raid B opened meanwhile stays (sol's fourth review)", async () => {
    // The load reads fight A; meanwhile a finish settles and drops A and a Trojan Horse spring opens B.
    await openFightingRaid(USER, { ...fighting(T0 + 300), id: "r_b" }, T0 + 300);
    const staleA = JSON.stringify(fighting(T0 + 300));
    const get = redis.get;
    redis.get = (async (key: string) => (key === raidKey(USER) ? staleA : get(key))) as typeof redis.get;
    try {
      expect(await cancelRaidOnYardLoad(USER, false)).toBe(false);
    } finally {
      redis.get = get;
    }
    expect((await readOpenRaid(USER))?.id).toBe("r_b");
  });

  test("keeps a warning while the game stayed open (back from the map)", async () => {
    await openRaid(USER, warning({ warned: 1 }), T0);
    expect(await cancelRaidOnYardLoad(USER, false)).toBe(false);
    expect(await readOpenRaid(USER)).not.toBeNull();
  });

  test("cancels a warning when the game had been closed (owner, Q2)", async () => {
    await openRaid(USER, warning(), T0);
    expect(await cancelRaidOnYardLoad(USER, true)).toBe(true);
    expect(await readOpenRaid(USER)).toBeNull();
  });

  test("nothing open, nothing done", async () => {
    expect(await cancelRaidOnYardLoad(USER, true)).toBe(false);
  });

  test("the game counts as closed once the presence mark has lapsed", async () => {
    expect(await presenceLapsed(USER)).toBe(true);
    await ping(T0);
    expect(await presenceLapsed(USER)).toBe(false);
    at(T0 + 120);
    expect(await presenceLapsed(USER)).toBe(true);
  });
});

describe("the screen", () => {
  test("a ping's body says where the player is; anything else is nothing", () => {
    expect(parseRaidScreen({ where: "yard", planner: false })).toEqual({ where: "yard", planner: false });
    expect(parseRaidScreen({ where: "other", planner: true, extra: 1 })).toEqual({ where: "other", planner: true });
    for (const body of [undefined, null, {}, { where: "yard" }, { where: "map", planner: false }, { where: "yard", planner: "false" }]) {
      expect(parseRaidScreen(body)).toBeNull();
    }
  });

  test("kept for as long as a ping counts", async () => {
    await recordRaidScreen(USER, { where: "yard", planner: false });
    expect(await readRaidScreen(USER)).toEqual({ where: "yard", planner: false });
    at(T0 + 120);
    expect(await readRaidScreen(USER)).toBeNull();
  });
});
