import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { YardStore } from "@/game/yard/YardStore";
import {
  LockerKey,
  lockerActions,
  lockerCancel,
  lockerFinish,
  lockerInstant,
  lockerStart,
  type LockerApi,
} from "./yardMonsters";

/** The locker routes on the wire, and their trip through the store's queue. */

const sent: { url: string; body: URLSearchParams }[] = [];

const stubFetch = (status: number, payload: Record<string, unknown>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, body: new URLSearchParams(String(init.body ?? "")) });
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

describe("locker routes", () => {
  it("posts each action to its path with plain form fields", async () => {
    stubFetch(200, { error: 0, savetime: 1, currenttime: 1, completed: [], report: null });
    await lockerStart("C5");
    await lockerCancel();
    await lockerFinish();
    await lockerInstant("C16");
    expect(sent.map((call) => call.url.replace(/^.*\/bm\/yard/, ""))).toEqual([
      "/locker/start",
      "/locker/cancel",
      "/locker/finish",
      "/locker/instant",
    ]);
    expect(sent[0]!.body.get("monster")).toBe("C5");
    expect(sent[3]!.body.get("monster")).toBe("C16");
  });
});

const T0 = 2_000_000;

const building = (id: number, t: number, l: number): BuildingData => ({ id, t, l, X: id * 40, Y: 0 });

const loadOf = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 1e8, r4: 0 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: { "1": building(1, 14, 6), "2": building(2, 8, 2) },
    buildinghealthdata: {},
    storedata: {},
    lockerdata: {},
    ...extra,
  }) as unknown as BaseLoadResponse;

const answer = <R>(report: R, extra: Record<string, unknown> = {}): YardResponse<R> =>
  ({ error: 0, savetime: T0, currenttime: T0, completed: [], report, ...extra }) as unknown as YardResponse<R>;

const setup = (load: Partial<BaseLoadResponse> = {}) => {
  const yardApi = {
    state: vi.fn(() => Promise.resolve(answer(null))),
    shopBuy: vi.fn(() =>
      Promise.resolve(answer({ item: "CLOD", credits: 60, q: 1, endsAt: T0 + 14_400 })),
    ),
  } as unknown as YardApi & Record<"state" | "shopBuy", ReturnType<typeof vi.fn>>;
  const api = {
    start: vi.fn((monster: string) =>
      Promise.resolve(
        answer(
          { monster, endsAt: T0 + 100, cost: { r3: 64_000 } },
          { lockerdata: { [monster]: { t: 1, s: T0, e: T0 + 100 } } },
        ),
      ),
    ),
    cancel: vi.fn(() => Promise.resolve(answer({ monster: "C5", refund: { r3: 64_000 } }))),
    finish: vi.fn(() => Promise.resolve(answer({ monster: "C5", credits: 3 }))),
    instant: vi.fn((monster: string) => Promise.resolve(answer({ monster, credits: 100 }))),
  } satisfies LockerApi;
  const store = new YardStore({
    save: loadOf(load),
    api: yardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  return { store, api, yardApi, actions: lockerActions(store, api) };
};

describe("lockerActions", () => {
  it("sends a start the client can see is allowed, and merges the answer", async () => {
    const { store, api, actions } = setup();
    const result = await actions.start("C5");
    expect(api.start).toHaveBeenCalledWith("C5");
    expect(result).toMatchObject({ ok: true, report: { monster: "C5" } });
    expect(store.save.lockerdata?.["C5"]).toEqual({ t: 1, s: T0, e: T0 + 100 });
  });

  it("refuses locally, in the server's terms, what the state already says no to", async () => {
    const { api, actions } = setup();
    const locked = await actions.start("C9");
    expect(locked).toEqual({
      ok: false,
      refusal: {
        reason: "lockerLevel",
        message: "Needs Monster Locker level 3.",
        detail: { have: 2, need: 3 },
        local: true,
      },
    });
    const blocked = await actions.start("C18");
    expect(blocked.ok ? null : blocked.refusal.reason).toBe("badRequest");
    expect(api.start).not.toHaveBeenCalled();
  });

  it("re-checks a queued start against the answer ahead of it: one unlock at a time", async () => {
    const { api, actions } = setup();
    const first = actions.start("C5");
    const second = actions.start("C6");
    await first;
    const refused = await second;
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(refused.ok ? null : refused.refusal.reason).toBe("unlockRunning");
  });

  it("cancels and finishes only while something unlocks", async () => {
    const idle = setup();
    expect((await idle.actions.cancel()).ok).toBe(false);
    expect((await idle.actions.finish()).ok).toBe(false);
    expect(idle.api.cancel).not.toHaveBeenCalled();

    const busy = setup({ lockerdata: { C5: { t: 1, s: T0, e: T0 + 100 } } });
    expect((await busy.actions.cancel()).ok).toBe(true);
    expect((await busy.actions.finish()).ok).toBe(true);
  });

  it("instant needs no putty; the overdrive goes through the shop as CLOD", async () => {
    const { api, yardApi, actions } = setup({ resources: { r3: 0 } });
    expect((await actions.instant("C5")).ok).toBe(true);
    expect(api.instant).toHaveBeenCalledWith("C5");
    await actions.overdrive();
    expect(yardApi.shopBuy).toHaveBeenCalledWith("CLOD");
  });

  it("runs under one key per action", async () => {
    const { store, actions } = setup();
    const pending = actions.start("C5");
    expect(store.isRunning(LockerKey.START)).toBe(true);
    await pending;
    expect(store.isRunning(LockerKey.START)).toBe(false);
  });
});
