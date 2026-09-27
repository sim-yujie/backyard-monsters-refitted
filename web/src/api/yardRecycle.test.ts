import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { YardStore } from "@/game/yard/YardStore";
import { recycleAction, recycleBuilding, type RecycleReport } from "./yardRecycle";

/** The recycle route on the wire, and its trip through the store's queue. */

const sent: { url: string; body: URLSearchParams }[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

describe("recycle route", () => {
  it("posts the building id", async () => {
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
    await recycleBuilding(12);
    expect(sent[0]!.url).toMatch(/\/bm\/yard\/recycle$/);
    expect(sent[0]!.body.get("id")).toBe("12");
  });
});

const T0 = 2_000_000;

const setup = (buildings: BuildingData[]) => {
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
  const report: RecycleReport = {
    id: 2,
    t: 20,
    refund: { r1: 10, r2: 10, r3: 0, r4: 0 },
    lost: { r1: 0, r2: 0, r3: 0, r4: 0 },
    stored: null,
    culled: {},
  };
  const send = vi.fn(() =>
    Promise.resolve({
      error: 0,
      savetime: T0,
      currenttime: T0,
      completed: [],
      report,
      buildingdata: Object.fromEntries(
        buildings.filter((b) => b.id !== 2).map((b) => [String(b.id), b]),
      ),
    } as unknown as YardResponse<RecycleReport>),
  );
  return { store, send };
};

describe("recycleAction", () => {
  const hall = { id: 1, t: 14, X: 0, Y: 0, l: 5 } as BuildingData;
  const tower = { id: 2, t: 20, X: 40, Y: 0, l: 3 } as BuildingData;

  it("recycles and merges the answer", async () => {
    const { store, send } = setup([hall, tower]);
    const result = await recycleAction(store, 2, send);
    expect(send).toHaveBeenCalledWith(2);
    expect(result).toMatchObject({ ok: true, report: { id: 2 } });
    expect(store.save.buildingdata?.["2"]).toBeUndefined();
  });

  it("refuses locally the Town Hall, a busy building and one already gone", async () => {
    const { store, send } = setup([hall, { ...tower, cU: 60 }]);
    expect(await recycleAction(store, 1, send)).toMatchObject({
      ok: false,
      refusal: { reason: "isTownHall", local: true },
    });
    expect(await recycleAction(store, 2, send)).toMatchObject({ ok: false, refusal: { reason: "busy" } });
    expect(await recycleAction(store, 9, send)).toMatchObject({ ok: false, refusal: { reason: "badRequest" } });
    expect(send).not.toHaveBeenCalled();
  });
});
