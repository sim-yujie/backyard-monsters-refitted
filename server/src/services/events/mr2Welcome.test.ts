import { afterEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";

import { quoteTakeover, takeoverResourceCost, takeoverShinyCost } from "../maproom/v2/takeoverCost.js";
import { calculateTribeLevel } from "../maproom/v2/calculateTribeLevel.js";
import { STARTER_KITS } from "../../game-data/starterKits.js";
import { kitBuildings } from "../yard/starterKit.js";
import { Tribes } from "../../enums/Tribes.js";
import {
  cheapTakeoverPrice,
  claimWelcome,
  memoryWelcomeStore,
  MR2_WELCOME_DAYS,
  MR2_WELCOME_SECONDS,
  MR2_WELCOME_SETS,
  newWelcome,
  onMapRoom2,
  recordMr2Join,
  useWelcomeStore,
  welcomeDayOf,
  welcomeDayStart,
  welcomeEnd,
  welcomeReady,
  welcomeState,
  welcomeStatus,
  welcomeStore,
} from "./mr2Welcome.js";

const DAY = 86_400;
const HOUR = 3_600;
/** 08:00 UTC on 15 Jan 2027; the next daily reset is 16 hours later. */
const T0 = 1_800_000_000;
const MIDNIGHT = T0 + 16 * HOUR;
/** 00:00 UTC on 15 Jan 2027: day 1 of a pass joined on that day. */
const DAY1 = T0 - 8 * HOUR;
const em = {} as EntityManager;
/** A pass joined on 15 Jan 2027 (kept as that day's 00:00 UTC). */
const fresh = newWelcome(DAY1);

describe("the pass days", () => {
  test("10 days with 7 sets (owner, 11 Nov)", () => {
    expect(MR2_WELCOME_DAYS).toBe(10);
    expect(MR2_WELCOME_SETS).toBe(7);
    expect(MR2_WELCOME_SECONDS).toBe(10 * DAY);
  });

  test("open for exactly 10 daily resets from the joining day's 00:00 UTC", () => {
    expect(welcomeReady(fresh, "takeover", DAY1 - 1)).toBe(false);
    expect(welcomeReady(fresh, "takeover", DAY1)).toBe(true);
    expect(welcomeReady(fresh, "kit", DAY1 + MR2_WELCOME_SECONDS - 1)).toBe(true);
    expect(welcomeReady(fresh, "kit", DAY1 + MR2_WELCOME_SECONDS)).toBe(false);
    expect(welcomeReady(null, "kit", T0)).toBe(false);
  });

  test("one of each a day: used today is back at the daily reset (UTC midnight), the other reward unaffected", () => {
    const kitToday = { ...fresh, kitUses: [T0 + 60], kitDay: "2027-01-15" };
    expect(new Date(T0 * 1000).toISOString().slice(0, 10)).toBe("2027-01-15");
    expect(welcomeReady(kitToday, "kit", T0 + HOUR)).toBe(false);
    expect(welcomeReady(kitToday, "kit", MIDNIGHT - 1)).toBe(false);
    expect(welcomeReady(kitToday, "kit", MIDNIGHT)).toBe(true);
    expect(welcomeReady(kitToday, "takeover", T0 + HOUR)).toBe(true);
  });

  test("7 of each, then none; days not played lose nothing", () => {
    const six = { ...fresh, takeoverUses: [1, 2, 3, 4, 5, 6], takeoverDay: "2027-01-17" };
    // Six used by day 3, none used since: the 7th is still there on day 10.
    expect(welcomeReady(six, "takeover", T0 + 9 * DAY)).toBe(true);
    const seven = { ...six, takeoverUses: [...six.takeoverUses, 7] };
    expect(welcomeReady(seven, "takeover", T0 + 9 * DAY)).toBe(false);
    expect(welcomeReady(seven, "kit", T0 + 9 * DAY)).toBe(true);
  });

  test("the card: days left of 10, each reward's left of 7 and today's state, gone only when the days are over", () => {
    expect(welcomeStatus(fresh, T0)).toEqual({
      startsAt: DAY1,
      endsAt: DAY1 + 10 * DAY,
      daysLeft: 10,
      sets: 7,
      takeover: true,
      kit: true,
      takeoverLeft: 7,
      kitLeft: 7,
      takeoverToday: false,
      kitToday: false,
      nextDayAt: MIDNIGHT,
      takeoverUses: [],
      kitUses: [],
    });
    expect(welcomeStatus(fresh, T0 + 9 * DAY + 1)?.daysLeft).toBe(1);
    const used = { ...fresh, takeoverUses: [null, T0 + 2 * DAY], takeoverDay: "2027-01-17", kitUses: [T0 + 100], kitDay: "2027-01-15" };
    expect(welcomeStatus(used, T0 + 2 * DAY + HOUR)).toMatchObject({
      daysLeft: 8,
      takeover: false,
      kit: true,
      takeoverLeft: 5,
      kitLeft: 6,
      takeoverToday: true,
      kitToday: false,
      takeoverUses: [T0 + 2 * DAY],
      kitUses: [T0 + 100],
    });
    // All 7 used: the card stays for the rest of the days (owner, 9 Nov).
    const all = { ...fresh, takeoverUses: [1, 2, 3, 4, 5, 6, 7], kitUses: [1, 2, 3, 4, 5, 6, 7] };
    expect(welcomeStatus(all, T0 + 8 * DAY)).toMatchObject({ takeover: false, kit: false, takeoverLeft: 0, kitLeft: 0 });
    expect(welcomeStatus(fresh, T0 + 10 * DAY)).toBeNull();
    expect(welcomeStatus(null, T0)).toBeNull();
  });

  test("on Map Room 2 by either flag", () => {
    expect(onMapRoom2({ mr2upgraded: true, mapversion: 1 })).toBe(true);
    expect(onMapRoom2({ mr2upgraded: false, mapversion: 2 })).toBe(true);
    expect(onMapRoom2({ mr2upgraded: false, mapversion: 1 })).toBe(false);
    expect(onMapRoom2(null)).toBe(false);
  });
});
describe("the days are daily resets (owner, 28 Nov: a brand new day, not the joining time)", () => {
  /** Rygnus's live pass, written before patch 9.1 at the joining moment (21 Nov 2026 03:56:02 UTC). */
  const RYGNUS_START = 1_795_233_362;
  const rygnus = {
    start: RYGNUS_START,
    kitUses: [1_795_233_733, 1_795_307_246, 1_795_397_401, 1_795_486_975, 1_795_575_899, 1_795_651_994, 1_795_744_345],
    takeoverUses: [1_795_233_713, 1_795_307_238, 1_795_397_396, 1_795_486_969, 1_795_575_892, 1_795_651_989, 1_795_744_340],
    kitDay: "2026-11-27",
    takeoverDay: "2026-11-27",
  };
  const at = (iso: string) => Date.parse(iso) / 1000;

  test("Rygnus: 7 uses on 7 resets land on days 1-7, 28 Nov is day 8", () => {
    expect(rygnus.kitUses.map((use) => welcomeDayOf(RYGNUS_START, use))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rygnus.takeoverUses.map((use) => welcomeDayOf(RYGNUS_START, use))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const now = at("2026-11-28T03:02:48Z");
    expect(welcomeDayOf(RYGNUS_START, now)).toBe(8);
    const status = welcomeStatus(rygnus, now)!;
    expect(status.startsAt).toBe(at("2026-11-21T00:00:00Z"));
    expect(welcomeDayOf(status.startsAt, now)).toBe(8);
    expect(status).toMatchObject({ takeoverLeft: 0, kitLeft: 0, daysLeft: 4 });
  });

  test("a pass from before 9.1 loses no time: its old end, rounded up to the next reset (an 11th day)", () => {
    const oldEnd = RYGNUS_START + 10 * DAY;
    expect(new Date(oldEnd * 1000).toISOString()).toBe("2026-12-01T03:56:02.000Z");
    expect(welcomeEnd(RYGNUS_START)).toBe(at("2026-12-02T00:00:00Z"));
    expect(welcomeEnd(RYGNUS_START)).toBeGreaterThanOrEqual(oldEnd);
    const unused = newWelcome(RYGNUS_START);
    expect(welcomeReady(unused, "kit", oldEnd)).toBe(true);
    expect(welcomeReady(unused, "kit", at("2026-12-01T23:59:59Z"))).toBe(true);
    expect(welcomeReady(unused, "kit", at("2026-12-02T00:00:00Z"))).toBe(false);
    expect(welcomeDayOf(RYGNUS_START, at("2026-12-01T12:00:00Z"))).toBe(11);
    // Any joining moment: never earlier than 10 x 24 hours, never a whole day more.
    for (let start = T0; start < T0 + DAY; start += 997) {
      expect(welcomeEnd(start)).toBeGreaterThanOrEqual(start + 10 * DAY);
      expect(welcomeEnd(start)).toBeLessThan(start + 11 * DAY);
      expect(welcomeEnd(start) % DAY).toBe(0);
    }
  });

  test("a pass written since 9.1 starts at a reset: exactly 10 days", () => {
    expect(welcomeEnd(DAY1)).toBe(DAY1 + 10 * DAY);
    expect(welcomeDayStart(T0)).toBe(DAY1);
    expect(welcomeDayStart(DAY1)).toBe(DAY1);
  });

  describe("a player who joins at 23:59 UTC", () => {
    let previous = welcomeStore();
    afterEach(() => useWelcomeStore(previous));
    const JOIN = at("2027-01-15T23:59:00Z");

    test("day 1 is that last minute, day 2 starts at midnight, the pass ends at the reset after day 10", async () => {
      expect(JOIN).toBe(DAY1 + DAY - 60);
      const store = memoryWelcomeStore();
      previous = useWelcomeStore(store);
      await recordMr2Join(em, 21, JOIN);
      expect(store.rows.get(21)?.start).toBe(DAY1);

      expect(await claimWelcome(em, 21, "takeover", JOIN + 30)).toBe(true);
      expect(welcomeStatus(store.rows.get(21)!, JOIN + 40)).toMatchObject({ daysLeft: 10, takeoverToday: true });
      // A new day at 00:00 UTC: day 2's takeover.
      expect(await claimWelcome(em, 21, "takeover", DAY1 + DAY + 30)).toBe(true);
      const uses = store.rows.get(21)!.takeoverUses as number[];
      expect(uses.map((use) => welcomeDayOf(DAY1, use))).toEqual([1, 2]);
      expect(welcomeStatus(store.rows.get(21)!, DAY1 + DAY + 60)?.daysLeft).toBe(9);
      // Day 10 is 24 Jan; over at 00:00 UTC on 25 Jan.
      expect(welcomeDayOf(DAY1, at("2027-01-24T12:00:00Z"))).toBe(10);
      expect(await claimWelcome(em, 21, "kit", at("2027-01-24T23:59:59Z"))).toBe(true);
      expect(await claimWelcome(em, 21, "takeover", at("2027-01-25T00:00:00Z"))).toBe(false);
      expect(welcomeStatus(store.rows.get(21)!, at("2027-01-25T00:00:00Z"))).toBeNull();
    });
  });
});

describe("when the days start", () => {
  let previous = welcomeStore();
  afterEach(() => useWelcomeStore(previous));

  test("a new joiner starts on the joining day (its 00:00 UTC), once ever", async () => {
    const store = memoryWelcomeStore(T0 - 30 * DAY);
    previous = useWelcomeStore(store);

    await recordMr2Join(em, 7, T0);
    await recordMr2Join(em, 7, T0 + 50 * DAY);
    expect(await welcomeState(em, 7, true, T0 + DAY)).toEqual(fresh);
  });

  test("a player on Map Room 2 at launch with no row starts at the launch time, the same for everyone", async () => {
    const store = memoryWelcomeStore();
    previous = useWelcomeStore(store);

    // The first server start with the feature fixes the launch time.
    expect(await store.launchTime(em, T0)).toBe(T0);
    expect(await welcomeState(em, 8, true, T0 + 3 * DAY)).toEqual(fresh);
    expect(await welcomeState(em, 9, true, T0 + 5 * DAY)).toEqual(fresh);
    expect(welcomeStatus(await welcomeState(em, 9, true, T0 + 5 * DAY), T0 + 5 * DAY)?.daysLeft).toBe(5);
  });

  test("a player not on Map Room 2 with no row has no window, and none is written", async () => {
    const store = memoryWelcomeStore(T0);
    previous = useWelcomeStore(store);

    expect(await welcomeState(em, 10, false, T0)).toBeNull();
    expect(store.rows.size).toBe(0);
  });

  test("one of each a day, 7 of each, only inside the days", async () => {
    const store = memoryWelcomeStore(T0);
    previous = useWelcomeStore(store);
    await recordMr2Join(em, 11, T0);

    expect(await claimWelcome(em, 11, "takeover", T0 + 10 * DAY)).toBe(false);
    expect(await claimWelcome(em, 11, "takeover", T0 + HOUR)).toBe(true);
    expect(await claimWelcome(em, 11, "takeover", T0 + 2 * HOUR)).toBe(false);
    expect(await claimWelcome(em, 11, "kit", T0 + 2 * HOUR)).toBe(true);
    expect(await claimWelcome(em, 12, "kit", T0 + HOUR)).toBe(false);
    expect(store.rows.get(11)).toMatchObject({ takeoverUses: [T0 + HOUR], kitUses: [T0 + 2 * HOUR], takeoverDay: "2027-01-15" });
    // The next day's takeover, after the reset; then six more days of it.
    for (let day = 1; day < 7; day++) expect(await claimWelcome(em, 11, "takeover", MIDNIGHT + (day - 1) * DAY + 60)).toBe(true);
    expect(store.rows.get(11)?.takeoverUses).toHaveLength(7);
    expect(await claimWelcome(em, 11, "takeover", MIDNIGHT + 7 * DAY)).toBe(false);
    expect(await claimWelcome(em, 11, "kit", MIDNIGHT + 7 * DAY)).toBe(true);
  });
});

describe("the cheap takeover price", () => {
  // A camp far enough out that its level makes the price more than the floor.
  const cell = { x: 120, y: 160 };
  const level = calculateTribeLevel(cell.x, cell.y, Tribes[(cell.x + cell.y) % Tribes.length]!);
  const fullBase = takeoverResourceCost({
    isWildMonster: true,
    level,
    empireValue: 0,
    adjacentToMainYard: false,
  });
  const quote = (over: Partial<Parameters<typeof quoteTakeover>[0]> = {}) =>
    quoteTakeover({ cell, isWildMonster: true, buildingdata: null, takerHomebase: ["0", "0"], ...over });

  test("10% of the camp's full base price, in each resource", () => {
    expect(cheapTakeoverPrice(1_000_000)).toBe(100_000);
    const cheap = quote({ welcome: true });
    expect(cheap.resources).toBe(Math.round(fullBase * 0.1));
    expect(cheap).toMatchObject({ welcome: true, usualResources: fullBase });
  });

  test("no half price on top", () => {
    const next = quote({ welcome: true, takerHomebase: [String(cell.x), String(cell.y - 1)] });
    expect(next.adjacent).toBe(true);
    expect(next.resources).toBe(Math.round(fullBase * 0.1));
    expect(next.usualResources).toBe(fullBase * 0.5);
  });

  test("the Shiny price is the usual one", () => {
    expect(quote({ welcome: true }).shiny).toBe(quote().shiny);
    expect(quote().shiny).toBe(takeoverShinyCost(fullBase));
  });

  test("a player outpost is never cheap", () => {
    const buildingdata = kitBuildings(STARTER_KITS[0]!, "shiny", {}).buildingdata;
    const outpost = quote({ welcome: true, isWildMonster: false, buildingdata });
    expect(outpost.welcome).toBeUndefined();
    expect(outpost.resources).toBe(quote({ isWildMonster: false, buildingdata }).resources);
  });
});
