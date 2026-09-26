import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { bucketCost, dropRadius, flingerPayload } from "@/game/combat/rules";
import { AttackSession } from "./AttackSession";
import type { AttackRoster, AttackTarget } from "./attackTarget";
import { Bucket, bucketFor, LAST_ARMY_KEY_PREFIX } from "./bucket";

/**
 * The bucket (`docs/design/attack-flow.md` §F2, §6 WP3): a row never exceeds
 * what is housed or what the payload has room for, Fill walks roster order,
 * a drop leaves the numbers but re-clamps them, and the last army survives a
 * round trip through a store that may be missing or blocked.
 */

/** A real own-yard load of the sandbox account, for its housed roster. */
const sandbox = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url)),
    "utf8",
  ),
) as BaseLoadResponse;

/**
 * A roster from its parts. Asserted rather than typed so the fixture survives
 * the roster gaining fields the bucket does not read (sources, siege).
 */
const rosterOf = (over: Partial<AttackRoster>): AttackRoster =>
  ({
    monsters: { C1: 30 },
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 0,
    sources: [],
    siege: null,
    ...over,
  }) as AttackRoster;

/** The sandbox yard's roster as the map would gather it: 25 Teratorn, 2 Zafreeti, two champions. */
const sandboxRoster = (): AttackRoster => {
  const housed = (sandbox.monsters?.housed ?? {}) as Record<string, number>;
  const levels: Record<string, number> = {};
  for (const [id, entry] of Object.entries(sandbox.academy ?? {})) {
    if (typeof entry?.level === "number") levels[id] = entry.level;
  }
  return rosterOf({
    monsters: housed,
    levels,
    champions: sandbox.champion ?? [],
    flingerLevel: 4,
    catapultLevel: 1,
  });
};

/** A lone level 1 Cannon Tower at the origin, enough of a yard to load. */
const towerYard = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const champion = (t: number, l: number, hp = 1000, status = 0) => ({
  t,
  l,
  hp,
  ft: 0,
  fd: 0,
  fb: 0,
  pl: 0,
  status,
});

const sessionWith = (roster: Partial<AttackRoster>): AttackSession => {
  const target: AttackTarget = {
    baseid: "3502",
    kind: "wild",
    cell: { col: 241, row: 208 },
    name: "Kozu",
    roster: rosterOf(roster),
  };
  const session = new AttackSession({ target, seed: 1 });
  session.load(towerYard());
  session.start();
  return session;
};

/** A `Storage` over a Map, enough for get/set/remove. */
const fakeStorage = (): Storage & { readonly map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
};

/** A store that throws on every touch, as a blocked private window does. */
const blockedStorage = (): Storage =>
  ({
    length: 0,
    clear: () => {
      throw new Error("blocked");
    },
    getItem: () => {
      throw new Error("blocked");
    },
    key: () => null,
    removeItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  }) as Storage;

const CAPACITY = flingerPayload();

describe("Bucket rows", () => {
  it("starts empty and prices nothing", () => {
    const bucket = new Bucket(sessionWith({}), { storage: null });
    expect(bucket.isEmpty()).toBe(true);
    expect(bucket.cost()).toBe(0);
    expect(bucket.capacity()).toBe(CAPACITY);
    expect(bucket.composition()).toEqual({ monsters: {} });
    expect(bucket.radius()).toBe(dropRadius(0));
  });

  it("lists the roster ids in the order the map gathered them", () => {
    const bucket = new Bucket(sessionWith({ monsters: { C4: 5, C1: 30, C2: 0 } }), {
      storage: null,
    });
    expect(bucket.ids()).toEqual(["C4", "C1"]);
  });

  it("clamps a row to what is housed, floors it at zero, and ignores an unknown id", () => {
    const bucket = new Bucket(sessionWith({ monsters: { C1: 30 } }), { storage: null });
    bucket.setCount("C1", 50);
    expect(bucket.count("C1")).toBe(30);
    bucket.setCount("C1", -4);
    expect(bucket.count("C1")).toBe(0);
    bucket.setCount("C1", 7.9);
    expect(bucket.count("C1")).toBe(7);
    bucket.setCount("XX", 3);
    expect(bucket.composition()).toEqual({ monsters: { C1: 7 } });
  });

  it("clamps a row to what the flinger's payload has room for", () => {
    // A Rezghul costs 250 bucket units; 2,250 carries nine.
    const bucket = new Bucket(sessionWith({ monsters: { C19: 20 } }), { storage: null });
    const unit = bucketCost({ C19: 1 }, {});
    expect(bucket.max("C19")).toBe(Math.floor(CAPACITY / unit));
    bucket.setCount("C19", 20);
    expect(bucket.count("C19")).toBe(Math.floor(CAPACITY / unit));
    expect(bucket.cost()).toBeLessThanOrEqual(CAPACITY);
  });

  it("counts the other rows against a row's ceiling", () => {
    const bucket = new Bucket(sessionWith({ monsters: { C1: 30, C19: 20 } }), { storage: null });
    bucket.setCount("C1", 30);
    const pokeys = bucketCost({ C1: 30 }, {});
    const unit = bucketCost({ C19: 1 }, {});
    expect(bucket.max("C19")).toBe(Math.floor((CAPACITY - pokeys) / unit));
    bucket.setCount("C19", 20);
    expect(bucket.cost()).toBeLessThanOrEqual(CAPACITY);
    // The full row's own ceiling still counts the other one, not itself twice.
    expect(bucket.max("C1")).toBe(30);
  });

  it("prices a row at its academy level", () => {
    const bucket = new Bucket(sessionWith({ monsters: { C14: 25 }, levels: { C14: 6 } }), {
      storage: null,
    });
    expect(bucket.level("C14")).toBe(6);
    expect(bucket.unitCost("C14")).toBe(bucketCost({ C14: 1 }, { C14: 6 }));
    bucket.setCount("C14", 25);
    expect(bucket.cost()).toBe(bucketCost({ C14: 25 }, { C14: 6 }));
    expect(bucket.radius()).toBe(dropRadius(bucket.cost()));
  });

  it("fills a row to its ceiling and clears everything", () => {
    const bucket = new Bucket(sessionWith({ monsters: { C1: 30, C4: 5 }, champions: [champion(3, 2)] }), {
      storage: null,
    });
    bucket.fill("C4");
    expect(bucket.count("C4")).toBe(5);
    bucket.pickChampion(3);
    expect(bucket.isEmpty()).toBe(false);
    bucket.clear();
    expect(bucket.isEmpty()).toBe(true);
    expect(bucket.champion()).toBeNull();
    expect(bucket.count("C4")).toBe(0);
  });
});

describe("Bucket fill order", () => {
  it("walks the rows in roster order until the payload is spent", () => {
    // Rezghul first: nine of them fill the flinger and no Pokey fits after.
    const first = new Bucket(sessionWith({ monsters: { C19: 20, C1: 300 } }), { storage: null });
    first.fillAll();
    const unit = bucketCost({ C19: 1 }, {});
    expect(first.composition().monsters).toEqual({ C19: Math.floor(CAPACITY / unit) });

    // Pokey first: three hundred Pokeys leave no room for a Rezghul.
    const second = new Bucket(sessionWith({ monsters: { C1: 300, C19: 20 } }), { storage: null });
    second.fillAll();
    expect(second.composition().monsters).toEqual({ C1: 300 });
  });

  it("tops up rather than resets, and two presses land on the same numbers", () => {
    const bucket = new Bucket(sessionWith({ monsters: { C1: 30, C19: 20 } }), { storage: null });
    bucket.setCount("C19", 2);
    bucket.fillAll();
    const once = bucket.composition().monsters;
    expect(once["C1"]).toBe(30);
    expect(once["C19"]).toBeGreaterThanOrEqual(2);
    expect(bucket.cost()).toBeLessThanOrEqual(CAPACITY);
    bucket.fillAll();
    expect(bucket.composition().monsters).toEqual(once);
  });

  it("fills the sandbox roster whole, because it fits", () => {
    const roster = sandboxRoster();
    const bucket = new Bucket(sessionWith(roster), { storage: null });
    bucket.fillAll();
    expect(bucket.composition().monsters).toEqual({ C14: 25, C15: 2 });
    expect(bucket.cost()).toBe(bucketCost({ C14: 25, C15: 2 }, roster.levels));
    expect(bucket.cost()).toBeLessThanOrEqual(CAPACITY);
  });
});

describe("Bucket champion", () => {
  it("picks one by type with its level, replaces it, and un-picks with null", () => {
    const bucket = new Bucket(
      sessionWith({ champions: [champion(5, 5), champion(3, 6)] }),
      { storage: null },
    );
    expect(bucket.champions().map((entry) => [entry.t, entry.available])).toEqual([
      [5, true],
      [3, true],
    ]);
    bucket.pickChampion(5);
    expect(bucket.champion()).toEqual({ t: 5, l: 5 });
    bucket.pickChampion(3);
    expect(bucket.champion()).toEqual({ t: 3, l: 6 });
    bucket.setCount("C1", 4);
    expect(bucket.composition()).toEqual({ monsters: { C1: 4 }, champion: { t: 3, l: 6 } });
    bucket.pickChampion(null);
    expect(bucket.champion()).toBeNull();
    expect(bucket.composition()).toEqual({ monsters: { C1: 4 } });
  });

  it("refuses a hurt, frozen or unknown champion", () => {
    const bucket = new Bucket(
      sessionWith({ champions: [champion(1, 1, 0), champion(2, 1, 100, 1)] }),
      { storage: null },
    );
    expect(bucket.champions().map((entry) => entry.available)).toEqual([false, false]);
    bucket.pickChampion(1);
    expect(bucket.champion()).toBeNull();
    bucket.pickChampion(2);
    expect(bucket.champion()).toBeNull();
    bucket.pickChampion(9);
    expect(bucket.champion()).toBeNull();
  });
});

describe("Bucket after a drop", () => {
  it("keeps the numbers, re-clamps each row to what is left, and reports the clamp", () => {
    const session = sessionWith({ monsters: { C1: 10, C4: 5 } });
    const bucket = new Bucket(session, { storage: null });
    bucket.setCount("C1", 6);
    bucket.setCount("C4", 5);

    session.appendFling({ x: 100, y: 100, ...bucket.composition() });
    bucket.afterDrop();

    // The player's figures stay; what they would send is what is left.
    expect(bucket.requestedCount("C1")).toBe(6);
    expect(bucket.count("C1")).toBe(4);
    expect(bucket.requestedCount("C4")).toBe(5);
    expect(bucket.count("C4")).toBe(0);
    expect(bucket.composition()).toEqual({ monsters: { C1: 4 } });
    expect(bucket.clamped()).toEqual({ C1: 4, C4: 0 });
    expect(bucket.max("C4")).toBe(0);
  });

  it("clears the champion, which is on the field now", () => {
    const session = sessionWith({ monsters: { C1: 10 }, champions: [champion(3, 2)] });
    const bucket = new Bucket(session, { storage: null });
    bucket.setCount("C1", 2);
    bucket.pickChampion(3);
    session.appendFling({ x: 100, y: 100, ...bucket.composition() });
    bucket.afterDrop();
    expect(bucket.champion()).toBeNull();
    expect(bucket.champions()[0]?.available).toBe(false);
    bucket.pickChampion(3);
    expect(bucket.champion()).toBeNull();
    expect(bucket.composition()).toEqual({ monsters: { C1: 2 } });
  });

  it("reports nothing clamped while every row is within what is housed", () => {
    const bucket = new Bucket(sessionWith({ monsters: { C1: 10 } }), { storage: null });
    bucket.setCount("C1", 10);
    expect(bucket.clamped()).toEqual({});
  });

  it("stops taking drops once the attack ends", () => {
    const session = sessionWith({});
    const bucket = new Bucket(session, { storage: null });
    const seen: boolean[] = [];
    bucket.subscribe((b) => seen.push(b.live()));
    expect(bucket.live()).toBe(true);
    session.retreat();
    expect(bucket.live()).toBe(false);
    expect(seen).toEqual([false]);
  });
});

describe("Bucket listeners", () => {
  it("hears each change once and not a no-op", () => {
    const bucket = new Bucket(sessionWith({}), { storage: null });
    let calls = 0;
    const stop = bucket.subscribe(() => {
      calls += 1;
    });
    bucket.setCount("C1", 3);
    bucket.setCount("C1", 3);
    bucket.fill("C1");
    bucket.fillAll();
    bucket.clear();
    bucket.clear();
    expect(calls).toBe(3);
    stop();
    bucket.setCount("C1", 1);
    expect(calls).toBe(3);
  });

  it("hands out one bucket per session", () => {
    const session = sessionWith({});
    expect(bucketFor(session)).toBe(bucketFor(session));
    expect(bucketFor(session)).not.toBe(bucketFor(sessionWith({})));
  });
});

describe("Bucket last army", () => {
  it("round-trips the rows and the champion through a per-player store", () => {
    const storage = fakeStorage();
    const first = new Bucket(
      sessionWith({ monsters: { C1: 30, C4: 5 }, champions: [champion(3, 2)] }),
      { storage, playerKey: "2503" },
    );
    first.setCount("C1", 12);
    first.setCount("C4", 2);
    first.pickChampion(3);
    first.saveLast();
    expect(storage.map.has(`${LAST_ARMY_KEY_PREFIX}2503`)).toBe(true);

    const second = new Bucket(
      sessionWith({ monsters: { C1: 30, C4: 5 }, champions: [champion(3, 2)] }),
      { storage, playerKey: "2503" },
    );
    expect(second.loadLast()).toBe(true);
    expect(second.composition()).toEqual({ monsters: { C1: 12, C4: 2 }, champion: { t: 3, l: 2 } });

    // Another player on the same browser starts from nothing.
    const other = new Bucket(sessionWith({ monsters: { C1: 30 } }), { storage, playerKey: "1" });
    expect(other.loadLast()).toBe(false);
    expect(other.isEmpty()).toBe(true);
  });

  it("clamps a recalled army to today's roster and drops a champion it cannot send", () => {
    const storage = fakeStorage();
    storage.setItem(
      `${LAST_ARMY_KEY_PREFIX}2503`,
      JSON.stringify({ v: 1, monsters: { C1: 25, C9: 4 }, champion: 3 }),
    );
    const bucket = new Bucket(sessionWith({ monsters: { C1: 10 }, champions: [champion(5, 1)] }), {
      storage,
      playerKey: "2503",
    });
    expect(bucket.loadLast()).toBe(true);
    expect(bucket.composition()).toEqual({ monsters: { C1: 10 } });
    expect(bucket.champion()).toBeNull();
  });

  it("treats a blocked, missing or malformed store as nothing saved", () => {
    const blocked = new Bucket(sessionWith({}), { storage: blockedStorage(), playerKey: "x" });
    blocked.setCount("C1", 3);
    expect(() => blocked.saveLast()).not.toThrow();
    expect(blocked.loadLast()).toBe(false);

    const none = new Bucket(sessionWith({}), { storage: null, playerKey: "x" });
    expect(none.loadLast()).toBe(false);

    const storage = fakeStorage();
    storage.setItem(`${LAST_ARMY_KEY_PREFIX}x`, "{not json");
    const garbled = new Bucket(sessionWith({}), { storage, playerKey: "x" });
    expect(garbled.loadLast()).toBe(false);
    storage.setItem(`${LAST_ARMY_KEY_PREFIX}x`, JSON.stringify({ v: 2, rows: [] }));
    expect(garbled.loadLast()).toBe(false);
  });

  it("saves what was sent when a drop lands", () => {
    const storage = fakeStorage();
    const session = sessionWith({ monsters: { C1: 10 } });
    const bucket = new Bucket(session, { storage, playerKey: "2503" });
    bucket.setCount("C1", 4);
    session.appendFling({ x: 100, y: 100, ...bucket.composition() });
    bucket.afterDrop();
    expect(JSON.parse(storage.map.get(`${LAST_ARMY_KEY_PREFIX}2503`) ?? "{}")).toEqual({
      v: 1,
      monsters: { C1: 4 },
      champion: null,
    });
  });
});
