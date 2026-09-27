import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { YardStore } from "@/game/yard/YardStore";
import {
  HatcheryKey,
  hatcheryActions,
  hatcheryAdd,
  hatcheryFinish,
  hatcheryRemove,
  type HatcheryApi,
} from "./yardHatchery";

/** The hatchery routes on the wire, and their trip through the store's queue. */

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

describe("hatchery routes", () => {
  it("posts each action to its path with plain form fields, one request per batch", async () => {
    stubFetch(200, { error: 0, savetime: 1, currenttime: 1, completed: [], report: null });
    await hatcheryAdd(12, "C3", 80);
    await hatcheryRemove("hcc", 2, "all");
    await hatcheryRemove(12, 0, 1);
    await hatcheryFinish("hcc");
    expect(sent.map((call) => call.url.replace(/^.*\/bm\/yard/, ""))).toEqual([
      "/hatchery/add",
      "/hatchery/remove",
      "/hatchery/remove",
      "/hatchery/finish",
    ]);
    expect(Object.fromEntries(sent[0]!.body)).toEqual({ hatchery: "12", monster: "C3", count: "80" });
    expect(Object.fromEntries(sent[1]!.body)).toEqual({ hatchery: "hcc", slot: "2", count: "all" });
    expect(Object.fromEntries(sent[2]!.body)).toEqual({ hatchery: "12", slot: "0", count: "1" });
    expect(Object.fromEntries(sent[3]!.body)).toEqual({ hatchery: "hcc" });
  });
});

const T0 = 2_000_000;

const loadOf = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 0, r4: 1e6 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: { "10": { id: 10, t: 13, l: 3, X: 0, Y: 0 } },
    buildinghealthdata: {},
    storedata: {},
    lockerdata: { C1: { t: 2 }, C4: { t: 1 } },
    ...extra,
  }) as unknown as BaseLoadResponse;

const answer = <R>(report: R, extra: Record<string, unknown> = {}): YardResponse<R> =>
  ({ error: 0, savetime: T0, currenttime: T0, completed: [], report, ...extra }) as unknown as YardResponse<R>;

const setup = (load: Partial<BaseLoadResponse> = {}) => {
  const yardApi = {
    state: vi.fn(() => Promise.resolve(answer(null))),
    shopBuy: vi.fn((item: string) => Promise.resolve(answer({ item, credits: 30, q: 1, endsAt: T0 + 3600 }))),
  } as unknown as YardApi & Record<"state" | "shopBuy", ReturnType<typeof vi.fn>>;
  const api = {
    add: vi.fn((hatchery: number | "hcc", monster: string, count: number) =>
      Promise.resolve(
        answer(
          { hatchery, monster, added: count, requested: count, stoppedBy: null, cost: { r4: count * 250 } },
          { resources: { r1: 0, r2: 0, r3: 0, r4: 1e6 - count * 250 } },
        ),
      ),
    ),
    remove: vi.fn((hatchery: number | "hcc", slot: number) =>
      Promise.resolve(answer({ hatchery, slot, monster: "C1", removed: 20, refund: { r4: 5_000 } })),
    ),
    finish: vi.fn((hatchery: number | "hcc") =>
      Promise.resolve(answer({ hatchery, housed: { C1: 3 }, credits: 8, finishedAll: true })),
    ),
  } satisfies HatcheryApi;
  const store = new YardStore({
    save: loadOf(load),
    api: yardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  return { store, api, yardApi, actions: hatcheryActions(store, api) };
};

describe("hatcheryActions", () => {
  it("adds a batch in one request and merges the answer", async () => {
    const { store, api, actions } = setup();
    const result = await actions.add(10, "C1", 80);
    expect(api.add).toHaveBeenCalledOnce();
    expect(api.add).toHaveBeenCalledWith(10, "C1", 80);
    expect(result).toMatchObject({ ok: true, report: { added: 80 } });
    expect(store.resources.r4).toBe(1e6 - 80 * 250);
  });

  it("refuses locally a monster that is not unlocked, or a count out of range", async () => {
    const { api, actions } = setup();
    const unlocking = await actions.add(10, "C4", 5);
    expect(unlocking.ok ? null : unlocking.refusal).toMatchObject({ reason: "locked", local: true });
    const hidden = await actions.add(10, "C18", 5);
    expect(hidden.ok ? null : hidden.refusal.reason).toBe("badRequest");
    const tooMany = await actions.add(10, "C1", 401);
    expect(tooMany.ok ? null : tooMany.refusal.reason).toBe("badRequest");
    const none = await actions.add(10, "C1", 0);
    expect(none.ok ? null : none.refusal.reason).toBe("badRequest");
    expect(api.add).not.toHaveBeenCalled();
  });

  it("removes and finishes through the queue", async () => {
    const { api, actions } = setup();
    expect((await actions.remove("hcc", 3, "all")).ok).toBe(true);
    expect(api.remove).toHaveBeenCalledWith("hcc", 3, "all");
    expect((await actions.finish(10)).ok).toBe(true);
    expect(api.finish).toHaveBeenCalledWith(10);
  });

  it("buys an Overdrive through the shop, and refuses a second while one runs", async () => {
    const { yardApi, actions } = setup();
    expect((await actions.overdrive("HOD2")).ok).toBe(true);
    expect(yardApi.shopBuy).toHaveBeenCalledWith("HOD2");

    const running = setup({ storedata: { HOD: { q: 1, s: T0 - 60, e: T0 + 60 } } });
    const refused = await running.actions.overdrive("HOD3");
    expect(refused.ok ? null : refused.refusal).toMatchObject({
      reason: "alreadyActive",
      detail: { item: "HOD", endsAt: T0 + 60 },
    });
    expect(running.yardApi.shopBuy).not.toHaveBeenCalled();
  });

  it("runs under one key per action", async () => {
    const { store, actions } = setup();
    const pending = actions.add(10, "C1", 1);
    expect(store.isRunning(HatcheryKey.ADD)).toBe(true);
    await pending;
    expect(store.isRunning(HatcheryKey.ADD)).toBe(false);
  });
});
