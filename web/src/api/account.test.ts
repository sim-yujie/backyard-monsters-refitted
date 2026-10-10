import { afterEach, describe, expect, it, vi } from "vitest";
import { setShinyLocked } from "./account";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setShinyLocked", () => {
  it("sends a real JSON boolean, which the server's schema insists on", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ error: 0, settings: { shinyLocked: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    expect(await setShinyLocked(true)).toBe(true);
    expect(calls[0]?.url).toMatch(/\/player\/settings$/);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ shinyLocked: true });
  });
});
