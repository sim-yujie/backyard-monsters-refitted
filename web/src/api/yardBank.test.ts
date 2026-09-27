import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { YardStore } from "@/game/yard/YardStore";
import { bankActions, bankAll, bankHarvesters, type BankApi, type BankReport } from "./yardBank";

/** The bank route on the wire, and its trip through the store's queue. */

const sent: { url: string; body: URLSearchParams }[] = [];

const stubFetch = (): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, body: new URLSearchParams(String(init.body ?? "")) });
      return Promise.resolve(
        new Response(
          JSON.stringify({ error: 0, savetime: 1, currenttime: 1, completed: [], report: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

describe("bank route", () => {
  it("posts ids as a JSON array, or all=1", async () => {
    stubFetch();
    await bankHarvesters([4, 7]);
    await bankAll();
    expect(sent.map((call) => call.url.replace(/^.*\/bm\/yard/, ""))).toEqual(["/bank", "/bank"]);
    expect(sent[0]!.body.get("ids")).toBe("[4,7]");
    expect(sent[0]!.body.has("all")).toBe(false);
    expect(sent[1]!.body.get("all")).toBe("1");
  });
});

const T0 = 2_000_000;

const harvester = (id: number, st: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t: 1,
  X: id * 40,
  Y: 0,
  st,
  pr: st >= 720 ? 0 : 1,
  ...extra,
});

const report = (amount: number): BankReport => ({
  banked: { r1: amount, r2: 0, r3: 0, r4: 0 },
  byBuilding: { "1": { resource: "r1", amount } },
  leftInBuffers: { r1: 0, r2: 0, r3: 0, r4: 0 },
  skipped: [],
  points: amount,
});

const setup = (buildings: BuildingData[]) => {
  const answer = (amount: number): YardResponse<BankReport> =>
    ({
      error: 0,
      savetime: T0,
      currenttime: T0,
      completed: [],
      report: report(amount),
      resources: { r1: amount },
      buildingdata: Object.fromEntries(buildings.map((b) => [String(b.id), { ...b, st: 0, pr: 1, cP: 10 }])),
    }) as unknown as YardResponse<BankReport>;
  const api = {
    ids: vi.fn(() => Promise.resolve(answer(720))),
    all: vi.fn(() => Promise.resolve(answer(720))),
  } satisfies BankApi;
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: { r1: 0 },
      caps: { r1: 1e6, r2: 1e6, r3: 1e6, r4: 1e6 },
      buildingdata: Object.fromEntries(buildings.map((b) => [String(b.id), b])),
      buildinghealthdata: {},
      storedata: {},
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn() } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  return { store, api, actions: bankActions(store, api) };
};

describe("bankActions", () => {
  it("banks one harvester and merges the answer", async () => {
    const { store, api, actions } = setup([harvester(1, 720)]);
    const result = await actions.one(1);
    expect(api.ids).toHaveBeenCalledWith([1]);
    expect(result).toMatchObject({ ok: true, report: { banked: { r1: 720 } } });
    expect(store.resources.r1).toBe(720);
  });

  it("refuses locally a harvester with nothing, a busy one, and a stranger", async () => {
    const { api, actions } = setup([harvester(1, 0, { pr: 0 }), harvester(2, 500, { cU: 60 })]);
    expect(await actions.one(1)).toMatchObject({ ok: false, refusal: { reason: "empty", local: true } });
    expect(await actions.one(2)).toMatchObject({ ok: false, refusal: { reason: "busy", local: true } });
    expect(await actions.one(99)).toMatchObject({ ok: false, refusal: { reason: "badRequest" } });
    expect(api.ids).not.toHaveBeenCalled();
  });

  it("a second Collect all queued behind the first finds nothing left and is not sent", async () => {
    const { api, actions } = setup([harvester(1, 720)]);
    const first = actions.all();
    const second = actions.all();
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: false, refusal: { reason: "empty" } });
    expect(api.all).toHaveBeenCalledTimes(1);
  });
});
