import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { TROJAN_HORSE_TYPE } from "../../game-data/buildingFootprints.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { memoryRedis } from "../../testing/memoryRedis.js";
import { catchUpLockedYard } from "../../controllers/yard/yardAction.js";
import type { TrojanHorseSave } from "./trojanHorse.js";

// `trojanHorse.ts` imports `raidSchedule.ts`, which imports `raidStore.ts`,
// which imports `redis` from `../../server.js` — real module load fails
// outside a running server (`SECRET_KEY` unset). Stood in the same way
// `raidSchedule.test.ts` does, so the file under test can load for real.
mock.module("../../server.js", () => ({ postgres: { em: {} }, redis: memoryRedis() }));

const { placeTrojanHorse, protectTrojanHorse, TROJAN_SCORE_THRESHOLD } = await import("./trojanHorse.js");

/**
 * The Trojan Horse's placement gate, its save protection, and the "once per
 * account" guarantee under concurrent loads (`docs/design/trojan-horse.md`
 * §2, §7, §8, issue #324).
 */

const NOW = 1_900_000_000;

/** A qualifying main yard: Map Room 1, well over the score threshold, no flag yet. */
const qualifyingSave = (overrides: Partial<TrojanHorseSave> = {}): TrojanHorseSave => ({
  type: BaseType.MAIN,
  mapversion: MapRoomVersion.V1,
  points: String(TROJAN_SCORE_THRESHOLD + 1),
  basevalue: "0",
  aiattacks: {},
  buildingdata: {},
  buildinghealthdata: {},
  ...overrides,
});

const horsesIn = (buildingdata: BuildingDataMap | null | undefined) =>
  Object.values(buildingdata ?? {}).filter((building) => Number(building?.t) === TROJAN_HORSE_TYPE);

describe("placeTrojanHorse", () => {
  test("not placed at exactly the threshold", () => {
    const save = qualifyingSave({ points: String(TROJAN_SCORE_THRESHOLD), basevalue: "0" });

    expect(placeTrojanHorse(save, NOW)).toBe(false);
    expect(horsesIn(save.buildingdata)).toHaveLength(0);
  });

  test("placed one point over the threshold", () => {
    const save = qualifyingSave({ points: String(TROJAN_SCORE_THRESHOLD + 1), basevalue: "0" });

    expect(placeTrojanHorse(save, NOW)).toBe(true);
    expect(horsesIn(save.buildingdata)).toHaveLength(1);
    expect((save.aiattacks as { trojan?: { placedAt: number } }).trojan).toEqual({ placedAt: NOW });
  });

  test("not on an outpost", () => {
    const save = qualifyingSave({ type: BaseType.OUTPOST });

    expect(placeTrojanHorse(save, NOW)).toBe(false);
    expect(horsesIn(save.buildingdata)).toHaveLength(0);
  });

  test("not on Inferno", () => {
    const save = qualifyingSave({ type: BaseType.INFERNO });

    expect(placeTrojanHorse(save, NOW)).toBe(false);
    expect(horsesIn(save.buildingdata)).toHaveLength(0);
  });

  test("not on Map Room 3, even on a main yard", () => {
    const save = qualifyingSave({ mapversion: MapRoomVersion.V3 });

    expect(placeTrojanHorse(save, NOW)).toBe(false);
    expect(horsesIn(save.buildingdata)).toHaveLength(0);
  });

  test("not placed again once the flag is set", () => {
    const placedOnly = qualifyingSave({ aiattacks: { trojan: { placedAt: NOW - 1000 } } });
    expect(placeTrojanHorse(placedOnly, NOW)).toBe(false);
    expect(horsesIn(placedOnly.buildingdata)).toHaveLength(0);

    const sprungToo = qualifyingSave({ aiattacks: { trojan: { placedAt: NOW - 1000, doneAt: NOW - 500 } } });
    expect(placeTrojanHorse(sprungToo, NOW)).toBe(false);
    expect(horsesIn(sprungToo.buildingdata)).toHaveLength(0);
  });

  test("an old Flash s1 value does not block placement, and is carried through unchanged", () => {
    const save = qualifyingSave({ aiattacks: { s1: 3 } });

    expect(placeTrojanHorse(save, NOW)).toBe(true);
    expect(horsesIn(save.buildingdata)).toHaveLength(1);
    expect((save.aiattacks as { s1?: unknown }).s1).toBe(3);
  });
});

/** A building fixture in the runtime's actual (uppercase) shape, bridged like the rest of the codebase. */
const buildingAt = (t: number, x: number, y: number, id: number): BuildingData =>
  ({ id, t, X: x, Y: y }) as unknown as BuildingData;

describe("protectTrojanHorse", () => {
  test("keeps the stored horse when the submitted save omits it", () => {
    const stored: BuildingDataMap = {
      "1": buildingAt(14, 0, 0, 1),
      "9": buildingAt(TROJAN_HORSE_TYPE, -70, -800, 9),
    };
    const submitted: BuildingDataMap = { "1": buildingAt(14, 0, 0, 1) };

    const result = protectTrojanHorse(stored, submitted);

    expect(result["9"]).toEqual(stored["9"]);
    expect(result["1"]).toEqual(submitted["1"]);
  });

  test("keeps the stored horse's position when the submitted save moves it", () => {
    const stored: BuildingDataMap = { "9": buildingAt(TROJAN_HORSE_TYPE, -70, -800, 9) };
    const submitted: BuildingDataMap = { "9": buildingAt(TROJAN_HORSE_TYPE, 100, 100, 9) };

    const result = protectTrojanHorse(stored, submitted);

    expect(result["9"]).toEqual(stored["9"]);
  });

  test("strips a horse the submitted save adds where none was stored", () => {
    const stored: BuildingDataMap = { "1": buildingAt(14, 0, 0, 1) };
    const submitted: BuildingDataMap = {
      "1": buildingAt(14, 0, 0, 1),
      "9": buildingAt(TROJAN_HORSE_TYPE, 0, 0, 9),
    };

    const result = protectTrojanHorse(stored, submitted);

    expect(result["9"]).toBeUndefined();
    expect(Object.keys(result)).toEqual(["1"]);
  });

  test("returns the submitted save unchanged when no horse is involved on either side", () => {
    const submitted: BuildingDataMap = { "1": buildingAt(14, 0, 0, 1) };

    expect(protectTrojanHorse(undefined, submitted)).toBe(submitted);
    expect(protectTrojanHorse({}, submitted)).toBe(submitted);
  });
});

describe("two concurrent loads place exactly one horse", () => {
  type Row = Record<string, unknown>;

  const db = {
    row: null as Row | null,
    reads: 0,
    afterLockedRead: null as (() => Promise<void>) | null,
    tail: Promise.resolve() as Promise<void>,
  };

  /** Takes the row lock; resolves with its release once every earlier holder let go. */
  const acquire = (): Promise<() => void> => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const previous = db.tail;
    db.tail = previous.then(() => held);
    return previous.then(() => release);
  };

  const em = {
    async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
      let release: (() => void) | undefined;
      let entity: Row | null = null;
      let pending: Row | null = null;

      const fork = {
        async findOne(_entity: unknown, _where: unknown, options?: { lockMode?: LockMode }) {
          if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) release = await acquire();
          db.reads++;
          entity = db.row && structuredClone(db.row);
          if (release && db.afterLockedRead) {
            const hook = db.afterLockedRead;
            db.afterLockedRead = null;
            await hook();
          }
          return entity;
        },
        async flush() {
          if (entity) pending = structuredClone(entity);
        },
      };

      try {
        const result = await cb(fork);
        await fork.flush();
        if (pending) db.row = pending;
        return result;
      } finally {
        release?.();
      }
    },
  };

  const BASESAVEID = 9001;

  /** The same shape `yardAction.test.ts` uses for a catch-up-able main yard, plus the trojan fields. */
  const rowOf = (overrides: Row = {}): Row => ({
    basesaveid: BASESAVEID,
    userid: 2503,
    type: BaseType.MAIN,
    mapversion: MapRoomVersion.V1,
    attackid: 0,
    attacks: [],
    savetime: getCurrentDateTime() - 1000,
    credits: 100,
    points: String(TROJAN_SCORE_THRESHOLD + 1),
    basevalue: "0",
    flinger: 0,
    catapult: 0,
    aiattacks: {},
    resources: { r1: 5000, r2: 5000, r3: 5000, r4: 5000 },
    buildingdata: {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 },
      "1": { id: 1, t: 20, X: 100, Y: 100, l: 1, cU: 100 },
    },
    buildinghealthdata: {},
    storedata: {},
    monsters: {},
    lockerdata: {},
    academy: {},
    champion: [],
    mushrooms: {},
    researchdata: {},
    outposts: [],
    ...overrides,
  });

  beforeEach(() => {
    db.row = rowOf();
    db.reads = 0;
    db.afterLockedRead = null;
    db.tail = Promise.resolve();
  });

  test("the second load finds the flag already set and places none", async () => {
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((resolve) => (releaseFirst = resolve));
    db.afterLockedRead = () => firstHolds;

    const alsoUnderLock = (locked: Save, now: number) => {
      placeTrojanHorse(locked, now);
    };
    const load = () =>
      catchUpLockedYard(em as unknown as EntityManager, { basesaveid: BASESAVEID } as Save, alsoUnderLock);

    const first = load();
    const second = load();

    // The first holds the lock; the second has not been allowed to read yet.
    await Bun.sleep(5);
    expect(db.reads).toBe(1);

    releaseFirst();
    await Promise.all([first, second]);

    expect(horsesIn(db.row!.buildingdata as BuildingDataMap)).toHaveLength(1);
    expect((db.row!.aiattacks as { trojan?: { placedAt: number } }).trojan?.placedAt).toBeGreaterThan(0);
  });
});

describe("bots never get a horse", () => {
  test("the bot catch-up path never reaches placeTrojanHorse or catchUpLockedYard", () => {
    const sources = ["../bots/sweep.ts", "../bots/factory.ts", "../bots/seededPlayers.ts"].map((path) =>
      readFileSync(new URL(path, import.meta.url), "utf8")
    );

    for (const source of sources) {
      expect(source).not.toContain("trojanHorse");
      // `catchUpLockedYard` is mentioned in a comment (sweep.ts) explaining why
      // bots DON'T go through it; only an actual call would reach the horse.
      expect(source).not.toContain("catchUpLockedYard(");
    }
  });
});
