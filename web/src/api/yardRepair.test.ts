import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { YardStore } from "@/game/yard/YardStore";
import {
  repairActions,
  repairAll,
  repairBuildings,
  repairNow,
  type RepairApi,
  type RepairInstantReport,
  type RepairReport,
} from "./yardRepair";

/** The repair routes on the wire, and their trip through the store's queue. */

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

describe("repair routes", () => {
  it("posts ids as a JSON array, all=1, and nothing for Repair now", async () => {
    stubFetch();
    await repairBuildings([4, 7]);
    await repairAll();
    await repairNow();
    expect(sent.map((call) => call.url.replace(/^.*\/bm\/yard/, ""))).toEqual([
      "/repair",
      "/repair",
      "/repair/instant",
    ]);
    expect(sent[0]!.body.get("ids")).toBe("[4,7]");
    expect(sent[1]!.body.get("all")).toBe("1");
  });
});

const T0 = 2_000_000;

const snapper = (id: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t: 1,
  X: id * 40,
  Y: 0,
  ...extra,
});

const setup = (buildings: BuildingData[]) => {
  const repaired = Object.fromEntries(
    buildings.map((b) => [String(b.id), { ...b, ...(b.hp !== undefined && { rE: 1 }) }]),
  );
  const answer = <Report>(report: Report): YardResponse<Report> =>
    ({
      error: 0,
      savetime: T0,
      currenttime: T0,
      completed: [],
      report,
      buildingdata: repaired,
      buildinghealthdata: {},
    }) as unknown as YardResponse<Report>;
  const started: RepairReport = { started: [1], skipped: [], doneBy: T0 + 24 };
  const healed: RepairInstantReport = { repaired: [1], credits: 0 };
  const api = {
    ids: vi.fn(() => Promise.resolve(answer(started))),
    all: vi.fn(() => Promise.resolve(answer(started))),
    now: vi.fn(() => Promise.resolve(answer(healed))),
  } satisfies RepairApi;
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: {},
      buildingdata: Object.fromEntries(buildings.map((b) => [String(b.id), b])),
      buildinghealthdata: {},
      storedata: {},
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn() } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  return { store, api, actions: repairActions(store, api) };
};

describe("repairActions", () => {
  it("repairs one building and merges the answer", async () => {
    const { store, api, actions } = setup([snapper(1, { hp: 100 })]);
    const result = await actions.one(1);
    expect(api.ids).toHaveBeenCalledWith([1]);
    expect(result).toMatchObject({ ok: true, report: { started: [1] } });
    expect(store.save.buildingdata?.["1"]?.rE).toBe(1);
  });

  it("refuses locally a whole building, one already repairing, and nothing to repair", async () => {
    const { api, actions } = setup([snapper(1), snapper(2, { hp: 100, rE: 1 })]);
    expect(await actions.one(1)).toMatchObject({ ok: false, refusal: { reason: "notDamaged", local: true } });
    expect(await actions.one(2)).toMatchObject({ ok: false, refusal: { reason: "notDamaged", local: true } });
    expect(await actions.all()).toMatchObject({ ok: false, refusal: { reason: "notDamaged" } });
    expect(api.ids).not.toHaveBeenCalled();
    expect(api.all).not.toHaveBeenCalled();
  });

  it("a second Repair all queued behind the first finds everything repairing and is not sent", async () => {
    const { api, actions } = setup([snapper(1, { hp: 100 })]);
    const first = actions.all();
    const second = actions.all();
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: false, refusal: { reason: "notDamaged" } });
    expect(api.all).toHaveBeenCalledTimes(1);
  });

  it("Repair now goes out while anything is damaged, repairing or not", async () => {
    const { api, actions } = setup([snapper(1, { hp: 100, rE: 1 })]);
    expect(await actions.now()).toMatchObject({ ok: true, report: { repaired: [1] } });
    expect(api.now).toHaveBeenCalledTimes(1);
  });
});
