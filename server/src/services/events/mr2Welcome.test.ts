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
  welcomeReady,
  welcomeState,
  welcomeStatus,
  welcomeStore,
} from "./mr2Welcome.js";

const DAY = 86_400;
const HOUR = 3_600;
/** 08:00 UTC; the next daily reset is 16 hours later. */
const T0 = 1_800_000_000;
const MIDNIGHT = T0 + 16 * HOUR;
const em = {} as EntityManager;
const fresh = newWelcome(T0);

describe("the pass days", () => {
  test("10 days with 7 sets (owner, 11 Nov)", () => {
    expect(MR2_WELCOME_DAYS).toBe(10);
    expect(MR2_WELCOME_SETS).toBe(7);
    expect(MR2_WELCOME_SECONDS).toBe(10 * DAY);
  });

  test("open from the start for exactly 10 days", () => {
    expect(welcomeReady(fresh, "takeover", T0 - 1)).toBe(false);
    expect(welcomeReady(fresh, "takeover", T0)).toBe(true);
    expect(welcomeReady(fresh, "kit", T0 + MR2_WELCOME_SECONDS - 1)).toBe(true);
    expect(welcomeReady(fresh, "kit", T0 + MR2_WELCOME_SECONDS)).toBe(false);
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
      startsAt: T0,
      endsAt: T0 + 10 * DAY,
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

describe("when the days start", () => {
  let previous = welcomeStore();
  afterEach(() => useWelcomeStore(previous));

  test("a new joiner starts on joining, once ever", async () => {
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
    conquestActive: false,
  });
  const quote = (over: Partial<Parameters<typeof quoteTakeover>[0]> = {}) =>
    quoteTakeover({ cell, isWildMonster: true, buildingdata: null, takerHomebase: ["0", "0"], conquestActive: false, ...over });

  test("10% of the camp's full base price, in each resource", () => {
    expect(cheapTakeoverPrice(1_000_000)).toBe(100_000);
    const cheap = quote({ welcome: true });
    expect(cheap.resources).toBe(Math.round(fullBase * 0.1));
    expect(cheap).toMatchObject({ welcome: true, usualResources: fullBase });
  });

  test("no half price or Conquest on top", () => {
    const next = quote({ welcome: true, takerHomebase: [String(cell.x), String(cell.y - 1)], conquestActive: true });
    expect(next.adjacent).toBe(true);
    expect(next.resources).toBe(Math.round(fullBase * 0.1));
    expect(next.usualResources).toBe(Math.ceil(fullBase * 0.5 * 0.75));
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
