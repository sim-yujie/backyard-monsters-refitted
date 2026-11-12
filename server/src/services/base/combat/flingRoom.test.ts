import { describe, expect, test } from "bun:test";
import { bucketCost, championStat, type FlingEvent } from "../../../game-rules/combat/index.js";
import {
  NORMAL_FLINGER_ROOM,
  championRoomOf,
  championTakesRoom,
  flingsOverRoom,
  type MarkedFlingLog,
} from "./flingRoom.js";

/**
 * The Flinger's room in a normal attack (owner, 12 Nov 2026): the champion
 * first, then monsters, all within 2,250, as Flash's `ATTACK.BucketAdd` and
 * the web client's `Bucket` fill it; an older page's log on the older rule.
 */

const fling = (t: number, monsters: Record<string, number>, champion?: { t: number; l: number }): FlingEvent => ({
  kind: "fling",
  t,
  x: 0,
  y: 0,
  r: 300,
  monsters,
  ...(champion && { champion }),
});

/** A log from a page that marks it (`championRoom: 1`), or an older page's (`old`). */
const log = (events: FlingEvent[], old = false): MarkedFlingLog => ({
  v: 1,
  seed: 7,
  events,
  ...(!old && { championRoom: 1 as const }),
});

const GORGO = { t: 1, l: 6 };
const gorgoRoom = championStat("G1", "bucket", 6);

describe("flingsOverRoom", () => {
  test("the room is the Map Room 2 Flinger's 2,250 whatever was built", () => {
    expect(NORMAL_FLINGER_ROOM).toBe(2250);
  });

  test("a champion takes its own bucket; an unknown type takes none", () => {
    expect(gorgoRoom).toBe(240);
    expect(championRoomOf(GORGO)).toBe(240);
    expect(championRoomOf(undefined)).toBe(0);
    expect(championRoomOf({ t: 99, l: 1 })).toBe(0);
  });

  test("monsters filling the Flinger exactly pass", () => {
    // 150 Bolts at 15 each.
    expect(bucketCost({ C3: 150 }, undefined)).toBe(2250);
    expect(flingsOverRoom(log([fling(10, { C3: 150 })]), 2250, undefined)).toEqual([]);
  });

  test("a champion plus monsters that fill exactly the room left pass", () => {
    // 240 for Gorgo, then 2,010 of monsters: 134 Bolts.
    const exact = log([fling(10, { C3: 134 }, GORGO)]);
    expect(flingsOverRoom(exact, 2250, undefined)).toEqual([]);
  });

  test("one Bolt more than the room is refused, and names the fling", () => {
    const over = log([fling(10, { C1: 10 }), fling(400, { C3: 135 }, GORGO)]);
    expect(flingsOverRoom(over, 2250, undefined)).toEqual([{ fling: 2, t: 400, used: 2265, room: 2250 }]);
  });

  test("a champion on top of a full Flinger is refused from a marked log", () => {
    const onTop = log([fling(10, { C3: 150 }, GORGO)]);
    expect(flingsOverRoom(onTop, 2250, undefined)).toEqual([{ fling: 1, t: 10, used: 2250 + gorgoRoom, room: 2250 }]);
  });

  test("monsters alone over the room are refused, champion or not", () => {
    expect(flingsOverRoom(log([fling(10, { C8: 76 })]), 2250, undefined)).toHaveLength(1);
  });

  test("bombs, siege and retreats take no room", () => {
    const events: FlingEvent[] = [
      { kind: "bomb", t: 5, x: 0, y: 0, id: "pb1" },
      { kind: "retreat", t: 900 },
    ];
    expect(flingsOverRoom(log(events), 2250, undefined)).toEqual([]);
  });

  describe("an older page's log (no championRoom)", () => {
    test("is held to the older rule", () => {
      expect(championTakesRoom(log([], true))).toBe(false);
      expect(championTakesRoom(log([]))).toBe(true);
    });

    test("its champion on top of a full Flinger passes, as that page sent it", () => {
      const onTop = log([fling(10, { C3: 150 }, GORGO)], true);
      expect(flingsOverRoom(onTop, 2250, undefined)).toEqual([]);
    });

    test("its monsters alone over the room are still refused", () => {
      const over = log([fling(10, { C3: 151 }, GORGO)], true);
      expect(flingsOverRoom(over, 2250, undefined)).toEqual([{ fling: 1, t: 10, used: 2265, room: 2250 }]);
    });
  });
});
