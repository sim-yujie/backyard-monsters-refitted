import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { SHOP_ITEMS, shopItemsFor, shopModel, type ShopOffer } from "./shop";
import { YardStore } from "./YardStore";

/**
 * The Shop's rows (§8.2): the next step's price, running and sold-out items,
 * the Locker and Hatchery Overdrive gates, the outpost list and Repair
 * everything now.
 */

const T0 = 2_000_000;

const never = <R>() => new Promise<R>(() => undefined);

const storeOf = (extra: Partial<BaseLoadResponse> = {}, kind: "main" | "outpost" = "main"): YardStore =>
  new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      credits: 1_000,
      buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 } },
      buildinghealthdata: {},
      storedata: {},
      lockerdata: {},
      ...extra,
    } as unknown as BaseLoadResponse,
    ...(kind === "outpost" ? { target: { baseid: "9", kind: "outpost" } as const } : {}),
    api: { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });

const offer = (store: YardStore, item: string): ShopOffer => {
  const found = shopModel(store).offers.find((one) => one.item.item === item);
  if (!found) throw new Error(`${item} is not in the Shop`);
  return found;
};

describe("shopModel", () => {
  it("prices the next step of an item bought in steps", () => {
    const store = storeOf({ storedata: { BEW: { q: 2 }, BIP: { q: 9 } } });

    expect(offer(store, "BEW")).toMatchObject({ owned: 2, state: { kind: "buy", price: 1_000, blocked: null } });
    expect(offer(store, "BIP")).toMatchObject({ owned: 9, state: { kind: "buy", price: 500 } });
    expect(offer(store, "ENL")).toMatchObject({ owned: 0, state: { kind: "buy", price: 50 } });
  });

  it("says sold out once every step is bought", () => {
    const store = storeOf({ storedata: { BEW: { q: 4 }, ENL: { q: 6 } } });

    expect(offer(store, "BEW").state).toEqual({ kind: "soldOut" });
    expect(offer(store, "ENL").state).toEqual({ kind: "soldOut" });
  });

  it("shows a timed item as running until its end, and on sale again after", () => {
    expect(offer(storeOf({ storedata: { POD: { q: 1, s: T0 - 10, e: T0 + 600 } } }), "POD").state).toEqual({
      kind: "running",
      endsAt: T0 + 600,
    });
    expect(offer(storeOf({ storedata: { POD: { q: 1, s: T0 - 10, e: T0 } } }), "POD").state).toMatchObject({
      kind: "buy",
      price: 200,
    });
  });

  it("blocks what the balance does not cover", () => {
    const store = storeOf({ credits: 224 });

    expect(offer(store, "BST").state).toEqual({ kind: "buy", price: 225, blocked: "Not enough Shiny." });
    expect(offer(store, "EXH").state).toMatchObject({ blocked: "Not enough Shiny." });
    expect(offer(store, "POD").state).toMatchObject({ blocked: null });
    expect(offer(store, "HOD").state).toMatchObject({ blocked: null });
  });

  it("sells the Locker Overdrive only while a monster unlocks", () => {
    expect(offer(storeOf(), "CLOD").state).toMatchObject({ blocked: "Only while a monster is unlocking." });

    const unlocking = storeOf({ lockerdata: { C5: { t: 1, s: T0 - 60, e: T0 + 3_600 } } });
    expect(offer(unlocking, "CLOD").state).toEqual({ kind: "buy", price: 60, blocked: null });
  });

  it("allows one Hatchery Overdrive at a time", () => {
    const store = storeOf({ storedata: { HOD2: { q: 1, s: T0, e: T0 + 3_600 } } });

    expect(offer(store, "HOD2").state).toEqual({ kind: "running", endsAt: T0 + 3_600 });
    expect(offer(store, "HOD").state).toMatchObject({ blocked: "Another Hatchery Overdrive is running." });
    expect(offer(store, "HOD3").state).toMatchObject({ blocked: "Another Hatchery Overdrive is running." });
  });

  it("an outpost sells only its own list", () => {
    expect(shopItemsFor("outpost").map((one) => one.item)).toEqual(["BST", "POD", "HOD", "HOD2", "HOD3", "EXH"]);
    expect(shopModel(storeOf({}, "outpost")).offers.map((one) => one.item.item)).toEqual(
      shopItemsFor("outpost").map((one) => one.item),
    );
    expect(shopItemsFor("main")).toBe(SHOP_ITEMS);
  });

  it("offers Repair everything now only while something is damaged", () => {
    expect(shopModel(storeOf()).repair).toBeNull();

    const damaged = storeOf({
      buildingdata: {
        "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 },
        "1": { id: 1, t: 20, X: 100, Y: 100, l: 1 },
      },
      buildinghealthdata: { "1": 1 },
    });
    const repair = shopModel(damaged).repair;
    expect(repair).toMatchObject({ count: 1, blocked: null });
    expect(repair!.price).toBeGreaterThanOrEqual(0);
  });
});
