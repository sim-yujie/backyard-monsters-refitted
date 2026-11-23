import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, ChampionSaveEntry, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { NetworkError } from "./http";
import { YardStore } from "@/game/yard/YardStore";
import { onFed, type FedNews } from "@/game/monsters/feedNews";
import { hatchCost } from "@/game/monsters/monsterCatalogue";
import { championActions, type ChampionApi, type ChampionFeedReport } from "./yardChampion";

/** The feed route tells the yard once the server has fed the champion monsters, and only then (`feedNews.ts`). */

const T0 = 2_000_000;
const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const gorgo: ChampionSaveEntry = { t: 1, hp: 40_000, l: 1, ft: T0 - 1, fd: 0, fb: 0, pl: 1, status: 0 };

const setup = (answer: YardResponse<ChampionFeedReport> | Promise<never>, housed: Record<string, number> = { C2: 40 }) => {
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: {},
      credits: 1_000,
      buildingdata: { "3": { id: 3, t: 114, l: 1, X: 0, Y: 0 } },
      buildinghealthdata: {},
      storedata: {},
      monsters: { housed },
      academy: { C2: { level: 3 } },
      champion: [gorgo],
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn() } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const api = {
    feed: vi.fn(() => (answer instanceof Promise ? answer : Promise.resolve(answer))),
  } as unknown as ChampionApi;
  const heard: FedNews[] = [];
  stops.push(onFed((news) => heard.push(news)));
  return { actions: championActions(store, api), heard };
};

const answerWith = (report: ChampionFeedReport) =>
  ({ error: 0, savetime: T0, currenttime: T0, completed: [], report }) as unknown as YardResponse<ChampionFeedReport>;

const fedChampion = { ...gorgo, fd: 1, ft: T0 + 82_800 };

describe("championActions: word of a feed", () => {
  it("tells the yard which champion ate what, with the hatch costs, once the server answers", async () => {
    const { actions, heard } = setup(
      answerWith({ champion: fedChampion, mode: "monsters", eaten: { C2: 15 }, credits: 0, evolved: false }),
    );
    expect((await actions.feed("monsters")).ok).toBe(true);
    expect(heard).toEqual([{ champion: "G1", monsters: { C2: 15 }, hatchCost: { C2: hatchCost("C2", 3) } }]);
  });

  it("says nothing for a Shiny feed, which eats no monsters (as in Flash)", async () => {
    const { actions, heard } = setup(
      answerWith({ champion: fedChampion, mode: "shiny", eaten: {}, credits: 26, evolved: false }),
    );
    expect((await actions.feed("shiny")).ok).toBe(true);
    expect(heard).toEqual([]);
  });

  it("says nothing for a feed refused here or by the server", async () => {
    const report = answerWith({ champion: fedChampion, mode: "monsters", eaten: { C2: 15 }, credits: 0, evolved: false });
    const short = setup(report, { C2: 2 });
    expect((await short.actions.feed("monsters")).ok).toBe(false);
    const refused = setup(Promise.reject(new NetworkError("offline", null)));
    await refused.actions.feed("monsters");
    expect(short.heard).toEqual([]);
    expect(refused.heard).toEqual([]);
  });
});
