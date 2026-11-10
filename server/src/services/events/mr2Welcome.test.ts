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
  MR2_WELCOME_SECONDS,
  onMapRoom2,
  recordMr2Join,
  useWelcomeStore,
  welcomeReady,
  welcomeState,
  welcomeStatus,
  welcomeStore,
} from "./mr2Welcome.js";

const DAY = 86_400;
const T0 = 1_800_000_000;
const em = {} as EntityManager;
const fresh = { start: T0, takeoverUsed: false, kitUsed: false };

describe("the 10 days", () => {
  test("open from the start for exactly 10 days", () => {
    expect(welcomeReady(fresh, "takeover", T0 - 1)).toBe(false);
    expect(welcomeReady(fresh, "takeover", T0)).toBe(true);
    expect(welcomeReady(fresh, "kit", T0 + MR2_WELCOME_SECONDS - 1)).toBe(true);
    expect(welcomeReady(fresh, "kit", T0 + MR2_WELCOME_SECONDS)).toBe(false);
    expect(welcomeReady(null, "kit", T0)).toBe(false);
  });

  test("a used reward is not ready", () => {
    expect(welcomeReady({ ...fresh, takeoverUsed: true }, "takeover", T0)).toBe(false);
    expect(welcomeReady({ ...fresh, takeoverUsed: true }, "kit", T0)).toBe(true);
  });

  test("the card: days left rounded up, each reward's state, gone only when the 10 days are over", () => {
    expect(welcomeStatus(fresh, T0)).toEqual({
      startsAt: T0,
      endsAt: T0 + 10 * DAY,
      daysLeft: 10,
      takeover: true,
      kit: true,
      takeoverUsedAt: null,
      kitUsedAt: null,
    });
    expect(welcomeStatus(fresh, T0 + 9 * DAY + 1)?.daysLeft).toBe(1);
    expect(welcomeStatus({ ...fresh, kitUsed: true }, T0 + DAY)).toMatchObject({ daysLeft: 9, takeover: true, kit: false });
    // Both used: the card stays for the rest of the 10 days (owner, 9 Nov), with when each was used.
    expect(
      welcomeStatus({ ...fresh, kitUsed: true, takeoverUsed: true, takeoverAt: T0 + 100, kitAt: T0 + 2 * DAY }, T0 + 3 * DAY),
    ).toMatchObject({ daysLeft: 7, takeover: false, kit: false, takeoverUsedAt: T0 + 100, kitUsedAt: T0 + 2 * DAY });
    // Used before the time was kept: Used, with no day.
    expect(welcomeStatus({ ...fresh, kitUsed: true, takeoverUsed: true }, T0)).toMatchObject({
      takeover: false,
      kit: false,
      takeoverUsedAt: null,
      kitUsedAt: null,
    });
    // A time on a reward not used is not shown.
    expect(welcomeStatus({ ...fresh, takeoverAt: T0 }, T0)?.takeoverUsedAt).toBeNull();
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

describe("when the 10 days start", () => {
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
    expect(await welcomeState(em, 9, true, T0 + 5 * DAY)).toEqual({ ...fresh });
    expect(welcomeStatus(await welcomeState(em, 9, true, T0 + 5 * DAY), T0 + 5 * DAY)?.daysLeft).toBe(5);
  });

  test("a player not on Map Room 2 with no row has no window, and none is written", async () => {
    const store = memoryWelcomeStore(T0);
    previous = useWelcomeStore(store);

    expect(await welcomeState(em, 10, false, T0)).toBeNull();
    expect(store.rows.size).toBe(0);
  });

  test("each reward is claimed once, only inside the 10 days", async () => {
    const store = memoryWelcomeStore(T0);
    previous = useWelcomeStore(store);
    await recordMr2Join(em, 11, T0);

    expect(await claimWelcome(em, 11, "takeover", T0 + 10 * DAY)).toBe(false);
    expect(await claimWelcome(em, 11, "takeover", T0 + DAY)).toBe(true);
    expect(await claimWelcome(em, 11, "takeover", T0 + DAY)).toBe(false);
    expect(await claimWelcome(em, 11, "kit", T0 + DAY)).toBe(true);
    expect(await claimWelcome(em, 12, "kit", T0 + DAY)).toBe(false);
    expect(store.rows.get(11)).toMatchObject({ takeoverAt: T0 + DAY, kitAt: T0 + DAY });
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
