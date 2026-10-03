import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPresence } from "./presence";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendPresence", () => {
  it("POSTs to bm/presence with no body fields", async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ error: 0 }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await sendPresence()).toEqual({ error: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toMatch(/\/api\/[^/]+\/bm\/presence$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("");
  });
});
