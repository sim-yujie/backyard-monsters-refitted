import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unlockInbox } from "@/game/achievements/unlockInbox";
import type { YardStore } from "@/game/yard/YardStore";
import {
  achievementsApi,
  AchievementsSeenKey,
  markAchievementsSeen,
  markSeenAction,
  type AchievementsSeenReport,
} from "./achievements";
import { takeOverCell } from "./maproom";
import type { YardResponse } from "./types";

/** The achievements routes as the screen and the pop-up call them (#204). */

interface Call {
  url: string;
  method: string;
  body: URLSearchParams;
}

const calls: Call[] = [];

const stubFetch = (answer: unknown, status = 200): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: new URLSearchParams(String(init.body ?? "")) });
      return Promise.resolve(new Response(JSON.stringify(answer), { status }));
    }),
  );
};

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("achievementsApi", () => {
  it("reads the player's own list from the yard action's report, with no baseid", async () => {
    const report = { achievements: [], earned: 0, total: 16, shinyEarned: 0, fresh: [] };
    stubFetch({ error: 0, completed: [], report });
    expect(await achievementsApi.state()).toEqual(report);
    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(calls[0]?.url).toMatch(/\/bm\/yard\/achievements\/state$/);
    expect(calls[0]?.body.has("baseid")).toBe(false);
  });

  it("has one seen call, the pop-up's, not the screen's", () => {
    expect(Object.keys(achievementsApi).sort()).toEqual(["player", "state"]);
  });
});

describe("achievements/seen", () => {
  it("posts ids as a JSON array, with the outpost's baseid when given", async () => {
    stubFetch({ error: 0, savetime: 1, currenttime: 1, completed: [], report: { seen: [2, 5] } });
    expect((await markAchievementsSeen([2, 5])).report.seen).toEqual([2, 5]);
    await markAchievementsSeen([7], "2001");
    expect(calls[0]?.url).toMatch(/\/bm\/yard\/achievements\/seen$/);
    expect(calls[0]?.body.get("ids")).toBe("[2,5]");
    expect(calls[0]?.body.has("baseid")).toBe(false);
    expect(calls[1]?.body.get("ids")).toBe("[7]");
    expect(calls[1]?.body.get("baseid")).toBe("2001");
  });

  it("runs through the yard store's queue under its own key, passing the yard on", async () => {
    const send = vi.fn((_ids: readonly number[], _baseid?: string) =>
      Promise.resolve({ error: 0, report: { seen: [4] } } as unknown as YardResponse<AchievementsSeenReport>),
    );
    const run = vi.fn((action: { key: string; send: (api: never, baseid?: string) => Promise<unknown> }) =>
      action.send(undefined as never, "2001"),
    );
    await markSeenAction({ run } as unknown as Pick<YardStore, "run">, [4], send);
    expect(run.mock.calls[0]?.[0].key).toBe(AchievementsSeenKey);
    expect(send).toHaveBeenCalledWith([4], "2001");
  });
});

describe("takeOverCell", () => {
  beforeEach(() => unlockInbox.reset());
  afterEach(() => unlockInbox.reset());

  it("queues the answer's unlocks for the next yard", async () => {
    stubFetch({ error: 0, achievements: [{ id: 3, name: "Squatter", shiny: 10 }] });
    await takeOverCell("1234", "resources");
    expect(unlockInbox.size).toBe(1);
    expect(unlockInbox.next()).toMatchObject({ unlocks: [{ id: 3, name: "Squatter", shiny: 10 }] });
  });

  it("queues nothing when the answer has no achievements (rewards off)", async () => {
    stubFetch({ error: 0 });
    await takeOverCell("1234", "shiny");
    expect(unlockInbox.size).toBe(0);
    expect(calls[0]?.body.get("shiny")).toBe("1");
  });
});

describe("achievementsApi, another player", () => {

  it("reads another player's list by id, keeping only the list's own fields", async () => {
    stubFetch({ error: 0, userid: 77, name: "Bob", earned: 1, total: 16, achievements: [{ id: 1, status: "earned" }] });
    expect(await achievementsApi.player(77)).toEqual({
      userid: 77,
      name: "Bob",
      earned: 1,
      total: 16,
      achievements: [{ id: 1, status: "earned" }],
    });
    expect(calls[0]).toMatchObject({ method: "GET" });
    expect(calls[0]?.url).toMatch(/\/bm\/achievements\/player\/77$/);
  });

  it("throws on a 404, for the screen to say so", async () => {
    stubFetch({ error: "Player not found", reason: "notFound" }, 404);
    await expect(achievementsApi.player(4040)).rejects.toMatchObject({ status: 404 });
  });
});
