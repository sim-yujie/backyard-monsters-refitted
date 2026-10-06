import { afterEach, describe, expect, it, vi } from "vitest";
import { springTrojan } from "./trojan";

/** Springing the Trojan Horse (#327): the one route this work package adds. */

const sent: { url: string; init: RequestInit }[] = [];

const stubFetch = (body: unknown): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

describe("springTrojan", () => {
  it("POSTs /bm/raid/trojan with no body and returns the raid and fight unchanged", async () => {
    const raid = { id: "r1", phase: "fighting", tribe: "wild", monsters: { C2: 3 }, attackAt: 1_000, warned: 1 };
    const fight = { seed: 7, events: [], tick: 480, seconds: 6, yard: { buildingdata: {}, buildinghealthdata: {}, resources: {} }, defence: null };
    stubFetch({ error: 0, raid, fight });

    const response = await springTrojan();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toMatch(/\/bm\/raid\/trojan$/);
    expect(sent[0]!.init.method).toBe("POST");
    expect(response).toEqual({ error: 0, raid, fight });
  });
});
