import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPresence } from "./presence";

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = () => {
  const fetch = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ error: 0 }), { status: 200 })),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("sendPresence", () => {
  it("POSTs to bm/presence saying the player is elsewhere by default", async () => {
    const fetch = stubFetch();
    expect(await sendPresence()).toEqual({ error: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toMatch(/\/api\/[^/]+\/bm\/presence$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ where: "other", planner: false });
  });

  it("sends the yard and the Planner as JSON, the Planner a real boolean (#226)", async () => {
    const fetch = stubFetch();
    await sendPresence({ where: "yard", planner: false });
    await sendPresence({ where: "yard", planner: true });
    const bodies = fetch.mock.calls.map(([, init]) => init.body);
    expect(bodies).toEqual(['{"where":"yard","planner":false}', '{"where":"yard","planner":true}']);
    expect(new Headers(fetch.mock.calls[0]![1].headers).get("content-type")).toMatch(/application\/json/);
  });
});
