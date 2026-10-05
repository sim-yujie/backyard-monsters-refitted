import { afterEach, describe, expect, it, vi } from "vitest";
import { achievementsApi } from "./achievements";

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

  it("marks pop-ups seen with the ids as a JSON list, and answers the ids marked", async () => {
    stubFetch({ error: 0, completed: [], report: { seen: [2] } });
    expect(await achievementsApi.seen([2, 6])).toEqual([2]);
    expect(calls[0]?.url).toMatch(/\/bm\/yard\/achievements\/seen$/);
    expect(calls[0]?.body.get("ids")).toBe("[2,6]");
  });

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
