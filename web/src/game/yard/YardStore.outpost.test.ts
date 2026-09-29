import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { BuildCategory, buildOffers } from "./buildCatalogue";
import { maxLevel, OUTPOST_CORE_TYPE } from "./buildingCosts";
import { MAIN_YARD, outpostTarget } from "./ownYards";
import { YardStore } from "./YardStore";

/**
 * The store over an outpost (outposts WP5, #146): every request names the
 * outpost, the main yard's `state` is never asked for, and the yard reads the
 * outpost's props table and its one worker.
 */

const T0 = 1_000_000;
const OUTPOST = "2000242209";
const RICH = { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 };

/** An outpost's own-yard load: the core, a cannon and a laser at the outpost cap. */
const outpostLoad = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 7,
    baseid: OUTPOST,
    basesaveid: 7,
    type: "outpost",
    worldsize: [800, 800],
    currenttime: T0,
    savetime: T0,
    resources: RICH,
    credits: 100,
    outposts: [[242, 209, OUTPOST]],
    buildingdata: {
      "1": { X: 0, Y: -50, t: OUTPOST_CORE_TYPE, id: 1, l: 1 },
      "2": { X: 100, Y: 0, t: 20, id: 2, l: 1 },
      "3": { X: 200, Y: 0, t: 23, id: 3, l: maxLevel(23, "outpost") },
    },
    // Bought workers count in the main yard only.
    storedata: { BEW: { q: 3 } },
  }) as BaseLoadResponse;

const answer = (): YardResponse<null> =>
  ({
    error: 0,
    savetime: T0,
    currenttime: T0,
    resources: RICH,
    credits: 100,
    caps: { r1: 5e9, r2: 5e9, r3: 5e9, r4: 5e9 },
    workers: { total: 1, busy: 0 },
    buildingdata: outpostLoad().buildingdata,
    completed: [],
    report: null,
  }) as unknown as YardResponse<null>;

/** Every yard call answering with the outpost as it stands. */
const stubApi = () => {
  const reply = vi.fn((..._args: unknown[]) => Promise.resolve(answer()));
  return {
    state: reply,
    upgrade: vi.fn((..._args: unknown[]) => Promise.resolve(answer())),
    cancelUpgrade: reply,
    instantUpgrade: vi.fn((..._args: unknown[]) => Promise.resolve(answer())),
    speedUp: reply,
    shopBuy: vi.fn((..._args: unknown[]) => Promise.resolve(answer())),
    pickMushroom: reply,
  };
};

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const outpostStore = (api: ReturnType<typeof stubApi>) =>
  new YardStore({
    save: outpostLoad(),
    target: outpostTarget(OUTPOST, { col: 242, row: 209 }),
    api: api as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });

describe("YardStore over an outpost", () => {
  it("asks for the outpost's state, never the main yard's", async () => {
    const api = stubApi();
    const store = outpostStore(api);
    // The load carried no caps, so starting asks for the state once.
    store.start();
    await flush();
    store.mergeWrite({ resources: RICH });
    await flush();
    await store.refresh();

    expect(api.state.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of api.state.mock.calls) expect(call).toEqual([OUTPOST]);
    // The answer was merged over the outpost, not swapped for the main yard.
    expect(store.save.type).toBe("outpost");
    expect(store.save.baseid).toBe(OUTPOST);
  });

  it("names the outpost on every action", async () => {
    const api = stubApi();
    const store = outpostStore(api);
    await store.upgrade(2);
    await store.instantUpgrade(2);
    await store.buy("BST");

    expect(api.upgrade.mock.calls).toEqual([[2, OUTPOST]]);
    expect(api.instantUpgrade.mock.calls).toEqual([[2, OUTPOST]]);
    expect(api.shopBuy.mock.calls).toEqual([["BST", OUTPOST]]);
    expect(store.baseid).toBe(OUTPOST);
  });

  it("sends no baseid at all from the main yard", async () => {
    const api = stubApi();
    const store = new YardStore({
      save: { ...outpostLoad(), type: "main" },
      target: MAIN_YARD,
      api: api as unknown as YardApi,
      clock: () => T0,
      timers: { set: () => 0, clear: () => undefined },
    });
    store.start();
    await flush();
    await store.upgrade(2);

    expect(api.state.mock.calls).toEqual([[]]);
    expect(api.upgrade.mock.calls).toEqual([[2]]);
    expect(store.baseid).toBeUndefined();
    expect(store.kind).toBe("main");
  });

  it("has one worker, whatever the outpost's store data says", () => {
    const store = outpostStore(stubApi());
    expect(store.kind).toBe("outpost");
    expect(store.yard.kind).toBe("outpost");
    expect(store.workers.total).toBe(1);
  });

  it("builds from the outpost's menu and limits", () => {
    const store = outpostStore(stubApi());
    // No Storage Silo in an outpost.
    expect(buildOffers(BuildCategory.RESOURCES, store).map((offer) => offer.type)).toEqual([1, 2, 3, 4]);
    const cannon = buildOffers(BuildCategory.DEFENSIVE, store).find((offer) => offer.type === 20);
    // The core counts as the hall, and the outpost table allows four cannons.
    expect(cannon?.allowed).toBe(4);
    expect(cannon?.owned).toBe(1);
    expect(cannon?.gate).toBeNull();
  });

  it("refuses, before sending, an upgrade past the outpost's level cap", async () => {
    expect(maxLevel(23, "outpost")).toBeLessThan(maxLevel(23));
    const api = stubApi();
    const store = outpostStore(api);
    const result = await store.upgrade(3);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("maxLevel");
    expect(api.upgrade).not.toHaveBeenCalled();
  });
});
