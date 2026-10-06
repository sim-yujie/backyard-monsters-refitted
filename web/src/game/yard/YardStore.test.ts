import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { BaseLoadResponse, BuildingDataMap, YardResponse, YardState } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { housingSummary } from "@/game/monsters/housing";
import { housingSpace } from "@/game/monsters/monsterCatalogue";
import {
  YardChangeReason,
  YardStore,
  type YardActionResult,
  type YardChange,
} from "./YardStore";

/**
 * The store's contract (`docs/design/yard-buildings.md` §2.1 "The client
 * side", §2.4, WP1.4 tests): a finished job flips the display and brings one
 * coalesced `state` call a second later; the queue never has two requests in
 * flight; a queued action re-checks its preconditions against the answer
 * ahead of it.
 */

const T0 = 1_000_000;

/** A Town Hall at 3 and a Cannon Tower at 2, plenty of everything, one worker. */
const baseBuildings = (): BuildingDataMap => ({
  "1": { X: 0, Y: 0, t: 14, id: 1, l: 3 },
  "2": { X: 100, Y: 0, t: 20, id: 2, l: 2 },
  "3": { X: 200, Y: 0, t: 20, id: 3, l: 2 },
});

const RICH = { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 };

const loadWith = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: T0,
    savetime: T0,
    resources: RICH,
    credits: 100,
    buildingdata: baseBuildings(),
    storedata: {},
    ...extra,
  }) as BaseLoadResponse;

/** A server answer: the given slices over a default state at `now`. */
const answer = <R>(
  now: number,
  slices: Partial<YardState> = {},
  report: R = null as R,
  completed: YardResponse<R>["completed"] = [],
): YardResponse<R> =>
  ({
    error: 0,
    savetime: now,
    currenttime: now,
    resources: RICH,
    credits: 100,
    caps: { r1: 5e9, r2: 5e9, r3: 5e9, r4: 5e9 },
    workers: { total: 1, busy: 0 },
    buildingdata: baseBuildings(),
    buildinghealthdata: {},
    storedata: {},
    monsters: {},
    lockerdata: {},
    academy: {},
    champion: [],
    mushrooms: {},
    researchdata: {},
    ...slices,
    completed,
    report,
  }) as YardResponse<R>;

/** A promise the test settles by hand. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

/** Lets every settled promise run its continuations. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A clock and timers the test moves by hand. */
const manualTime = () => {
  let now = T0;
  const timers: { at: number; fn: () => void; handle: number }[] = [];
  let next = 1;
  return {
    clock: () => now,
    timers: {
      set: (fn: () => void, ms: number) => {
        const handle = next++;
        timers.push({ at: now + ms / 1000, fn, handle });
        return handle;
      },
      clear: (handle: unknown) => {
        const index = timers.findIndex((timer) => timer.handle === handle);
        if (index >= 0) timers.splice(index, 1);
      },
    },
    /** Moves the clock and fires every timer now due. */
    advance(seconds: number) {
      now += seconds;
      for (const timer of timers.filter((one) => one.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    },
    pending: () => timers.length,
  };
};

const stubApi = (
  overrides: Partial<Record<keyof YardApi, (...args: never[]) => unknown>> = {},
) =>
  ({
    state: vi.fn(() => Promise.resolve(answer(T0))),
    upgrade: vi.fn(),
    cancelUpgrade: vi.fn(),
    instantUpgrade: vi.fn(),
    speedUp: vi.fn(),
    shopBuy: vi.fn(),
    ...overrides,
  }) as unknown as YardApi & { [K in keyof YardApi]: ReturnType<typeof vi.fn> };

const storeWith = (
  save: BaseLoadResponse,
  api: YardApi,
  time = manualTime(),
  away: YardChange["completed"] = [],
) => {
  const store = new YardStore({ save, api, clock: time.clock, timers: time.timers, away });
  // Every change but `pending`, which only says which buttons to disable.
  const changes: YardChange[] = [];
  store.subscribe((change) => {
    if (change.reason !== YardChangeReason.PENDING) changes.push(change);
  });
  return { store, changes, time };
};

describe("finishing jobs", () => {
  it("flips the display at once and sends one coalesced state call a second later", async () => {
    const save = loadWith({
      buildingdata: {
        ...baseBuildings(),
        "2": { X: 100, Y: 0, t: 20, id: 2, l: 2, cU: 5 },
        "3": { X: 200, Y: 0, t: 20, id: 3, l: 2, cU: 5 },
      },
    });
    const api = stubApi({ state: vi.fn(() => Promise.resolve(answer(T0 + 6))) });
    const { store, changes, time } = storeWith(save, api);
    expect(store.workers.busy).toBe(2);

    time.advance(4);
    store.tick();
    expect(changes).toHaveLength(0);

    time.advance(1);
    store.tick();
    // Both towers are drawn at level 3 and both workers are free, before any request.
    expect(store.building(2)?.level).toBe(3);
    expect(store.building(3)?.level).toBe(3);
    expect(store.workers.busy).toBe(0);
    expect(changes.at(-1)).toMatchObject({ reason: YardChangeReason.PREDICTED });
    expect(changes.at(-1)?.predicted.map((job) => job.key)).toEqual(["upgrade:2", "upgrade:3"]);
    expect(api.state).not.toHaveBeenCalled();

    // Further ticks in the same second add nothing.
    store.tick();
    time.advance(0.5);
    store.tick();
    expect(api.state).not.toHaveBeenCalled();

    time.advance(0.5);
    await flush();
    expect(api.state).toHaveBeenCalledTimes(1);
    expect(changes.at(-1)).toMatchObject({ reason: YardChangeReason.REFRESH });
    expect(store.save.savetime).toBe(T0 + 6);
    expect(store.caps).toEqual({ r1: 5e9, r2: 5e9, r3: 5e9, r4: 5e9 });
  });

  /** A hatchery (id 5) with a Pokey 5 s from housing, and whatever `buildings` adds. */
  const hatching = (buildings: Record<string, unknown> = {}) =>
    loadWith({
      buildingdata: { ...baseBuildings(), "5": { X: 300, Y: 0, t: 13, id: 5, l: 1 }, ...buildings },
      monsters: { h: [["C1", 5]], hid: [5], hstage: [1], saved: T0, housed: {} },
    } as Partial<BaseLoadResponse>);

  it("asks for a hatch's housing, batching hatches over 10 s (#142)", async () => {
    const api = stubApi({ state: vi.fn(() => Promise.resolve(answer(T0 + 15))) });
    const { store, changes, time } = storeWith(hatching(), api);

    time.advance(5);
    store.tick();
    expect(changes.at(-1)).toMatchObject({ reason: YardChangeReason.PREDICTED });
    time.advance(9);
    await flush();
    expect(api.state).not.toHaveBeenCalled();
    time.advance(1);
    await flush();
    expect(api.state).toHaveBeenCalledTimes(1);
  });

  it("houses a predicted hatch at once, before the server answers (#272)", () => {
    const api = stubApi({ state: vi.fn(() => Promise.resolve(answer(T0 + 15))) });
    const { store, changes, time } = storeWith(
      hatching({ "6": { X: 500, Y: 0, t: 15, id: 6, l: 1 } }),
      api,
    );
    time.advance(5);
    store.tick();
    expect(store.save.monsters?.housed?.["C1"]).toBe(1);
    expect(housingSummary(store.save, store.now()).used).toBe(housingSpace("C1", 1));
    expect(changes.at(-1)?.hatched).toEqual([{ hatchery: 5, monster: "C1", housed: true }]);
    expect(api.state).not.toHaveBeenCalled();
  });

  it("stalls a predicted hatch with no Housing to take it (#272)", () => {
    const { store, changes, time } = storeWith(hatching(), stubApi());
    time.advance(5);
    store.tick();
    expect(store.save.monsters?.housed?.["C1"]).toBeUndefined();
    expect(changes.at(-1)?.hatched).toEqual([{ hatchery: 5, monster: "C1", housed: false }]);
  });

  it("pulls a waiting hatch refresh in when an upgrade ends meanwhile (#142)", async () => {
    const api = stubApi({ state: vi.fn(() => Promise.resolve(answer(T0 + 13))) });
    const { store, time } = storeWith(
      hatching({ "2": { X: 100, Y: 0, t: 20, id: 2, l: 2, cU: 8 } }),
      api,
    );

    time.advance(5);
    store.tick();
    time.advance(3);
    store.tick();
    time.advance(1);
    await flush();
    expect(api.state).toHaveBeenCalledTimes(1);
    time.advance(10);
    await flush();
    expect(api.state).toHaveBeenCalledTimes(1);
  });

  it("never asks twice for a job the server left unfinished", async () => {
    // The answer still carries the countdown (a server that did not complete it).
    const running = { X: 100, Y: 0, t: 20, id: 2, l: 2, cU: 5 };
    const save = loadWith({ buildingdata: { ...baseBuildings(), "2": running } });
    const api = stubApi({
      state: vi.fn(() =>
        Promise.resolve(
          answer(T0 + 6, { savetime: T0, buildingdata: { ...baseBuildings(), "2": running } }),
        ),
      ),
    });
    const { store, time } = storeWith(save, api);

    time.advance(5);
    store.tick();
    time.advance(1);
    await flush();
    expect(api.state).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      time.advance(1);
      store.tick();
      await flush();
    }
    expect(api.state).toHaveBeenCalledTimes(1);
  });

  it("does not predict a paused countdown or a kind the server does not complete yet", async () => {
    const save = loadWith({
      buildingdata: {
        ...baseBuildings(),
        "2": { X: 100, Y: 0, t: 20, id: 2, l: 2, cU: 5, hp: 10 },
      },
      // Champion hunger: the server does not complete it until Phase 5.
      champion: [{ t: 1, hp: 100, l: 1, fd: 0, fb: 0, pl: 0, status: 0, ft: T0 + 5 - 24 * 60 * 60 }],
    });
    const api = stubApi();
    const { store, changes, time } = storeWith(save, api);
    time.advance(10);
    store.tick();
    time.advance(2);
    await flush();
    expect(changes).toHaveLength(0);
    expect(api.state).not.toHaveBeenCalled();
  });

  it("sends nothing while harvesters fill, cycle after cycle and past full (owner 2026-09-28)", async () => {
    // Two Twig Snappers mid-cycle and a Goo Factory: the per-second tick runs
    // through many harvest cycles and past both buffers filling up. Collect
    // all's total grows, but only a press, a tap or a real job asks the server.
    const save = loadWith({
      caps: { r1: 1, r2: 1, r3: 1, r4: 1 },
      buildingdata: {
        ...baseBuildings(),
        "4": { X: 300, Y: 0, t: 1, id: 4, l: 1, st: 0, pr: 1, cP: 3 },
        "5": { X: 400, Y: 0, t: 1, id: 5, l: 2, st: 100, pr: 1, cP: 30 },
        "6": { X: 500, Y: 0, t: 4, id: 6, l: 1, st: 0, pr: 1, cP: 1 },
      },
    });
    const api = stubApi();
    const { store, changes, time } = storeWith(save, api);
    store.start();
    expect(store.jobs().filter((job) => job.kind === "harvest")).toHaveLength(3);
    const lastFull = Math.max(
      ...store.jobs().filter((job) => job.kind === "harvest").map((job) => job.endsAt ?? 0),
    );

    for (let second = 0; second <= lastFull - T0 + 60; second++) {
      time.advance(1);
      store.tick();
    }
    await flush();

    for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
    expect(changes).toHaveLength(0);
  });

  it("treats jobs already over at load as the server's to have finished", async () => {
    // A load answered at T0 with a buff that ran out before it: the server
    // had its chance, so the client does not ask again.
    const save = loadWith({ storedata: { XYZ: { e: T0 - 100 } } });
    const api = stubApi();
    const { store, time } = storeWith(save, api);
    time.advance(1);
    store.tick();
    time.advance(2);
    await flush();
    expect(api.state).not.toHaveBeenCalled();
  });
});

describe("the action queue", () => {
  it("never has two requests in flight", async () => {
    const answers = [deferred<YardResponse<unknown>>(), deferred<YardResponse<unknown>>()];
    let inFlight = 0;
    let most = 0;
    const track = (index: number) => () => {
      inFlight++;
      most = Math.max(most, inFlight);
      return answers[index]!.promise.finally(() => inFlight--);
    };
    const api = stubApi({
      upgrade: vi.fn(track(0)),
      shopBuy: vi.fn(track(1)),
      state: vi.fn(() => {
        inFlight++;
        most = Math.max(most, inFlight);
        return Promise.resolve(answer(T0)).finally(() => inFlight--);
      }),
    });
    const { store } = storeWith(loadWith(), api);

    const first = store.upgrade(2);
    const second = store.buy("BST");
    const third = store.refresh();
    await flush();
    expect(api.upgrade).toHaveBeenCalledTimes(1);
    expect(api.shopBuy).not.toHaveBeenCalled();
    expect(store.busy).toBe(true);
    expect(store.isRunning("upgrade:2")).toBe(true);
    expect(store.isRunning("buy:BST")).toBe(true);

    answers[0]!.resolve(
      answer(
        T0,
        {
          buildingdata: {
            ...baseBuildings(),
            "2": { X: 100, Y: 0, t: 20, id: 2, l: 2, cU: 900 },
          },
        },
        {
          id: 2,
          from: 2,
          to: 3,
          seconds: 900,
          cost: { r1: 1, r2: 1, r3: 1, r4: 0 },
        },
      ),
    );
    await flush();
    expect(api.shopBuy).toHaveBeenCalledTimes(1);
    expect(store.isRunning("upgrade:2")).toBe(false);

    answers[1]!.resolve(
      answer(T0, {}, { item: "BST", credits: 225, q: 1, endsAt: T0 + 604_800 }),
    );
    await flush();

    expect(await first).toMatchObject({ ok: true, report: { id: 2, to: 3 } });
    expect(await second).toMatchObject({ ok: true, report: { item: "BST" } });
    // The refresh was queued before the upgrade's answer, but a request sent
    // after it asked (the shop buy) has answered since: no state call needed.
    expect(await third).toEqual({ ok: true, report: null, completed: [] });
    expect(api.state).not.toHaveBeenCalled();
    expect(most).toBe(1);
    expect(store.busy).toBe(false);
  });

  it("re-checks a queued click against the answer ahead of it", async () => {
    const pending = deferred<YardResponse<unknown>>();
    const api = stubApi({ upgrade: vi.fn(() => pending.promise) });
    const { store } = storeWith(loadWith(), api);

    const first = store.upgrade(2);
    const again = store.upgrade(2);
    await flush();
    expect(api.upgrade).toHaveBeenCalledTimes(1);

    pending.resolve(
      answer(T0, {
        buildingdata: {
          ...baseBuildings(),
          "2": { X: 100, Y: 0, t: 20, id: 2, l: 2, cU: 900 },
        },
      }),
    );
    await flush();

    expect(await first).toMatchObject({ ok: true });
    expect(await again).toMatchObject({ ok: false, refusal: { reason: "busy", local: true } });
    expect(api.upgrade).toHaveBeenCalledTimes(1);
  });

  it("refuses an upgrade locally when the only worker is taken by the answer ahead", async () => {
    const pending = deferred<YardResponse<unknown>>();
    const api = stubApi({ upgrade: vi.fn(() => pending.promise) });
    const { store } = storeWith(loadWith(), api);

    void store.upgrade(2);
    const other = store.upgrade(3);
    pending.resolve(
      answer(T0, {
        buildingdata: {
          ...baseBuildings(),
          "2": { X: 100, Y: 0, t: 20, id: 2, l: 2, cU: 900 },
        },
      }),
    );
    expect(await other).toMatchObject({
      ok: false,
      refusal: { reason: "workers", detail: { workers: { total: 1, busy: 1 } } },
    });
    expect(api.upgrade).toHaveBeenCalledTimes(1);
  });

  it("refuses a five-minute step locally when no worker is free: it holds one too (#137)", async () => {
    const api = stubApi();
    const { store } = storeWith(
      loadWith({
        buildingdata: {
          ...baseBuildings(),
          "2": { X: 100, Y: 0, t: 20, id: 2, l: 2, cU: 900 },
          "7": { X: 600, Y: 0, t: 1, id: 7, l: 1 },
        },
      }),
      api,
    );
    // Twig Snapper L1 → L2 is 300 s; the only worker is on the Cannon Tower.
    expect(await store.upgrade(7)).toMatchObject({
      ok: false,
      refusal: { reason: "workers", local: true },
    });
    expect(api.upgrade).not.toHaveBeenCalled();
  });

  it("refuses locally what the yard it holds already rules out, sending nothing", async () => {
    const api = stubApi();
    const { store } = storeWith(
      loadWith({
        buildingdata: {
          ...baseBuildings(),
          "4": { X: 300, Y: 0, t: 11, id: 4, l: 1 },
          "5": { X: 400, Y: 0, t: 20, id: 5, l: 2, cU: 600, hp: 10 },
          "6": { X: 500, Y: 0, t: 17, id: 6, l: 1 },
        },
      }),
      api,
    );
    const reasonOf = async (pending: Promise<YardActionResult<unknown>>) => {
      const result = await pending;
      return result.ok ? "ok" : result.refusal.reason;
    };
    // The Map Room takes a plain upgrade (D16) but no Shiny.
    expect(await reasonOf(store.instantUpgrade(4))).toBe("mapRoom");
    expect(await reasonOf(store.upgrade(5))).toBe("busy");
    expect(await reasonOf(store.upgrade(6))).toBe("useBatchRoute");
    expect(await reasonOf(store.upgrade(99))).toBe("badRequest");
    expect(await reasonOf(store.speedUp(2, "SP4"))).toBe("notRunning");
    expect(await reasonOf(store.speedUp(5, "SP4"))).toBe("damaged");
    expect(await reasonOf(store.cancelUpgrade(2))).toBe("notUpgrading");
    expect(api.upgrade).not.toHaveBeenCalled();
    expect(api.instantUpgrade).not.toHaveBeenCalled();
    expect(api.speedUp).not.toHaveBeenCalled();
    expect(api.cancelUpgrade).not.toHaveBeenCalled();
  });

  it("reports a server refusal and fetches the state it was refused against", async () => {
    const refused = new ApiError("You do not have enough resources for that.", {
      status: 409,
      code: "You do not have enough resources for that.",
      body: {
        error: "You do not have enough resources for that.",
        reason: "shortfall",
        shortfall: { r1: 10, r2: 0, r3: 0, r4: 0 },
      },
    });
    const api = stubApi({ upgrade: vi.fn(() => Promise.reject(refused)) });
    const { store } = storeWith(loadWith(), api);

    const result = await store.upgrade(2);
    expect(result).toEqual({
      ok: false,
      refusal: {
        reason: "shortfall",
        message: "You do not have enough resources for that.",
        detail: { shortfall: { r1: 10, r2: 0, r3: 0, r4: 0 } },
        status: 409,
      },
    });
    await flush();
    expect(api.state).toHaveBeenCalledTimes(1);
  });

  it("hands an auth failure to the scene", async () => {
    const onAuthFailure = vi.fn();
    const api = stubApi({
      state: vi.fn(() => Promise.reject(new ApiError("Unauthorized", { status: 401 }))),
    });
    const time = manualTime();
    const store = new YardStore({
      save: loadWith(),
      api,
      clock: time.clock,
      timers: time.timers,
      onAuthFailure,
    });
    expect(await store.refresh()).toMatchObject({ ok: false, refusal: { reason: "auth" } });
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("hands an under-attack refusal to the scene, with the server's sentence, and fetches nothing (#275)", async () => {
    const message = "Your yard is under attack right now. Try again when the attack is over.";
    const refused = () =>
      Promise.reject(
        new ApiError(message, { status: 409, code: message, body: { error: message, reason: "underAttack" } }),
      );
    const onUnderAttack = vi.fn();
    const api = stubApi({ upgrade: vi.fn(refused), state: vi.fn(refused) });
    const time = manualTime();
    const store = new YardStore({ save: loadWith(), api, clock: time.clock, timers: time.timers, onUnderAttack });

    expect(await store.upgrade(2)).toMatchObject({ ok: false, refusal: { reason: "underAttack", message } });
    await flush();
    expect(onUnderAttack).toHaveBeenCalledTimes(1);
    // A yard under attack answers nothing: no state call after the refusal.
    expect(api.state).not.toHaveBeenCalled();

    expect(await store.refresh()).toMatchObject({ ok: false, refusal: { reason: "underAttack" } });
    expect(onUnderAttack).toHaveBeenCalledTimes(2);
  });

  it("hands a raid-fight refusal to the scene, with the server's sentence, and fetches nothing (#309)", async () => {
    const message = "Wild monsters are raiding your yard right now. Try again when the raid is over.";
    const refused = () =>
      Promise.reject(
        new ApiError(message, { status: 409, code: message, body: { error: message, reason: "raidInProgress" } }),
      );
    const onRaidInProgress = vi.fn();
    const onUnderAttack = vi.fn();
    const api = stubApi({ upgrade: vi.fn(refused), state: vi.fn(refused) });
    const time = manualTime();
    const store = new YardStore({
      save: loadWith(),
      api,
      clock: time.clock,
      timers: time.timers,
      onRaidInProgress,
      onUnderAttack,
    });

    expect(await store.upgrade(2)).toMatchObject({ ok: false, refusal: { reason: "raidInProgress", message } });
    await flush();
    expect(onRaidInProgress).toHaveBeenCalledExactlyOnceWith(message);
    // The yard is frozen for the fight: no state call that would be refused too.
    expect(api.state).not.toHaveBeenCalled();
    // A raid is not a player's attack: the yard is not locked as one.
    expect(onUnderAttack).not.toHaveBeenCalled();
  });

  it("shares one queued refresh between callers", async () => {
    const pending = deferred<YardResponse<unknown>>();
    const api = stubApi({ upgrade: vi.fn(() => pending.promise) });
    const { store } = storeWith(loadWith(), api);

    void store.upgrade(2);
    const a = store.refresh();
    const b = store.refresh();
    expect(a).toBe(b);
    pending.reject(new ApiError("boom", { status: 500 }));
    await flush();
    await a;
    expect(api.state).toHaveBeenCalledTimes(1);
  });

  it("announces what the server finished, for the job notices", async () => {
    const completed = [
      {
        kind: "upgrade" as const,
        id: 2,
        t: 20,
        at: T0 - 1,
        detail: { from: 2, level: 3, points: 10 },
      },
    ];
    const api = stubApi({
      state: vi.fn(() => Promise.resolve(answer(T0, {}, null, completed))),
    });
    const { store, changes } = storeWith(loadWith(), api);
    const result = await store.refresh();
    expect(result).toEqual({ ok: true, report: null, completed });
    expect(
      changes.find((change) => change.reason === YardChangeReason.REFRESH)?.completed,
    ).toEqual(completed);
  });
});

describe("the player level (#192)", () => {
  it("reads the load's level and takes each answer's, keeping it when an answer has none", async () => {
    let next: number | undefined = 5;
    const api = stubApi({
      state: vi.fn(() => Promise.resolve({ ...answer(T0), ...(next !== undefined && { playerlevel: next }) })),
    });
    const { store } = storeWith(loadWith({ playerlevel: 4 }), api);
    expect(store.playerLevel).toBe(4);
    await store.refresh();
    expect(store.playerLevel).toBe(5);
    next = undefined;
    await store.refresh();
    expect(store.playerLevel).toBe(5);
  });

  it("is null when the server sent none", () => {
    expect(storeWith(loadWith(), stubApi()).store.playerLevel).toBeNull();
  });
});

describe("the notification count (#257)", () => {
  it("reads the load's count and takes each answer's, keeping it when an answer has none", async () => {
    let next: number | undefined = 3;
    const api = stubApi({
      state: vi.fn(() => Promise.resolve({ ...answer(T0), ...(next !== undefined && { notifications: next }) })),
    });
    const { store } = storeWith(loadWith({ notifications: 1 }), api);
    expect(store.save.notifications).toBe(1);
    await store.refresh();
    expect(store.save.notifications).toBe(3);
    next = undefined;
    await store.refresh();
    expect(store.save.notifications).toBe(3);
  });
});

describe("lifecycle", () => {
  it("fetches the state once at start when the load carried no caps", async () => {
    const api = stubApi();
    const { store } = storeWith(loadWith(), api);
    store.start();
    await flush();
    expect(api.state).toHaveBeenCalledTimes(1);

    const withCaps = stubApi();
    storeWith(loadWith({ caps: { r1: 1, r2: 1, r3: 1, r4: 1 } }), withCaps).store.start();
    await flush();
    expect(withCaps.state).not.toHaveBeenCalled();
  });

  it("announces what the load finished while the player was away, once, at start (#135)", async () => {
    const away = [
      {
        kind: "upgrade" as const,
        id: 2,
        t: 20,
        at: T0 - 3600,
        detail: { from: 1, level: 2, points: 10 },
      },
    ];
    const api = stubApi();
    const { store, changes } = storeWith(loadWith({ completed: away }), api, manualTime(), away);
    expect(changes).toEqual([]);

    store.start();
    expect(changes[0]).toEqual({ reason: YardChangeReason.AWAY, completed: away, predicted: [] });
    await flush();
    // The state call that follows found nothing new: the load had written it.
    expect(api.state).toHaveBeenCalledTimes(1);
    expect(changes.filter((change) => change.reason === YardChangeReason.AWAY)).toHaveLength(1);
    expect(changes[1]).toMatchObject({ reason: YardChangeReason.REFRESH, completed: [] });

    store.start();
    await flush();
    expect(changes.filter((change) => change.reason === YardChangeReason.AWAY)).toHaveLength(1);
  });

  it("announces nothing at start when nothing finished while the player was away", () => {
    const { store, changes } = storeWith(loadWith(), stubApi(), manualTime(), []);
    store.start();
    expect(changes.filter((change) => change.reason === YardChangeReason.AWAY)).toEqual([]);
  });

  it("merges a planner write with savetime at the server's now, then fetches the state", async () => {
    const api = stubApi({ state: vi.fn(() => Promise.resolve(answer(T0 + 10))) });
    const time = manualTime();
    const { store, changes } = storeWith(loadWith(), api, time);
    time.advance(10);

    const buildingdata = {
      ...baseBuildings(),
      "2": { X: 500, Y: 0, t: 20, id: 2, l: 2, cU: 60 },
    };
    store.mergeWrite({ buildingdata, resources: { r1: 5 } });
    expect(changes[0]).toMatchObject({ reason: YardChangeReason.MERGE });
    expect(store.save.buildingdata).toBe(buildingdata);
    expect(store.save.savetime).toBe(T0 + 10);
    expect(store.building(2)?.countdown?.endsAt).toBe(T0 + 70);
    await flush();
    expect(api.state).toHaveBeenCalledTimes(1);
  });

  it("stops scheduling and ignores late answers once destroyed", async () => {
    const pending = deferred<YardResponse<unknown>>();
    const api = stubApi({ state: vi.fn(() => pending.promise) });
    const { store, changes, time } = storeWith(
      loadWith({
        buildingdata: { ...baseBuildings(), "2": { X: 100, Y: 0, t: 20, id: 2, l: 2, cU: 1 } },
      }),
      api,
    );
    const request = store.refresh();
    store.destroy();
    pending.resolve(answer(T0 + 5));
    expect(await request).toMatchObject({ ok: false });
    time.advance(5);
    store.tick();
    expect(changes).toHaveLength(0);
    expect(time.pending()).toBe(0);
  });
});
