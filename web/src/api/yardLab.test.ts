import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { YardStore } from "@/game/yard/YardStore";
import { LabKey, labActions, labCancel, labFinish, labInstant, labStart, type LabApi } from "./yardLab";

/** The Lab routes on the wire, and their trip through the store's queue. */

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

describe("lab routes", () => {
  it("posts each action to its path; only start and instant name a monster", async () => {
    stubFetch(200, { error: 0, savetime: 1, currenttime: 1, completed: [], report: null });
    await labStart("C3");
    await labCancel();
    await labFinish();
    await labInstant("C4");
    expect(sent.map((call) => call.url.replace(/^.*\/bm\/yard/, ""))).toEqual([
      "/lab/start",
      "/lab/cancel",
      "/lab/finish",
      "/lab/instant",
    ]);
    expect(sent.map((call) => call.body.get("monster"))).toEqual(["C3", null, null, "C4"]);
  });
});

const T0 = 2_000_000;

const building = (id: number, t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

/** A level 2 Lab; Bolt (C3) ready for rank 1, Fink (C4) for rank 2. */
const loadOf = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 1e7, r4: 0 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: { "1": building(1, 14, 7), "9": building(9, 116, 2) },
    buildinghealthdata: {},
    storedata: {},
    lockerdata: { C3: { t: 2 }, C4: { t: 2 } },
    academy: { C3: { level: 2 }, C4: { level: 3, powerup: 1 } },
    ...extra,
  }) as unknown as BaseLoadResponse;

const answer = <R>(report: R, extra: Record<string, unknown> = {}): YardResponse<R> =>
  ({ error: 0, savetime: T0, currenttime: T0, completed: [], report, ...extra }) as unknown as YardResponse<R>;

const setup = (load: Partial<BaseLoadResponse> = {}) => {
  const yardApi = { state: vi.fn(() => Promise.resolve(answer(null))) } as unknown as YardApi;
  const api = {
    start: vi.fn((monster: string) =>
      Promise.resolve(
        answer(
          { monster, rank: 1, lab: 9, endsAt: T0 + 86_400, cost: { r3: 48_000 } },
          {
            buildingdata: {
              "1": building(1, 14, 7),
              "9": building(9, 116, 2, { upg: monster, upt: T0 + 86_400, upl: 1 }),
            },
          },
        ),
      ),
    ),
    cancel: vi.fn(() => Promise.resolve(answer({ monster: "C3", rank: 1, refund: { r3: 48_000 } }))),
    finish: vi.fn(() => Promise.resolve(answer({ monster: "C3", rank: 1, credits: 262 }))),
    instant: vi.fn((monster: string) => Promise.resolve(answer({ monster, rank: 2, credits: 400 }))),
  } satisfies LabApi;
  const store = new YardStore({
    save: loadOf(load),
    api: yardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  return { store, api, actions: labActions(store, api) };
};

describe("labActions", () => {
  it("sends a research the client can see is allowed, and merges the answer", async () => {
    const { store, api, actions } = setup();
    const result = await actions.start("C3");
    expect(api.start).toHaveBeenCalledWith("C3");
    expect(result).toMatchObject({ ok: true, report: { monster: "C3", rank: 1 } });
    expect(store.save.buildingdata?.["9"]?.["upg"]).toBe("C3");
  });

  it("refuses locally, in the server's terms, what the state already says no to", async () => {
    const { api, actions } = setup({ resources: { r3: 40_000 } });
    expect(await actions.start("C3")).toEqual({
      ok: false,
      refusal: {
        reason: "shortfall",
        message: "Need 8,000 more putty.",
        detail: { shortfall: { r1: 0, r2: 0, r3: 8_000, r4: 0 } },
        local: true,
      },
    });
    const none = await actions.start("C1");
    expect(none.ok ? null : none.refusal.reason).toBe("badRequest");
    expect(api.start).not.toHaveBeenCalled();
  });

  it("re-checks a queued research against the answer ahead of it: one Lab, one research", async () => {
    const { api, actions } = setup();
    const first = actions.start("C3");
    const second = actions.start("C4");
    await first;
    const refused = await second;
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(refused.ok ? null : refused.refusal.reason).toBe("labBusy");
  });

  it("cancels and finishes only a running research", async () => {
    const idle = setup();
    expect((await idle.actions.cancel()).ok).toBe(false);
    expect((await idle.actions.finish()).ok).toBe(false);
    expect(idle.api.cancel).not.toHaveBeenCalled();

    const busy = setup({
      buildingdata: { "1": building(1, 14, 7), "9": building(9, 116, 2, { upg: "C3", upt: T0 + 100, upl: 1 }) },
    });
    expect((await busy.actions.cancel()).ok).toBe(true);
    expect(busy.api.cancel).toHaveBeenCalled();
  });

  it("instant needs no putty", async () => {
    const { api, actions } = setup({ resources: { r3: 0 } });
    expect((await actions.instant("C4")).ok).toBe(true);
    expect(api.instant).toHaveBeenCalledWith("C4");
  });

  it("runs under one key per action", async () => {
    const { store, actions } = setup();
    const pending = actions.start("C3");
    expect(store.isRunning(LabKey.START)).toBe(true);
    await pending;
    expect(store.isRunning(LabKey.START)).toBe(false);
  });
});
