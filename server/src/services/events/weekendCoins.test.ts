import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";

import { DEFAULT_WEEKEND_SETTINGS, type WeekendSettings } from "../../game-data/events/weekendEvents.js";
import { coinNotes, memoryCoinStore, type EventCoinStore } from "./eventCoins.js";
import {
  awardWeekendCoins,
  awardWeekendCoinsSafely,
  forgetWeekendCoinCache,
  WEEKEND_COINS,
  weekendAwardKey,
  weekendCoinState,
} from "./weekendCoins.js";

/**
 * A weekend event's coins (beta 7 grill item 29): 25 for playing, 75 for
 * using the boost, each once per player per run, nothing outside a run.
 * The schedule is the default rotation: Saturday 14 Nov 2026 is a
 * Builder's Weekend, 21 Nov a Tribe Plunder.
 */
const at = (iso: string): number => Date.parse(iso) / 1000;
const settings = (over: Partial<WeekendSettings> = {}): WeekendSettings => ({ ...DEFAULT_WEEKEND_SETTINGS, ...over });

const SATURDAY = at("2026-11-14T10:00:00Z");
const SUNDAY_LATE = at("2026-11-15T23:30:00Z");
const NEXT_SATURDAY = at("2026-11-21T10:00:00Z");
const FRIDAY = at("2026-11-13T10:00:00Z");

const fakeEm = (): EntityManager => ({}) as EntityManager;

describe("weekend coins", () => {
  let store: ReturnType<typeof memoryCoinStore>;
  const options = () => ({ settings: settings(), store });

  beforeEach(() => {
    store = memoryCoinStore();
    forgetWeekendCoinCache();
  });

  test("the owner's figures: 25 for playing, 75 for the boost, 100 in all", () => {
    expect(WEEKEND_COINS).toEqual({ played: 25, boost: 75 });
    expect(WEEKEND_COINS.played + WEEKEND_COINS.boost).toBe(100);
  });

  test("playing pays 25 once per weekend, however often", async () => {
    expect(await awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, options())).toBe(25);
    expect(await awardWeekendCoins(fakeEm(), 7, ["played"], SUNDAY_LATE, options())).toBe(0);
    expect(store.balances.get(7)).toBe(25);
    expect(store.log).toEqual([{ userid: 7, amount: 25, reason: "weekend-played", awardKey: "weekend:2026-11-14:played" }]);
  });

  test("using the boost pays 75, and playing too when still unpaid; then nothing more", async () => {
    expect(await awardWeekendCoins(fakeEm(), 7, ["played", "boost"], SATURDAY, options())).toBe(100);
    expect(await awardWeekendCoins(fakeEm(), 7, ["played", "boost"], SATURDAY + 60, options())).toBe(0);
    expect(store.balances.get(7)).toBe(100);
  });

  test("after playing, the boost adds only its 75", async () => {
    await awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, options());
    expect(await awardWeekendCoins(fakeEm(), 7, ["played", "boost"], SUNDAY_LATE, options())).toBe(75);
    expect(store.balances.get(7)).toBe(100);
  });

  test("the next weekend pays again; each player is counted alone", async () => {
    await awardWeekendCoins(fakeEm(), 7, ["played", "boost"], SATURDAY, options());
    expect(await awardWeekendCoins(fakeEm(), 7, ["played", "boost"], NEXT_SATURDAY, options())).toBe(100);
    expect(await awardWeekendCoins(fakeEm(), 8, ["played"], SATURDAY, options())).toBe(25);
    expect(store.balances.get(7)).toBe(200);
    expect(store.balances.get(8)).toBe(25);
  });

  test("nothing outside a run, switched off, or on a skipped weekend", async () => {
    expect(await awardWeekendCoins(fakeEm(), 7, ["played", "boost"], FRIDAY, options())).toBe(0);
    expect(
      await awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, { store, settings: settings({ enabled: false }) })
    ).toBe(0);
    expect(
      await awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, {
        store,
        settings: settings({ overrides: { "2026-11-14": "skip" } }),
      })
    ).toBe(0);
    expect(store.log).toEqual([]);
  });

  test("a forced run pays under its own key", async () => {
    const s = settings({ forced: { id: "study", since: 0, until: 4_102_444_800 } });
    expect(await awardWeekendCoins(fakeEm(), 7, ["played"], FRIDAY, { store, settings: s })).toBe(25);
    expect(store.log[0]?.awardKey).toBe("weekend:forced-0:played");
  });

  test("a payment is noted on the request's entity manager for the yard answer", async () => {
    const em = fakeEm();
    expect(coinNotes(em)).toBeNull();
    await awardWeekendCoins(em, 7, ["played", "boost"], SATURDAY, options());
    expect(coinNotes(em)).toEqual({
      balance: 100,
      gained: [
        { amount: 25, reason: "weekend-played" },
        { amount: 75, reason: "weekend-boost" },
      ],
    });
  });

  test("a payment that rolled back is tried again (only 'already paid' is cached)", async () => {
    await awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, options());
    // The yard action rolled back: the row is gone.
    store.log.length = 0;
    store.balances.clear();
    expect(await awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, options())).toBe(25);
  });

  test("once found paid, later calls skip the store", async () => {
    await awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, options());
    await awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, options());
    let calls = 0;
    const counting: EventCoinStore = {
      ...store,
      grant: async (...args) => {
        calls++;
        return store.grant(...args);
      },
    };
    await awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, { settings: settings(), store: counting });
    expect(calls).toBe(0);
  });

  test("the safe form logs a failing store and pays nothing", async () => {
    const broken: EventCoinStore = {
      ...store,
      grant: async () => {
        throw new Error("no table");
      },
    };
    expect(await awardWeekendCoinsSafely(fakeEm(), 7, ["played"], SATURDAY, { settings: settings(), store: broken })).toBe(0);
    await expect(awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, { settings: settings(), store: broken })).rejects.toThrow(
      "no table"
    );
  });

  test("the pop-up's ticks: which parts this player has", async () => {
    expect(await weekendCoinState(fakeEm(), 7, FRIDAY, options())).toBeNull();
    expect(await weekendCoinState(fakeEm(), 7, SATURDAY, options())).toEqual({
      key: "2026-11-14",
      played: false,
      boost: false,
      coins: WEEKEND_COINS,
    });
    await awardWeekendCoins(fakeEm(), 7, ["played"], SATURDAY, options());
    expect(await weekendCoinState(fakeEm(), 7, SATURDAY, options())).toMatchObject({ played: true, boost: false });
    expect(weekendAwardKey({ key: "2026-11-14" }, "boost")).toBe("weekend:2026-11-14:boost");
  });
});

describe("the in-memory coin store's rules (the SQL store's twin)", () => {
  test("spend takes only what the balance covers; amounts are whole and above 0", async () => {
    const store = memoryCoinStore();
    const em = fakeEm();
    expect(await store.spend(em, 1, 5, "decor-55")).toBeNull();
    expect(await store.grant(em, 1, 40.9, "calendar")).toBe(40);
    expect(await store.grant(em, 1, 0, "calendar")).toBeNull();
    expect(await store.grant(em, 1, -5, "calendar")).toBeNull();
    expect(await store.spend(em, 1, 50, "decor-57")).toBeNull();
    expect(await store.spend(em, 1, 40, "decor-57")).toBe(0);
    expect(await store.balance(em, 1)).toBe(0);
  });

  test("an award key pays once; other grants are not limited", async () => {
    const store = memoryCoinStore();
    const em = fakeEm();
    expect(await store.grant(em, 1, 10, "x", "k")).toBe(10);
    expect(await store.grant(em, 1, 10, "x", "k")).toBeNull();
    expect(await store.grant(em, 1, 10, "calendar")).toBe(20);
    expect(await store.grant(em, 1, 10, "calendar")).toBe(30);
    expect(await store.awarded(em, 1, ["k", "other"])).toEqual(new Set(["k"]));
  });
});
