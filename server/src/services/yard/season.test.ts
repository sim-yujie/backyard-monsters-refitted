import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { catchUpMushrooms } from "./catchUpMushrooms.js";
import {
  MUSHROOM_RESPAWN_SECONDS,
  PUMPKIN_RESPAWN_SECONDS,
  mushroomRespawnSeconds,
  readMushrooms,
  type MushroomYardSave,
} from "./mushrooms.js";
import { EVENTS } from "../../game-data/events/events.js";
import { activeEventKinds, PUMPKIN_HUNT_EVENT, pumpkinHuntOn } from "./season.js";

/**
 * The Halloween season (`season.ts`): on from 2026-10-28 to 2026-11-11 UTC,
 * forced on locally by EVENTS_FORCE_ON; and the pumpkin hunt's faster growth
 * while it is on.
 */

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000);
const NONE: ReadonlySet<string> = new Set();
const FORCED: ReadonlySet<string> = new Set(["halloween-2026"]);


// These run outside every event: a local EVENTS_FORCE_ON (server/.env) would
// switch the Halloween pumpkin hunt on and change the mushroom rules under test.
const forcedOn = process.env.EVENTS_FORCE_ON;
beforeAll(() => {
  delete process.env.EVENTS_FORCE_ON;
});
afterAll(() => {
  if (forcedOn !== undefined) process.env.EVENTS_FORCE_ON = forcedOn;
});

describe("Halloween season", () => {
  test("on from its start up to, not including, its end", () => {
    expect(pumpkinHuntOn(at("2026-10-27T23:59:59Z"), EVENTS, NONE)).toBe(false);
    expect(pumpkinHuntOn(at("2026-10-28T00:00:00Z"), EVENTS, NONE)).toBe(true);
    expect(pumpkinHuntOn(at("2026-11-10T23:59:59Z"), EVENTS, NONE)).toBe(true);
    expect(pumpkinHuntOn(at("2026-11-11T00:00:00Z"), EVENTS, NONE)).toBe(false);
  });

  test("the base load's kinds: halloween while on, nothing otherwise", () => {
    expect(activeEventKinds(at("2026-11-01T12:00:00Z"), EVENTS, NONE)).toEqual(["halloween"]);
    expect(activeEventKinds(at("2026-10-20T12:00:00Z"), EVENTS, NONE)).toEqual([]);
  });

  test("forced on (EVENTS_FORCE_ON), it runs from today's UTC midnight", () => {
    const today = at("2026-10-20T15:00:00Z");
    expect(pumpkinHuntOn(today, EVENTS, FORCED)).toBe(true);
    expect(activeEventKinds(today, EVENTS, FORCED)).toEqual(["halloween"]);
  });

  test("the hunt is the halloween-2026 event's", () => {
    expect(PUMPKIN_HUNT_EVENT).toBe("halloween-2026");
    expect(EVENTS.find((event) => event.id === PUMPKIN_HUNT_EVENT)?.ladder?.label).toBe("Pumpkins found");
  });
});

describe("pumpkin hunt growth", () => {
  const saveOf = (count: number, s: number): MushroomYardSave => ({
    buildingdata: { "0": { id: 0, t: 14, x: 0, y: 0, X: 0, Y: 0, l: 3 } },
    storedata: {},
    mushrooms: { l: Array.from({ length: count }, (_, i) => [1, -480 + i * 40, 360]), s },
  });
  const countOf = (save: MushroomYardSave): number => readMushrooms(save.mushrooms).l.length;

  test("an hour a pumpkin while the hunt is on, 17,280 s a mushroom otherwise", () => {
    expect(PUMPKIN_RESPAWN_SECONDS).toBe(3_600);
    expect(mushroomRespawnSeconds(true)).toBe(PUMPKIN_RESPAWN_SECONDS);
    expect(mushroomRespawnSeconds(false)).toBe(MUSHROOM_RESPAWN_SECONDS);
  });

  test("during the event three hours away grows three pumpkins", () => {
    const last = at("2026-11-01T09:00:00Z");
    const save = saveOf(2, last);

    catchUpMushrooms(save, last + 3 * 3_600 + 60, Math.random, mushroomRespawnSeconds(true));

    expect(countOf(save)).toBe(5);
  });

  test("outside the event the same three hours grow nothing", () => {
    const last = at("2026-10-20T09:00:00Z");
    const save = saveOf(2, last);

    catchUpMushrooms(save, last + 3 * 3_600 + 60, Math.random);

    expect(countOf(save)).toBe(2);
    expect(save.mushrooms!.s).toBe(last);
  });

  test("the period defaults to the event's own clock: on in the window, off before it", () => {
    const inside = at("2026-11-01T09:00:00Z");
    const before = at("2026-10-01T09:00:00Z");
    const on = saveOf(0, inside);
    const off = saveOf(0, before);

    catchUpMushrooms(on, inside + 2 * 3_600, Math.random);
    catchUpMushrooms(off, before + 2 * 3_600, Math.random);

    expect(countOf(on)).toBe(2);
    expect(countOf(off)).toBe(0);
  });

  test("the cap of 10 still holds during the hunt", () => {
    const last = at("2026-11-01T09:00:00Z");
    const save = saveOf(8, last);

    catchUpMushrooms(save, last + 24 * 3_600, Math.random, mushroomRespawnSeconds(true));

    expect(countOf(save)).toBe(10);
  });
});
