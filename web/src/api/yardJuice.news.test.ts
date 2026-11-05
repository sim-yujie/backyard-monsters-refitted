import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { NetworkError } from "./http";
import { YardStore } from "@/game/yard/YardStore";
import { onJuiced, type JuicedNews } from "@/game/monsters/juiceNews";
import { hatchCost } from "@/game/monsters/monsterCatalogue";
import { juiceActions, type JuiceApi, type JuiceReport } from "./yardJuice";

/** The juice route tells the yard once the server has juiced, and only then (`juiceNews.ts`). */

const T0 = 2_000_000;
const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const setup = (answer: YardResponse<JuiceReport> | Promise<never>) => {
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: {},
      credits: 0,
      buildingdata: { "7": { id: 7, t: 9, l: 2, X: 0, Y: 0 } },
      buildinghealthdata: {},
      storedata: {},
      monsters: { housed: { C1: 5 } },
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn() } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const api = { juice: vi.fn(() => (answer instanceof Promise ? answer : Promise.resolve(answer))) } as unknown as JuiceApi;
  const heard: JuicedNews[] = [];
  stops.push(onJuiced((news) => heard.push(news)));
  return { actions: juiceActions(store, api), heard };
};

const report: JuiceReport = { juiced: { C1: 2 }, goo: 10, lost: 0, rate: 0.8 };

describe("juiceActions: word of a juice", () => {
  it("tells the yard which Juicer juiced what, with the hatch costs, once the server answers", async () => {
    const answer = { error: 0, savetime: T0, currenttime: T0, completed: [], report } as unknown as YardResponse<JuiceReport>;
    const { actions, heard } = setup(answer);
    const result = await actions.juice({ C1: 2 });
    expect(result.ok).toBe(true);
    expect(heard).toEqual([
      { juicer: 7, level: 2, monsters: { C1: 2 }, hatchCost: { C1: hatchCost("C1", 1) }, rate: 0.8 },
    ]);
  });

  it("says nothing for a juice refused here or by the server", async () => {
    const answer = { error: 0, savetime: T0, currenttime: T0, completed: [], report } as unknown as YardResponse<JuiceReport>;
    const { actions, heard } = setup(answer);
    expect((await actions.juice({ C1: 9 })).ok).toBe(false);
    const refused = setup(Promise.reject(new NetworkError("offline", null)));
    await refused.actions.juice({ C1: 1 });
    expect(heard).toEqual([]);
    expect(refused.heard).toEqual([]);
  });
});
