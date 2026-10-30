import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { INFERNO_SHOP_ITEMS, SHOP_ITEMS, shopItemsFor, shopModel, wallOffers, type ShopOffer } from "./shop";
import { YardStore } from "./YardStore";

/**
 * The Shop's rows (§8.2): the next step's price, running and sold-out items,
 * the Locker and Hatchery Overdrive gates, the outpost list and Repair
 * everything now.
 */

const T0 = 2_000_000;

const never = <R>() => new Promise<R>(() => undefined);

const storeOf = (extra: Partial<BaseLoadResponse> = {}, kind: "main" | "outpost" | "inferno" = "main"): YardStore =>
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
    ...(kind === "main" ? {} : { target: { baseid: "9", kind } as const }),
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

  it("protection is always on sale, and the model says when the current protection ends", () => {
    const store = storeOf({
      protected: T0 + 3_600,
      storedata: { PRO2: { q: 1, s: T0 - 60, e: T0 + 3_600 } },
    });

    expect(offer(store, "PRO2").state).toEqual({ kind: "buy", price: 250, blocked: null });
    expect(shopModel(store).protectedUntil).toBe(T0 + 3_600);
    expect(shopModel(storeOf({ protected: T0 })).protectedUntil).toBeNull();
    expect(shopModel(storeOf()).protectedUntil).toBeNull();
  });

  it("an outpost sells only its own list", () => {
    expect(shopItemsFor("outpost").map((one) => one.item)).toEqual(["BST", "POD", "HOD", "HOD2", "HOD3", "EXH", "TOD"]);
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

describe("wallOffers", () => {
  const blocks = (hall: number, levels: (number | { t?: number; l?: number; cB?: number })[]) => ({
    buildingdata: {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: hall },
      ...Object.fromEntries(
        levels.map((one, i) => [
          String(10 + i),
          { id: 10 + i, t: 17, X: i * 20, Y: 0, ...(typeof one === "number" ? { l: one } : one) },
        ]),
      ),
    },
  });

  it("prices every Block below the tier, 3 / 6 / 10 / 15 per level climbed", () => {
    const [stone, metal, gold, black] = wallOffers(storeOf({ ...blocks(6, [1, 2, 3, 4, 5]), credits: 10_000 }));

    expect(stone).toMatchObject({ blocks: 1, state: { kind: "buy", price: 3, blocked: null } });
    expect(metal).toMatchObject({ blocks: 2, state: { kind: "buy", price: 9 + 6 } });
    // A level-1 Block to gold is 19.
    expect(gold).toMatchObject({ blocks: 3, state: { kind: "buy", price: 19 + 16 + 10 } });
    expect(black).toMatchObject({ blocks: 4, state: { kind: "buy", price: 34 + 31 + 25 + 15 } });
  });

  it("counts a Block being built as level 1 and a legacy Stone row as level 2", () => {
    const [stone, metal] = wallOffers(storeOf(blocks(6, [{ l: 1, cB: 50 }, { t: 18, l: 1 }])));

    expect(stone).toMatchObject({ blocks: 1, state: { kind: "buy", price: 3 } });
    expect(metal).toMatchObject({ blocks: 2, state: { kind: "buy", price: 9 + 6 } });
  });

  it("gates each tier on its Town Hall level in the main yard, then on Shiny", () => {
    const [stone, metal] = wallOffers(storeOf({ ...blocks(3, [1]), credits: 2 }));
    expect(stone!.state).toMatchObject({ blocked: "Not enough Shiny." });
    expect(metal!.state).toMatchObject({ blocked: "Needs Town Hall level 4." });
  });

  it("says when every Block has reached a tier, or there are none", () => {
    expect(wallOffers(storeOf(blocks(6, [3, 4])))[1]!.state).toEqual({ kind: "reached" });
    expect(wallOffers(storeOf(blocks(6, [])))[0]!.state).toEqual({ kind: "none" });
  });

  it("an outpost has no Town Hall gate", () => {
    const outpost = storeOf(
      {
        buildingdata: {
          "1": { id: 1, t: 112, X: 0, Y: 0, l: 1 },
          "2": { id: 2, t: 17, X: 50, Y: 50, l: 1 },
        },
      },
      "outpost",
    );
    expect(wallOffers(outpost)[3]).toMatchObject({ blocks: 1, state: { kind: "buy", price: 34, blocked: null } });
  });
});

describe("on the Inferno yard (WP 1.17 items)", () => {
  const inferno = (extra: Partial<BaseLoadResponse> = {}) => storeOf(extra, "inferno");

  it("sells Flash's Inferno store and the workers, nothing of the surface's own", () => {
    expect(shopItemsFor("inferno")).toBe(INFERNO_SHOP_ITEMS);
    const codes = shopModel(inferno()).offers.map((one) => one.item.item);
    expect(codes).toEqual([
      "BEW",
      "ENLI",
      "BIP",
      "HODI",
      "HOD2I",
      "HOD3I",
      "EXHI",
      "TODI",
      "PRO1",
      "PRO2",
      "PRO3",
    ]);
    // No Sharper Tools, Production Overdrive, Locker Overdrive or monster boosts.
    for (const surface of [
      "BST",
      "POD",
      "CLOD",
      "MOD",
      "MDOD",
      "MSOD",
      "ENL",
      "HOD",
      "TOD",
      "EXH",
    ]) {
      expect(codes).not.toContain(surface);
    }
  });

  it("reads the Inferno's own ladders: workers 250 to 2,000, More Yardage in five steps", () => {
    const store = inferno({ storedata: { BEW: { q: 1 }, ENLI: { q: 4 } } });
    expect(offer(store, "BEW")).toMatchObject({
      owned: 1,
      state: { kind: "buy", price: 500, blocked: null },
    });
    expect(offer(store, "ENLI")).toMatchObject({
      owned: 4,
      state: { kind: "buy", price: 250 },
    });
    const full = inferno({ storedata: { BEW: { q: 4 }, ENLI: { q: 5 } } });
    expect(offer(full, "BEW").state).toEqual({ kind: "soldOut" });
    expect(offer(full, "ENLI").state).toEqual({ kind: "soldOut" });
  });

  it("runs one of its three Hatchery Overdrives at a time", () => {
    const store = inferno({ storedata: { HOD2I: { e: T0 + 3_600 } } });
    expect(offer(store, "HOD2I").state).toEqual({ kind: "running", endsAt: T0 + 3_600 });
    expect(offer(store, "HODI").state).toMatchObject({
      blocked: "Another Hatchery Overdrive is running.",
    });
  });

  it("restarts Tower Overdrive while it runs, like the surface's", () => {
    const store = inferno({ storedata: { TODI: { e: T0 + 600 } } });
    expect(offer(store, "TODI").state).toEqual({
      kind: "buy",
      price: 600,
      blocked: null,
      endsAt: T0 + 600,
    });
  });

  it("sells Granite and Forged Steel behind Under Hall 3 and 4", () => {
    const yard = (hall: number) =>
      inferno({
        buildingdata: {
          "0": { id: 0, t: 14, X: 0, Y: 0, l: hall },
          "1": { id: 1, t: 17, X: 50, Y: 50, l: 1 },
        },
      });
    const [granite, steel, ...rest] = wallOffers(yard(3));
    expect(rest).toEqual([]);
    expect(granite).toMatchObject({
      tier: { item: "BLK2I", name: "Granite Blocks" },
      state: { price: 3, blocked: null },
    });
    expect(steel).toMatchObject({
      tier: { item: "BLK3I" },
      state: { price: 9, blocked: "Needs Under Hall level 4." },
    });
    expect(wallOffers(yard(4))[1]!.state).toEqual({ kind: "buy", price: 9, blocked: null });
  });
});
