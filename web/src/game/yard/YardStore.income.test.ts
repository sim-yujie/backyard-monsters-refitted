import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, Resources, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { YardChangeReason, YardStore, type YardChange } from "./YardStore";

/**
 * The store's outpost income (#207): between answers the pool climbs by the
 * outposts' rate on every whole 10 s tick of the server's clock, as Flash's
 * resource bar did, and every answer puts the server's pool in its place.
 */

const T0 = 1_000_000;
const CAPS = { r1: 1e6, r2: 1e6, r3: 1e6, r4: 1e6 };
const POOL = { r1: 1000, r2: 1000, r3: 1000, r4: 1000 };

/** A main-yard load whose one outpost earns 10 twigs and 5 goo a tick, paid up to T0 − 3. */
const loadWith = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: T0,
    savetime: T0,
    resources: POOL,
    credits: 100,
    buildingdata: { "1": { X: 0, Y: 0, t: 14, id: 1, l: 3 } },
    storedata: {},
    buildingresources: { t: T0 - 3, b2000242209: { r1: 10, r2: 0, r3: 0, r4: 5 } },
    ...extra,
  }) as BaseLoadResponse;

const answer = (
  now: number,
  resources: Resources = POOL,
  caps = CAPS,
  extra: Partial<YardResponse<null>> = {},
): YardResponse<null> =>
  ({
    error: 0,
    savetime: now,
    currenttime: now,
    resources,
    credits: 100,
    caps,
    workers: { total: 1, busy: 0 },
    buildingdata: { "1": { X: 0, Y: 0, t: 14, id: 1, l: 3 } },
    buildinghealthdata: {},
    storedata: {},
    monsters: {},
    lockerdata: {},
    academy: {},
    champion: [],
    mushrooms: {},
    researchdata: {},
    completed: [],
    report: null,
    ...extra,
  }) as YardResponse<null>;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A store on a clock the test moves; `start()` has fetched the caps. */
const started = async (save = loadWith(), state = vi.fn(() => Promise.resolve(answer(T0)))) => {
  let now = T0;
  const api = { state } as unknown as YardApi;
  const store = new YardStore({
    save,
    api,
    clock: () => now,
    timers: { set: () => 0, clear: () => undefined },
  });
  const changes: YardChange[] = [];
  store.subscribe((change) => {
    if (change.reason !== YardChangeReason.PENDING) changes.push(change);
  });
  store.start();
  await flush();
  return {
    store,
    changes,
    /** Moves the clock and runs the scene's once-a-second tick. */
    at(seconds: number) {
      now = T0 + seconds;
      store.tick();
    },
  };
};

describe("outpost income between answers (#207)", () => {
  it("adds a tick on each 10 s boundary of the server's t, and says only the pool moved", async () => {
    const { store, changes, at } = await started();
    expect(store.resources.r1).toBe(1000);
    const before = changes.length;

    at(6);
    expect(store.resources.r1).toBe(1000);
    expect(changes).toHaveLength(before);

    at(7);
    expect(store.resources).toMatchObject({ r1: 1010, r2: 1000, r3: 1000, r4: 1005 });
    expect(changes.at(-1)).toMatchObject({ reason: YardChangeReason.INCOME, completed: [] });

    at(8);
    expect(changes).toHaveLength(before + 1);

    at(27);
    expect(store.resources.r1).toBe(1030);
    expect(store.yard.resources.r1).toBe(1030);
  });

  it("takes the server's pool from every answer and predicts on from where it paid", async () => {
    const state = vi.fn(() => Promise.resolve(answer(T0)));
    const { store, at } = await started(loadWith(), state);
    at(17);
    expect(store.resources.r1).toBe(1020);

    // The server paid the same two ticks by T0 + 20, and something spent 500 twigs.
    state.mockImplementation(() => Promise.resolve(answer(T0 + 20, { ...POOL, r1: 520, r4: 1010 })));
    at(20);
    await store.refresh();
    expect(store.resources.r1).toBe(520);

    at(26);
    expect(store.resources.r1).toBe(520);
    at(27);
    expect(store.resources).toMatchObject({ r1: 530, r4: 1015 });
  });

  it("fills to the cap and no further", async () => {
    const caps = { r1: 1015, r2: 1015, r3: 1015, r4: 1015 };
    const { store, at } = await started(loadWith(), vi.fn(() => Promise.resolve(answer(T0, POOL, caps))));
    at(37);
    expect(store.resources).toMatchObject({ r1: 1015, r4: 1015 });
  });

  it("counts Production Overdrive ticks twice", async () => {
    const storedata = { POD: { e: T0 + 10 } };
    const state = vi.fn(() => Promise.resolve(answer(T0, POOL, CAPS, { storedata })));
    const { store, at } = await started(loadWith({ storedata }), state);
    // Two ticks by T0 + 17, the first before the overdrive ends.
    at(17);
    expect(store.resources.r1).toBe(1030);
  });

  it("predicts nothing before the caps arrive", async () => {
    const pending = new Promise<YardResponse<null>>(() => undefined);
    const { store, changes, at } = await started(loadWith(), vi.fn(() => pending));
    at(47);
    expect(store.resources.r1).toBe(1000);
    expect(changes.some((change) => change.reason === YardChangeReason.INCOME)).toBe(false);
  });

  it("puts the ticks already due back on a Yard Planner write's pool", async () => {
    const { store, at } = await started();
    at(17);
    store.mergeWrite({ resources: { ...POOL, r1: 300 } });
    expect(store.resources.r1).toBe(320);
  });

  it("does nothing for a player with no outposts", async () => {
    const { store, changes, at } = await started(loadWith({ buildingresources: { t: T0 } }));
    at(100);
    expect(store.resources.r1).toBe(1000);
    expect(changes.some((change) => change.reason === YardChangeReason.INCOME)).toBe(false);
  });
});
